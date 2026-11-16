import { useEffect, useState } from 'react';
import { finishRide, log, rideActions, updateProfile, useApp, type AppState, type RideView } from '../core/app';
import { World3D } from './World3D';
import { dbPut } from '../core/db';
import { fmtKm, fmtTime, zoneOf } from '../core/stats';
import { stravaUpload } from '../core/strava';
import { go } from './App';
import { ElevationChart, MiniMap, PowerTrace, WorkoutChart } from './charts';
import { DemoSlider } from './StartPage';

interface Cell {
  value: string | number;
  unit?: string;
  color?: string;
  sub?: string;
}

const de = (n: number, digits = 1) => n.toFixed(digits).replace('.', ',');

/** Alle wählbaren Datenfelder. `show` blendet Felder aus, die zur Fahrt nicht passen. */
export const HUD_FIELDS: { id: string; label: string; show?(r: RideView): boolean; cell(r: RideView, app: AppState): Cell }[] = [
  { id: 'power', label: 'Leistung', cell: (r, a) => ({ value: r.power, unit: 'W', color: zoneOf(r.power / a.profile.ftp).color, sub: zoneOf(r.power / a.profile.ftp).name }) },
  { id: 'target', label: 'Ziel', show: (r) => r.mode === 'workout' || r.wattLock !== null, cell: (r) => ({ value: r.target ?? '–', unit: 'W', sub: r.mode !== 'workout' ? 'Watt gehalten' : r.bias !== 1 ? `Intensität ${Math.round(r.bias * 100)} %` : undefined }) },
  { id: 'hr', label: 'Puls', cell: (_r, a) => ({ value: a.live.hr || '–', unit: 'bpm', sub: a.live.hr ? `${Math.round((a.live.hr / a.profile.maxHr) * 100)} % von max.` : undefined }) },
  { id: 'cadence', label: 'Kadenz', cell: (_r, a) => ({ value: a.live.cadence, unit: 'U/min' }) },
  { id: 'speed', label: 'Tempo', cell: (r) => ({ value: de(r.speed * 3.6), unit: 'km/h', sub: r.drafting ? 'im Windschatten' : undefined }) },
  { id: 'dist', label: 'Distanz', cell: (r) => ({ value: fmtKm(r.dist), unit: 'km', sub: r.route ? `von ${fmtKm(r.route.distance)} km` : undefined }) },
  { id: 'time', label: 'Zeit', cell: (r) => ({ value: fmtTime(r.elapsed) }) },
  { id: 'grade', label: 'Steigung', show: (r) => r.mode !== 'workout', cell: (r) => ({ value: de(r.grade), unit: '%', sub: r.alt !== undefined ? `${Math.round(r.alt)} m Höhe` : undefined }) },
  { id: 'segment', label: 'Abschnitt (Workout)', show: (r) => r.mode === 'workout' && r.segIndex >= 0, cell: (r) => ({ value: fmtTime(r.segRemaining), sub: `${r.segIndex + 1} von ${r.segments!.length}` }) },
  { id: 'avgPower', label: 'Ø Leistung', cell: (r) => ({ value: r.avgPower, unit: 'W' }) },
  { id: 'wkg', label: 'Watt pro kg', cell: (r, a) => ({ value: de(r.power / a.profile.weight, 2), unit: 'W/kg' }) },
  { id: 'ftpPct', label: 'Prozent der FTP', cell: (r, a) => ({ value: Math.round((r.power / a.profile.ftp) * 100), unit: '%' }) },
  { id: 'kj', label: 'Arbeit', cell: (r) => ({ value: r.kj, unit: 'kJ' }) },
  { id: 'gear', label: 'Gang', show: (r) => r.mode !== 'workout' && r.wattLock === null, cell: (r) => ({ value: r.gear > 0 ? `+${r.gear}` : r.gear, sub: 'virtuelle Schaltung' }) },
  { id: 'remaining', label: 'Reststrecke / Restzeit', show: (r) => r.mode !== 'free', cell: (r) => (r.route ? { value: fmtKm(Math.max(0, r.route.distance - r.dist)), unit: 'km' } : { value: fmtTime(r.workoutDuration - r.workoutTime) }) },
];
export const DEFAULT_HUD = ['power', 'target', 'hr', 'cadence', 'speed', 'dist', 'time', 'grade', 'segment'];

