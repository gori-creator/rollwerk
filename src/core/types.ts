export interface Profile {
  weight: number; // Fahrer kg
  bikeWeight: number; // kg
  ftp: number; // Watt
  maxHr: number;
  difficulty: number; // 0..1 Anteil der Steigung, der an die Rolle geht
  hud?: string[]; // gewählte Datenfelder im Fahrtbildschirm
  autoStrava?: boolean; // Fahrten nach dem Beenden automatisch hochladen
  world?: string; // gewählte 3D-Welt
  lowGraphics?: boolean; // einfachere 3D-Grafik: ohne Gras und Schatten
  flatView?: boolean; // 3D-Ansicht ausschalten (für schwache Rechner)
}

export const DEFAULT_PROFILE: Profile = {
  weight: 75,
  bikeWeight: 9,
  ftp: 200,
  maxHr: 185,
  difficulty: 0.5,
};

export interface RoutePoint {
  lat: number;
  lon: number;
  ele: number; // geglättete Höhe in m
  dist: number; // m ab Start
}

export interface Route {
  id: string;
  name: string;
  step: number; // Abstand der Punkte in m (gleichmäßig)
  points: RoutePoint[];
  distance: number; // m
  ascent: number; // m
  hasElevation: boolean;
  synthetic?: boolean; // erzeugter Anstieg ohne echte GPS-Koordinaten
  created: number;
}

export type Block =
  | { type: 'steady'; duration: number; power: number; cadence?: number }
  | { type: 'ramp'; duration: number; from: number; to: number }
  | {
      type: 'intervals';
      repeat: number;
      onDuration: number;
      onPower: number;
      offDuration: number;
      offPower: number;
    }
  | { type: 'free'; duration: number };

export interface Workout {
  id: string;
  name: string;
  description?: string;
  blocks: Block[]; // Leistung als Anteil der FTP (1.0 = 100 %)
  builtin?: boolean;
  created: number;
}

/** Ein Workout, aufgelöst in lineare Abschnitte. */
export interface Segment {
  start: number; // s
  duration: number; // s
  from: number; // Anteil FTP
  to: number;
  free: boolean;
}

export interface Sample {
  t: number; // Fahrzeit in s (ohne Pausen)
  ts: number; // Unix ms
  power: number;
  hr?: number;
  cadence?: number;
  speed: number; // m/s
  dist: number; // m
  lat?: number;
  lon?: number;
  alt?: number;
  grade?: number; // %
  target?: number; // Zielwatt
}

export type RideMode = 'free' | 'route' | 'workout';

export interface Ride {
  id: string;
  name: string;
  mode: RideMode;
  start: number; // Unix ms
  end: number;
  samples: Sample[];
  routeName?: string;
  routeId?: string;
  workoutName?: string;
  ftp: number;
  weight: number;
  inProgress?: boolean;
  stravaId?: number;
}

export interface RideStats {
  duration: number; // s
  distance: number; // m
  avgPower: number;
  maxPower: number;
  np: number;
  intensity: number;
  tss: number;
  kj: number;
  avgHr?: number;
  maxHr?: number;
  avgCadence?: number;
  maxCadence?: number;
  avgSpeed: number; // m/s
  maxSpeed: number;
  ascent: number;
  hasGps: boolean;
}
