import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/tokens.css';
import { App } from './app/App';
import { AppProvider } from './app/context';
import { createLocalCommands } from './data/local-commands';
import { indexedDbPersistence, memoryPersistence } from './data/persistence';
import { buildSampleData } from './data/seed';
import { Store, isCurrentSchema } from './data/store';
import type { Persistence } from './data/store';

async function boot() {
  const root = createRoot(document.getElementById('root')!);
  let persistence: Persistence = indexedDbPersistence();
  let loaded;
  try {
    loaded = await persistence.load();
  } catch (err) {
    // Private browsing or blocked storage: keep working in memory for this visit.
    console.warn('IndexedDB er ikke tilgjengelig; data lagres bare i denne fanen.', err);
    persistence = memoryPersistence();
  }
  const state = isCurrentSchema(loaded) ? loaded : await buildSampleData(persistence);
  const store = new Store(state, persistence);
  if (!isCurrentSchema(loaded)) await persistence.save(state).catch(() => undefined);
  const cmd = createLocalCommands(store);

  root.render(
    <StrictMode>
      <AppProvider store={store} cmd={cmd}>
        <App />
      </AppProvider>
    </StrictMode>,
  );
}

boot();
