// Virtuelle Geschwindigkeit aus Leistung, Gewicht und Steigung.

export const G = 9.80665;
export const RHO = 1.225; // Luftdichte kg/m³
export const CRR = 0.004; // Rollwiderstand
export const CDA = 0.32; // m²
export const DRIVETRAIN = 0.975;

export interface PhysicsParams {
  mass: number; // Fahrer + Rad in kg
  crr?: number;
  cda?: number;
}

/**
 * Ein Zeitschritt: liefert die neue Geschwindigkeit in m/s.
 * grade als Dezimalwert (0.05 = 5 %).
 */
export function stepSpeed(v: number, power: number, grade: number, dt: number, p: PhysicsParams): number {
  const crr = p.crr ?? CRR;
  const cda = p.cda ?? CDA;
  const theta = Math.atan(grade);
  const sub = Math.max(1, Math.round(dt / 0.1));
  const h = dt / sub;
  for (let i = 0; i < sub; i++) {
    const drive = (power * DRIVETRAIN) / Math.max(v, 1);
    const gravity = p.mass * G * Math.sin(theta);
    const rolling = v > 0.01 || drive > 0 ? p.mass * G * crr * Math.cos(theta) : 0;
    const aero = 0.5 * RHO * cda * v * v;
    const a = (drive - gravity - rolling - aero) / p.mass;
    v += a * h;
    if (v < 0) v = 0;
  }
  return v;
}

/** Gleichgewichtsgeschwindigkeit (für Tests und Schätzungen). */
export function steadySpeed(power: number, grade: number, p: PhysicsParams): number {
  let v = 5;
  for (let i = 0; i < 600; i++) v = stepSpeed(v, power, grade, 1, p);
  return v;
}

/** Windwiderstandskoeffizient für FTMS (kg/m). */
export function windCoefficient(cda = CDA): number {
  return 0.5 * RHO * cda;
}
