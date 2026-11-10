import { createServer } from 'node:http';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { DataStore, moveKeysFrom } from './data-store.ts';
import { createHandler } from './app.ts';
import { CredentialStore } from './credential-store.ts';
import { loadOrCreateMasterKey } from './crypto.ts';
import { fetchImage, fetchPage, fetchVideo } from './fetch-page.ts';
import { ResponsesProvider } from './provider.ts';
import { WebSearch } from './search.ts';

// One fixed folder for everything: data, images, backups and the encrypted keys.
const dataDir = resolve((process.env.PAINTREST_DATA_DIR ?? '~/Paintrest').replace(/^~(?=$|\/)/, homedir()));
const data = new DataStore(dataDir);
const moved = moveKeysFrom(resolve('.paintrest-data'), dataDir);
if (moved.length) console.log(`[api] Flyttet ${moved.join(', ')} fra .paintrest-data til ${dataDir} (kopiert, originalene står).`);
const port = Number(process.env.PORT ?? 8787);
// Localhost only: the browser reaches this through the Vite proxy.
const host = process.env.HOST ?? '127.0.0.1';
// Test only: lets the research tools open pages on localhost (mock sites).
const allowLocal = process.env.PAINTREST_ALLOW_LOCAL_FETCH === '1';

const masterKey = loadOrCreateMasterKey(dataDir);
const aiStore = new CredentialStore(dataDir, masterKey);
// Tests point this at a local mock; otherwise YouTube's own endpoint.
const oembedBase = allowLocal ? process.env.PAINTREST_OEMBED_URL || undefined : undefined;
const searchStore = new CredentialStore(dataDir, masterKey, 'local', 'search_credential.json');

createServer(createHandler({
  aiStore,
  provider: new ResponsesProvider(aiStore),
  searchStore,
  search: new WebSearch(searchStore),
  openPage: (url) => fetchPage(url, { allowLocal, oembedBase }),
  getImage: (url) => fetchImage(url, { allowLocal }),
  videoInfo: (url) => fetchVideo(url, { allowLocal, oembedBase }),
  data,
})).listen(port, host, () => {
  console.log(`[api] Paintrest-server på http://${host}:${port} (data: ${dataDir})${allowLocal ? ' · TESTMODUS: lokale sider tillatt' : ''}`);
});
