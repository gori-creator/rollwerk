import { useEffect, useState } from 'react';
import { recoverRides, useApp } from '../core/app';
import { StartPage } from './StartPage';
import { RoutesPage } from './RoutesPage';
import { WorkoutsPage } from './WorkoutsPage';
import { RidePage } from './RidePage';
import { HistoryPage } from './HistoryPage';
import { SettingsPage } from './SettingsPage';

const NAV = [
  ['start', 'Start'],
  ['strecken', 'Strecken'],
  ['workouts', 'Workouts'],
  ['verlauf', 'Verlauf'],
  ['einstellungen', 'Einstellungen'],
] as const;

export function go(page: string) {
  location.hash = `#/${page}`;
}

function currentPage() {
  return location.hash.replace(/^#\//, '').split('?')[0] || 'start';
}

export function App() {
  const [page, setPage] = useState(currentPage());
  const app = useApp();

  useEffect(() => {
    const on = () => setPage(currentPage());
    window.addEventListener('hashchange', on);
    void recoverRides();
    return () => window.removeEventListener('hashchange', on);
  }, []);

  const riding = !!app.ride;
  const show = page === 'fahrt' && !riding ? 'start' : page;

  return (
    <div className="app">
      <header className="top" hidden={show === 'fahrt'}>
        <a className="brand" href="#/start"><span className="brand-mark" />Rollwerk</a>
        <nav>
          {NAV.map(([id, label]) => (
            <a key={id} href={`#/${id}`} className={show.startsWith(id) ? 'active' : ''}>
              {label}
            </a>
          ))}
          {riding && (
            <a href="#/fahrt" className={`ride-link ${show === 'fahrt' ? 'active' : ''}`}>
              ● Fahrt läuft
            </a>
          )}
        </nav>
        <div className="top-live">
          {app.trainer ? (
            <span className={app.trainer.state === 'connected' ? 'ok' : 'warn'}>
              {app.trainer.state === 'connected' ? app.trainer.name : 'Rolle: verbinde neu …'}
            </span>
          ) : (
            <span className="muted">Keine Rolle verbunden</span>
          )}
        </div>
      </header>
      <main>
        {show === 'start' && <StartPage />}
        {show === 'strecken' && <RoutesPage />}
        {show === 'workouts' && <WorkoutsPage />}
        {show === 'fahrt' && <RidePage />}
        {show.startsWith('verlauf') && <HistoryPage />}
        {show === 'einstellungen' && <SettingsPage />}
      </main>
    </div>
  );
}
