import { useState } from 'react';
import {
  disconnectHeartRate, disconnectTrainer, getDemoPower, pairHeartRate, pairTrainer, setDemoPower, startRide, useApp,
  useDemoTrainer,
} from '../core/app';
import { bluetoothAvailable } from '../ble/devices';
import { go } from './App';

export function DemoSlider() {
  const [w, setW] = useState(getDemoPower());
  return (
    <label className="demo-slider">
      Demo-Leistung: <b>{w} W</b>
      <input
        type="range" min={0} max={500} step={5} value={w}
        onChange={(e) => {
          setW(Number(e.target.value));
          setDemoPower(Number(e.target.value));
        }}
      />
    </label>
  );
}

export function StartPage() {
  const app = useApp();
  const t = app.trainer;
  return (
    <div className="page">
      {!bluetoothAvailable() && (
        <div className="notice">
          Dieser Browser unterstützt kein Bluetooth. Öffne Rollwerk in Chrome oder Edge, um deine Rolle zu verbinden.
          Zum Ausprobieren funktioniert der Demo-Trainer überall.
        </div>
      )}
      <div className="hero">
        <h1>Bereit für die <em>nächste Runde</em>?</h1>
        <p>Rolle verbinden, Strecke oder Workout wählen, losfahren.</p>
      </div>
      <div className="grid2">
        <section className="card">
          <h2>Geräte</h2>
          <div className="device">
            <div>
              <div className="device-title">Rolle</div>
              <div className="muted">
                {t
                  ? `${t.name} · ${t.state === 'connected' ? 'verbunden' : 'verbinde neu …'}${t.controllable ? '' : ' · nur Daten, nicht steuerbar'}`
                  : 'nicht verbunden'}
              </div>
            </div>
            {t ? (
              <button onClick={disconnectTrainer}>Trennen</button>
            ) : (
              <div className="row">
                <button className="primary" disabled={app.busy} onClick={pairTrainer}>Rolle verbinden</button>
                <button onClick={useDemoTrainer}>Demo-Trainer</button>
              </div>
            )}
          </div>
          <div className="device">
            <div>
              <div className="device-title">Pulsgurt</div>
              <div className="muted">
                {app.hrm ? `${app.hrm.name} · ${app.hrm.state === 'connected' ? 'verbunden' : 'verbinde neu …'}` : 'nicht verbunden (optional)'}
              </div>
            </div>
            {app.hrm ? (
              <button onClick={disconnectHeartRate}>Trennen</button>
            ) : (
              <button disabled={app.busy} onClick={pairHeartRate}>Pulsgurt verbinden</button>
            )}
          </div>
          {t?.kind === 'demo' && <DemoSlider />}
          <div className="live-row">
            <div><span className="big">{app.live.power}</span>Watt</div>
            <div><span className="big">{app.live.cadence}</span>U/min</div>
            <div><span className="big">{app.live.hr || '–'}</span>Puls</div>
          </div>
        </section>

        <section className="card">
          <h2>Losfahren</h2>
          {!t && <p className="muted">Verbinde zuerst deine Rolle oder nutze den Demo-Trainer.</p>}
          <div className="start-options">
            <button
              className="primary" disabled={!t}
              onClick={() => {
                startRide('free');
                go('fahrt');
              }}
            >
              Freie Fahrt
            </button>
            <button disabled={!t} onClick={() => go('strecken')}>GPS-Strecke fahren</button>
            <button disabled={!t} onClick={() => go('workouts')}>Workout fahren</button>
          </div>
          <p className="muted small">
            Profil: {app.profile.weight} kg · FTP {app.profile.ftp} W · Steigung zu {Math.round(app.profile.difficulty * 100)} % spürbar.{' '}
            <a href="#/einstellungen">Ändern</a>
          </p>
        </section>
      </div>

      {app.log.length > 0 && (
        <section className="card">
          <h2>Meldungen</h2>
          <pre className="log">{app.log.join('\n')}</pre>
        </section>
      )}
    </div>
  );
}
