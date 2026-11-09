import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { createHandler } from './app.ts';
import { CredentialStore } from './credential-store.ts';
import { loadOrCreateMasterKey } from './crypto.ts';
import { ResponsesProvider } from './provider.ts';

const dataDir = resolve(process.env.PAINTREST_DATA_DIR ?? '.paintrest-data');
const port = Number(process.env.PORT ?? 8787);
// Localhost only: the browser reaches this through the Vite proxy.
const host = process.env.HOST ?? '127.0.0.1';

const store = new CredentialStore(dataDir, loadOrCreateMasterKey(dataDir));
const provider = new ResponsesProvider(store);

createServer(createHandler(store, provider)).listen(port, host, () => {
  console.log(`[api] Paintrest-server på http://${host}:${port} (data: ${dataDir})`);
});
