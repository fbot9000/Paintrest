import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createHandler } from './app.ts';
import { CredentialStore } from './credential-store.ts';
import { loadOrCreateMasterKey } from './crypto.ts';
import { fetchImage, fetchPage } from './fetch-page.ts';
import { ResponsesProvider } from './provider.ts';
import { WebSearch } from './search.ts';

const dataDir = resolve(process.env.PAINTREST_DATA_DIR ?? '.paintrest-data');
const port = Number(process.env.PORT ?? 8787);
// Localhost only: the browser reaches this through the Vite proxy.
const host = process.env.HOST ?? '127.0.0.1';
// Test only: lets the research tools open pages on localhost (mock sites).
const allowLocal = process.env.PAINTREST_ALLOW_LOCAL_FETCH === '1';

const masterKey = loadOrCreateMasterKey(dataDir);
const aiStore = new CredentialStore(dataDir, masterKey);
const searchStore = new CredentialStore(dataDir, masterKey, 'local', 'search_credential.json');

createServer(createHandler({
  aiStore,
  provider: new ResponsesProvider(aiStore),
  searchStore,
  search: new WebSearch(searchStore),
  openPage: (url) => fetchPage(url, { allowLocal }),
  getImage: (url) => fetchImage(url, { allowLocal }),
})).listen(port, host, () => {
  console.log(`[api] Paintrest-server på http://${host}:${port} (data: ${dataDir})${allowLocal ? ' · TESTMODUS: lokale sider tillatt' : ''}`);
});
