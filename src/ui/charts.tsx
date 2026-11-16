import type { Route, Segment } from '../core/types';
import { zoneOf } from '../core/stats';
import { totalDuration } from '../core/workout';

/** Leistungsprofil eines Workouts; optional mit aktueller Position. */
export function WorkoutChart({ segments, position, height = 120 }: { segments: Segment[]; position?: number; height?: number }) {
  const total = totalDuration(segments) || 1;
  const max = Math.max(1.3, ...segments.map((s) => Math.max(s.from, s.to))) + 0.1;
  const y = (p: number) => 100 - (p / max) * 100;
  return (
    <svg className="chart" viewBox="0 0 1000 100" preserveAspectRatio="none" style={{ height }}>
      <line x1="0" x2="1000" y1={y(1)} y2={y(1)} className="chart-ref" />
      {segments.map((s, i) => {
        const x1 = (s.start / total) * 1000;
        const x2 = ((s.start + s.duration) / total) * 1000;
        const fill = s.free ? '#4b5563' : zoneOf((s.from + s.to) / 2).color;
        return <polygon key={i} points={`${x1},100 ${x1},${y(s.from)} ${x2},${y(s.to)} ${x2},100`} fill={fill} stroke="#14171c" strokeWidth="1" vectorEffect="non-scaling-stroke" />;
      })}
      {position !== undefined && (
        <>
          <rect x="0" y="0" width={(position / total) * 1000} height="100" fill="#000" opacity="0.45" />
          <line x1={(position / total) * 1000} x2={(position / total) * 1000} y1="0" y2="100" className="chart-pos" />
        </>
      )}
    </svg>
  );
}

export function gradeColor(g: number): string {
  if (g < -1) return '#4f93b8';
  if (g < 2) return '#4f9f6e';
  if (g < 4) return '#9bbf4a';
  if (g < 7) return '#e6b93a';
  if (g < 10) return '#e8833a';
  return '#d9483b';
}

/** Höhenprofil einer Strecke; optional mit aktueller Position (m). */
export function ElevationChart({ route, position, height = 120, markers = [] }: { route: Route; position?: number; height?: number; markers?: { dist: number; color: string }[] }) {
  const pts = route.points;
  const stride = Math.max(1, Math.floor(pts.length / 500));
  const sel = pts.filter((_, i) => i % stride === 0 || i === pts.length - 1);
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of sel) { lo = Math.min(lo, p.ele); hi = Math.max(hi, p.ele); }
  const span = Math.max(20, hi - lo);
  const x = (d: number) => (d / route.distance) * 1000;
  const y = (e: number) => 95 - ((e - lo) / span) * 85;
  // in rund 150 Scheiben teilen und jede nach ihrer Steigung einfärben
  const per = Math.max(1, Math.ceil(sel.length / 150));
  const slices: { d: string; fill: string }[] = [];
  for (let i = 0; i < sel.length - 1; i += per) {
    const part = sel.slice(i, i + per + 1);
    const a = part[0];
    const b = part[part.length - 1];
    const g = b.dist > a.dist ? ((b.ele - a.ele) / (b.dist - a.dist)) * 100 : 0;
    slices.push({
      d: `M${x(a.dist).toFixed(1)},100 ${part.map((p) => `L${x(p.dist).toFixed(1)},${y(p.ele).toFixed(1)}`).join(' ')} L${x(b.dist).toFixed(1)},100 Z`,
      fill: gradeColor(g),
    });
  }
  return (
    <svg className="chart" viewBox="0 0 1000 100" preserveAspectRatio="none" style={{ height }}>
      {slices.map((s, i) => <path key={i} d={s.d} fill={s.fill} stroke={s.fill} strokeWidth="0.5" vectorEffect="non-scaling-stroke" />)}
      {position !== undefined && (
        <>
          <rect x="0" y="0" width={x(position)} height="100" fill="#000" opacity="0.35" />
          <line x1={x(position)} x2={x(position)} y1="0" y2="100" className="chart-pos" />
        </>
      )}
      {markers.map((m, i) => (
        <line key={i} x1={x(Math.min(m.dist, route.distance))} x2={x(Math.min(m.dist, route.distance))} y1="0" y2="100" stroke={m.color} strokeWidth="2" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
      ))}
    </svg>
  );
}

