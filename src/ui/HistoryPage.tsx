import { useEffect, useState } from 'react';
import { updateProfile, useApp } from '../core/app';
import { dbAll, dbDelete, dbPut } from '../core/db';
import { bestPower, computeStats, fmtKm, fmtTime } from '../core/stats';
import { downloadFit, stravaStatus, stravaUpload } from '../core/strava';
import type { Ride } from '../core/types';
import { go } from './App';
import { PowerTrace } from './charts';

const BESTS: [string, number][] = [['5 s', 5], ['1 min', 60], ['5 min', 300], ['20 min', 1200], ['60 min', 3600]];

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="muted small">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

function Detail({ ride, onChange }: { ride: Ride; onChange(): void }) {
  const app = useApp();
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [stravaReady, setStravaReady] = useState(false);
  useEffect(() => {
    setMsg('');
    stravaStatus().then((s) => setStravaReady(s.connected)).catch(() => setStravaReady(false));
  }, [ride.id]);

  const s = computeStats(ride);
  const powers = ride.samples.map((x) => x.power);
  const best1 = bestPower(powers, 60);
  const isRamp = ride.workoutName === 'FTP-Rampentest' && best1 !== null;
  const best20 = bestPower(powers, 1200);
  const is20 = ride.workoutName === 'FTP-Test 20 min' && best20 !== null;
  const newFtp = isRamp ? Math.round(best1! * 0.75) : is20 ? Math.round(best20! * 0.95) : 0;

  const upload = async () => {
    setBusy(true);
    setMsg('Lade zu Strava hoch …');
    try {
      const r = await stravaUpload(ride);
      if (r.activityId) {
        await dbPut('rides', { ...ride, stravaId: r.activityId });
        setMsg('Bei Strava hochgeladen.');
        onChange();
      } else setMsg('Hochgeladen – Strava verarbeitet die Fahrt noch.');
    } catch (err) {
      setMsg(`Upload fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card">
      <div className="page-head">
        <h2>{ride.name}</h2>
        <div className="row">
          <button
            onClick={async () => {
              if (!confirm(`Fahrt „${ride.name}“ endgültig löschen?`)) return;
              await dbDelete('rides', ride.id);
              go('verlauf');
              onChange();
            }}
          >
            Löschen
          </button>
          <button onClick={() => downloadFit(ride)}>FIT-Datei speichern</button>
          {ride.stravaId ? (
            <a className="button" href={`https://www.strava.com/activities/${ride.stravaId}`} target="_blank" rel="noreferrer">Bei Strava ansehen</a>
          ) : stravaReady ? (
            <button className="primary" disabled={busy} onClick={upload}>Zu Strava hochladen</button>
          ) : (
            <a className="button" href="#/einstellungen">Strava einrichten</a>
          )}
        </div>
      </div>
      {msg && <div className="notice">{msg}</div>}
      <p className="muted">
        {new Date(ride.start).toLocaleString('de-DE', { dateStyle: 'full', timeStyle: 'short' })}
      </p>
      <div className="stats">
        <Stat label="Dauer" value={fmtTime(s.duration)} />
        <Stat label="Distanz" value={`${fmtKm(s.distance)} km`} />
        <Stat label="Ø Leistung" value={`${s.avgPower} W`} />
        <Stat label="Normalized Power" value={`${s.np} W`} />
        <Stat label="Max. Leistung" value={`${s.maxPower} W`} />
        <Stat label="Arbeit" value={`${s.kj} kJ`} />
        <Stat label="Intensität" value={s.intensity.toFixed(2).replace('.', ',')} />
        <Stat label="TSS" value={String(s.tss)} />
        <Stat label="Ø Tempo" value={`${(s.avgSpeed * 3.6).toFixed(1).replace('.', ',')} km/h`} />
        {s.avgHr !== undefined && <Stat label="Ø / max. Puls" value={`${s.avgHr} / ${s.maxHr} bpm`} />}
        {s.avgCadence !== undefined && <Stat label="Ø Kadenz" value={`${s.avgCadence} U/min`} />}
        {s.hasGps && <Stat label="Höhenmeter" value={`${s.ascent} m`} />}
      </div>
      <PowerTrace values={powers} ftp={ride.ftp} height={160} />
      <h3>Bestwerte dieser Fahrt</h3>
      <div className="stats">
        {BESTS.map(([label, w]) => {
          const v = bestPower(powers, w);
          return v === null ? null : <Stat key={w} label={label} value={`${v} W`} />;
        })}
      </div>
      {(isRamp || is20) && (
        <div className="notice">
          {isRamp ? `Rampentest: beste Minute ${best1} W` : `FTP-Test: beste 20 Minuten ${best20} W`}, daraus ergibt sich eine FTP von etwa <b>{newFtp} W</b> (bisher {app.profile.ftp} W).{' '}
          {newFtp !== app.profile.ftp && <button onClick={() => updateProfile({ ftp: newFtp })}>Als FTP übernehmen</button>}
        </div>
      )}
    </section>
  );
}

export function HistoryPage() {
  const [rides, setRides] = useState<Ride[] | null>(null);
  const [hash, setHash] = useState(location.hash);
  const reload = async () => setRides((await dbAll<Ride>('rides')).filter((r) => !r.inProgress).sort((a, b) => b.start - a.start));
  useEffect(() => {
    void reload();
    const on = () => setHash(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const id = hash.split('verlauf/')[1];
  if (!rides) return <div className="page" />;
  const ride = rides.find((r) => r.id === id) ?? rides[0];

  return (
    <div className="page">
      <div className="page-head"><h1>Verlauf</h1></div>
      {!rides.length && <div className="card muted">Noch keine Fahrten. Nach deiner ersten Fahrt findest du sie hier.</div>}
      {ride && (
        <div className="split">
          <ul className="list">
            {rides.map((r) => {
              const n = r.samples.length;
              return (
                <li key={r.id} className={r.id === ride.id ? 'active' : ''} onClick={() => go(`verlauf/${r.id}`)}>
                  <div>{r.name}</div>
                  <div className="muted small">
                    {fmtTime(n)} · {fmtKm(n ? r.samples[n - 1].dist : 0)} km{r.stravaId ? ' · Strava ✓' : ''}
                  </div>
                </li>
              );
            })}
          </ul>
          <Detail ride={ride} onChange={reload} />
        </div>
      )}
    </div>
  );
}
