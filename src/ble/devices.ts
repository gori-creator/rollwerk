// Verbindung zu Rolle und Pulsgurt über Web Bluetooth, plus Demo-Trainer.
import {
  UUID, OP, parseIndoorBikeData, parsePowerMeasurement, parseHeartRate, cmdRequestControl, cmdStart,
  cmdTargetPower, cmdSimulation, type BikeData, type CrankState, type SimParams,
} from './ftms';

export type ConnState = 'connected' | 'reconnecting' | 'disconnected';

export interface Trainer {
  name: string;
  kind: 'ftms' | 'power' | 'demo';
  /** false = liefert nur Daten (Powermeter oder alter Trainer), lässt sich nicht steuern */
  controllable: boolean;
  setTargetPower(watts: number): void;
  setSimulation(p: SimParams): void;
  disconnect(): void;
}

export interface Listeners {
  onData(d: BikeData): void;
  onState(s: ConnState): void;
  onLog?(msg: string): void;
}

export const bluetoothAvailable = () => typeof navigator !== 'undefined' && !!navigator.bluetooth;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Hält die Verbindung und baut sie nach einem Abbruch selbst wieder auf. */
abstract class BleDevice {
  protected closed = false;
  constructor(protected device: BluetoothDevice, protected listeners: Listeners) {
    device.addEventListener('gattserverdisconnected', this.onDisconnect);
  }

  get name() {
    return this.device.name || 'Unbekanntes Gerät';
  }

  protected abstract setup(server: BluetoothRemoteGATTServer): Promise<void>;

  async connect() {
    const server = await this.device.gatt!.connect();
    await this.setup(server);
    this.listeners.onState('connected');
  }

  private onDisconnect = async () => {
    if (this.closed) return;
    this.listeners.onState('reconnecting');
    for (let attempt = 0; attempt < 60 && !this.closed; attempt++) {
      await sleep(Math.min(5000, 1000 + attempt * 500));
      if (this.closed) return;
      try {
        await this.connect();
        return;
      } catch {
        /* nächster Versuch */
      }
    }
    if (!this.closed) this.listeners.onState('disconnected');
  };

  disconnect() {
    this.closed = true;
    this.device.removeEventListener('gattserverdisconnected', this.onDisconnect);
    try {
      this.device.gatt?.disconnect();
    } catch {
      /* egal */
    }
    this.listeners.onState('disconnected');
  }
}

class BleTrainer extends BleDevice implements Trainer {
  kind: 'ftms' | 'power' = 'ftms';
  controllable = false;
  private cp: BluetoothRemoteGATTCharacteristic | null = null;
  private crank: CrankState | null = null;
  // Pro Befehlstyp nur den neuesten Wert senden, GATT verträgt keine parallelen Schreibzugriffe
  private pending = new Map<number, Uint8Array<ArrayBuffer>>();
  private pumping = false;
  private last: { op: number; bytes: Uint8Array<ArrayBuffer> } | null = null;

  protected async setup(server: BluetoothRemoteGATTServer) {
    this.cp = null;
    this.crank = null;
    let ftms: BluetoothRemoteGATTService | null = null;
    try {
      ftms = await server.getPrimaryService(UUID.ftms);
    } catch {
      ftms = null;
    }
    if (ftms) {
      this.kind = 'ftms';
      const data = await ftms.getCharacteristic(UUID.indoorBikeData);
      data.addEventListener('characteristicvaluechanged', (e) => {
        const v = (e.target as BluetoothRemoteGATTCharacteristic).value;
        if (v) this.listeners.onData(parseIndoorBikeData(v));
      });
      await data.startNotifications();
      try {
        const cp = await ftms.getCharacteristic(UUID.controlPoint);
        cp.addEventListener('characteristicvaluechanged', (e) => this.onResponse((e.target as BluetoothRemoteGATTCharacteristic).value));
        await cp.startNotifications();
        this.cp = cp;
        this.controllable = true;
        this.pending.clear();
        await cp.writeValueWithResponse(cmdRequestControl());
        await cp.writeValueWithResponse(cmdStart()).catch(() => undefined);
        // nach einem Wiederverbinden den letzten Sollwert erneut setzen
        if (this.last) this.send(this.last.op, this.last.bytes);
      } catch (err) {
        this.controllable = false;
        this.listeners.onLog?.(`Steuerung nicht verfügbar: ${String(err)}`);
      }
      return;
    }
    // Rückfall: nur Leistungsdaten (Powermeter, ältere Trainer)
    const ps = await server.getPrimaryService(UUID.power);
    this.kind = 'power';
    this.controllable = false;
    const pm = await ps.getCharacteristic(UUID.powerMeasurement);
    pm.addEventListener('characteristicvaluechanged', (e) => {
      const v = (e.target as BluetoothRemoteGATTCharacteristic).value;
      if (!v) return;
      const r = parsePowerMeasurement(v, this.crank);
      const moved = r.crank && this.crank && r.crank.revs !== this.crank.revs;
      this.crank = r.crank;
      const d: BikeData = { power: r.power };
      if (r.cadence !== undefined) d.cadence = r.cadence;
      else if (!moved && r.power === 0) d.cadence = 0;
      this.listeners.onData(d);
    });
    await pm.startNotifications();
  }

