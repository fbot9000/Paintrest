import type { AiCredentialView, AiGateway, AiTestResult } from '../domain/ai';

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
  };
}