function Metric({ label, c }: { label: string; c: Cell }) {
  return (
    <div className="metric">
      <div className="metric-label">{label}</div>
      <div className="metric-value" style={c.color ? { color: c.color } : undefined}>
        {c.value}
        {c.unit && <span className="metric-unit"> {c.unit}</span>}
      </div>
      {c.sub && <div className="metric-sub">{c.sub}</div>}
    </div>
  );
}

const STATUS: Record<string, string> = {
  waiting: 'Tritt los, dann startet die Aufzeichnung.',
  autopaused: 'Pausiert – tritt weiter, um fortzufahren.',
  paused: 'Pausiert.',
};

export function RidePage() {
  const app = useApp();
  const [ending, setEnding] = useState(false);
  const [map, setMap] = useState(true);
  const [pacerW, setPacerW] = useState(String(Math.round(app.profile.ftp * 0.7)));
  const r = app.ride;
  const canShift = !!r && r.mode !== 'workout' && r.wattLock === null;

  // Tastatur: Leertaste = Pause, Pfeil hoch/runter = schalten
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (e.code === 'Space') { e.preventDefault(); rideActions.togglePause(); }
      if (canShift && e.code === 'ArrowUp') { e.preventDefault(); rideActions.shift(1); }
      if (canShift && e.code === 'ArrowDown') { e.preventDefault(); rideActions.shift(-1); }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [canShift]);

  if (!r) return null;
  const ftp = app.profile.ftp;
  const t = app.trainer;
  const hud = app.profile.hud ?? DEFAULT_HUD;
  const fields = HUD_FIELDS.filter((f) => hud.includes(f.id) && (!f.show || f.show(r)));

  const end = async () => {
    if (!r.done && r.elapsed > 5 && !confirm('Fahrt beenden und speichern?')) return;
    setEnding(true);
    const ride = await finishRide();
    if (ride && app.profile.autoStrava) {
      try {
        const up = await stravaUpload(ride);
        if (up.activityId) await dbPut('rides', { ...ride, stravaId: up.activityId });
        log(up.activityId ? 'Fahrt automatisch zu Strava hochgeladen.' : 'Fahrt zu Strava gesendet, die Verarbeitung läuft noch.');
      } catch (err) {
        log(`Automatischer Strava-Upload fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    go(ride ? `verlauf/${ride.id}` : 'start');
  };

  const markers = [
    ...(r.ghost ? [{ dist: r.ghost.dist, color: '#a78bfa' }] : []),
    ...(r.pacer ? [{ dist: r.pacer.dist, color: '#38bdf8' }] : []),
  ];

  const flat = !!app.profile.flatView;
  const showMap = !!r.route && !r.route.synthetic && map;
  const notice = r.done ? 'Geschafft! Beende die Fahrt, um sie zu speichern.' : r.status !== 'running' ? STATUS[r.status] : '';

  return (
    <div className={`ride-screen ${flat ? 'is-flat' : ''}`}>
      {!flat && <World3D low={!!app.profile.lowGraphics} />}
      <div className="hud-top">
        <div className="metrics">
          {fields.map((f) => <Metric key={f.id} label={f.label.replace(' (Workout)', '')} c={f.cell(r, app)} />)}
          {r.ghost && <Metric label="Ghost" c={{ value: Math.abs(Math.round(r.ghost.gap)), unit: 'm', color: '#c4b5fd', sub: r.ghost.gap > 0 ? 'vor dir' : 'hinter dir' }} />}
          {r.pacer && <Metric label={`Tempomacher ${r.pacer.power} W`} c={{ value: Math.abs(Math.round(r.pacer.gap)), unit: 'm', color: '#7dd3fc', sub: r.pacer.gap > 0 ? 'vor dir' : 'hinter dir' }} />}
        </div>
        {notice && <div className="hud-notice">{notice}</div>}
        {t && t.state !== 'connected' && <div className="hud-notice error">Verbindung zur Rolle verloren – es wird neu verbunden. Die Fahrt bleibt erhalten.</div>}
        {!t && <div className="hud-notice error">Keine Rolle verbunden. Verbinde sie auf der Startseite, die Fahrt läuft danach weiter.</div>}
        {t && !t.controllable && <div className="hud-notice">Diese Rolle liefert nur Daten. Widerstand und Zielwatt lassen sich nicht steuern.</div>}
      </div>

      <div className="hud-bottom">
        {showMap && (
          <div className="hud-map">
            <MiniMap route={r.route!} position={r.dist} markers={markers} />
          </div>
        )}
        <div className="hud-profile">
          {r.mode === 'workout' && r.segments && <WorkoutChart segments={r.segments} position={r.workoutTime} height={84} />}
          {r.route && <ElevationChart route={r.route} position={r.dist} height={84} markers={markers} />}
          {r.mode === 'free' && <PowerTrace values={r.recent} ftp={ftp} height={64} />}
        </div>
        <div className="controls">
          <button onClick={rideActions.togglePause} disabled={r.done} title="Leertaste">{r.status === 'paused' ? 'Weiter' : 'Pause'}</button>
          {r.mode === 'workout' && (
            <div className="group">
              <button onClick={() => rideActions.setBias(r.bias - 0.05)} title="Zielleistung senken">−5 %</button>
              <span className="muted">Intensität {Math.round(r.bias * 100)} %</span>
              <button onClick={() => rideActions.setBias(r.bias + 0.05)} title="Zielleistung erhöhen">+5 %</button>
              <button onClick={rideActions.skipSegment} disabled={r.done}>Abschnitt überspringen</button>
            </div>
          )}
          {r.mode !== 'workout' && (
            <div className="group">
              {r.wattLock === null ? (
                <button onClick={() => rideActions.setWattLock(Math.max(r.power, 80))} title="Die Rolle hält deine aktuelle Leistung konstant">Watt halten</button>
              ) : (
                <>
                  <button onClick={() => rideActions.setWattLock(r.wattLock! - 10)}>−10 W</button>
                  <b>{r.wattLock} W</b>
                  <button onClick={() => rideActions.setWattLock(r.wattLock! + 10)}>+10 W</button>
                  <button onClick={() => rideActions.setWattLock(null)}>Lösen</button>
                </>
              )}
            </div>
          )}
          {canShift && (
            <div className="group" title="Pfeiltasten hoch/runter">
              <button onClick={() => rideActions.shift(-1)}>Leichter</button>
              <span className="muted">Gang {r.gear > 0 ? `+${r.gear}` : r.gear}</span>
              <button onClick={() => rideActions.shift(1)}>Schwerer</button>
            </div>
          )}
          {r.mode === 'free' && r.wattLock === null && (
            <div className="group">
              <button onClick={() => rideActions.setManualGrade(r.manualGrade - 0.5)}>Steigung −</button>
              <span className="muted">{de(r.manualGrade)} %</span>
              <button onClick={() => rideActions.setManualGrade(r.manualGrade + 0.5)}>Steigung +</button>
            </div>
          )}
          {r.mode !== 'workout' && (
            <div className="group">
              <span className="muted">Tempomacher</span>
              <span className="unit"><input className="num" type="number" min={50} max={600} step={5} value={pacerW} onChange={(e) => setPacerW(e.target.value)} /> W</span>
              <button disabled={!(Number(pacerW) >= 50 && Number(pacerW) <= 600)} onClick={() => rideActions.setPacer(Number(pacerW))}>{r.pacer ? 'Ändern' : 'Start'}</button>
              {r.pacer && <button onClick={() => rideActions.setPacer(null)}>Aus</button>}
            </div>
          )}
          {t?.kind === 'demo' && <DemoSlider />}
          <span className="spacer" />
          {r.route && !r.route.synthetic && <button onClick={() => setMap(!map)}>{map ? 'Karte aus' : 'Karte an'}</button>}
          {!flat && (
            <button onClick={() => updateProfile({ lowGraphics: !app.profile.lowGraphics })} title="Niedrig: ohne Gras und Schatten, mit einfacheren Bäumen – für Rechner ohne starke Grafikkarte">
              Grafik: {app.profile.lowGraphics ? 'niedrig' : 'hoch'}
            </button>
          )}
          <button onClick={() => updateProfile({ flatView: !flat })} title="Die 3D-Ansicht braucht eine Grafikkarte; auf schwachen Rechnern lässt sie sich abschalten">{flat ? '3D an' : '3D aus'}</button>
          <a className="button" href="#/start" title="Die Fahrt läuft weiter">Menü</a>
          <button className="danger" disabled={ending} onClick={end}>Fahrt beenden</button>
        </div>
      </div>
    </div>
  );
}
