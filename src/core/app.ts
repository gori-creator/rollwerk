// Zentraler App-Zustand: Geräte, Live-Daten und die laufende Fahrt.
import { useSyncExternalStore } from 'react';
import {
  bluetoothAvailable, connectHeartRate, connectTrainer, DemoTrainer, type ConnState, type Trainer,
} from '../ble/devices';
import type { BikeData } from '../ble/ftms';
import { dbAll, dbPut, loadProfile, saveProfile } from './db';
import { positionAt } from './gpx';
import { CDA, CRR, stepSpeed, windCoefficient } from './physics';
import type { Profile, Ride, RideMode, Route, Sample, Segment, Workout } from './types';
import { expand, segmentAt, targetAt, totalDuration } from './workout';

export type RideStatus = 'waiting' | 'running' | 'paused' | 'autopaused';

export interface RideView {
  mode: RideMode;
  status: RideStatus;
  elapsed: number;
  dist: number;
  speed: number; // m/s
  grade: number; // %
  alt?: number;
  lat?: number;
  lon?: number;
  power: number; // 3-s-Mittel
  avgPower: number;
  target: number | null; // Zielwatt (ERG)
  bias: number; // Intensitätsfaktor für Workouts
  manualGrade: number; // % bei freier Fahrt
  segIndex: number;
  segRemaining: number;
  workoutTime: number; // Position im Workout in s
  route?: Route;
  workout?: Workout;
  segments?: Segment[];
  workoutDuration: number;
  recent: number[]; // Leistung der letzten Minuten, 1 Wert pro Sekunde
  done: boolean; // Strecke bzw. Workout zu Ende
  wattLock: number | null; // gehaltene Zielleistung bei freier Fahrt / Strecke
  gear: number; // virtueller Gang relativ zur Mitte
  kj: number;
  drafting: boolean;
  pacer: { power: number; dist: number; gap: number } | null; // gap in m, positiv = vor dir
  ghost: { dist: number; gap: number } | null;
}

export interface DeviceInfo {
  name: string;
  state: ConnState;
  kind?: Trainer['kind'];
  controllable?: boolean;
}

export interface AppState {
  profile: Profile;
  trainer: DeviceInfo | null;
  hrm: DeviceInfo | null;
  live: { power: number; cadence: number; hr: number };
  ride: RideView | null;
  log: string[];
  busy: boolean;
}

let state: AppState = {
  profile: loadProfile(),
  trainer: null,
  hrm: null,
  live: { power: 0, cadence: 0, hr: 0 },
  ride: null,
  log: [],
  busy: false,
};

const subs = new Set<() => void>();
function set(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  subs.forEach((f) => f());
}
export const getState = () => state;
export function useApp(): AppState {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => state,
  );
}

export function log(msg: string) {
  const time = new Date().toLocaleTimeString('de-DE');
  set({ log: [`${time}  ${msg}`, ...state.log].slice(0, 50) });
}

export function updateProfile(patch: Partial<Profile>) {
  const profile = { ...state.profile, ...patch };
  saveProfile(profile);
  set({ profile });
}

// ---------- Geräte ----------

let trainer: Trainer | null = null;
let hrm: { name: string; disconnect(): void } | null = null;
const raw = { power: 0, cadence: 0, hrTrainer: 0, hrStrap: 0, tPower: 0, tHrStrap: 0, tHrTrainer: 0 };

function onTrainerData(d: BikeData) {
  const now = Date.now();
  if (d.power !== undefined) { raw.power = Math.max(0, d.power); raw.tPower = now; }
  if (d.cadence !== undefined) raw.cadence = d.cadence;
  if (d.hr !== undefined && d.hr > 0) { raw.hrTrainer = d.hr; raw.tHrTrainer = now; }
  publishLive();
}

function currentLive() {
  const now = Date.now();
  const fresh = now - raw.tPower < 4000;
  const hr = now - raw.tHrStrap < 10000 ? raw.hrStrap : now - raw.tHrTrainer < 10000 ? raw.hrTrainer : 0;
  return { power: fresh ? Math.round(raw.power) : 0, cadence: fresh ? Math.round(raw.cadence) : 0, hr };
}

