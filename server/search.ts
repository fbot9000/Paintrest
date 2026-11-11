/**
 * Web search for the research agent. Two providers; the key is stored with
 * the same encryption as the AI key, in its own file.
 *
 * Endpoints as documented by the providers (not testable from the build
 * environment, which blocks outbound traffic):
 *   Tavily: POST https://api.tavily.com/search, Authorization: Bearer <key>
 *   Brave:  GET  https://api.search.brave.com/res/v1/web/search?q=…, X-Subscription-Token: <key>
 *
 * Image search (what a person does in Google Images):
 *   Brave:  GET  …/res/v1/images/search?q=… → results[] with title, url (the page), source (domain),
 *           thumbnail.src (served by Brave's image proxy, 500 px wide) and properties.url (the original image).
 *   Tavily: POST …/search with include_images → each result has an images array (strings, or {url, description}).
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

/** One picture from an image search, with the page it was found on. */
export interface ImageHit {
  image_url: string;
  /** Small copy that loads even when the original site blocks other servers (Brave's proxy). */
  thumbnail_url: string | null;
  page_url: string;
  title: string;
  site: string;
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
    return this.call(query, (provider, base, q, secret) => provider === 'brave'
      ? this.fetchImpl(`${base}/web/search?${new URLSearchParams({ q, count: String(max) })}`, {
          headers: { Accept: 'application/json', 'X-Subscription-Token': secret },
          signal: AbortSignal.timeout(20_000),
        })
      : this.fetchImpl(`${base}/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
          body: JSON.stringify({ query: q, max_results: max, search_depth: 'basic', include_answer: false }),
          signal: AbortSignal.timeout(20_000),
        }),
    (provider, body) => (provider === 'brave' ? parseBrave(body) : parseTavily(body)));
  }

  /** Pictures for a query with the page each came from. Brave has a real image search; Tavily gives images per result. */
  async imageSearch(query: string, max = 40): Promise<ImageHit[]> {
    return this.call(query, (provider, base, q, secret) => provider === 'brave'
      ? this.fetchImpl(`${base}/images/search?${new URLSearchParams({ q, count: String(Math.min(max, 100)) })}`, {
          headers: { Accept: 'application/json', 'X-Subscription-Token': secret },
          signal: AbortSignal.timeout(20_000),
        })
      : this.fetchImpl(`${base}/search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
          body: JSON.stringify({ query: q, max_results: 10, search_depth: 'basic', include_answer: false, include_images: true }),
          signal: AbortSignal.timeout(20_000),
        }),
    (provider, body) => (provider === 'brave' ? parseBraveImages(body) : parseTavilyImages(body)).slice(0, max));
  }

  /** Which kind of image search the stored key gives, if any. */
  imageSearchKind(): 'brave' | 'tavily' | null {
    const p = this.store.get()?.provider;
    return p === 'brave' || p === 'tavily' ? p : null;
  }

  private async call<T>(query: string, send: (provider: SearchProviderId, base: string, q: string, secret: string) => Promise<Response>,
    parse: (provider: SearchProviderId, body: Record<string, unknown>) => T): Promise<T> {
    const q = query.trim().slice(0, 300);
    if (!q) throw new UserError('Tomt søk');
    return this.store.useSecret(async (secret, cred) => {
      const provider = cred.provider as SearchProviderId;
      // Test only: point at a mock search service.
      const base = process.env.PAINTREST_SEARCH_BASE_URL || cred.base_url;
      let res: Response;
      try {
        res = await send(provider, base, q, secret);
      } catch {
        throw new UserError(`${SEARCH_PROVIDERS[provider]?.label ?? 'Søketjenesten'} kunne ikke nås`, 502);
      }
      if (res.status === 401 || res.status === 403) throw new UserError('Søketjenesten avviste nøkkelen', 502);
      if (res.status === 429 || res.status === 432) throw new UserError('Søketjenesten sier at kvoten er brukt opp eller at det går for fort', 502);
      if (!res.ok) throw new UserError(`Søketjenesten svarte med feil ${res.status}: ${scrub(await res.text().catch(() => ''), secret).slice(0, 200)}`, 502);
      const body = (await res.json()) as Record<string, unknown>;
      return parse(provider, body);
    });
  }
}

const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const isHttp = (u: unknown): u is string => typeof u === 'string' && /^https?:\/\//.test(u);

export function parseBraveImages(body: Record<string, unknown>): ImageHit[] {
  const results = Array.isArray(body.results) ? body.results as Record<string, unknown>[] : [];
  return results.flatMap((r) => {
    const props = (r.properties ?? {}) as Record<string, unknown>;
    const thumb = (r.thumbnail ?? {}) as Record<string, unknown>;
    const image = isHttp(props.url) ? props.url : isHttp(thumb.src) ? thumb.src : null;
    if (!image || !isHttp(r.url)) return [];
    return [{ image_url: image, thumbnail_url: isHttp(thumb.src) ? thumb.src : null, page_url: r.url,
      title: stripTags(String(r.title ?? '')).slice(0, 200), site: typeof r.source === 'string' ? r.source : hostOf(r.url) }];
  });
}

export function parseTavilyImages(body: Record<string, unknown>): ImageHit[] {
  const results = Array.isArray(body.results) ? body.results as Record<string, unknown>[] : [];
  return results.flatMap((r) => {
    if (!isHttp(r.url)) return [];
    const imgs = Array.isArray(r.images) ? r.images : [];
    return imgs.flatMap((i: unknown) => {
      const url = typeof i === 'string' ? i : (i as Record<string, unknown>)?.url;
      const desc = typeof i === 'object' && i ? (i as Record<string, unknown>).description : null;
      if (!isHttp(url)) return [];
      return [{ image_url: url, thumbnail_url: null, page_url: r.url as string,
        title: (typeof desc === 'string' && desc ? desc : String(r.title ?? '')).slice(0, 200), site: hostOf(r.url as string) }];
    });
  });
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
