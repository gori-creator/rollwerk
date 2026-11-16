import { describe, expect, it } from 'vitest';
// @ts-ignore – keine Typen
import FitParser from 'fit-file-parser';
import { cmdSimulation, cmdTargetPower, parseHeartRate, parseIndoorBikeData, parsePowerMeasurement } from '../src/ble/ftms';
import { encodeFit, fitCrc } from '../src/core/fit';
import { makeClimb, parseGpx, positionAt } from '../src/core/gpx';
import { steadySpeed } from '../src/core/physics';
import { bestPower, computeStats } from '../src/core/stats';
import type { Ride, Sample } from '../src/core/types';
import { BUILTIN_WORKOUTS, expand, parseErgMrc, parseZwo, targetAt, totalDuration } from '../src/core/workout';

const dv = (...b: number[]) => new DataView(Uint8Array.from(b).buffer);

describe('Bluetooth-Parser', () => {
  it('liest Indoor Bike Data mit Tempo, Kadenz, Leistung und Puls', () => {
    // Flags 0x0244: Kadenz, Leistung, Puls; Tempo ist enthalten (Bit 0 = 0)
    const d = parseIndoorBikeData(dv(0x44, 0x02, 0xc4, 0x09, 0xb4, 0x00, 0xfa, 0x00, 0x8c));
    expect(d.speed).toBeCloseTo(25);
    expect(d.cadence).toBe(90);
    expect(d.power).toBe(250);
    expect(d.hr).toBe(140);
  });
  it('überspringt Felder, die nicht gebraucht werden', () => {
    // Flags 0x0074: Kadenz, Distanz, Widerstand, Leistung
    const d = parseIndoorBikeData(dv(0x74, 0x00, 0x00, 0x00, 0xa0, 0x00, 0x10, 0x27, 0x00, 0x05, 0x00, 0x2c, 0x01));
    expect(d.cadence).toBe(80);
    expect(d.distance).toBe(10000);
    expect(d.power).toBe(300);
  });
  it('bricht bei zu kurzen Paketen nicht ab', () => {
    expect(parseIndoorBikeData(dv(0x44, 0x02, 0xc4))).toEqual({});
  });
  it('berechnet Kadenz aus Kurbelumdrehungen', () => {
    const a = parsePowerMeasurement(dv(0x20, 0x00, 0xc8, 0x00, 0x0a, 0x00, 0x00, 0x04), null);
    expect(a.power).toBe(200);
    // eine Umdrehung später, 2/3 s danach → 90 U/min
    const t = 0x0400 + Math.round((1024 * 2) / 3);
    const b = parsePowerMeasurement(dv(0x20, 0x00, 0xc8, 0x00, 0x0b, 0x00, t & 0xff, t >> 8), a.crank);
    expect(b.cadence).toBeCloseTo(90, 0);
  });
  it('liest Puls in 8 und 16 Bit', () => {
    expect(parseHeartRate(dv(0x00, 150))).toBe(150);
    expect(parseHeartRate(dv(0x01, 0x2c, 0x01))).toBe(300);
  });
  it('kodiert Zielwatt und Simulation', () => {
    expect(Array.from(cmdTargetPower(250))).toEqual([0x05, 0xfa, 0x00]);
    // 0 Wind, -2,5 % Steigung, Crr 0,004, Cw 0,51
    expect(Array.from(cmdSimulation({ grade: -2.5, crr: 0.004, cw: 0.51 }))).toEqual([0x11, 0, 0, 0x06, 0xff, 40, 51]);
  });
});

describe('Physik', () => {
  const p = { mass: 84 };
  it('liefert plausible Geschwindigkeiten', () => {
    expect(steadySpeed(200, 0, p) * 3.6).toBeGreaterThan(31);
    expect(steadySpeed(200, 0, p) * 3.6).toBeLessThan(36);
    expect(steadySpeed(250, 0.08, p) * 3.6).toBeGreaterThan(11);
    expect(steadySpeed(250, 0.08, p) * 3.6).toBeLessThan(14);
    expect(steadySpeed(0, -0.05, p) * 3.6).toBeGreaterThan(40);
    expect(steadySpeed(0, 0, p)).toBeLessThan(0.1);
  });
});

