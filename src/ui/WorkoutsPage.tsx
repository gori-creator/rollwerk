import { useEffect, useState } from 'react';
import { startRide, useApp } from '../core/app';
import { dbAll, dbDelete, dbPut } from '../core/db';
import { fmtTime } from '../core/stats';
import type { Block, Workout } from '../core/types';
import { BUILTIN_WORKOUTS, estimateTss, expand, parseErgMrc, parseZwo, totalDuration } from '../core/workout';
import { go } from './App';
import { WorkoutChart } from './charts';

function parseDuration(text: string): number | null {
  const m = text.trim().match(/^(\d+)(?::(\d{1,2}))?$/);
  if (!m) return null;
  return m[2] !== undefined ? Number(m[1]) * 60 + Number(m[2]) : Number(m[1]) * 60;
}

function DurationInput({ value, onChange }: { value: number; onChange(v: number): void }) {
  const [text, setText] = useState(fmtTime(value));
  useEffect(() => setText(fmtTime(value)), [value]);
  return (
    <input
      className="num" value={text} title="Dauer als Minuten:Sekunden"
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const v = parseDuration(text);
        if (v && v > 0) onChange(v);
        else setText(fmtTime(value));
      }}
    />
  );
}

function PercentInput({ value, onChange }: { value: number; onChange(v: number): void }) {
  return (
    <span className="unit">
      <input
        className="num" type="number" min={20} max={300} step={5} value={Math.round(value * 100)}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (v >= 1) onChange(Math.min(300, v) / 100);
        }}
      />
      %
    </span>
  );
}

const NEW_BLOCKS: Record<Block['type'], Block> = {
  steady: { type: 'steady', duration: 300, power: 0.75 },
  ramp: { type: 'ramp', duration: 600, from: 0.5, to: 0.75 },
  intervals: { type: 'intervals', repeat: 4, onDuration: 120, onPower: 1.1, offDuration: 120, offPower: 0.5 },
  free: { type: 'free', duration: 300 },
};
const LABEL: Record<Block['type'], string> = { steady: 'Konstant', ramp: 'Rampe', intervals: 'Intervalle', free: 'Frei' };

