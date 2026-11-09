import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/tokens.css';
import { App } from './app/App';
import { AppProvider } from './app/context';
import { httpAiGateway } from './data/ai-http';
import { createLocalCommands } from './data/local-commands';
import { createAgentCommands, createResearchCommands } from './data/research-commands';
import { indexedDbPersistence, memoryPersistence } from './data/persistence';
import { buildSampleData } from './data/seed';
import { Store, migrate } from './data/store';
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
  const migrated = migrate(loaded);
  const state = migrated ?? await buildSampleData(persistence);
  const store = new Store(state, persistence);
  if (!migrated || migrated !== loaded) await persistence.save(state).catch(() => undefined);
  const cmd = createLocalCommands(store);
  const ai = httpAiGateway();

  root.render(
    <StrictMode>
      <AppProvider store={store} cmd={cmd} ai={ai} research={createResearchCommands(store, { fetchImage: ai.fetchImage })} agent={createAgentCommands(store)}>
        <App />
      </AppProvider>
    </StrictMode>,
  );
}

boot();
