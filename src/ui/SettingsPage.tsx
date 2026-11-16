import { useEffect, useState } from 'react';
import { updateProfile, useApp } from '../core/app';
import { ZONES } from '../core/stats';
import { DEFAULT_HUD, HUD_FIELDS } from './RidePage';
import { stravaConfigure, stravaDisconnect, stravaStatus, type StravaStatus } from '../core/strava';

function NumberField({ label, value, min, max, unit, onChange }: { label: string; value: number; min: number; max: number; unit: string; onChange(v: number): void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  return (
    <label>
      {label}
      <span className="unit">
        <input
          className="num" type="number" min={min} max={max} value={text}
          onChange={(e) => {
            setText(e.target.value);
            const v = Number(e.target.value);
            if (v >= min && v <= max) onChange(v);
          }}
          onBlur={() => setText(String(value))}
        />
        {unit}
      </span>
    </label>
  );
}

const CALLBACK: Record<string, string> = {
  ok: 'Strava ist verbunden.',
  denied: 'Die Verbindung wurde bei Strava abgelehnt.',
  scope: 'Ohne die Erlaubnis zum Hochladen kann Rollwerk keine Fahrten zu Strava senden. Bitte erneut verbinden und den Haken gesetzt lassen.',
  state: 'Die Anmeldung ist abgelaufen. Bitte erneut verbinden.',
  token: 'Strava hat die Anmeldung abgelehnt. Prüfe Client-ID und Client-Secret.',
};

function Strava() {
  const [status, setStatus] = useState<StravaStatus | null>(null);
  const [error, setError] = useState('');
  const [id, setId] = useState('');
  const [secret, setSecret] = useState('');
  const [edit, setEdit] = useState(false);
  const result = new URLSearchParams(location.hash.split('?')[1] ?? '').get('strava');

  const load = () => stravaStatus().then((s) => { setStatus(s); setId(s.clientId); setError(''); }).catch((e) => setError(e.message));
  useEffect(() => void load(), []);

  if (error && !status) return <div className="notice error">{error}</div>;
  if (!status) return null;

  return (
    <>
      {result && <div className={`notice ${result === 'ok' ? '' : 'error'}`}>{CALLBACK[result] ?? result}</div>}
      {error && <div className="notice error">{error}</div>}
      {status.connected && !edit ? (
        <div className="device">
          <div>
            <div className="device-title">Verbunden{status.athlete ? ` als ${status.athlete}` : ''}</div>
            <div className="muted">Fahrten lädst du im Verlauf mit einem Klick hoch.</div>
          </div>
          <button onClick={async () => { await stravaDisconnect().catch((e) => setError(e.message)); await load(); }}>Verbindung trennen</button>
        </div>
      ) : status.configured && !edit ? (
        <div className="row">
          <a className="button primary" href="/api/strava/login">Mit Strava verbinden</a>
          <button onClick={() => setEdit(true)}>Zugangsdaten ändern</button>
        </div>
      ) : (
        <>
          <ol className="steps">
            <li>Öffne <a href="https://www.strava.com/settings/api" target="_blank" rel="noreferrer">strava.com/settings/api</a> und lege eine eigene API-Anwendung an (kostenlos).</li>
            <li>Trage dort als „Authorization Callback Domain“ <code>localhost</code> ein.</li>
            <li>Kopiere Client-ID und Client-Secret hierher. Beides bleibt auf deinem Rechner.</li>
          </ol>
          <div className="form">
            <label>Client-ID<input value={id} onChange={(e) => setId(e.target.value)} inputMode="numeric" /></label>
            <label>Client-Secret<input value={secret} onChange={(e) => setSecret(e.target.value)} type="password" autoComplete="off" /></label>
          </div>
          <div className="row">
            <button
              className="primary" disabled={!id || !secret}
              onClick={async () => {
                try {
                  await stravaConfigure(id, secret);
                  setSecret('');
                  setEdit(false);
                  await load();
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              Speichern
            </button>
            {edit && <button onClick={() => setEdit(false)}>Abbrechen</button>}
          </div>
        </>
      )}
    </>
  );
}

export function SettingsPage() {
  const { profile } = useApp();
  return (
    <div className="page">
      <div className="page-head"><h1>Einstellungen</h1></div>
      <div className="grid2">
        <section className="card">
          <h2>Profil</h2>
          <div className="form">
            <NumberField label="Dein Gewicht" value={profile.weight} min={30} max={200} unit="kg" onChange={(v) => updateProfile({ weight: v })} />
            <NumberField label="Gewicht des Rads" value={profile.bikeWeight} min={4} max={30} unit="kg" onChange={(v) => updateProfile({ bikeWeight: v })} />
            <NumberField label="FTP (Schwellenleistung)" value={profile.ftp} min={50} max={600} unit="W" onChange={(v) => updateProfile({ ftp: v })} />
            <label>
              Spürbare Steigung: {Math.round(profile.difficulty * 100)} %
              <input type="range" min={0} max={100} step={5} value={Math.round(profile.difficulty * 100)} onChange={(e) => updateProfile({ difficulty: Number(e.target.value) / 100 })} />
            </label>
          </div>
          <p className="muted small">
            Die spürbare Steigung bestimmt, wie stark die Rolle Anstiege einer GPS-Strecke nachstellt. Dein Tempo wird immer
            mit der echten Steigung berechnet. Deine FTP kennst du nicht? Fahre den FTP-Rampentest unter Workouts.
          </p>
        </section>
        <section className="card">
          <h2>Leistungszonen</h2>
          <table className="blocks">
            <tbody>
              {ZONES.map((z, i) => {
                const lo = i === 0 ? 0 : Math.round(ZONES[i - 1].max * profile.ftp);
                return (
                  <tr key={z.name}>
                    <td><span className="dot" style={{ background: z.color }} /> {z.name}</td>
                    <td>{isFinite(z.max) ? `${lo} – ${Math.round(z.max * profile.ftp) - 1} W` : `ab ${lo} W`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>
      <section className="card">
        <h2>Datenfelder im Fahrtbildschirm</h2>
        <p className="muted small">Wähle, welche Werte du beim Fahren siehst. Felder, die zur Fahrt nicht passen (z. B. Steigung im Workout), blendet Rollwerk selbst aus.</p>
        <div className="checks">
          {HUD_FIELDS.map((f) => {
            const hud = profile.hud ?? DEFAULT_HUD;
            return (
              <label key={f.id}>
                <input
                  type="checkbox" checked={hud.includes(f.id)}
                  onChange={(e) => updateProfile({ hud: HUD_FIELDS.map((x) => x.id).filter((id) => (id === f.id ? e.target.checked : hud.includes(id))) })}
                />
                {f.label}
              </label>
            );
          })}
        </div>
      </section>
      <section className="card">
        <h2>Strava</h2>
        <label className="row">
          <input type="checkbox" checked={!!profile.autoStrava} onChange={(e) => updateProfile({ autoStrava: e.target.checked })} />
          Fahrten nach dem Beenden automatisch zu Strava hochladen
        </label>
        <Strava />
      </section>
    </div>
  );
}
