/**
 * Application layer HTTP surface (skjema §4). Clients never receive a key:
 * every credential response is the public view.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CredentialStore } from './credential-store.ts';
import { UserError } from './credential-store.ts';
import type { PageResult, VideoInfo } from './fetch-page.ts';
import type { DataStore } from './data-store.ts';
import { hostedSearchOf } from './provider.ts';
import type { ResponsesProvider } from './provider.ts';
import { runResearch } from './research-agent.ts';
import { lookAtImages } from './vision.ts';
import type { ImageFocus, KnowledgeFocus, PlanFocus, ResearchEvent, ResearchInput } from './research-agent.ts';
import { SEARCH_PROVIDERS } from './search.ts';
import type { SearchProviderId, WebSearch } from './search.ts';

const MAX_BODY = 64 * 1024;
const MAX_AGENT_BODY = 3 * 1024 * 1024;
const MAX_STATE_BODY = 200 * 1024 * 1024;
const MAX_FILE_BODY = 30 * 1024 * 1024;

export const UIB_PROVIDER = 'uib';

export interface AppDeps {
  aiStore: CredentialStore;
  provider: ResponsesProvider;
  searchStore: CredentialStore;
  search: WebSearch;
  openPage: (url: string) => Promise<PageResult>;
  getImage: (url: string) => Promise<{ type: string; body: Buffer }>;
  /** YouTube oEmbed lookup; without it, videos are confirmed only by the search. */
  videoInfo?: (url: string) => Promise<VideoInfo>;
  data: DataStore;
}

