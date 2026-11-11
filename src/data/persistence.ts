import { createStore, get, set, del } from 'idb-keyval';
import type { DbState, Persistence } from './store';

const STATE_KEY = 'state';

/** IndexedDB persistence. One record holds all tables; files are separate blobs. */
export function indexedDbPersistence(dbName = 'paintrest'): Persistence {
  const kv = createStore(dbName, 'kv');
  return {
    kind: 'browser',
    load: () => get<DbState>(STATE_KEY, kv),
    save: (state) => set(STATE_KEY, state, kv),
    putBlob: (key, blob) => set(`blob:${key}`, blob, kv),
    getBlob: (key) => get<Blob>(`blob:${key}`, kv),
    deleteBlob: (key) => del(`blob:${key}`, kv),
  };
}

/** In-memory persistence for tests and when IndexedDB is unavailable. */
export function memoryPersistence(): Persistence {
  let saved: DbState | undefined;
  const blobs = new Map<string, Blob>();
  return {
    kind: 'memory',
    load: async () => saved,
    save: async (s) => {
      saved = structuredClone(s);
    },
    putBlob: async (k, b) => {
      blobs.set(k, b);
    },
    getBlob: async (k) => blobs.get(k),
    deleteBlob: async (k) => {
      blobs.delete(k);
    },
  };
}