function publishLive() {
  const live = currentLive();
  const cur = state.live;
  if (live.power !== cur.power || live.cadence !== cur.cadence || live.hr !== cur.hr) set({ live });
}

const describe = (err: unknown) => (err instanceof Error ? err.message : String(err));
const cancelled = (err: unknown) => err instanceof DOMException && err.name === 'NotFoundError';

function attachTrainer(t: Trainer) {
  trainer = t;
  set({ trainer: { name: t.name, state: 'connected', kind: t.kind, controllable: t.controllable } });
  log(`${t.name} verbunden${t.controllable ? '' : ' (nur Daten, nicht steuerbar)'}.`);
  engine?.resendControl();
}

function trainerListeners() {
  return {
    onData: onTrainerData,
    onLog: log,
    onState: (s: ConnState) => {
      if (s === 'disconnected') {
        trainer = null;
        set({ trainer: null });
      } else if (state.trainer) {
        set({ trainer: { ...state.trainer, state: s, controllable: trainer?.controllable } });
        if (s === 'connected') engine?.resendControl();
      }
      if (s === 'reconnecting') log('Verbindung zur Rolle verloren – verbinde neu …');
    },
  };
}

export async function pairTrainer() {
  if (!bluetoothAvailable()) return log('Dieser Browser unterstützt kein Bluetooth. Nutze Chrome oder Edge.');
  set({ busy: true });
  try {
    trainer?.disconnect();
    attachTrainer(await connectTrainer(trainerListeners()));
  } catch (err) {
    if (!cancelled(err)) log(`Rolle konnte nicht verbunden werden: ${describe(err)}`);
  } finally {
    set({ busy: false });
  }
}

export function useDemoTrainer() {
  trainer?.disconnect();
  attachTrainer(new DemoTrainer(trainerListeners()));
}

export function setDemoPower(w: number) {
  if (trainer instanceof DemoTrainer) trainer.manualPower = w;
}
export const getDemoPower = () => (trainer instanceof DemoTrainer ? trainer.manualPower : 0);

export function disconnectTrainer() {
  trainer?.disconnect();
}

export async function pairHeartRate() {
  if (!bluetoothAvailable()) return log('Dieser Browser unterstützt kein Bluetooth. Nutze Chrome oder Edge.');
  set({ busy: true });
  try {
    hrm?.disconnect();
    hrm = await connectHeartRate({
      onData: (d) => {
        if (d.hr) { raw.hrStrap = d.hr; raw.tHrStrap = Date.now(); publishLive(); }
      },
      onState: (s) => {
        if (s === 'disconnected') { hrm = null; set({ hrm: null }); }
        else if (state.hrm) set({ hrm: { ...state.hrm, state: s } });
      },
    });
    set({ hrm: { name: hrm.name, state: 'connected' } });
    log(`${hrm.name} verbunden.`);
  } catch (err) {
    if (!cancelled(err)) log(`Pulsgurt konnte nicht verbunden werden: ${describe(err)}`);
  } finally {
    set({ busy: false });
  }
}

export function disconnectHeartRate() {
  hrm?.disconnect();
}

setInterval(publishLive, 1000);

// ---------- Fahrt ----------

class RideEngine {
  private samples: Sample[] = [];
  private id = crypto.randomUUID();
  private startTs = Date.now();
  private elapsed = 0;
  private dist = 0;
  private v = 0;
  private status: RideStatus = 'waiting';
  private manualPause = false;
  private idle = 0;
  private bias = 1;
  private offset = 0; // übersprungene Workout-Zeit
  private get wt() {
    return this.elapsed + this.offset;
  }
  private manualGrade = 0;
  private lastTick = performance.now();
  private acc = 0;
  private timer: ReturnType<typeof setInterval>;
  private segments?: Segment[];
  private workoutDuration = 0;
  private sent: { key: string; at: number } = { key: '', at: 0 };
  private done = false;
  private wakeLock: { release(): Promise<void> } | null = null;
  private wattLock: number | null = null;
  private gear = 0;
  private pacer: { power: number; dist: number; v: number } | null = null;
  private drafting = false;
  private work = 0; // Joule

