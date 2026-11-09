/**
 * Application layer HTTP surface (skjema §4). For now it only holds the AI
 * key routes. Clients never receive the key: every response uses the public
 * credential view.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { CredentialStore } from './credential-store.ts';
import { UserError } from './credential-store.ts';
import type { ResponsesProvider } from './provider.ts';
import { runTurn } from './agent.ts';
import type { TurnInput } from './agent.ts';

const MAX_BODY = 64 * 1024;
const MAX_AGENT_BODY = 1024 * 1024;

export const UIB_PROVIDER = 'uib';

export function createHandler(store: CredentialStore, provider: ResponsesProvider) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = `${req.method} ${url.pathname}`;
    try {
      switch (route) {
        case 'GET /api/health':
          return json(res, 200, { ok: true });

        case 'GET /api/ai/credential':
          return json(res, 200, { credential: store.get() });

        case 'PUT /api/ai/credential': {
          const body = await readJson(req);
          const base_url = normaliseBaseUrl(str(body.base_url));
          const credential = store.save({
            provider: UIB_PROVIDER,
            label: str(body.label).trim() || 'UiB',
            base_url,
            api_key: typeof body.api_key === 'string' ? body.api_key : undefined,
            default_model: str(body.default_model).trim() || null,
          });
          return json(res, 200, { credential });
        }

        case 'DELETE /api/ai/credential':
          store.delete();
          return json(res, 200, { credential: null });

        case 'GET /api/ai/models':
          return json(res, 200, { models: await provider.listModels() });

        case 'POST /api/ai/test': {
          const body = await readJson(req);
          const started = Date.now();
          const r = await provider.respond('Svar bare med ordet OK.', { model: str(body.model) || undefined });
          return json(res, 200, { ok: true, model: r.model, text: r.text, latency_ms: Date.now() - started });
        }

        case 'POST /api/agent/turn': {
          const body = await readJson(req, MAX_AGENT_BODY);
          const input: TurnInput = {
            context: body.context ?? {},
            messages: Array.isArray(body.messages) ? body.messages as TurnInput['messages'] : [],
            result_types: Array.isArray(body.result_types) ? body.result_types.filter((x): x is string => typeof x === 'string') : [],
            model: str(body.model) || undefined,
          };
          return json(res, 200, await runTurn(provider, input));
        }

        default:
          return json(res, 404, { error: 'Ukjent adresse' });
      }
    } catch (err) {
      if (err instanceof UserError) return json(res, err.status, { error: err.message });
      // Unexpected errors are logged without request bodies, which may hold the key.
      console.error(`[api] ${route} feilet:`, err instanceof Error ? err.message : err);
      return json(res, 500, { error: 'Noe gikk galt på serveren' });
    }
  };
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
