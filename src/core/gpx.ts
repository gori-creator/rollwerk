import type { Route, RoutePoint } from './types';

const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

interface RawPoint {
  lat: number;
  lon: number;
  ele: number | null;
}

export function parseGpxPoints(xml: string): { name: string; points: RawPoint[] } {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Die Datei ist kein gültiges GPX.');
  let nodes = Array.from(doc.getElementsByTagName('trkpt'));
  if (!nodes.length) nodes = Array.from(doc.getElementsByTagName('rtept'));
  const points: RawPoint[] = [];
  for (const n of nodes) {
    const lat = parseFloat(n.getAttribute('lat') ?? '');
    const lon = parseFloat(n.getAttribute('lon') ?? '');
    if (!isFinite(lat) || !isFinite(lon)) continue;
    const eleNode = n.getElementsByTagName('ele')[0];
    const ele = eleNode ? parseFloat(eleNode.textContent ?? '') : NaN;
    points.push({ lat, lon, ele: isFinite(ele) ? ele : null });
  }
  const trk = doc.getElementsByTagName('trk')[0] ?? doc.getElementsByTagName('rte')[0];
  const nameNode = trk?.getElementsByTagName('name')[0] ?? doc.getElementsByTagName('name')[0];
  return { name: nameNode?.textContent?.trim() || '', points };
}

/**
 * Baut aus rohen GPS-Punkten eine Strecke mit gleichmäßigem Punktabstand
 * und geglätteter Höhe. Rohe GPX-Höhen springen stark, ohne Glättung
 * würde die Rolle ständig hin- und herregeln.
 */
export function buildRoute(name: string, raw: RawPoint[], step = 10): Route {
  if (raw.length < 2) throw new Error('Die Datei enthält keine Strecke (zu wenige Punkte).');
  const hasElevation = raw.filter((p) => p.ele !== null).length > raw.length / 2;

  // fehlende Höhen auffüllen
  let last = raw.find((p) => p.ele !== null)?.ele ?? 0;
  const pts = raw.map((p) => {
    if (p.ele !== null) last = p.ele;
    return { lat: p.lat, lon: p.lon, ele: hasElevation ? last : 0 };
  });

  const cum: number[] = [0];
  for (let i = 1; i < pts.length; i++) {
    cum.push(cum[i - 1] + haversine(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon));
  }
  const total = cum[cum.length - 1];
  if (total < 50) throw new Error('Die Strecke ist zu kurz.');

  // gleichmäßig neu abtasten
  const n = Math.max(2, Math.floor(total / step) + 1);
  const res: RoutePoint[] = [];
  let j = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.min(i * step, total);
    while (j < cum.length - 2 && cum[j + 1] < d) j++;
    const span = cum[j + 1] - cum[j];
    const f = span > 0 ? (d - cum[j]) / span : 0;
    res.push({
      lat: pts[j].lat + (pts[j + 1].lat - pts[j].lat) * f,
      lon: pts[j].lon + (pts[j + 1].lon - pts[j].lon) * f,
      ele: pts[j].ele + (pts[j + 1].ele - pts[j].ele) * f,
      dist: d,
    });
  }

  // Höhe glätten: gleitender Mittelwert über ca. 150 m, zwei Durchgänge
  const half = Math.max(1, Math.round(75 / step));
  for (let pass = 0; pass < 2; pass++) {
    const src = res.map((p) => p.ele);
    for (let i = 0; i < res.length; i++) {
      let sum = 0;
      let cnt = 0;
      for (let k = Math.max(0, i - half); k <= Math.min(res.length - 1, i + half); k++) {
        sum += src[k];
        cnt++;
      }
      res[i].ele = sum / cnt;
    }
  }

  let ascent = 0;
  for (let i = 1; i < res.length; i++) {
    const d = res[i].ele - res[i - 1].ele;
    if (d > 0) ascent += d;
  }

  return {
    id: crypto.randomUUID(),
    name: name || 'Strecke',
    step,
    points: res,
    distance: res[res.length - 1].dist,
    ascent,
    hasElevation,
    created: Date.now(),
  };
}

/** Erzeugt einen Anstieg aus Länge und mittlerer Steigung (ohne echte GPS-Koordinaten). */
export function makeClimb(name: string, lengthKm: number, avgGrade: number): Route {
  const step = 10;
  const n = Math.max(10, Math.round((lengthKm * 1000) / step)) + 1;
  const points: RoutePoint[] = [];
  let ele = 0;
  for (let i = 0; i < n; i++) {
    const f = i / (n - 1);
    // leichte Wellen, damit der Anstieg nicht völlig gleichförmig ist; im Mittel bleibt die Steigung erhalten
    const g = (avgGrade / 100) * (1 + 0.25 * Math.sin(f * Math.PI * 6) + 0.15 * Math.sin(f * Math.PI * 17));
    if (i > 0) ele += g * step;
    points.push({ lat: 0, lon: 0, ele, dist: i * step });
  }
  return {
    id: crypto.randomUUID(), name, step, points, distance: (n - 1) * step,
    ascent: points.reduce((a, p, i) => a + (i && p.ele > points[i - 1].ele ? p.ele - points[i - 1].ele : 0), 0),
    hasElevation: true, synthetic: true, created: Date.now(),
  };
}

export function parseGpx(xml: string, fallbackName = 'Strecke'): Route {
  const { name, points } = parseGpxPoints(xml);
  return buildRoute(name || fallbackName, points);
}

export interface RoutePosition {
  lat: number;
  lon: number;
  ele: number;
  grade: number; // Dezimal, 0.05 = 5 %
}

/** Position und Steigung an einer Distanz (m ab Start). */
export function positionAt(route: Route, dist: number): RoutePosition {
  const pts = route.points;
  const d = Math.max(0, Math.min(dist, route.distance));
  const i = Math.min(pts.length - 2, Math.floor(d / route.step));
  const a = pts[i];
  const b = pts[i + 1];
  const span = b.dist - a.dist;
  const f = span > 0 ? (d - a.dist) / span : 0;
  // Steigung über ca. 30 m gemittelt
  const w = Math.max(1, Math.round(15 / route.step));
  const lo = pts[Math.max(0, i - w + 1)];
  const hi = pts[Math.min(pts.length - 1, i + w)];
  const run = hi.dist - lo.dist;
  let grade = run > 0 ? (hi.ele - lo.ele) / run : 0;
  grade = Math.max(-0.25, Math.min(0.25, grade));
  return {
    lat: a.lat + (b.lat - a.lat) * f,
    lon: a.lon + (b.lon - a.lon) * f,
    ele: a.ele + (b.ele - a.ele) * f,
    grade,
  };
}
