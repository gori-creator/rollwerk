import type { Block, Segment, Workout } from './types';

export function expand(blocks: Block[]): Segment[] {
  const out: Segment[] = [];
  let t = 0;
  const push = (duration: number, from: number, to: number, free = false) => {
    if (duration <= 0) return;
    out.push({ start: t, duration, from, to, free });
    t += duration;
  };
  for (const b of blocks) {
    if (b.type === 'steady') push(b.duration, b.power, b.power);
    else if (b.type === 'ramp') push(b.duration, b.from, b.to);
    else if (b.type === 'free') push(b.duration, 0.5, 0.5, true);
    else {
      for (let i = 0; i < b.repeat; i++) {
        push(b.onDuration, b.onPower, b.onPower);
        push(b.offDuration, b.offPower, b.offPower);
      }
    }
  }
  return out;
}

export function totalDuration(segments: Segment[]): number {
  const last = segments[segments.length - 1];
  return last ? last.start + last.duration : 0;
}

export function segmentAt(segments: Segment[], t: number): { seg: Segment; index: number } | null {
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    if (t < s.start + s.duration) return { seg: s, index: i };
  }
  return null;
}

/** Ziel als Anteil der FTP zum Zeitpunkt t; null = freies Fahren oder Ende. */
export function targetAt(segments: Segment[], t: number): number | null {
  const hit = segmentAt(segments, t);
  if (!hit || hit.seg.free) return null;
  const { seg } = hit;
  const f = seg.duration > 0 ? (t - seg.start) / seg.duration : 0;
  return seg.from + (seg.to - seg.from) * f;
}

/** Grobe Belastungsschätzung (TSS) eines Workouts. */
export function estimateTss(segments: Segment[]): number {
  let sum4 = 0;
  let dur = 0;
  for (const s of segments) {
    const mid = (s.from + s.to) / 2;
    sum4 += mid ** 4 * s.duration;
    dur += s.duration;
  }
  if (!dur) return 0;
  const intensity = (sum4 / dur) ** 0.25;
  return (dur / 3600) * intensity * intensity * 100;
}

const num = (el: Element, attr: string, def = 0) => {
  const v = parseFloat(el.getAttribute(attr) ?? '');
  return isFinite(v) ? v : def;
};

/** Zwift-Workout-Format (.zwo). */
export function parseZwo(xml: string, fallbackName = 'Workout'): Workout {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Die Datei ist kein gültiges ZWO.');
  const w = doc.getElementsByTagName('workout')[0];
  if (!w) throw new Error('Die Datei enthält kein Workout.');
  const blocks: Block[] = [];
  for (const el of Array.from(w.children)) {
    const tag = el.tagName.toLowerCase();
    const duration = num(el, 'Duration');
    if (tag === 'steadystate') {
      const cadence = num(el, 'Cadence') || undefined;
      blocks.push({ type: 'steady', duration, power: num(el, 'Power', num(el, 'PowerLow', 0.5)), cadence });
    } else if (tag === 'warmup' || tag === 'cooldown' || tag === 'ramp') {
      blocks.push({ type: 'ramp', duration, from: num(el, 'PowerLow', 0.4), to: num(el, 'PowerHigh', 0.7) });
    } else if (tag === 'intervalst') {
      blocks.push({
        type: 'intervals',
        repeat: Math.max(1, Math.round(num(el, 'Repeat', 1))),
        onDuration: num(el, 'OnDuration'),
        onPower: num(el, 'OnPower', num(el, 'PowerOnHigh', 1)),
        offDuration: num(el, 'OffDuration'),
        offPower: num(el, 'OffPower', num(el, 'PowerOffHigh', 0.5)),
      });
    } else if (tag === 'freeride' || tag === 'maxeffort') {
      blocks.push({ type: 'free', duration });
    }
  }
  if (!blocks.length) throw new Error('Das Workout enthält keine Abschnitte.');
  const text = (t: string) => doc.getElementsByTagName(t)[0]?.textContent?.trim() || '';
  return {
    id: crypto.randomUUID(),
    name: text('name') || fallbackName,
    description: text('description') || undefined,
    blocks,
    created: Date.now(),
  };
}