function Editor({ initial, onSave, onCancel }: { initial: Workout; onSave(w: Workout): void; onCancel(): void }) {
  const [w, setW] = useState(initial);
  const segs = expand(w.blocks);
  const upd = (i: number, patch: Partial<Block>) =>
    setW({ ...w, blocks: w.blocks.map((b, k) => (k === i ? ({ ...b, ...patch } as Block) : b)) });
  const move = (i: number, d: number) => {
    const blocks = [...w.blocks];
    const j = i + d;
    if (j < 0 || j >= blocks.length) return;
    [blocks[i], blocks[j]] = [blocks[j], blocks[i]];
    setW({ ...w, blocks });
  };
  return (
    <section className="card">
      <div className="page-head">
        <h2>Workout bearbeiten</h2>
        <div className="row">
          <button onClick={onCancel}>Abbrechen</button>
          <button className="primary" disabled={!w.blocks.length || !w.name.trim()} onClick={() => onSave({ ...w, name: w.name.trim() })}>
            Speichern
          </button>
        </div>
      </div>
      <div className="form">
        <label>Name<input value={w.name} onChange={(e) => setW({ ...w, name: e.target.value })} /></label>
        <label>Beschreibung<input value={w.description ?? ''} onChange={(e) => setW({ ...w, description: e.target.value })} /></label>
      </div>
      <WorkoutChart segments={segs} />
      <p className="muted small">
        Dauer {fmtTime(totalDuration(segs))} · Belastung ca. {Math.round(estimateTss(segs))} TSS · Leistung in Prozent deiner FTP
      </p>
      <table className="blocks">
        <tbody>
          {w.blocks.map((b, i) => (
            <tr key={i}>
              <td className="muted">{i + 1}</td>
              <td><b>{LABEL[b.type]}</b></td>
              <td>
                {b.type === 'steady' && (<><DurationInput value={b.duration} onChange={(v) => upd(i, { duration: v })} /> bei <PercentInput value={b.power} onChange={(v) => upd(i, { power: v })} /></>)}
                {b.type === 'ramp' && (<><DurationInput value={b.duration} onChange={(v) => upd(i, { duration: v })} /> von <PercentInput value={b.from} onChange={(v) => upd(i, { from: v })} /> auf <PercentInput value={b.to} onChange={(v) => upd(i, { to: v })} /></>)}
                {b.type === 'free' && (<><DurationInput value={b.duration} onChange={(v) => upd(i, { duration: v })} /> ohne Vorgabe</>)}
                {b.type === 'intervals' && (
                  <>
                    <input className="num" type="number" min={1} max={50} value={b.repeat} onChange={(e) => upd(i, { repeat: Math.max(1, Math.min(50, Math.round(Number(e.target.value)) || 1)) })} /> ×{' '}
                    <DurationInput value={b.onDuration} onChange={(v) => upd(i, { onDuration: v })} /> bei <PercentInput value={b.onPower} onChange={(v) => upd(i, { onPower: v })} />, Pause{' '}
                    <DurationInput value={b.offDuration} onChange={(v) => upd(i, { offDuration: v })} /> bei <PercentInput value={b.offPower} onChange={(v) => upd(i, { offPower: v })} />
                  </>
                )}
              </td>
              <td className="row right">
                <button className="small" disabled={i === 0} onClick={() => move(i, -1)} title="Nach oben">↑</button>
                <button className="small" disabled={i === w.blocks.length - 1} onClick={() => move(i, 1)} title="Nach unten">↓</button>
                <button className="small" onClick={() => setW({ ...w, blocks: w.blocks.filter((_, k) => k !== i) })} title="Entfernen">✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <span className="muted">Abschnitt hinzufügen:</span>
        {(Object.keys(NEW_BLOCKS) as Block['type'][]).map((t) => (
          <button key={t} onClick={() => setW({ ...w, blocks: [...w.blocks, { ...NEW_BLOCKS[t] }] })}>{LABEL[t]}</button>
        ))}
      </div>
    </section>
  );
}

export function WorkoutsPage() {
  const app = useApp();
  const [own, setOwn] = useState<Workout[]>([]);
  const [sel, setSel] = useState<string>(BUILTIN_WORKOUTS[1].id);
  const [editing, setEditing] = useState<Workout | null>(null);
  const [error, setError] = useState('');

  const reload = async () => setOwn((await dbAll<Workout>('workouts')).sort((a, b) => b.created - a.created));
  useEffect(() => void reload(), []);

  const all = [...own, ...BUILTIN_WORKOUTS];
  const w = all.find((x) => x.id === sel) ?? all[0];
  const segs = expand(w.blocks);
  const ftp = app.profile.ftp;

  const onFiles = async (files: FileList | null) => {
    setError('');
    for (const f of Array.from(files ?? [])) {
      try {
        const text = await f.text();
        const base = f.name.replace(/\.(zwo|erg|mrc)$/i, '');
        const parsed = /\.zwo$/i.test(f.name) ? parseZwo(text, base) : parseErgMrc(text, ftp, base);
        await dbPut('workouts', parsed);
        setSel(parsed.id);
      } catch (err) {
        setError(`${f.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    await reload();
  };

  if (editing) {
    return (
      <div className="page">
        <Editor
          initial={editing}
          onCancel={() => setEditing(null)}
          onSave={async (saved) => {
            await dbPut('workouts', saved);
            setSel(saved.id);
            setEditing(null);
            await reload();
          }}
        />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>Workouts</h1>
        <div className="row">
          <label className="button">
            Importieren (.zwo, .erg, .mrc)
            <input type="file" accept=".zwo,.erg,.mrc" multiple hidden onChange={(e) => { void onFiles(e.target.files); e.target.value = ''; }} />
          </label>
          <button
            className="primary"
            onClick={() => setEditing({ id: crypto.randomUUID(), name: 'Mein Workout', blocks: [{ ...NEW_BLOCKS.ramp }, { ...NEW_BLOCKS.intervals }, { type: 'ramp', duration: 300, from: 0.6, to: 0.4 }], created: Date.now() })}
          >
            Neues Workout
          </button>
        </div>
      </div>
      {error && <div className="notice error">{error}</div>}
      <div className="split">
        <ul className="list">
          {all.map((x) => (
            <li key={x.id} className={x.id === w.id ? 'active' : ''} onClick={() => setSel(x.id)}>
              <div>{x.name}</div>
              <div className="muted small">{fmtTime(totalDuration(expand(x.blocks)))}{x.builtin ? ' · mitgeliefert' : ''}</div>
            </li>
          ))}
        </ul>
        <section className="card">
          <div className="page-head">
            <h2>{w.name}</h2>
            <div className="row">
              {!w.builtin && (
                <button
                  onClick={async () => {
                    if (!confirm(`Workout „${w.name}“ löschen?`)) return;
                    await dbDelete('workouts', w.id);
                    setSel(BUILTIN_WORKOUTS[1].id);
                    await reload();
                  }}
                >
                  Löschen
                </button>
              )}
              <button onClick={() => setEditing(w.builtin ? { ...w, id: crypto.randomUUID(), name: `${w.name} (Kopie)`, builtin: undefined, created: Date.now() } : w)}>
                {w.builtin ? 'Als Kopie bearbeiten' : 'Bearbeiten'}
              </button>
              <button
                className="primary" disabled={!app.trainer}
                title={app.trainer ? '' : 'Zuerst auf der Startseite eine Rolle verbinden'}
                onClick={() => {
                  startRide('workout', { workout: w });
                  go('fahrt');
                }}
              >
                Workout starten
              </button>
            </div>
          </div>
          {w.description && <p>{w.description}</p>}
          <WorkoutChart segments={segs} height={160} />
          <p className="muted">
            Dauer {fmtTime(totalDuration(segs))} · Belastung ca. {Math.round(estimateTss(segs))} TSS · berechnet mit FTP {ftp} W
          </p>
          <table className="blocks">
            <tbody>
              {segs.slice(0, 60).map((s, i) => (
                <tr key={i}>
                  <td className="muted">{fmtTime(s.start)}</td>
                  <td>{fmtTime(s.duration)}</td>
                  <td>
                    {s.free ? 'frei' : s.from === s.to ? `${Math.round(s.from * ftp)} W (${Math.round(s.from * 100)} %)` : `${Math.round(s.from * ftp)} → ${Math.round(s.to * ftp)} W`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
