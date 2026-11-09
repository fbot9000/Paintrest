/**
 * Web search for the research agent. Two providers; the key is stored with
 * the same encryption as the AI key, in its own file.
 *
 * Endpoints as documented by the providers (not testable from the build
 * environment, which blocks outbound traffic):
 *   Tavily: POST https://api.tavily.com/search, Authorization: Bearer <key>
 *   Brave:  GET  https://api.search.brave.com/res/v1/web/search?q=…, X-Subscription-Token: <key>
 */
import type { CredentialStore } from './credential-store.ts';
import { UserError } from './credential-store.ts';
import { scrub } from './provider.ts';

export type SearchProviderId = 'tavily' | 'brave';

export const SEARCH_PROVIDERS: Record<SearchProviderId, { label: string; base_url: string }> = {
  tavily: { label: 'Tavily', base_url: 'https://api.tavily.com' },
  brave: { label: 'Brave Search', base_url: 'https://api.search.brave.com/res/v1' },
};

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

export class WebSearch {
  private store: CredentialStore;
  private fetchImpl: typeof fetch;

  constructor(store: CredentialStore, fetchImpl: typeof fetch = fetch) {
    this.store = store;
    this.fetchImpl = fetchImpl;
  }

  configured(): boolean {
    return !!this.store.get();
  }

  async search(query: string, max = 6): Promise<SearchHit[]> {
    const q = query.trim().slice(0, 300);
    if (!q) throw new UserError('Tomt søk');
    return this.store.useSecret(async (secret, cred) => {
      const provider = cred.provider as SearchProviderId;
      // Test only: point at a mock search service.
      const base = process.env.PAINTREST_SEARCH_BASE_URL || cred.base_url;
      let res: Response;
      try {
        res = provider === 'brave'
          ? await this.fetchImpl(`${base}/web/search?${new URLSearchParams({ q, count: String(max) })}`, {
              headers: { Accept: 'application/json', 'X-Subscription-Token': secret },
              signal: AbortSignal.timeout(20_000),
            })
          : await this.fetchImpl(`${base}/search`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
              body: JSON.stringify({ query: q, max_results: max, search_depth: 'basic', include_answer: false }),
              signal: AbortSignal.timeout(20_000),
            });
      } catch {
        throw new UserError(`${SEARCH_PROVIDERS[provider]?.label ?? 'Søketjenesten'} kunne ikke nås`, 502);
      }
      if (res.status === 401 || res.status === 403) throw new UserError('Søketjenesten avviste nøkkelen', 502);
      if (res.status === 429 || res.status === 432) throw new UserError('Søketjenesten sier at kvoten er brukt opp eller at det går for fort', 502);
      if (!res.ok) throw new UserError(`Søketjenesten svarte med feil ${res.status}: ${scrub(await res.text().catch(() => ''), secret).slice(0, 200)}`, 502);
      const body = (await res.json()) as Record<string, unknown>;
      return provider === 'brave' ? parseBrave(body) : parseTavily(body);
    });
  }
}

export function parseTavily(body: Record<string, unknown>): SearchHit[] {
  const results = Array.isArray(body.results) ? body.results : [];
  return results.flatMap((r: Record<string, unknown>) =>
    typeof r.url === 'string' ? [{ title: String(r.title ?? r.url), url: r.url, snippet: String(r.content ?? '').slice(0, 400) }] : []);
}

export function parseBrave(body: Record<string, unknown>): SearchHit[] {
  const web = (body.web ?? {}) as { results?: Record<string, unknown>[] };
  return (web.results ?? []).flatMap((r) =>
    typeof r.url === 'string' ? [{ title: String(r.title ?? r.url), url: r.url, snippet: stripTags(String(r.description ?? '')).slice(0, 400) }] : []);
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '');
}