export function createHandler(d: AppDeps) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = `${req.method} ${url.pathname}`;
    try {
      // ---------- Filer (bilder) i datamappen ----------
      const fileMatch = /^\/api\/files\/([^/]+)$/.exec(url.pathname);
      if (fileMatch) {
        const id = decodeURIComponent(fileMatch[1]!);
        if (req.method === 'PUT') {
          const body = await readRaw(req, MAX_FILE_BODY);
          d.data.putFile(id, String(req.headers['content-type'] ?? 'application/octet-stream'), body);
          return json(res, 200, { ok: true });
        }
        if (req.method === 'GET') {
          const f = d.data.getFile(id);
          if (!f) return json(res, 404, { error: 'Filen finnes ikke' });
          res.writeHead(200, { 'Content-Type': f.type, 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
          res.end(f.body);
          return;
        }
        if (req.method === 'DELETE') {
          d.data.trashFile(id);
          return json(res, 200, { ok: true });
        }
      }

      switch (route) {
        case 'GET /api/health':
          return json(res, 200, { ok: true, storage: 'server' });

        // ---------- Data ----------
        case 'GET /api/data/info':
          return json(res, 200, d.data.info());

        case 'GET /api/data': {
          const stored = d.data.read();
          return stored ? json(res, 200, stored) : json(res, 200, { revision: 0, saved_at: null, state: null });
        }

        case 'PUT /api/data': {
          const body = await readJson(req, MAX_STATE_BODY);
          const base = Number(body.base_revision);
          if (!Number.isInteger(base) || base < 0) throw new UserError('base_revision mangler');
          if (!body.state || typeof body.state !== 'object') throw new UserError('state mangler');
          const saved = d.data.write(base, body.state);
          return json(res, 200, { revision: saved.revision, saved_at: saved.saved_at });
        }

        case 'POST /api/data/backup': {
          const body = await readJson(req);
          const reason = body.reason === 'before-reset' ? 'before-reset' : 'manual';
          return json(res, 200, { backup: d.data.backup(reason) });
        }

        // ---------- AI-nøkkel ----------
        case 'GET /api/ai/credential':
          return json(res, 200, { credential: withHosted(d.aiStore.get()) });

        case 'PUT /api/ai/credential': {
          const body = await readJson(req);
          const credential = d.aiStore.save({
            provider: UIB_PROVIDER,
            label: str(body.label).trim() || 'UiB',
            base_url: normaliseBaseUrl(str(body.base_url)),
            api_key: typeof body.api_key === 'string' ? body.api_key : undefined,
            default_model: str(body.default_model).trim() || null,
            ...(typeof body.hosted_search === 'string' ? { hosted_search: hostedSearchOf(body.hosted_search) ?? 'off' } : {}),
          });
          return json(res, 200, { credential: withHosted(credential) });
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

        case 'POST /api/ai/test-search': {
          // Checks whether UiB accepts the built-in web_search tool for the chosen model.
          const body = await readJson(req);
          const hosted = hostedSearchOf(str(body.hosted_search) || d.aiStore.get()?.hosted_search) ?? 'web_search';
          const started = Date.now();
          const r = await d.provider.respond(
            'Which miniatures are included in the board game Zombicide 2nd Edition core box? Answer in two sentences and cite your sources.',
            { model: str(body.model) || undefined, hostedSearch: hosted, timeoutMs: 120_000 },
          );
          return json(res, 200, {
            ok: true, tool: hosted, model: r.model, latency_ms: Date.now() - started,
            searches: r.searches, citations: r.citations.slice(0, 5), text: r.text.slice(0, 400),
          });
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

        case 'POST /api/research/page-images': {
          // The user browses a known source without the agent: title and image list only.
          const body = await readJson(req);
          const page = await d.openPage(str(body.url));
          return json(res, 200, { url: page.url, title: page.title, site: page.site, author: page.author, images: page.images });
        }

        case 'POST /api/agent/run': {
          const body = await readJson(req, MAX_AGENT_BODY);
          const input: ResearchInput = {
            context: body.context ?? {},
            messages: Array.isArray(body.messages) ? body.messages as ResearchInput['messages'] : [],
            result_types: Array.isArray(body.result_types) ? body.result_types.filter((x): x is string => typeof x === 'string') : [],
            model: str(body.model) || undefined,
            focus: parseFocus(body.focus),
            direct_apply: body.direct_apply === true,
          };
          return streamResearch(req, res, d, input);
        }

        default:
          return json(res, 404, { error: 'Ukjent adresse' });
      }
    } catch (err) {
      if (res.headersSent) return void res.end();
      if (err instanceof UserError) return json(res, err.status, { error: err.message, ...('revision' in err ? { revision: (err as { revision: number }).revision } : {}) });
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
    const hostedSearch = hostedSearchOf(d.aiStore.get()?.hosted_search);
    await runResearch({
      provider: d.provider, search: d.search, hostedSearch, openPage: d.openPage, signal: ac.signal,
      lookAtImages: (urls, question, reference) => lookAtImages(d.provider, d.getImage, urls, question, reference, input.model),
      imageAsDataUrl: async (url) => {
        const img = await d.getImage(url);
        if (img.body.length > 4 * 1024 * 1024) throw new UserError('Ankerbildet er for stort til å vises modellen');
        return `data:${img.type};base64,${img.body.toString('base64')}`;
      },
      videoInfo: d.videoInfo,
    }, input, emit);
  } catch (err) {
    const msg = err instanceof UserError ? err.message : 'Noe gikk galt under researchen';
    if (!(err instanceof UserError)) console.error('[api] agent/run feilet:', err instanceof Error ? err.message : err);
    emit({ type: 'error', error: msg });
  }
  void req;
  res.end();
}

const DATA_IMAGE = /^data:image\/(jpeg|png|webp);base64,/;

function parseFocus(v: unknown): ImageFocus | PlanFocus | KnowledgeFocus | null {
  if (!v || typeof v !== 'object') return null;
  const f = v as Record<string, unknown>;
  if (f.kind === 'knowledge') {
    const rev = f.revision && typeof f.revision === 'object' ? str((f.revision as Record<string, unknown>).name).slice(0, 200) : '';
    const paints = f.paints === 'both' || f.paints === 'owned' || f.paints === 'best' ? f.paints : null;
    const reference_images = (Array.isArray(f.reference_images) ? f.reference_images : [])
      .filter((x): x is string => typeof x === 'string' && DATA_IMAGE.test(x) && x.length < 700_000).slice(0, 4);
    const target = f.target === 'recipe' ? 'recipe' : f.target === 'image' ? 'image' : 'technique';
    return { kind: 'knowledge', target, revision: rev ? { name: rev } : null, paints, ...(reference_images.length ? { reference_images } : {}) };
  }
  if (f.kind === 'plan') {
    return {
      kind: 'plan',
      subject_ref: str(f.subject_ref).slice(0, 12),
      subject_name: str(f.subject_name).slice(0, 120),
      game: str(f.game).slice(0, 160),
      reference_images: (Array.isArray(f.reference_images) ? f.reference_images : [])
        .filter((x): x is string => typeof x === 'string' && DATA_IMAGE.test(x) && x.length < 700_000).slice(0, 4),
      revision: f.revision === true,
      paints: f.paints === 'owned' || f.paints === 'best' ? f.paints : null,
    };
  }
  if (f.kind !== 'images') return null;
  const ref = typeof f.reference_image === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(f.reference_image) && f.reference_image.length < 1_500_000
    ? f.reference_image : null;
  return {
    kind: 'images',
    subject_ref: str(f.subject_ref).slice(0, 12),
    subject_name: str(f.subject_name).slice(0, 120),
    game: str(f.game).slice(0, 160),
    reference_image: ref,
  };
}

/** The public view always states the search mode, also for keys saved before the setting existed. */
function withHosted<T extends { hosted_search?: string | null } | null>(c: T): T {
  return c ? { ...c, hosted_search: hostedSearchOf(c.hosted_search) ?? 'off' } : c;
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

async function readRaw(req: IncomingMessage, max: number): Promise<Buffer> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > max) throw new UserError('Filen er for stor', 413);
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