function gpx(n: number, withEle = true) {
  let pts = '';
  for (let i = 0; i < n; i++) {
    // nach Norden, ca. 11 m je Punkt, gleichmäßig 5 % Steigung plus Rauschen
    const ele = 100 + i * 0.556 + (i % 2 ? 1.5 : -1.5);
    pts += `<trkpt lat="${48 + i * 0.0001}" lon="11"${withEle ? `><ele>${ele}</ele></trkpt>` : '/>'}`;
  }
  return `<?xml version="1.0"?><gpx><trk><name>Test</name><trkseg>${pts}</trkseg></trk></gpx>`;
}

describe('GPX', () => {
  it('berechnet Distanz, glättet die Höhe und liefert die Steigung', () => {
    const r = parseGpx(gpx(500));
    expect(r.name).toBe('Test');
    expect(r.distance).toBeGreaterThan(5400);
    expect(r.distance).toBeLessThan(5700);
    const pos = positionAt(r, 2500);
    expect(pos.grade).toBeGreaterThan(0.04);
    expect(pos.grade).toBeLessThan(0.06);
    expect(pos.lat).toBeGreaterThan(48.02);
    // ungeglättet wären es durch das Rauschen rund 1000 Hm
    expect(r.ascent).toBeGreaterThan(250);
    expect(r.ascent).toBeLessThan(300);
  });
  it('kommt ohne Höhendaten zurecht', () => {
    const r = parseGpx(gpx(100, false));
    expect(r.hasElevation).toBe(false);
    expect(positionAt(r, 300).grade).toBe(0);
  });
  it('erzeugt Anstiege mit der gewünschten Länge und Steigung', () => {
    const c = makeClimb('Berg', 8, 7);
    expect(c.distance).toBe(8000);
    expect(c.points[c.points.length - 1].ele).toBeGreaterThan(540);
    expect(c.points[c.points.length - 1].ele).toBeLessThan(580);
    expect(positionAt(c, 4000).grade).toBeGreaterThan(0.03);
    expect(positionAt(c, 4000).grade).toBeLessThan(0.11);
  });
  it('lehnt kaputte Dateien ab', () => {
    expect(() => parseGpx('<gpx></gpx>')).toThrow();
    expect(() => parseGpx('kein xml')).toThrow();
  });
});

describe('Workouts', () => {
  it('löst Blöcke in Abschnitte auf', () => {
    const segs = expand(BUILTIN_WORKOUTS.find((w) => w.id === 'builtin-vo2')!.blocks);
    expect(totalDuration(segs)).toBe(600 + 5 * 360 + 420);
    expect(targetAt(segs, 300)).toBeCloseTo(0.625);
    expect(targetAt(segs, 600)).toBeCloseTo(1.15);
    expect(targetAt(segs, 600 + 180)).toBeCloseTo(0.5);
    expect(targetAt(segs, 99999)).toBeNull();
  });
  it('importiert ZWO', () => {
    const w = parseZwo(`<workout_file><name>Test ZWO</name><description>d</description><workout>
      <Warmup Duration="600" PowerLow="0.25" PowerHigh="0.75"/>
      <IntervalsT Repeat="3" OnDuration="60" OffDuration="120" OnPower="1.2" OffPower="0.5"/>
      <SteadyState Duration="300" Power="0.9"/>
      <FreeRide Duration="120"/>
      <Cooldown Duration="300" PowerLow="0.75" PowerHigh="0.25"/></workout></workout_file>`);
    expect(w.name).toBe('Test ZWO');
    const segs = expand(w.blocks);
    expect(totalDuration(segs)).toBe(600 + 540 + 300 + 120 + 300);
    expect(targetAt(segs, 610)).toBeCloseTo(1.2);
    expect(targetAt(segs, 1500)).toBeNull();
    expect(targetAt(segs, 1560 + 299)).toBeCloseTo(0.25, 1);
  });
  it('importiert MRC und ERG', () => {
    const mrc = parseErgMrc('[COURSE HEADER]\nFILE NAME = a.mrc\nMINUTES PERCENT\n[END COURSE HEADER]\n[COURSE DATA]\n0\t50\n5\t50\n5\t100\n10\t100\n[END COURSE DATA]', 200);
    expect(mrc.name).toBe('a');
    expect(targetAt(expand(mrc.blocks), 400)).toBeCloseTo(1);
    const erg = parseErgMrc('[COURSE HEADER]\nFTP = 250\nMINUTES WATTS\n[END COURSE HEADER]\n[COURSE DATA]\n0 125\n10 250\n[END COURSE DATA]', 200);
    expect(targetAt(expand(erg.blocks), 300)).toBeCloseTo(0.75);
  });
});

