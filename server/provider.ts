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
}

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

  async respond(input: string, opts: { model?: string; instructions?: string } = {}): Promise<RespondResult> {
    return this.store.useSecret(async (secret, cred) => {
      const model = opts.model || cred.default_model;
      if (!model) throw new UserError('Velg en standardmodell først');
      const res = await this.call(secret, `${cred.base_url}/responses`, {
        method: 'POST',
        body: JSON.stringify({ model, input, ...(opts.instructions ? { instructions: opts.instructions } : {}) }),
      });
      const body = (await res.json()) as {
        model?: string;
        output_text?: string;
        output?: { type?: string; content?: { type?: string; text?: string }[] }[];
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text = body.output_text ?? (body.output ?? [])
        .filter((o) => o.type === 'message')
        .flatMap((o) => o.content ?? [])
        .filter((c) => c.type === 'output_text' && typeof c.text === 'string')
        .map((c) => c.text)
        .join('');
      return { text, model: body.model ?? model, usage: body.usage ?? null };
    });
  }

  private async call(secret: string, url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        ...init,
        headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const reason = err instanceof Error && err.name === 'TimeoutError' ? 'svarte ikke innen 60 sekunder' : 'kunne ikke nås';
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
