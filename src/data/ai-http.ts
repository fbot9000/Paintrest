import type { AiCredentialView, AiGateway, AiTestResult, FinalEvent, HostedSearchTest, ResearchEvent, SearchCredentialView } from '../domain/ai';

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data: { error?: string } & Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Serveren svarte ikke som forventet. Kjører appen med «npm run dev»?');
  }
  if (!res.ok) throw new Error(data.error ?? `Feil ${res.status}`);
  return data as T;
}

export function httpAiGateway(): AiGateway {
  return {
    async getCredential() {
      try {
        const health = await fetch('/api/health');
        if (!health.ok || !(health.headers.get('content-type') ?? '').includes('json')) return { status: 'unavailable' };
      } catch {
        return { status: 'unavailable' };
      }
      const r = await request<{ credential: AiCredentialView | null }>('GET', '/api/ai/credential');
      return { status: 'ok', credential: r.credential };
    },
    async saveCredential(input) {
      return (await request<{ credential: AiCredentialView }>('PUT', '/api/ai/credential', input)).credential;
    },
    async deleteCredential() {
      await request('DELETE', '/api/ai/credential');
    },
    async listModels() {
      return (await request<{ models: string[] }>('GET', '/api/ai/models')).models;
    },
    async test(model) {
      return request<AiTestResult>('POST', '/api/ai/test', { model });
    },
    async testHostedSearch(model, tool) {
      return request<HostedSearchTest>('POST', '/api/ai/test-search', { model, hosted_search: tool });
    },
    async runAgent(input, onEvent, signal) {
      const res = await fetch('/api/agent/run', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `Feil ${res.status}`);
      }
      // NDJSON: one event per line.
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buf = '';
      let final: FinalEvent | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (value) buf += value;
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const e = JSON.parse(line) as ResearchEvent;
          if (e.type === 'error') throw new Error(e.error);
          if (e.type === 'final') final = e;
          onEvent(e);
        }
        if (done) break;
      }
      if (!final) throw new Error('Agenten avsluttet uten svar');
      return final;
    },
    imageProxyUrl(url) {
      return `/api/research/image?${new URLSearchParams({ url })}`;
    },
    async fetchImage(url) {
      const res = await fetch(`/api/research/image?${new URLSearchParams({ url })}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error ?? `Feil ${res.status}`);
      }
      return res.blob();
    },
    async pageImages(url) {
      return request('POST', '/api/research/page-images', { url });
    },
    async getSearchCredential() {
      return (await request<{ credential: SearchCredentialView | null }>('GET', '/api/search/credential')).credential;
    },
    async saveSearchCredential(input) {
      return (await request<{ credential: SearchCredentialView }>('PUT', '/api/search/credential', input)).credential;
    },
    async deleteSearchCredential() {
      await request('DELETE', '/api/search/credential');
    },
    async testSearch(query) {
      return request('POST', '/api/search/test', { query });
    },
  };
}