  constructor(private mode: RideMode, private route?: Route, private workout?: Workout, private ghost?: Sample[]) {
    if (workout) {
      this.segments = expand(workout.blocks);
      this.workoutDuration = totalDuration(this.segments);
    }
    this.timer = setInterval(() => this.loop(), 250);
    void this.lock();
    this.control(true);
    this.publish();
  }

  private async lock() {
    try {
      this.wakeLock = await (navigator as any).wakeLock?.request('screen');
    } catch {
      /* nicht kritisch */
    }
  }

  private loop() {
    const now = performance.now();
    this.acc += (now - this.lastTick) / 1000;
    this.lastTick = now;
    // Nach langem Hänger (Rechner im Ruhezustand) nicht minutenlang nachholen
    if (this.acc > 120) this.acc = 1;
    let stepped = false;
    while (this.acc >= 1) {
      this.acc -= 1;
      this.step();
      stepped = true;
    }
    if (stepped) this.publish();
  }

  private gradeNow(): number {
    if (this.mode === 'route' && this.route) return positionAt(this.route, this.dist).grade;
    if (this.mode === 'free') return this.manualGrade / 100;
    return 0;
  }

  private targetNow(): number | null {
    if (this.mode !== 'workout' || !this.segments) return this.wattLock;
    const f = targetAt(this.segments, this.wt);
    return f === null ? null : Math.round(f * state.profile.ftp * this.bias);
  }

  private step() {
    const live = currentLive();
    const pedalling = live.power > 0;
    if (this.manualPause) this.status = 'paused';
    else {
      // Auto-Pause: ohne Tritt und (fast) im Stand
      if (pedalling) this.idle = 0;
      else this.idle++;
      const standing = this.mode === 'workout' ? true : this.v < 0.8;
      if (this.status === 'waiting') {
        if (pedalling) {
          this.status = 'running';
          if (!this.samples.length) this.startTs = Date.now();
        }
      } else if (this.idle >= 3 && standing) this.status = 'autopaused';
      else this.status = 'running';
    }

    if (this.status !== 'running') {
      this.v = 0;
      this.control();
      return;
    }

    const p = state.profile;
    const grade = this.gradeNow();
    const mass = p.weight + p.bikeWeight;
    // Tempomacher fährt mit fester Leistung; dicht dahinter gibt es Windschatten
    this.drafting = false;
    if (this.pacer) {
      // Abstand vor dem Zeitschritt vergleichen, sonst zählt der noch nicht bewegte Fahrer fälschlich als "dahinter"
      const gap = this.pacer.dist - this.dist;
      this.drafting = gap > 0.5 && gap < 12;
      const pg = this.route ? positionAt(this.route, this.pacer.dist).grade : grade;
      this.pacer.v = stepSpeed(this.pacer.v, this.pacer.power, pg, 1, { mass });
      this.pacer.dist += this.pacer.v;
    }
    this.v = stepSpeed(this.v, live.power, grade, 1, { mass, cda: this.drafting ? CDA * 0.75 : CDA });
    this.dist += this.v;
    this.work += live.power;
    this.elapsed += 1;

    const s: Sample = {
      t: this.elapsed,
      ts: Date.now(),
      power: live.power,
      speed: this.v,
      dist: this.dist,
      grade: grade * 100,
    };
    if (live.hr) s.hr = live.hr;
    if (live.cadence || pedalling) s.cadence = live.cadence;
    if (this.route) {
      const pos = positionAt(this.route, this.dist);
      if (!this.route.synthetic) {
        s.lat = pos.lat;
        s.lon = pos.lon;
      }
      s.alt = pos.ele;
    }
    const target = this.targetNow();
    if (target !== null) s.target = target;
    this.samples.push(s);

    if (this.mode === 'route' && this.route && this.dist >= this.route.distance) this.done = true;
    if (this.mode === 'workout' && this.wt >= this.workoutDuration) this.done = true;
    if (this.done) this.manualPause = true;

    this.control();
    if (this.samples.length % 30 === 0) void dbPut('rides', this.build(true));
  }

