import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHandler, normaliseBaseUrl, parseFocus, parseHint } from './app.ts';
import { CredentialStore } from './credential-store.ts';
import { decrypt, encrypt, loadOrCreateMasterKey } from './crypto.ts';
import { ResponsesProvider } from './provider.ts';
import { WebSearch } from './search.ts';
import { DataStore, moveKeysFrom } from './data-store.ts';

const SECRET = 'sk-test-HEMMELIG-1234567890';

// A fake OpenAI-compatible Responses API.
let upstreamUrl = '';
const seen: { auth?: string; body?: unknown }[] = [];
const upstream = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
  seen.push({ auth: req.headers.authorization, body });
  if (req.headers.authorization !== `Bearer ${SECRET}`) {
    res.writeHead(401).end(JSON.stringify({ error: `bad key ${req.headers.authorization}` }));
    return;
  }
  if (req.url === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ data: [{ id: 'gpt-x' }, { id: 'claude-y' }] }));
    return;
  }
  if (req.url === '/v1/responses') {
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
      model: body.model,
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'OK' }] }],
      usage: { input_tokens: 5, output_tokens: 1 },
    }));
    return;
  }
  res.writeHead(404).end();
});

let api = '';
let dataDir = '';
const app = createServer();

beforeAll(async () => {
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
  upstreamUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`;
  dataDir = mkdtempSync(join(tmpdir(), 'paintrest-'));
  const key = loadOrCreateMasterKey(dataDir);
  const store = new CredentialStore(dataDir, key);
  const searchStore = new CredentialStore(dataDir, key, 'local', 'search_credential.json');
  app.on('request', createHandler({
    aiStore: store, provider: new ResponsesProvider(store), searchStore, search: new WebSearch(searchStore),
    openPage: async () => { throw new Error('not used'); }, getImage: async () => { throw new Error('not used'); },
    data: new DataStore(join(dataDir, 'paintrest')),
  }));
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', r));
  api = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
});

afterAll(() => {
  upstream.close();
  app.close();
});

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(api + path, { method, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, text, json: JSON.parse(text) };
}

describe('kryptering', () => {
  it('krypterer med tilfeldig IV og dekrypterer tilbake', () => {
    const key = Buffer.alloc(32, 7);
    const a = encrypt(key, SECRET);
    expect(a).not.toContain(SECRET);
    expect(encrypt(key, SECRET)).not.toBe(a);
    expect(decrypt(key, a)).toBe(SECRET);
    expect(() => decrypt(Buffer.alloc(32, 8), a)).toThrow();
  });
});

describe('nøkkel-API', () => {
  it('starter uten nøkkel', async () => {
    expect((await call('GET', '/api/ai/credential')).json.credential).toBeNull();
  });

  it('krever nøkkel første gang', async () => {
    const r = await call('PUT', '/api/ai/credential', { base_url: upstreamUrl });
    expect(r.status).toBe(400);
  });

  it('avviser http mot andre verter enn localhost', () => {
    expect(() => normaliseBaseUrl('http://example.com/v1')).toThrow();
    expect(normaliseBaseUrl('https://example.com/v1/')).toBe('https://example.com/v1');
  });

  it('lagrer nøkkelen kryptert og returnerer den aldri', async () => {
    const r = await call('PUT', '/api/ai/credential', { base_url: upstreamUrl, api_key: SECRET, label: 'UiB', default_model: 'gpt-x' });
    expect(r.status).toBe(200);
    expect(r.text).not.toContain(SECRET);
    expect(r.json.credential.key_hint).toBe('••••7890');
    const onDisk = readFileSync(join(dataDir, 'ai_credential.json'), 'utf8');
    expect(onDisk).not.toContain(SECRET);
    expect(statSync(join(dataDir, 'ai_credential.json')).mode & 0o777).toBe(0o600);
    expect((await call('GET', '/api/ai/credential')).text).not.toContain(SECRET);
  });

  it('beholder nøkkelen når bare modell endres', async () => {
    await call('PUT', '/api/ai/credential', { base_url: upstreamUrl, default_model: 'claude-y' });
    const r = await call('POST', '/api/ai/test', {});
    expect(r.json).toMatchObject({ ok: true, model: 'claude-y', text: 'OK' });
    expect(seen.at(-1)?.auth).toBe(`Bearer ${SECRET}`);
  });

  it('lister modeller', async () => {
    expect((await call('GET', '/api/ai/models')).json.models).toEqual(['claude-y', 'gpt-x']);
  });

  it('feil fra tjenesten lekker ikke nøkkelen', async () => {
    await call('PUT', '/api/ai/credential', { base_url: upstreamUrl, api_key: 'sk-feil-nokkel-000000', default_model: 'gpt-x' });
    const r = await call('POST', '/api/ai/test', {});
    expect(r.status).toBe(502);
    expect(r.text).not.toContain('sk-feil-nokkel-000000');
    expect(r.json.error).toMatch(/avviste nøkkelen/);
  });

  it('sletter nøkkelen', async () => {
    await call('DELETE', '/api/ai/credential');
    expect((await call('GET', '/api/ai/credential')).json.credential).toBeNull();
    expect((await call('POST', '/api/ai/test', {})).status).toBe(400);
  });
});

describe('søkenøkkel', () => {
  it('lagres separat og returneres aldri', async () => {
    const r = await call('PUT', '/api/search/credential', { provider: 'tavily', api_key: 'tvly-HEMMELIG-9999' });
    expect(r.status).toBe(200);
    expect(r.text).not.toContain('tvly-HEMMELIG-9999');
    expect(r.json.credential.provider).toBe('tavily');
    expect(readFileSync(join(dataDir, 'search_credential.json'), 'utf8')).not.toContain('tvly-HEMMELIG-9999');
  });

  it('bytte av tjeneste krever ny nøkkel', async () => {
    expect((await call('PUT', '/api/search/credential', { provider: 'brave' })).status).toBe(400);
  });
});

describe('datamappen', () => {
  const state = (n: number) => ({ schema_version: 4, workspace_id: 'w', tables: { project: { p: { id: 'p', n } } } });

  it('starter tom, lagrer med revisjon og nekter utdatert lagring', async () => {
    expect((await call('GET', '/api/data')).json).toMatchObject({ revision: 0, state: null });
    const a = await call('PUT', '/api/data', { base_revision: 0, state: state(1) });
    expect(a.json.revision).toBe(1);
    const b = await call('PUT', '/api/data', { base_revision: 1, state: state(2) });
    expect(b.json.revision).toBe(2);
    const stale = await call('PUT', '/api/data', { base_revision: 1, state: state(99) });
    expect(stale.status).toBe(409);
    expect(stale.json.revision).toBe(2);
    expect((await call('GET', '/api/data')).json.state).toEqual(state(2));
  });

  it('lagrer og henter filer, og legger slettede i papirkurven', async () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    const put = await fetch(`${api}/api/files/${id}`, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: new Uint8Array([1, 2, 3]) });
    expect(put.status).toBe(200);
    const got = await fetch(`${api}/api/files/${id}`);
    expect(got.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await got.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    await fetch(`${api}/api/files/${id}`, { method: 'DELETE' });
    expect((await fetch(`${api}/api/files/${id}`)).status).toBe(404);
    expect(existsSync(join(dataDir, 'paintrest', 'files', 'trash', id))).toBe(true);
    expect((await fetch(`${api}/api/files/..%2F..%2Fetc`)).status).toBe(400);
  });

  it('tar sikkerhetskopi og beholder høyst 30', () => {
    const dir = mkdtempSync(join(tmpdir(), 'paintrest-backup-'));
    const store = new DataStore(dir);
    store.write(0, state(1));
    for (let i = 0; i < 35; i++) store.backup('manual');
    expect(readdirSync(join(dir, 'backups')).length).toBe(30);
    expect(store.info()).toMatchObject({ data_dir: dir, revision: 1, backups: 30 });
  });

  it('flytter nøklene fra den gamle mappen bare når hovednøkkelen passer', () => {
    const oldDir = mkdtempSync(join(tmpdir(), 'paintrest-old-'));
    const newDir = mkdtempSync(join(tmpdir(), 'paintrest-new-'));
    writeFileSync(join(oldDir, 'master.key'), 'a'.repeat(64));
    writeFileSync(join(oldDir, 'ai_credential.json'), '{}');
    expect(moveKeysFrom(oldDir, newDir).sort()).toEqual(['ai_credential.json', 'master.key']);
    const other = mkdtempSync(join(tmpdir(), 'paintrest-new2-'));
    writeFileSync(join(other, 'master.key'), 'b'.repeat(64));
    expect(moveKeysFrom(oldDir, other)).toEqual([]);
  });
});

describe('bildejakt: det klienten sender (brukerønske 11.11.2026)', () => {
  it('tar med brukerens egne bilder, identifiseringen, avviste figurer og merkede sider', () => {
    const f = parseFocus({
      kind: 'images', subject_ref: 'M1', subject_name: 'Merlin', game: 'Avalon',
      user_images: [{ image_url: 'https://i.redd.it/a.jpg', page_url: 'https://www.reddit.com/r/x/1', title: 'Mine' }, { image_url: 'javascript:x', page_url: 'https://a.example' }],
      identity: { status: 'confirmed', official_name: 'Merlin, the Archmage', aliases: ['Merlin', 7], description: 'Trollmann',
        images: [{ image_url: 'https://pub.example/a.jpg', page_url: 'https://pub.example/m', kind: 'concept_art' }, { image_url: 'file:///etc/passwd', page_url: 'https://pub.example/m' }],
        sources: [{ url: 'https://pub.example/m', title: 'Merlin' }] },
      rejected: [{ official_name: 'Morgana', image_urls: ['https://x.example/m.jpg', 'ftp://bad'] }],
      tagged_sources: [{ url: 'https://blog.example/merlin', title: 'Merlin painted', summary: 'Galleri' }, { url: 'nei', title: 'x' }],
    });
    expect(f).toMatchObject({
      kind: 'images',
      // Before this, the user's own finds were dropped here and never reached the agent.
      user_images: [{ image_url: 'https://i.redd.it/a.jpg', page_url: 'https://www.reddit.com/r/x/1', title: 'Mine' }],
      identity: { status: 'confirmed', official_name: 'Merlin, the Archmage', aliases: ['Merlin'], images: [{ image_url: 'https://pub.example/a.jpg', kind: 'concept_art' }] },
      rejected: [{ official_name: 'Morgana', image_urls: ['https://x.example/m.jpg'] }],
      tagged_sources: [{ url: 'https://blog.example/merlin', title: 'Merlin painted', summary: 'Galleri' }],
    });
    expect(f && f.kind === 'images' && f.identity!.images).toHaveLength(1);
    expect(parseFocus({ kind: 'images', identity: { status: 'whatever', official_name: 'x' } })).toMatchObject({ identity: null });
    expect(parseFocus({ kind: 'plan', subject_ref: 'M1', guides: [{ url: 'https://blog.example/g', title: 'G' }], identity: { status: 'confirmed', official_name: 'M' } }))
      .toMatchObject({ kind: 'plan', guides: [{ url: 'https://blog.example/g' }], identity: { official_name: 'M' } });
    expect(parseHint({ kind: 'tagged_source', url: 'https://blog.example/merlin', title: 'T' })).toEqual({ kind: 'tagged_source', url: 'https://blog.example/merlin', title: 'T' });
    expect(parseHint({ kind: 'tagged_source', url: 'javascript:x' })).toBeNull();
    expect(parseHint({ kind: 'other', url: 'https://a.example' })).toBeNull();
  });

  it('beskjed til en kjøring som ikke går, leveres ikke, og ugyldige beskjeder avvises', async () => {
    const ok = await call('POST', '/api/agent/hint', { run_id: 'run-12345678', hint: { kind: 'tagged_source', url: 'https://blog.example/m', title: 'M' } });
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({ delivered: false });
    expect((await call('POST', '/api/agent/hint', { run_id: 'x', hint: { kind: 'tagged_source', url: 'https://blog.example/m' } })).status).toBe(400);
    expect((await call('POST', '/api/agent/hint', { run_id: 'run-12345678', hint: { kind: 'tagged_source', url: 'javascript:x' } })).status).toBe(400);
  });
});

describe('beskjed til agenten mens den jobber', () => {
  it('når fram til kjøringen før neste steg, og køen forsvinner når kjøringen er ferdig', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'paintrest-hint-'));
    const key = loadOrCreateMasterKey(dir);
    const aiStore = new CredentialStore(dir, key);
    const searchStore = new CredentialStore(dir, key, 'local', 'search_credential.json');
    let release!: () => void;
    const waiting = new Promise<void>((r) => { release = r; });
    const seen: string[] = [];
    const provider = { respond: async (msgs: unknown) => {
      seen.push(JSON.stringify(msgs));
      if (seen.length === 1) await waiting;
      return { text: '{"action":"final","message":"ferdig","proposals":[]}', model: 'm', usage: null };
    } } as unknown as ResponsesProvider;
    const srv = createServer(createHandler({
      aiStore, provider, searchStore, search: new WebSearch(searchStore),
      openPage: async () => { throw new Error('not used'); }, getImage: async () => { throw new Error('not used'); },
      data: new DataStore(join(dir, 'paintrest')),
    }));
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    const hint = { kind: 'tagged_source', url: 'https://blog.example/merlin', title: 'Merlin painted' };
    try {
      const run = fetch(`${base}/api/agent/run`, { method: 'POST', body: JSON.stringify({
        messages: [{ role: 'user', content: 'Finn Merlin' }], result_types: ['reference_selection'], run_id: 'run-abcdefgh',
        focus: { kind: 'images', subject_ref: 'M1', subject_name: 'Merlin', game: 'Avalon' },
      }) }).then((r) => r.text());
      while (seen.length === 0) await new Promise((r) => setTimeout(r, 5));
      const sent = await fetch(`${base}/api/agent/hint`, { method: 'POST', body: JSON.stringify({ run_id: 'run-abcdefgh', hint }) }).then((r) => r.json());
      expect(sent).toEqual({ delivered: true });
      release();
      const out = await run;
      expect(seen[1]).toContain('Brukeren har nå merket denne siden som at den viser figuren: https://blog.example/merlin');
      expect(out).toContain('"type":"hint"');
      const after = await fetch(`${base}/api/agent/hint`, { method: 'POST', body: JSON.stringify({ run_id: 'run-abcdefgh', hint }) }).then((r) => r.json());
      expect(after).toEqual({ delivered: false });
    } finally {
      release();
      srv.close();
    }
  });
});

describe('fakta og illustrasjon: det klienten sender (brukerønske 11.11.2026)', () => {
  it('tar med det spillsiden har, og bare nettadresser', () => {
    expect(parseFocus({
      kind: 'game_info', game: '  Zombicide ', year: 2012, publishers: ['CMON', 7, ''], website: 'javascript:alert(1)',
      expansions: ['Washington Z.C.'], known_pages: [{ url: 'https://www.cmon.com/zombicide', title: 'CMON' }, { url: 'file:///etc/passwd', title: 'x' }],
    })).toEqual({
      kind: 'game_info', game: 'Zombicide', year: 2012, publishers: ['CMON'], website: null, expansions: ['Washington Z.C.'],
      known_pages: [{ url: 'https://www.cmon.com/zombicide', title: 'CMON' }],
    });
    expect(parseFocus({ kind: 'game_info', year: 'snart', website: 'https://www.cmon.com/' })).toMatchObject({ game: 'ukjent spill', year: null, website: 'https://www.cmon.com/' });
  });
});
