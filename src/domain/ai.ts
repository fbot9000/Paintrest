/**
 * Client view of the AI key (skjema §4: clients never see the key).
 * The browser only ever sends the key once, when the user saves it,
 * and only ever receives the public view below.
 */
export interface AiCredentialView {
  id: string;
  provider: string;
  label: string;
  base_url: string;
  default_model: string | null;
  key_hint: string;
  created_at: string;
  updated_at: string;
}

export interface AiSettingsInput {
  label: string;
  base_url: string;
  /** Leave out to keep the stored key. */
  api_key?: string;
  default_model: string | null;
}

export interface AiTestResult {
  ok: true;
  model: string;
  text: string;
  latency_ms: number;
}

export interface AgentTurnInput {
  context: unknown;
  messages: { role: 'user' | 'assistant'; content: string }[];
  result_types: string[];
  model?: string;
}

export interface TraceStep {
  action: 'search' | 'open';
  target: string;
  result: string;
}

/** One line of the research stream (server/research-agent.ts). */
export type ResearchEvent =
  | { type: 'status'; text: string }
  | { type: 'search'; query: string; why: string | null }
  | { type: 'search_done'; query: string; hits: { title: string; url: string }[] }
  | { type: 'open'; url: string; why: string | null }
  | { type: 'open_done'; url: string; title: string; image_count: number }
  | { type: 'tool_error'; action: string; target: string; error: string }
  | { type: 'final'; message: string; proposals: unknown[]; model: string; warnings: string[]; trace: TraceStep[] }
  | { type: 'error'; error: string };

export type FinalEvent = Extract<ResearchEvent, { type: 'final' }>;

export interface SearchCredentialView {
  provider: 'tavily' | 'brave';
  label: string;
  key_hint: string;
  updated_at: string;
}

export interface AiGateway {
  /** `unavailable` when the app runs without its server (e.g. a static preview). */
  getCredential(): Promise<{ status: 'ok'; credential: AiCredentialView | null } | { status: 'unavailable' }>;
  saveCredential(input: AiSettingsInput): Promise<AiCredentialView>;
  deleteCredential(): Promise<void>;
  listModels(): Promise<string[]>;
  test(model?: string): Promise<AiTestResult>;
  /** Runs one research turn; `onEvent` receives each step as it happens. */
  runAgent(input: AgentTurnInput, onEvent: (e: ResearchEvent) => void, signal?: AbortSignal): Promise<FinalEvent>;
  /** Address the browser can use to show an image found on the web (fetched by the server). */
  imageProxyUrl(url: string): string;
  fetchImage(url: string): Promise<Blob>;

  getSearchCredential(): Promise<SearchCredentialView | null>;
  saveSearchCredential(input: { provider: 'tavily' | 'brave'; api_key?: string }): Promise<SearchCredentialView>;
  deleteSearchCredential(): Promise<void>;
  testSearch(query?: string): Promise<{ count: number; first: { title: string; url: string } | null; latency_ms: number }>;
}