/** Leistungsverlauf als Linie. */
export function PowerTrace({ values, ftp, height = 120 }: { values: number[]; ftp: number; height?: number }) {
  if (values.length < 2) return <svg className="chart" style={{ height }} />;
  // auf höchstens 600 Punkte mitteln
  const bucket = Math.max(1, Math.ceil(values.length / 600));
  const v: number[] = [];
  for (let i = 0; i < values.length; i += bucket) {
    const slice = values.slice(i, i + bucket);
    v.push(slice.reduce((a, b) => a + b, 0) / slice.length);
  }
  const max = Math.max(ftp * 1.2, ...v) * 1.05;
  const y = (p: number) => 100 - (p / max) * 100;
  const d = v.map((p, i) => `${i ? 'L' : 'M'}${((i / (v.length - 1)) * 1000).toFixed(1)},${y(p).toFixed(1)}`).join(' ');
  return (
    <svg className="chart" viewBox="0 0 1000 100" preserveAspectRatio="none" style={{ height }}>
      <line x1="0" x2="1000" y1={y(ftp)} y2={y(ftp)} className="chart-ref" />
      <path d={d} fill="none" stroke="#f5a524" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Schlichte Streckenkarte (Norden oben) mit gefahrenem Teil und Positionen. Braucht kein Internet. */
export function MiniMap({ route, position, markers = [], size = 210 }: { route: Route; position: number; markers?: { dist: number; color: string }[]; size?: number }) {
  const pts = route.points;
  const lat0 = pts[0].lat;
  const kx = Math.cos((lat0 * Math.PI) / 180);
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  const xy = pts.map((p) => {
    const x = p.lon * kx;
    const y = -p.lat;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
    return [x, y];
  });
  const pad = 16;
  const scale = (size - 2 * pad) / Math.max(maxX - minX, maxY - minY, 1e-9);
  const ox = (size - (maxX - minX) * scale) / 2;
  const oy = (size - (maxY - minY) * scale) / 2;
  const at = (i: number) => [ox + (xy[i][0] - minX) * scale, oy + (xy[i][1] - minY) * scale];
  const index = (d: number) => Math.max(0, Math.min(pts.length - 1, Math.round(d / route.step)));
  const stride = Math.max(1, Math.floor(pts.length / 600));
  const line = (to: number) => {
    const out: string[] = [];
    for (let i = 0; i <= to; i += stride) out.push(at(i).map((v) => v.toFixed(1)).join(','));
    out.push(at(to).map((v) => v.toFixed(1)).join(','));
    return out.join(' ');
  };
  const me = at(index(position));
  const start = at(0);
  const end = at(pts.length - 1);
  return (
    <svg className="minimap" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Streckenkarte">
      <polyline points={line(pts.length - 1)} fill="none" stroke="rgba(255,255,255,.38)" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
      <polyline points={line(index(position))} fill="none" stroke="#f5a524" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={start[0]} cy={start[1]} r="4" fill="#4ccb7f" />
      <rect x={end[0] - 4} y={end[1] - 4} width="8" height="8" fill="#fff" />
      {markers.map((m, i) => {
        const p = at(index(m.dist));
        return <circle key={i} cx={p[0]} cy={p[1]} r="5" fill={m.color} stroke="#0c0f16" strokeWidth="1.5" />;
      })}
      <circle cx={me[0]} cy={me[1]} r="7" fill="#f5a524" stroke="#fff" strokeWidth="2.5" />
      <text x={size - 10} y="18" textAnchor="end" fontSize="11" fontWeight="700" fill="rgba(255,255,255,.7)">N ↑</text>
    </svg>
  );
}
