// Parser und Befehle für die Bluetooth-Standardprofile:
// FTMS (Fitness Machine), Cycling Power, Heart Rate.

export const UUID = {
  ftms: 0x1826,
  indoorBikeData: 0x2ad2,
  controlPoint: 0x2ad9,
  power: 0x1818,
  powerMeasurement: 0x2a63,
  heartRate: 0x180d,
  hrMeasurement: 0x2a37,
} as const;

export interface BikeData {
  speed?: number; // km/h
  cadence?: number; // rpm
  power?: number; // W
  hr?: number;
  distance?: number; // m
  resistance?: number;
}

/** Indoor Bike Data (0x2AD2). */
export function parseIndoorBikeData(dv: DataView): BikeData {
  const out: BikeData = {};
  if (dv.byteLength < 2) return out;
  const flags = dv.getUint16(0, true);
  let o = 2;
  const has = (n: number) => o + n <= dv.byteLength;
  // Bit 0 = "More Data": 0 bedeutet, die Momentangeschwindigkeit ist enthalten
  if (!(flags & 0x0001)) { if (!has(2)) return out; out.speed = dv.getUint16(o, true) / 100; o += 2; }
  if (flags & 0x0002) o += 2; // Durchschnittsgeschwindigkeit
  if (flags & 0x0004) { if (!has(2)) return out; out.cadence = dv.getUint16(o, true) / 2; o += 2; }
  if (flags & 0x0008) o += 2; // Durchschnittskadenz
  if (flags & 0x0010) {
    if (!has(3)) return out;
    out.distance = dv.getUint16(o, true) | (dv.getUint8(o + 2) << 16);
    o += 3;
  }
  if (flags & 0x0020) { if (!has(2)) return out; out.resistance = dv.getInt16(o, true); o += 2; }
  if (flags & 0x0040) { if (!has(2)) return out; out.power = dv.getInt16(o, true); o += 2; }
  if (flags & 0x0080) o += 2; // Durchschnittsleistung
  if (flags & 0x0100) o += 5; // Energie
  if (flags & 0x0200) { if (!has(1)) return out; out.hr = dv.getUint8(o); o += 1; }
  return out;
}

export interface CrankState {
  revs: number;
  time: number; // 1/1024 s
}

/** Cycling Power Measurement (0x2A63). Kadenz ergibt sich aus zwei aufeinanderfolgenden Kurbelwerten. */
export function parsePowerMeasurement(dv: DataView, prev: CrankState | null): { power: number; cadence?: number; crank: CrankState | null } {
  const flags = dv.getUint16(0, true);
  const power = dv.getInt16(2, true);
  let o = 4;
  if (flags & 0x01) o += 1; // Pedalbalance
  if (flags & 0x04) o += 2; // Drehmoment
  if (flags & 0x10) o += 6; // Radumdrehungen
  let crank: CrankState | null = prev;
  let cadence: number | undefined;
  if (flags & 0x20 && o + 4 <= dv.byteLength) {
    crank = { revs: dv.getUint16(o, true), time: dv.getUint16(o + 2, true) };
    if (prev) {
      const dRevs = (crank.revs - prev.revs + 0x10000) & 0xffff;
      const dTime = (crank.time - prev.time + 0x10000) & 0xffff;
      if (dTime > 0 && dRevs > 0) cadence = Math.min(250, (dRevs * 60 * 1024) / dTime);
    }
  }
  return { power, cadence, crank };
}

/** Heart Rate Measurement (0x2A37). */
export function parseHeartRate(dv: DataView): number {
  return dv.getUint8(0) & 0x01 ? dv.getUint16(1, true) : dv.getUint8(1);
}

export const OP = {
  requestControl: 0x00,
  reset: 0x01,
  setTargetPower: 0x05,
  start: 0x07,
  stop: 0x08,
  setSimulation: 0x11,
  response: 0x80,
} as const;

export function cmdRequestControl(): Uint8Array<ArrayBuffer> {
  return Uint8Array.of(OP.requestControl);
}

export function cmdStart(): Uint8Array<ArrayBuffer> {
  return Uint8Array.of(OP.start);
}

export function cmdTargetPower(watts: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(3);
  const dv = new DataView(b.buffer);
  b[0] = OP.setTargetPower;
  dv.setInt16(1, Math.round(Math.max(0, Math.min(4000, watts))), true);
  return b;
}

export interface SimParams {
  grade: number; // Prozent
  crr: number;
  cw: number; // kg/m
  wind?: number; // m/s
}

export function cmdSimulation(p: SimParams): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(7);
  const dv = new DataView(b.buffer);
  b[0] = OP.setSimulation;
  dv.setInt16(1, Math.round((p.wind ?? 0) * 1000), true);
  dv.setInt16(3, Math.round(Math.max(-40, Math.min(40, p.grade)) * 100), true);
  dv.setUint8(5, Math.round(Math.max(0, Math.min(0.0254, p.crr)) * 10000));
  dv.setUint8(6, Math.round(Math.max(0, Math.min(2.54, p.cw)) * 100));
  return b;
}
