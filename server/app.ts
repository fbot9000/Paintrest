/**
 * Application layer HTTP surface (skjema §4). Clients never receive a key:
 * every credential response is the public view.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CredentialStore } from './credential-store.ts';
import { UserError } from './credential-store.ts';
import type { PageResult } from './fetch-page.ts';
import type { ResponsesProvider } from './provider.ts';
import { runResearch } from './research-agent.ts';
import type { ResearchEvent, ResearchInput } from './research-agent.ts';
import { SEARCH_PROVIDERS } from './search.ts';
import type { SearchProviderId, WebSearch } from './search.ts';

const MAX_BODY = 64 * 1024;
const MAX_AGENT_BODY = 1024 * 1024;

export const UIB_PROVIDER = 'uib';

export interface AppDeps {
  aiStore: CredentialStore;
  provider: ResponsesProvider;
  searchStore: CredentialStore;
  search: WebSearch;
  openPage: (url: string) => Promise<PageResult>;
  getImage: (url: string) => Promise<{ type: string; body: Buffer }>;
}

export function createHandler(d: AppDeps) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = `${req.method} ${url.pathname}`;
    try {
      switch (route) {
        case 'GET /api/health':
          return json(res, 200, { ok: true });

        // ---------- AI-nøkkel ----------
        case 'GET /api/ai/credential':
          return json(res, 200, { credential: d.aiStore.get() });

        case 'PUT /api/ai/credential': {
          const body = await readJson(req);
          const credential = d.aiStore.save({
            provider: UIB_PROVIDER,
            label: str(body.label).trim() || 'UiB',
            base_url: normaliseBaseUrl(str(body.base_url)),
            api_key: typeof body.api_key === 'string' ? body.api_key : undefined,
            default_model: str(body.default_model).trim() || null,
          });
          return json(res, 200, { credential });
        }

        case 'DELETE /api/ai/credential':
          d.aiStore.delete();
          return json(res, 200, { credential: null });

        case 'GET /api/ai/models':
          return json(res, 200, { models: await d.provider.listModels() });

        case 'POST /api/ai/test': {
          const body = await readJson(req);
          const started = Date.now();
          const r = await d.provider.respond('Svar bare med ordet OK.', { model: str(body.model) || undefined });
          return json(res, 200, { ok: true, model: r.model, text: r.text, latency_ms: Date.now() - started });
        }

        // ---------- Nettsøk ----------
        case 'GET /api/search/credential':
          return json(res, 200, { credential: d.searchStore.get() });

        case 'PUT /api/search/credential': {
          const body = await readJson(req);
          const provider = str(body.provider) as SearchProviderId;
          const def = SEARCH_PROVIDERS[provider];
          if (!def) throw new UserError('Velg Tavily eller Brave');
          const existing = d.searchStore.get();
          const key = typeof body.api_key === 'string' && body.api_key.trim() ? body.api_key : undefined;
          // Switching provider needs a new key; the old one belongs to the other service.
          if (existing && existing.provider !== provider && !key) throw new UserError('Lim inn nøkkelen for den nye søketjenesten');
          const credential = d.searchStore.save({ provider, label: def.label, base_url: def.base_url, api_key: key, default_model: null });
          return json(res, 200, { credential });
        }

        case 'DELETE /api/search/credential':
          d.searchStore.delete();
          return json(res, 200, { credential: null });

        case 'POST /api/search/test': {
          const body = await readJson(req);
          const started = Date.now();
          const hits = await d.search.search(str(body.query) || 'miniature painting guide');
          return json(res, 200, { ok: true, count: hits.length, first: hits[0] ?? null, latency_ms: Date.now() - started });
        }

        // ---------- Research ----------
        case 'GET /api/research/image': {
          const target = url.searchParams.get('url') ?? '';
          const img = await d.getImage(target);
          res.writeHead(200, { 'Content-Type': img.type, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
          res.end(img.body);
          return;
        }

        case 'POST /api/agent/run': {
          const body = await readJson(req, MAX_AGENT_BODY);
          const input: ResearchInput = {
            context: body.context ?? {},
            messages: Array.isArray(body.messages) ? body.messages as ResearchInput['messages'] : [],
            result_types: Array.isArray(body.result_types) ? body.result_types.filter((x): x is string => typeof x === 'string') : [],
            model: str(body.model) || undefined,
          };
          return streamResearch(req, res, d, input);
        }

        default:
          return json(res, 404, { error: 'Ukjent adresse' });
      }
    } catch (err) {
      if (res.headersSent) return void res.end();
      if (err instanceof UserError) return json(res, err.status, { error: err.message });
      // Unexpected errors are logged without request bodies, which may hold a key.
      console.error(`[api] ${route} feilet:`, err instanceof Error ? err.message : err);
      return json(res, 500, { error: 'Noe gikk galt på serveren' });
    }
  };
}

/** NDJSON stream: one research event per line, so the panel can show each step live. */
async function streamResearch(req: IncomingMessage, res: ServerResponse, d: AppDeps, input: ResearchInput) {
  const ac = new AbortController();
  res.on('close', () => ac.abort());
  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
  const emit = (e: ResearchEvent) => { if (!res.writableEnded) res.write(`${JSON.stringify(e)}\n`); };
  try {
    await runResearch({ provider: d.provider, search: d.search, openPage: d.openPage, signal: ac.signal }, input, emit);
  } catch (err) {
    const msg = err instanceof UserError ? err.message : 'Noe gikk galt under researchen';
    if (!(err instanceof UserError)) console.error('[api] agent/run feilet:', err instanceof Error ? err.message : err);
    emit({ type: 'error', error: msg });
  }
  void req;
  res.end();
}

/** https only, except localhost for testing. Trailing slash removed. */
export function normaliseBaseUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new UserError('Skriv en gyldig adresse, for eksempel https://…/v1');
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) {
    throw new UserError('Adressen må begynne med https://');
  }
  if (u.username || u.password) throw new UserError('Legg ikke brukernavn eller passord i adressen');
  u.search = '';
  u.hash = '';
  return u.toString().replace(/\/+$/, '');
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

async function readJson(req: IncomingMessage, max = MAX_BODY): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) throw new UserError('Forespørselen er for stor', 413);
    chunks.push(chunk as Buffer);
  }
  if (!chunks.length) return {};
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return v && typeof v === 'object' ? v : {};
  } catch {
    throw new UserError('Ugyldig JSON');
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
