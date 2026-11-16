import type { Ride, RideStats } from './types';

export function computeStats(ride: Pick<Ride, 'samples' | 'ftp'>): RideStats {
  const s = ride.samples;
  const n = s.length;
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const powers = s.map((x) => x.power);
  const hrs = s.filter((x) => x.hr !== undefined && x.hr > 0).map((x) => x.hr!);
  const cads = s.filter((x) => x.cadence !== undefined && x.cadence > 0).map((x) => x.cadence!);

  // Normalized Power: 30-s-Mittel, vierte Potenz
  let np = 0;
  if (n >= 30) {
    let sum = 0;
    let acc = 0;
    let cnt = 0;
    for (let i = 0; i < n; i++) {
      sum += powers[i];
      if (i >= 30) sum -= powers[i - 30];
      if (i >= 29) {
        acc += (sum / 30) ** 4;
        cnt++;
      }
    }
    np = (acc / cnt) ** 0.25;
  } else np = avg(powers);

  let ascent = 0;
  for (let i = 1; i < n; i++) {
    const a = s[i - 1].alt;
    const b = s[i].alt;
    if (a !== undefined && b !== undefined && b > a) ascent += b - a;
  }

  const duration = n;
  const distance = n ? s[n - 1].dist : 0;
  const intensity = ride.ftp > 0 ? np / ride.ftp : 0;
  return {
    duration,
    distance,
    avgPower: Math.round(avg(powers)),
    maxPower: n ? Math.max(...powers) : 0,
    np: Math.round(np),
    intensity,
    tss: Math.round((duration / 3600) * intensity * intensity * 100),
    kj: Math.round(powers.reduce((a, b) => a + b, 0) / 1000),
    avgHr: hrs.length ? Math.round(avg(hrs)) : undefined,
    maxHr: hrs.length ? Math.max(...hrs) : undefined,
    avgCadence: cads.length ? Math.round(avg(cads)) : undefined,
    maxCadence: cads.length ? Math.max(...cads) : undefined,
    avgSpeed: duration ? distance / duration : 0,
    maxSpeed: n ? Math.max(...s.map((x) => x.speed)) : 0,
    ascent: Math.round(ascent),
    hasGps: s.some((x) => x.lat !== undefined),
  };
}

/** Beste Durchschnittsleistung über ein Zeitfenster (s). */
export function bestPower(powers: number[], window: number): number | null {
  if (powers.length < window) return null;
  let sum = 0;
  let best = 0;
  for (let i = 0; i < powers.length; i++) {
    sum += powers[i];
    if (i >= window) sum -= powers[i - window];
    if (i >= window - 1) best = Math.max(best, sum / window);
  }
  return Math.round(best);
}

export const ZONES = [
  { name: 'Z1 Erholung', max: 0.55, color: '#8a94a6' },
  { name: 'Z2 Grundlage', max: 0.75, color: '#3b82f6' },
  { name: 'Z3 Tempo', max: 0.9, color: '#22c55e' },
  { name: 'Z4 Schwelle', max: 1.05, color: '#eab308' },
  { name: 'Z5 VO2max', max: 1.2, color: '#f97316' },
  { name: 'Z6 Anaerob', max: Infinity, color: '#ef4444' },
];

export function zoneOf(fraction: number) {
  return ZONES.find((z) => fraction < z.max) ?? ZONES[ZONES.length - 1];
}

export function fmtTime(sec: number): string {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return (h ? `${h}:` : '') + `${mm}:${String(s).padStart(2, '0')}`;
}

export const fmtKm = (m: number) => (m / 1000).toFixed(m < 100000 ? 2 : 1).replace('.', ',');