  private onResponse(v: DataView | undefined) {
    if (!v || v.byteLength < 3 || v.getUint8(0) !== OP.response) return;
    const op = v.getUint8(1);
    const result = v.getUint8(2);
    if (result === 1) return;
    this.listeners.onLog?.(`Rolle hat Befehl 0x${op.toString(16)} abgelehnt (Code ${result}).`);
    // Code 5 = Kontrolle nicht erteilt: neu anfordern und letzten Befehl wiederholen
    if (result === 5 && op !== OP.requestControl) {
      this.pending.set(OP.requestControl, cmdRequestControl());
      if (this.last) this.pending.set(this.last.op, this.last.bytes);
      void this.pump();
    }
  }

  private send(op: number, bytes: Uint8Array<ArrayBuffer>) {
    if (!this.cp) return;
    this.last = { op, bytes };
    // ERG und Simulation schließen sich aus: der jeweils andere wartende Befehl entfällt
    if (op === OP.setTargetPower) this.pending.delete(OP.setSimulation);
    if (op === OP.setSimulation) this.pending.delete(OP.setTargetPower);
    this.pending.set(op, bytes);
    void this.pump();
  }

  private async pump() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.pending.size && this.cp && !this.closed) {
        // Kontrollanforderung immer zuerst
        const op = this.pending.has(OP.requestControl) ? OP.requestControl : this.pending.keys().next().value!;
        const bytes = this.pending.get(op)!;
        this.pending.delete(op);
        try {
          await this.cp.writeValueWithResponse(bytes);
        } catch (err) {
          this.listeners.onLog?.(`Senden fehlgeschlagen: ${String(err)}`);
          break;
        }
      }
    } finally {
      this.pumping = false;
    }
  }

  setTargetPower(watts: number) {
    this.send(OP.setTargetPower, cmdTargetPower(watts));
  }

  setSimulation(p: SimParams) {
    this.send(OP.setSimulation, cmdSimulation(p));
  }
}

class BleHeartRate extends BleDevice {
  protected async setup(server: BluetoothRemoteGATTServer) {
    const s = await server.getPrimaryService(UUID.heartRate);
    const c = await s.getCharacteristic(UUID.hrMeasurement);
    c.addEventListener('characteristicvaluechanged', (e) => {
      const v = (e.target as BluetoothRemoteGATTCharacteristic).value;
      if (v) this.listeners.onData({ hr: parseHeartRate(v) });
    });
    await c.startNotifications();
  }
}

export async function connectTrainer(listeners: Listeners): Promise<Trainer> {
  const device = await navigator.bluetooth.requestDevice({
    filters: [{ services: [UUID.ftms] }, { services: [UUID.power] }],
    optionalServices: [UUID.ftms, UUID.power],
  });
  const t = new BleTrainer(device, listeners);
  await t.connect();
  return t;
}

export async function connectHeartRate(listeners: Listeners): Promise<{ name: string; disconnect(): void }> {
  const device = await navigator.bluetooth.requestDevice({ filters: [{ services: [UUID.heartRate] }] });
  const h = new BleHeartRate(device, listeners);
  await h.connect();
  return h;
}

/**
 * Demo-Trainer ohne Hardware: Im ERG-Modus folgt er dem Zielwert,
 * sonst der per Regler eingestellten Leistung.
 */
export class DemoTrainer implements Trainer {
  name = 'Demo-Trainer';
  kind = 'demo' as const;
  controllable = true;
  manualPower = 150;
  private target: number | null = null;
  private power = 0;
  private hr = 70;
  private timer: ReturnType<typeof setInterval>;

  constructor(private listeners: Listeners) {
    listeners.onState('connected');
    this.timer = setInterval(() => this.tick(), 500);
  }

  private tick() {
    const goal = this.target ?? this.manualPower;
    this.power += (goal - this.power) * 0.35;
    const noise = goal > 0 ? (Math.random() - 0.5) * 6 : 0;
    const p = Math.max(0, Math.round(this.power + noise));
    const hrGoal = 65 + Math.min(120, p * 0.42);
    this.hr += (hrGoal - this.hr) * 0.01;
    this.listeners.onData({
      power: p < 3 ? 0 : p,
      cadence: p < 3 ? 0 : Math.round(86 + (Math.random() - 0.5) * 4),
      hr: Math.round(this.hr),
    });
  }

  setTargetPower(watts: number) {
    this.target = watts;
  }

  setSimulation() {
    this.target = null;
  }

  disconnect() {
    clearInterval(this.timer);
    this.listeners.onState('disconnected');
  }
}