  /** Sollwert an die Rolle senden – bei Änderung, sonst alle 10 s zur Sicherheit. */
  private control(force = false) {
    if (!trainer?.controllable) return;
    const target = this.targetNow();
    let key: string;
    if (target !== null && !this.done) key = `erg:${target}`;
    else {
      // Die einstellbare Stärke gilt nur für Strecken; jeder virtuelle Gang verschiebt den Widerstand um 0,5 %
      const scale = this.mode === 'route' ? state.profile.difficulty : 1;
      const g = this.done ? 0 : this.gradeNow() * 100 * scale + this.gear * 0.5;
      key = `sim:${(Math.round(g * 10) / 10).toFixed(1)}`;
    }
    const now = Date.now();
    if (!force && key === this.sent.key && now - this.sent.at < 10000) return;
    this.sent = { key, at: now };
    const [kind, value] = key.split(':');
    if (kind === 'erg') trainer.setTargetPower(Number(value));
    else trainer.setSimulation({ grade: Number(value), crr: CRR, cw: windCoefficient() });
  }

  resendControl() {
    this.control(true);
  }

  private publish() {
    const n = this.samples.length;
    const live = currentLive();
    const last3 = this.samples.slice(-3);
    const power = this.status === 'running' && last3.length ? Math.round(last3.reduce((a, s) => a + s.power, 0) / last3.length) : live.power;
    const hit = this.segments ? segmentAt(this.segments, this.wt) : null;
    const pos = this.route ? positionAt(this.route, this.dist) : null;
    const view: RideView = {
      mode: this.mode,
      status: this.status,
      elapsed: this.elapsed,
      dist: this.dist,
      speed: this.v,
      grade: this.gradeNow() * 100,
      alt: pos?.ele,
      lat: pos?.lat,
      lon: pos?.lon,
      power,
      avgPower: n ? Math.round(this.samples.reduce((a, s) => a + s.power, 0) / n) : 0,
      target: this.targetNow(),
      bias: this.bias,
      manualGrade: this.manualGrade,
      segIndex: hit?.index ?? -1,
      segRemaining: hit ? hit.seg.start + hit.seg.duration - this.wt : 0,
      workoutTime: this.wt,
      route: this.route,
      workout: this.workout,
      segments: this.segments,
      workoutDuration: this.workoutDuration,
      recent: this.samples.slice(-300).map((s) => s.power),
      done: this.done,
      wattLock: this.wattLock,
      gear: this.gear,
      kj: Math.round(this.work / 1000),
      drafting: this.drafting,
      pacer: this.pacer ? { power: this.pacer.power, dist: this.pacer.dist, gap: this.pacer.dist - this.dist } : null,
      ghost: this.ghostDist() === null ? null : { dist: this.ghostDist()!, gap: this.ghostDist()! - this.dist },
    };
    set({ ride: view });
  }

  togglePause() {
    if (this.done) return;
    this.manualPause = !this.manualPause;
    if (!this.manualPause) {
      this.idle = 0;
      this.status = this.samples.length ? 'running' : 'waiting';
    } else this.status = 'paused';
    this.publish();
  }

  private ghostDist(): number | null {
    if (!this.ghost?.length) return null;
    if (this.elapsed <= 0) return 0;
    return this.ghost[Math.min(this.elapsed, this.ghost.length) - 1].dist;
  }

  setWattLock(w: number | null) {
    if (this.mode === 'workout') return;
    this.wattLock = w === null ? null : Math.max(50, Math.min(1500, Math.round(w / 5) * 5));
    this.control();
    this.publish();
  }

