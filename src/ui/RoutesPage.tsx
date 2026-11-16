import { useEffect, useState } from 'react';
import { startRide, useApp } from '../core/app';
import { dbAll, dbDelete, dbPut } from '../core/db';
import { makeClimb, parseGpx } from '../core/gpx';
import { fmtKm } from '../core/stats';
import type { Ride, Route } from '../core/types';
import { go } from './App';
import { ElevationChart } from './charts';
import { RouteMap } from './RouteMap';

export function RoutesPage() {
  const app = useApp();
  const [routes, setRoutes] = useState<Route[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [error, setError] = useState('');

  const reload = async () => setRoutes((await dbAll<Route>('routes')).sort((a, b) => b.created - a.created));
  useEffect(() => void reload(), []);

  const onFiles = async (files: FileList | null) => {
    setError('');
    for (const f of Array.from(files ?? [])) {
      try {
        const route = parseGpx(await f.text(), f.name.replace(/\.gpx$/i, ''));
        await dbPut('routes', route);
        setSel(route.id);
      } catch (err) {
        setError(`${f.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await reload();
  };

  const route = routes.find((r) => r.id === sel) ?? routes[0];

  // Ghost: die schnellste frühere Fahrt auf dieser Strecke
  const [ghost, setGhost] = useState<Ride | null>(null);
  const [useGhost, setUseGhost] = useState(true);
  useEffect(() => {
    setGhost(null);
    if (!route) return;
    void dbAll<Ride>('rides').then((rides) => {
      const speed = (r: Ride) => r.samples[r.samples.length - 1].dist / r.samples.length;
      const fits = rides.filter((r) => r.routeId === route.id && !r.inProgress && r.samples.length >= 60);
      setGhost(fits.sort((a, b) => speed(b) - speed(a))[0] ?? null);
    });
  }, [route?.id]);

  const [climb, setClimb] = useState({ open: false, name: 'Mein Anstieg', km: '8', grade: '7' });
  const climbOk = climb.name.trim() && Number(climb.km) >= 0.5 && Number(climb.km) <= 60 && Number(climb.grade) >= 1 && Number(climb.grade) <= 20;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Strecken</h1>
        <button onClick={() => setClimb({ ...climb, open: !climb.open })}>Anstieg erzeugen</button>
        <label className="button primary">
          GPX-Datei laden
          <input type="file" accept=".gpx,application/gpx+xml" multiple hidden onChange={(e) => { void onFiles(e.target.files); e.target.value = ''; }} />
        </label>
      </div>
      {error && <div className="notice error">{error}</div>}
      {climb.open && (
        <section className="card">
          <h2>Anstieg erzeugen</h2>
          <p className="muted small">
            Für einen Berg ohne GPX-Datei: Länge und mittlere Steigung eingeben. Für das echte Profil eines bekannten Passes lade besser dessen GPX-Datei.
          </p>
          <div className="row">
            <label>Name <input value={climb.name} onChange={(e) => setClimb({ ...climb, name: e.target.value })} /></label>
            <label>Länge <span className="unit"><input className="num" type="number" min={0.5} max={60} step={0.5} value={climb.km} onChange={(e) => setClimb({ ...climb, km: e.target.value })} /> km</span></label>
            <label>Ø Steigung <span className="unit"><input className="num" type="number" min={1} max={20} step={0.5} value={climb.grade} onChange={(e) => setClimb({ ...climb, grade: e.target.value })} /> %</span></label>
            <button
              className="primary" disabled={!climbOk}
              onClick={async () => {
                const r = makeClimb(climb.name.trim(), Number(climb.km), Number(climb.grade));
                await dbPut('routes', r);
                setSel(r.id);
                setClimb({ ...climb, open: false });
                await reload();
              }}
            >
              Anlegen
            </button>
          </div>
        </section>
      )}
      {!routes.length && (
        <div className="card muted">
          Noch keine Strecken. Lade eine GPX-Datei, zum Beispiel einen Export aus Komoot, Strava oder von deinem Radcomputer.
        </div>
      )}
      {route && (
        <div className="split">
          <ul className="list">
            {routes.map((r) => (
              <li key={r.id} className={r.id === route.id ? 'active' : ''} onClick={() => setSel(r.id)}>
                <div>{r.name}</div>
                <div className="muted small">{fmtKm(r.distance)} km · {Math.round(r.ascent)} Hm</div>
              </li>
            ))}
          </ul>
          <section className="card">
            <div className="page-head">
              <h2>{route.name}</h2>
              <div className="row">
                <button
                  onClick={async () => {
                    if (!confirm(`Strecke „${route.name}“ löschen?`)) return;
                    await dbDelete('routes', route.id);
                    setSel(null);
                    await reload();
                  }}
                >
                  Löschen
                </button>
                <button
                  className="primary" disabled={!app.trainer}
                  title={app.trainer ? '' : 'Zuerst auf der Startseite eine Rolle verbinden'}
                  onClick={() => {
                    startRide('route', { route, ghost: ghost && useGhost ? ghost.samples : undefined });
                    go('fahrt');
                  }}
                >
                  Strecke fahren
                </button>
              </div>
            </div>
            <p className="muted">
              {fmtKm(route.distance)} km · {Math.round(route.ascent)} Höhenmeter
              {!route.hasElevation && ' · Die Datei enthält keine Höhendaten, die Strecke wird flach gefahren.'}
            </p>
            {ghost && (
              <label className="row">
                <input type="checkbox" checked={useGhost} onChange={(e) => setUseGhost(e.target.checked)} />
                Gegen meine schnellste Fahrt antreten (Ghost vom {new Date(ghost.start).toLocaleDateString('de-DE')})
              </label>
            )}
            <ElevationChart route={route} />
            {!route.synthetic && <RouteMap route={route} />}
          </section>
        </div>
      )}
    </div>
  );
}
