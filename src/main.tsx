import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import './ui/tokens.css';
import './app/boot.css';
import { App } from './app/App';
import { AppProvider } from './app/context';
import { getSaveStatus, setSaveStatus } from './app/saveStatus';
import { httpAiGateway } from './data/ai-http';
import { createLocalCommands } from './data/local-commands';
import { createAgentCommands, createResearchCommands } from './data/research-commands';
import { indexedDbPersistence, memoryPersistence } from './data/persistence';
import { buildSampleData } from './data/seed';
import { serverAvailable, serverPersistence } from './data/server-persistence';
import { Store, migrate } from './data/store';
import type { DbState, Persistence } from './data/store';

/**
 * Start-up. With the Paintrest server running, the data lives in its data
 * folder (~/Paintrest) and the port does not matter. Without it (for example
 * a static preview), the app falls back to this browser's storage and says so.
 */
async function boot() {
  const root = createRoot(document.getElementById('root')!);
  const server = await serverAvailable();

  if (server) {
    const remote = serverPersistence();
    setSaveStatus({ where: 'server', data_dir: server.data_dir });
    const loaded = migrate(await remote.load());
    if (loaded) return start(root, loaded, remote);

    // The data folder is empty. Data in this browser is offered to be moved, never overwritten.
    const browser = indexedDbPersistence();
    const local = migrate(await browser.load().catch(() => undefined));
    if (local) {
      root.render(<MoveScreen dataDir={server.data_dir} local={local} onDone={(state) => start(root, state, remote)}
        onFresh={async () => start(root, await fresh(remote), remote)} browser={browser} remote={remote} />);
      return;
    }
    return start(root, await fresh(remote), remote);
  }

  let persistence: Persistence = indexedDbPersistence();
  let loaded;
  try {
    loaded = await persistence.load();
  } catch (err) {
    // Private browsing or blocked storage: keep working in memory for this visit.
    console.warn('IndexedDB er ikke tilgjengelig; data lagres bare i denne fanen.', err);
    persistence = memoryPersistence();
  }
  setSaveStatus({ where: persistence.kind });
  const migrated = migrate(loaded);
  const state = migrated ?? await buildSampleData(persistence);
  if (!migrated || migrated !== loaded) await persistence.save(state).catch(() => undefined);
  start(root, state, persistence);
}

async function fresh(p: Persistence): Promise<DbState> {
  const state = await buildSampleData(p);
  await p.save(state);
  return state;
}

function start(root: Root, state: DbState, persistence: Persistence) {
  const store = new Store(state, persistence);
  const ai = httpAiGateway();
  const cmd = createLocalCommands(store, { fetchImage: ai.fetchImage });
  // Do not lose a change that is still on its way to the data folder.
  window.addEventListener('beforeunload', (e) => {
    if (getSaveStatus().state === 'saving' || getSaveStatus().state === 'error') e.preventDefault();
  });
  root.render(
    <StrictMode>
      <AppProvider store={store} cmd={cmd} ai={ai} research={createResearchCommands(store, { fetchImage: ai.fetchImage })} agent={createAgentCommands(store)}>
        <App />
      </AppProvider>
    </StrictMode>,
  );
}

function MoveScreen({ dataDir, local, browser, remote, onDone, onFresh }: {
  dataDir: string; local: DbState; browser: Persistence; remote: Persistence;
  onDone: (s: DbState) => void; onFresh: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const t = local.tables;
  const projects = Object.values(t.project).filter((p) => !p.deleted_at).length;
  const subjects = Object.values(t.miniature_subject).filter((s) => !s.deleted_at).length;
  const files = Object.values(t.stored_file);

  const move = async () => {
    setBusy(true); setError(null);
    try {
      let n = 0;
      for (const f of files) {
        const blob = await browser.getBlob(f.storage_key);
        if (blob) await remote.putBlob(f.storage_key, blob);
        setProgress(`Flytter bilder … ${++n} av ${files.length}`);
      }
      setProgress('Lagrer prosjektene …');
      await remote.save(local);
      if (getSaveStatus().state !== 'saved') throw new Error(getSaveStatus().message ?? 'Lagringen ble ikke bekreftet');
      onDone(local);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <main className="boot">
      <div className="boot-card">
        <span className="eyebrow">Paintrest</span>
        <h1>Flytte dataene til datamappen?</h1>
        <p>
          Paintrest lagrer nå alt i en fast mappe på maskinen: <code>{dataDir}</code>. Da ser du de samme dataene uansett port og nettleser,
          og mappen kan tas med i sikkerhetskopien din.
        </p>
        <p>Denne nettleseren har data fra før: <strong>{projects} prosjekt{projects === 1 ? '' : 'er'}, {subjects} miniatyrer og {files.length} bilder.</strong></p>
        <p className="small muted">Kopien i nettleseren blir liggende urørt, så ingenting går tapt om noe skulle feile.</p>
        {progress && <p className="small">{progress}</p>}
        {error && <p className="boot-error">Flyttingen stoppet: {error}. Ingenting er slettet; prøv igjen.</p>}
        <div className="boot-actions">
          <button type="button" className="btn btn-primary" onClick={move} disabled={busy}>{busy ? 'Flytter …' : 'Flytt dataene til datamappen'}</button>
          <button type="button" className="btn btn-secondary" onClick={onFresh} disabled={busy}>Start med eksempeldata i stedet</button>
        </div>
      </div>
    </main>
  );
}

boot();
