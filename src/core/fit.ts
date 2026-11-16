// Minimaler FIT-Encoder für Aktivitäten (Strava, Garmin, intervals.icu …).
import type { Ride } from './types';
import { computeStats } from './stats';

const FIT_EPOCH = 631065600; // 1989-12-31T00:00:00Z in Unix-Sekunden

const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01,
  0x8801, 0x4400,
];

export function fitCrc(bytes: Uint8Array, crc = 0): number {
  for (const byte of bytes) {
    let tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[byte & 0xf];
    tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xf];
  }
  return crc;
}

type BaseType = 'enum' | 'uint8' | 'uint16' | 'sint16' | 'uint32' | 'sint32' | 'uint32z';
const BASE: Record<BaseType, { id: number; size: number; invalid: number }> = {
  enum: { id: 0x00, size: 1, invalid: 0xff },
  uint8: { id: 0x02, size: 1, invalid: 0xff },
  sint16: { id: 0x83, size: 2, invalid: 0x7fff },
  uint16: { id: 0x84, size: 2, invalid: 0xffff },
  sint32: { id: 0x85, size: 4, invalid: 0x7fffffff },
  uint32: { id: 0x86, size: 4, invalid: 0xffffffff },
  uint32z: { id: 0x8c, size: 4, invalid: 0 },
};

type Field = [num: number, type: BaseType];

class Writer {
  private bytes: number[] = [];
  private defs = new Map<number, Field[]>();
  private nextLocal = 0;
  private localByGlobal = new Map<number, number>();

  define(global: number, fields: Field[]) {
    const local = this.nextLocal++;
    this.localByGlobal.set(global, local);
    this.defs.set(global, fields);
    this.bytes.push(0x40 | local, 0, 0, global & 0xff, global >> 8, fields.length);
    for (const [n, t] of fields) this.bytes.push(n, BASE[t].size, BASE[t].id);
  }

  write(global: number, values: (number | undefined | null)[]) {
    const fields = this.defs.get(global)!;
    this.bytes.push(this.localByGlobal.get(global)!);
    fields.forEach(([, t], i) => {
      const b = BASE[t];
      let v = values[i];
      if (v === undefined || v === null || !isFinite(v)) v = b.invalid;
      v = Math.round(v);
      if (t === 'sint16' && v < 0) v += 0x10000;
      if (t === 'sint32' && v < 0) v += 0x100000000;
      for (let k = 0; k < b.size; k++) this.bytes.push(Math.floor(v / 2 ** (8 * k)) & 0xff);
    });
  }

  finish(): Uint8Array<ArrayBuffer> {
    const data = Uint8Array.from(this.bytes);
    const header = new Uint8Array(14);
    const dv = new DataView(header.buffer);
    header[0] = 14;
    header[1] = 0x20; // Protokoll 2.0
    dv.setUint16(2, 2132, true); // Profilversion
    dv.setUint32(4, data.length, true);
    header.set([0x2e, 0x46, 0x49, 0x54], 8); // ".FIT"
    dv.setUint16(12, fitCrc(header.subarray(0, 12)), true);
    const out = new Uint8Array(14 + data.length + 2);
    out.set(header, 0);
    out.set(data, 14);
    const crc = fitCrc(out.subarray(0, 14 + data.length));
    out[out.length - 2] = crc & 0xff;
    out[out.length - 1] = crc >> 8;
    return out;
  }
}

const semicircles = (deg: number) => Math.round((deg * 2 ** 31) / 180);
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function encodeFit(ride: Ride): Uint8Array<ArrayBuffer> {
  const stats = computeStats(ride);
  const fitTime = (ms: number) => Math.round(ms / 1000) - FIT_EPOCH;
  const start = fitTime(ride.start);
  const samples = ride.samples;
  const end = samples.length ? fitTime(samples[samples.length - 1].ts) : start;
  const elapsed = Math.max(0, end - start);
  const w = new Writer();

  // file_id
  w.define(0, [[0, 'enum'], [1, 'uint16'], [2, 'uint16'], [3, 'uint32z'], [4, 'uint32']]);
  w.write(0, [4, 255, 1, (start & 0x7fffffff) || 1, start]);

  // event: Timer-Start
  w.define(21, [[253, 'uint32'], [0, 'enum'], [1, 'enum']]);
  w.write(21, [start, 0, 0]);

  // record
  w.define(20, [
    [253, 'uint32'], // timestamp
    [0, 'sint32'], // position_lat
    [1, 'sint32'], // position_long
    [2, 'uint16'], // altitude (m + 500) * 5
    [3, 'uint8'], // heart_rate
    [4, 'uint8'], // cadence
    [5, 'uint32'], // distance * 100
    [6, 'uint16'], // speed * 1000
    [7, 'uint16'], // power
  ]);
  for (const s of samples) {
    const gps = s.lat !== undefined && s.lon !== undefined;
    w.write(20, [
      fitTime(s.ts),
      gps ? semicircles(s.lat!) : undefined,
      gps ? semicircles(s.lon!) : undefined,
      s.alt !== undefined ? clamp((s.alt + 500) * 5, 0, 0xfffe) : undefined,
      s.hr !== undefined ? clamp(s.hr, 0, 254) : undefined,
      s.cadence !== undefined ? clamp(s.cadence, 0, 254) : undefined,
      s.dist * 100,
      clamp(s.speed * 1000, 0, 0xfffe),
      clamp(s.power, 0, 0xfffe),
    ]);
  }

  // event: Timer-Stopp
  w.write(21, [end, 0, 4]);

  const opt = (v: number | undefined) => (v === undefined ? undefined : v);

  // lap
  w.define(19, [
    [254, 'uint16'], [253, 'uint32'], [0, 'enum'], [1, 'enum'], [2, 'uint32'], [7, 'uint32'], [8, 'uint32'],
    [9, 'uint32'], [19, 'uint16'], [20, 'uint16'],
  ]);
  w.write(19, [0, end, 9, 1, start, elapsed * 1000, stats.duration * 1000, stats.distance * 100, stats.avgPower, stats.maxPower]);

  // session
  w.define(18, [
    [254, 'uint16'], [253, 'uint32'], [0, 'enum'], [1, 'enum'], [2, 'uint32'], [5, 'enum'], [6, 'enum'],
    [7, 'uint32'], [8, 'uint32'], [9, 'uint32'], [11, 'uint16'], [14, 'uint16'], [15, 'uint16'], [16, 'uint8'],
    [17, 'uint8'], [18, 'uint8'], [19, 'uint8'], [20, 'uint16'], [21, 'uint16'], [22, 'uint16'], [25, 'uint16'],
    [26, 'uint16'],
  ]);
  w.write(18, [
    0, end, 8, 1, start,
    2, // sport: cycling
    stats.hasGps ? 58 : 6, // sub_sport: virtual_activity bzw. indoor_cycling
    elapsed * 1000, stats.duration * 1000, stats.distance * 100,
    stats.kj, // kJ mechanisch ≈ kcal verbrannt
    stats.avgSpeed * 1000, stats.maxSpeed * 1000,
    opt(stats.avgHr), opt(stats.maxHr), opt(stats.avgCadence), opt(stats.maxCadence),
    stats.avgPower, stats.maxPower, stats.ascent, 0, 1,
  ]);

  // activity
  w.define(34, [[253, 'uint32'], [0, 'uint32'], [1, 'uint16'], [2, 'enum'], [3, 'enum'], [4, 'enum']]);
  w.write(34, [end, stats.duration * 1000, 1, 0, 26, 1]);

  return w.finish();
}