  shift(d: number) {
    this.gear = Math.max(-12, Math.min(12, this.gear + d));
    this.control();
    this.publish();
  }

  setPacer(power: number | null) {
    if (power === null) this.pacer = null;
    else if (this.pacer) this.pacer.power = power;
    else this.pacer = { power, dist: this.dist, v: this.v };
    this.publish();
  }

  setBias(b: number) {
    this.bias = Math.max(0.5, Math.min(1.5, Math.round(b * 100) / 100));
    this.control();
    this.publish();
  }

  setManualGrade(g: number) {
    this.manualGrade = Math.max(-10, Math.min(20, Math.round(g * 2) / 2));
    this.control();
    this.publish();
  }

  skipSegment() {
    if (!this.segments || this.done) return;
    const hit = segmentAt(this.segments, this.wt);
    if (!hit) return;
    this.offset += hit.seg.start + hit.seg.duration - this.wt;
    if (this.wt >= this.workoutDuration) {
      this.done = true;
      this.manualPause = true;
      this.status = 'paused';
    }
    this.control();
    this.publish();
  }

  private build(inProgress: boolean): Ride {
    const date = new Date(this.startTs).toLocaleDateString('de-DE');
    const what = this.mode === 'route' ? this.route!.name : this.mode === 'workout' ? this.workout!.name : 'Freie Fahrt';
    return {
      id: this.id,
      name: `${what} – ${date}`,
      mode: this.mode,
      start: this.startTs,
      end: this.samples.length ? this.samples[this.samples.length - 1].ts : this.startTs,
      samples: this.samples,
      routeName: this.route?.name,
      routeId: this.route?.id,
      workoutName: this.workout?.name,
      ftp: state.profile.ftp,
      weight: state.profile.weight,
      inProgress: inProgress || undefined,
    };
  }

  private stop() {
    clearInterval(this.timer);
    void this.wakeLock?.release().catch(() => undefined);
    // Rolle freigeben: flache Simulation statt ERG-Widerstand
    if (trainer?.controllable) trainer.setSimulation({ grade: 0, crr: CRR, cw: windCoefficient() });
  }

  async finish(): Promise<Ride | null> {
    this.stop();
    if (this.samples.length < 5) return null;
    const ride = this.build(false);
    await dbPut('rides', ride);
    return ride;
  }

  discard() {
    this.stop();
  }

  get sampleCount() {
    return this.samples.length;
  }
  get rideId() {
    return this.id;
  }
}

let engine: RideEngine | null = null;

export function startRide(mode: RideMode, opts: { route?: Route; workout?: Workout; ghost?: Sample[] } = {}) {
  engine?.discard();
  engine = new RideEngine(mode, opts.route, opts.workout, opts.ghost);
}

/** Beendet die Fahrt und speichert sie. Liefert null, wenn sie zu kurz war. */
export async function finishRide(): Promise<Ride | null> {
  if (!engine) return null;
  const e = engine;
  engine = null;
  const ride = await e.finish();
  set({ ride: null });
  if (ride) log(`Fahrt gespeichert: ${ride.name}`);
  return ride;
}

export const rideActions = {
  togglePause: () => engine?.togglePause(),
  setBias: (b: number) => engine?.setBias(b),
  setManualGrade: (g: number) => engine?.setManualGrade(g),
  skipSegment: () => engine?.skipSegment(),
  setWattLock: (w: number | null) => engine?.setWattLock(w),
  shift: (d: number) => engine?.shift(d),
  setPacer: (w: number | null) => engine?.setPacer(w),
};

/** Nach einem Absturz oder versehentlich geschlossenem Tab: angefangene Fahrten retten. */
export async function recoverRides() {
  const rides = await dbAll<Ride>('rides');
  for (const r of rides) {
    if (r.inProgress && r.id !== engine?.rideId) {
      delete r.inProgress;
      await dbPut('rides', r);
      log(`Unterbrochene Fahrt wiederhergestellt: ${r.name}`);
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', (e) => {
    if (engine && engine.sampleCount > 5) e.preventDefault();
  });
}
