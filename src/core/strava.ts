import { encodeFit } from './fit';
import type { Ride } from './types';

export interface StravaStatus {
  configured: boolean;
  connected: boolean;
  athlete: string | null;
  clientId: string;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(path, init);
  } catch {
    throw new Error('Der lokale Rollwerk-Server ist nicht erreichbar.');
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Fehler ${r.status}`);
  return data as T;
}

export const stravaStatus = () => call<StravaStatus>('/api/strava/status');

export const stravaConfigure = (clientId: string, clientSecret: string) =>
  call('/api/strava/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  });

export const stravaDisconnect = () => call('/api/strava/disconnect', { method: 'POST' });

export function stravaUpload(ride: Ride) {
  const q = new URLSearchParams({ name: ride.name, id: `rollwerk-${ride.id}` });
  return call<{ activityId: number | null; pending: boolean }>(`/api/strava/upload?${q}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: encodeFit(ride),
  });
}

export function downloadFit(ride: Ride) {
  const blob = new Blob([encodeFit(ride)], { type: 'application/octet-stream' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${ride.name.replace(/[^\wäöüÄÖÜß-]+/g, '_')}.fit`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
