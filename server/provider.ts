/**
 * Gateway call to an OpenAI-compatible Responses API (here: UiB's).
 * This is the only place that uses the decrypted key (skjema §4, §10).
 * The key never appears in return values, errors or logs.
 *
 * Assumed endpoints (OpenAI API conventions, to be confirmed against UiB's docs):
 *   GET  {base_url}/models     → { data: [{ id }] }
 *   POST {base_url}/responses  → { output: [{ type: 'message', content: [{ type: 'output_text', text }] }] }
 */
import type { CredentialStore } from './credential-store.ts';
import { UserError } from './credential-store.ts';

const TIMEOUT_MS = 60_000;

export interface RespondResult {
  text: string;
  model: string;
  usage: { input_tokens?: number; output_tokens?: number } | null;
  /** Sources the model cited from hosted web search (url_citation annotations). */
  citations: { url: string; title: string }[];
  /** Searches the model ran with the hosted web_search tool. */
  searches: string[];
}

/** Message for the Responses API: plain text, or content parts with images (input_image takes a data URL). */
export type ResponsesMessage =
  | { role: 'user' | 'assistant'; content: string }
  | { role: 'user'; content: ({ type: 'input_text'; text: string } | { type: 'input_image'; image_url: string })[] };

/** Thrown when the endpoint rejects image input, so the agent can continue without looking. */
export class VisionUnsupportedError extends UserError {}

/** Hosted tool types in the OpenAI Responses API (web_search is current, web_search_preview the earlier one). */
export type HostedSearch = 'web_search' | 'web_search_preview';

/** Thrown when the endpoint rejects the hosted search tool, so callers can fall back. */
export class HostedToolError extends UserError {}

export class ResponsesProvider {
  private store: CredentialStore;
  private fetchImpl: typeof fetch;

  constructor(store: CredentialStore, fetchImpl: typeof fetch = fetch) {
    this.store = store;
    this.fetchImpl = fetchImpl;
  }

  async listModels(): Promise<string[]> {
    return this.store.useSecret(async (secret, cred) => {
      const res = await this.call(secret, `${cred.base_url}/models`, { method: 'GET' });
      const body = (await res.json()) as { data?: { id?: unknown }[] };
      return (body.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string').sort();
    });
  }

  async respond(
    input: string | ResponsesMessage[],
    opts: { model?: string; instructions?: string; timeoutMs?: number; hostedSearch?: HostedSearch | null } = {},
  ): Promise<RespondResult> {
    return this.store.useSecret(async (secret, cred) => {
      const model = opts.model || cred.default_model;
      if (!model) throw new UserError('Velg en standardmodell først');
      const tools = opts.hostedSearch ? [{ type: opts.hostedSearch }] : undefined;
      let res: Response;
      try {
        res = await this.call(secret, `${cred.base_url}/responses`, {
          method: 'POST',
          body: JSON.stringify({ model, input, ...(opts.instructions ? { instructions: opts.instructions } : {}), ...(tools ? { tools } : {}) }),
        }, opts.timeoutMs);
      } catch (e) {
        // A 400 with tools present most likely means the tool is not supported for this model or gateway.
        if (tools && e instanceof UserError && /feil 400|feil 422|feil 501/i.test(e.message)) {
          throw new HostedToolError(`UiB godtok ikke nettsøkverktøyet ${opts.hostedSearch} for ${model}. ${e.message}`, 502);
        }
        throw e;
      }
      return parseResponse((await res.json()) as ResponseBody, model);
    });
  }

  async status(): Promise<{ hosted_search: HostedSearch | null }> {
    const c = this.store.get();
    return { hosted_search: hostedSearchOf(c?.hosted_search) };
  }

  private async call(secret: string, url: string, init: RequestInit, timeoutMs = TIMEOUT_MS): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        ...init,
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const reason = err instanceof Error && err.name === 'TimeoutError' ? `svarte ikke innen ${Math.round(timeoutMs / 1000)} sekunder` : 'kunne ikke nås';
      throw new UserError(`Tjenesten ${reason}. Sjekk adressen og nettverket.`, 502);
    }
    if (res.ok) return res;
    const detail = scrub(await res.text().catch(() => ''), secret).slice(0, 300);
    if (res.status === 401 || res.status === 403) throw new UserError('Tjenesten avviste nøkkelen. Sjekk at den er riktig og fortsatt gyldig.', 502);
    if (res.status === 404) throw new UserError(`Fant ikke endepunktet (${new URL(url).pathname}). Sjekk adressen.`, 502);
    if (res.status === 429) throw new UserError('Tjenesten sier at grensen for forespørsler er nådd. Prøv igjen senere.', 502);
    throw new UserError(`Tjenesten svarte med feil ${res.status}${detail ? `: ${detail}` : ''}`, 502);
  }
}

/** Removes the key from text that came back from the provider. */
export function scrub(text: string, secret: string): string {
  return secret ? text.split(secret).join('[skjult]') : text;
}

interface ResponseBody {
  model?: string;
  output_text?: string;
  output?: {
    type?: string;
    action?: { type?: string; query?: string; queries?: string[] };
    query?: string;
    content?: { type?: string; text?: string; annotations?: Record<string, unknown>[] }[];
  }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Reads text, url_citation annotations and web_search_call items from a Responses API body. */
export function parseResponse(body: ResponseBody, fallbackModel: string): RespondResult {
  const output = body.output ?? [];
  const contents = output.filter((o) => o.type === 'message').flatMap((o) => o.content ?? []);
  const text = body.output_text ?? contents
    .filter((c) => c.type === 'output_text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('');
  const citations = new Map<string, { url: string; title: string }>();
  for (const c of contents) {
    for (const a of c.annotations ?? []) {
      if (a.type !== 'url_citation') continue;
      // Responses puts url/title on the annotation; some gateways nest them under url_citation.
      const inner = (a.url_citation ?? a) as { url?: unknown; title?: unknown };
      if (typeof inner.url === 'string') citations.set(inner.url, { url: inner.url, title: typeof inner.title === 'string' ? inner.title : inner.url });
    }
  }
  const searches = output.filter((o) => o.type === 'web_search_call').flatMap((o) => {
    const q = o.action?.query ?? o.query;
    if (typeof q === 'string' && q.trim()) return [q];
    return (o.action?.queries ?? []).filter((x): x is string => typeof x === 'string');
  });
  return { text, model: body.model ?? fallbackModel, usage: body.usage ?? null, citations: [...citations.values()], searches };
}

export function hostedSearchOf(v: unknown): HostedSearch | null {
  if (v === 'off') return null;
  if (v === 'web_search_preview') return 'web_search_preview';
  // Default on: the user asked to build as if UiB supports it; it falls back when rejected.
  return 'web_search';
}