/** ERG- und MRC-Dateien: Minuten + Watt bzw. Minuten + Prozent der FTP. */
export function parseErgMrc(text: string, userFtp: number, fallbackName = 'Workout'): Workout {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  let inData = false;
  let percent = false;
  let ftp = userFtp;
  let name = '';
  let description = '';
  const pts: [number, number][] = [];
  for (const line of lines) {
    const up = line.toUpperCase();
    if (up.startsWith('[COURSE DATA]')) { inData = true; continue; }
    if (up.startsWith('[END COURSE DATA]')) { inData = false; continue; }
    if (up.startsWith('[')) continue;
    if (!inData) {
      const m = line.match(/^([A-Za-z ]+?)\s*=\s*(.*)$/);
      if (m) {
        const key = m[1].trim().toUpperCase();
        if (key === 'FTP' && parseFloat(m[2]) > 0) ftp = parseFloat(m[2]);
        if (key === 'FILE NAME') name = m[2].replace(/\.(erg|mrc)$/i, '');
        if (key === 'DESCRIPTION') description = m[2];
      } else if (/^MINUTES\s+PERCENT/i.test(line)) percent = true;
      continue;
    }
    const parts = line.split(/[\s,;]+/).map(parseFloat);
    if (parts.length >= 2 && isFinite(parts[0]) && isFinite(parts[1])) pts.push([parts[0] * 60, parts[1]]);
  }
  if (pts.length < 2) throw new Error('Die Datei enthält keine Workout-Daten.');
  const frac = (v: number) => (percent ? v / 100 : v / ftp);
  const blocks: Block[] = [];
  for (let i = 1; i < pts.length; i++) {
    const duration = Math.round(pts[i][0] - pts[i - 1][0]);
    if (duration <= 0) continue;
    const from = frac(pts[i - 1][1]);
    const to = frac(pts[i][1]);
    if (Math.abs(from - to) < 0.005) blocks.push({ type: 'steady', duration, power: from });
    else blocks.push({ type: 'ramp', duration, from, to });
  }
  return { id: crypto.randomUUID(), name: name || fallbackName, description: description || undefined, blocks, created: Date.now() };
}

export const BUILTIN_WORKOUTS: Workout[] = [
  {
    id: 'builtin-ramp-test',
    name: 'FTP-Rampentest',
    description:
      'Nach dem Einfahren steigt die Leistung jede Minute um 6 % der FTP. Fahre, bis nichts mehr geht, und beende dann die Fahrt. Deine neue FTP ist etwa 75 % der besten Minute – sie wird dir danach im Verlauf angezeigt.',
    builtin: true,
    created: 0,
    blocks: [
      { type: 'steady', duration: 300, power: 0.46 },
      ...Array.from({ length: 22 }, (_, i): Block => ({ type: 'steady', duration: 60, power: 0.52 + i * 0.06 })),
    ],
  },
  {
    id: 'builtin-ftp-20',
    name: 'FTP-Test 20 min',
    description:
      'Der klassische Test: nach dem Einfahren 20 Minuten so hart wie möglich, ohne Vorgabe der Rolle. Deine FTP ist etwa 95 % der Durchschnittsleistung dieser 20 Minuten – sie wird dir danach im Verlauf angezeigt.',
    builtin: true,
    created: 0,
    blocks: [
      { type: 'ramp', duration: 600, from: 0.45, to: 0.75 },
      { type: 'intervals', repeat: 3, onDuration: 60, onPower: 1.0, offDuration: 60, offPower: 0.5 },
      { type: 'steady', duration: 300, power: 0.5 },
      { type: 'free', duration: 1200 },
      { type: 'ramp', duration: 600, from: 0.55, to: 0.4 },
    ],
  },
  {
    id: 'builtin-sweetspot',
    name: 'Sweet Spot 3 × 10',
    description: 'Drei Blöcke knapp unter der Schwelle. Klassiker für die Grundlagenausdauer mit wenig Zeit.',
    builtin: true,
    created: 0,
    blocks: [
      { type: 'ramp', duration: 600, from: 0.45, to: 0.75 },
      { type: 'intervals', repeat: 3, onDuration: 600, onPower: 0.9, offDuration: 240, offPower: 0.55 },
      { type: 'ramp', duration: 360, from: 0.6, to: 0.4 },
    ],
  },
  {
    id: 'builtin-vo2',
    name: 'VO2max 5 × 3',
    description: 'Fünf harte Intervalle deutlich über der Schwelle, dazwischen je drei Minuten locker.',
    builtin: true,
    created: 0,
    blocks: [
      { type: 'ramp', duration: 600, from: 0.45, to: 0.8 },
      { type: 'intervals', repeat: 5, onDuration: 180, onPower: 1.15, offDuration: 180, offPower: 0.5 },
      { type: 'ramp', duration: 420, from: 0.6, to: 0.4 },
    ],
  },
  {
    id: 'builtin-endurance',
    name: 'Grundlage 60 min',
    description: 'Eine Stunde gleichmäßig im Grundlagenbereich.',
    builtin: true,
    created: 0,
    blocks: [
      { type: 'ramp', duration: 300, from: 0.45, to: 0.65 },
      { type: 'steady', duration: 3000, power: 0.68 },
      { type: 'ramp', duration: 300, from: 0.6, to: 0.4 },
    ],
  },
];