function ride(gps: boolean): Ride {
  const samples: Sample[] = [];
  const start = Date.UTC(2026, 10, 15, 10, 0, 0);
  for (let i = 1; i <= 600; i++) {
    samples.push({
      t: i, ts: start + i * 1000, power: 200 + (i % 10), hr: 140, cadence: 90, speed: 8, dist: i * 8,
      ...(gps ? { lat: 48.1 + i * 0.00005, lon: 11.5, alt: 500 + i * 0.1 } : {}),
    });
  }
  return { id: 'x', name: 'Test', mode: gps ? 'route' : 'workout', start, end: start + 600000, samples, ftp: 250, weight: 75 };
}

describe('FIT-Export', () => {
  it('berechnet die bekannte Prüfsumme', () => {
    expect(fitCrc(new TextEncoder().encode('123456789'))).toBe(0xbb3d);
  });
  for (const gps of [true, false]) {
    it(`erzeugt eine lesbare Datei (${gps ? 'mit' : 'ohne'} GPS)`, async () => {
      const bytes = encodeFit(ride(gps));
      const parser = new FitParser({ force: false, speedUnit: 'm/s', lengthUnit: 'm' });
      const data: any = await new Promise((resolve, reject) =>
        parser.parse(bytes.buffer, (err: unknown, d: unknown) => (err ? reject(err) : resolve(d))),
      );
      expect(data.records.length).toBe(600);
      const r = data.records[299];
      expect(r.power).toBe(200);
      expect(r.heart_rate).toBe(140);
      expect(r.cadence).toBe(90);
      expect(r.speed).toBeCloseTo(8, 2);
      expect(r.distance).toBeCloseTo(2400, 1);
      expect(new Date(r.timestamp).toISOString()).toBe('2026-11-15T10:05:00.000Z');
      if (gps) {
        expect(r.position_lat).toBeCloseTo(48.115, 4);
        expect(r.position_long).toBeCloseTo(11.5, 4);
        expect(r.altitude).toBeCloseTo(530, 0);
      } else expect(r.position_lat).toBeUndefined();
      const s = data.sessions[0];
      expect(s.sport).toBe('cycling');
      expect(s.sub_sport).toBe(gps ? 'virtual_activity' : 'indoor_cycling');
      expect(s.total_timer_time).toBeCloseTo(600, 0);
      expect(s.total_distance).toBeCloseTo(4800, 0);
      expect(s.avg_power).toBe(205);
      expect(data.laps.length).toBe(1);
    });
  }
});

describe('Statistik', () => {
  it('berechnet Kennzahlen', () => {
    const s = computeStats(ride(true));
    expect(s.duration).toBe(600);
    expect(s.avgPower).toBe(205);
    expect(s.np).toBeGreaterThanOrEqual(204);
    expect(s.np).toBeLessThanOrEqual(206);
    expect(s.kj).toBe(123);
    expect(s.ascent).toBe(60);
    expect(bestPower([100, 100, 300, 300, 100], 2)).toBe(300);
    expect(bestPower([100], 5)).toBeNull();
  });
});
