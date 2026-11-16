// Lokale Speicherung im Browser: IndexedDB für Fahrten, Strecken und Workouts,
// localStorage für das Profil.
import { DEFAULT_PROFILE, type Profile } from './types';

export type StoreName = 'rides' | 'routes' | 'workouts';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('rollwerk', 1);
    req.onupgradeneeded = () => {
      for (const s of ['rides', 'routes', 'workouts']) {
        if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export const dbAll = <T>(store: StoreName) => run<T[]>(store, 'readonly', (s) => s.getAll());
export const dbGet = <T>(store: StoreName, id: string) => run<T | undefined>(store, 'readonly', (s) => s.get(id));
export const dbPut = <T>(store: StoreName, value: T) => run(store, 'readwrite', (s) => s.put(value));
export const dbDelete = (store: StoreName, id: string) => run(store, 'readwrite', (s) => s.delete(id));

export function loadProfile(): Profile {
  try {
    return { ...DEFAULT_PROFILE, ...JSON.parse(localStorage.getItem('rollwerk.profile') || '{}') };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem('rollwerk.profile', JSON.stringify(p));
  } catch {
    /* Speicher nicht verfügbar */
  }
}
