/**
 * Persistence through the Paintrest server: the data lives in the fixed data
 * folder (~/Paintrest), whatever port or browser the app runs in.
 *
 * Saves are coalesced (only the newest state is sent) and carry the revision
 * they are based on. If another tab or device saved in between, the server
 * refuses and the app says so instead of overwriting.
 */
import { setSaveStatus } from '../app/saveStatus';
import type { DbState, Persistence } from './store';

export interface ServerPersistence extends Persistence {
  readonly revision: () => number;
}

export function serverPersistence(): ServerPersistence {
  let revision = 0;
  let pending: DbState | null = null;
  let running: Promise<void> | null = null;
  let stopped = false;

  async function send(): Promise<void> {
    while (pending && !stopped) {
      const state = pending;
      pending = null;
      setSaveStatus({ state: 'saving', message: null });
      let res: Response;
      try {
        res = await fetch('/api/data', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base_revision: revision, state }),
        });
      } catch {
        // The server is not answering: keep the newest state and try again shortly.
        pending ??= state;
        setSaveStatus({ state: 'error', message: 'Serveren svarer ikke. Endringene er ikke lagret ennå; prøver igjen.' });
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      const body = await res.json().catch(() => ({})) as { revision?: number; saved_at?: string; error?: string };
      if (res.status === 409) {
        stopped = true;
        setSaveStatus({ state: 'conflict', message: 'Dataene er endret i en annen fane eller på en annen enhet. Last inn siden på nytt før du fortsetter; endringer herfra lagres ikke.' });
        return;
      }
      if (!res.ok) {
        pending ??= state;
        // 502–504 come from the dev proxy when the Paintrest server is not running.
        const down = res.status >= 502 && res.status <= 504;
        setSaveStatus({ state: 'error', message: down ? 'Paintrest-serveren svarer ikke. Endringene er ikke lagret ennå; prøver igjen.' : body.error ?? `Lagring feilet (${res.status}); prøver igjen.` });
        await new Promise((r) => setTimeout(r, 5000));
        continue;
      }
      revision = body.revision ?? revision + 1;
      setSaveStatus({ state: pending ? 'saving' : 'saved', saved_at: body.saved_at ?? new Date().toISOString(), message: null });
    }
  }

  return {
    kind: 'server',
    revision: () => revision,
    async load() {
      const res = await fetch('/api/data');
      if (!res.ok) throw new Error(`Kunne ikke hente data (${res.status})`);
      const body = await res.json() as { revision: number; saved_at: string | null; state: DbState | null };
      revision = body.revision;
      setSaveStatus({ where: 'server', state: 'saved', saved_at: body.saved_at });
      return body.state ?? undefined;
    },
    save(state) {
      pending = state;
      running ??= send().finally(() => { running = null; });
      return running;
    },
    async putBlob(key, blob) {
      const res = await fetch(`/api/files/${encodeURIComponent(key)}`, {
        method: 'PUT', headers: { 'Content-Type': blob.type || 'application/octet-stream' }, body: blob,
      });
      if (!res.ok) throw new Error(`Kunne ikke lagre filen (${res.status})`);
    },
    async getBlob(key) {
      const res = await fetch(`/api/files/${encodeURIComponent(key)}`);
      if (!res.ok) return undefined;
      return res.blob();
    },
    async deleteBlob(key) {
      await fetch(`/api/files/${encodeURIComponent(key)}`, { method: 'DELETE' });
    },
    async backup(reason) {
      await fetch('/api/data/backup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason }) });
    },
  };
}

/** True when the Paintrest server with a data folder answers (not only the static app). */
export async function serverAvailable(): Promise<{ data_dir: string } | null> {
  try {
    const health = await fetch('/api/health');
    if (!health.ok || !(health.headers.get('content-type') ?? '').includes('json')) return null;
    const h = await health.json() as { storage?: string };
    if (h.storage !== 'server') return null;
    const info = await fetch('/api/data/info');
    return info.ok ? await info.json() as { data_dir: string } : null;
  } catch {
    return null;
  }
}
