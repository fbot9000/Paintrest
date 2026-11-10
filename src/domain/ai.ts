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
  /** UiB's built-in web search tool, or off. */
  hosted_search: HostedSearchSetting;
  key_hint: string;
  created_at: string;
  updated_at: string;
}

export type HostedSearchSetting = 'off' | 'web_search' | 'web_search_preview';

export interface HostedSearchTest {
  ok: true;
  tool: string;
  model: string;
  latency_ms: number;
  searches: string[];
  citations: { url: string; title: string }[];
  text: string;
}

export interface AiSettingsInput {
  label: string;
  base_url: string;
  /** Leave out to keep the stored key. */
  api_key?: string;
  default_model: string | null;
  hosted_search?: HostedSearchSetting;
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
  /** Open zone: changes in the project are applied directly (the agent is told so). */
  direct_apply?: boolean;
  /** Image hunt for one miniature (own strategy, more steps, may look at images). */
  focus?:
    | { kind: 'images'; subject_ref: string; subject_name: string; game: string; reference_image?: string | null }
    | { kind: 'plan'; subject_ref: string; subject_name: string; game: string; reference_images: string[]; revision: boolean }
    | null;
}

export interface PageSeen {
  url: string;
  title: string;
  site: string;
  author: string | null;
  language: string | null;
  image_count: number;
}

export interface TraceStep {
  action: 'search' | 'open' | 'look' | 'anchor' | 'image_search';
  target: string;
  result: string;
}

/** One line of the research stream (server/research-agent.ts). */
export type ResearchEvent =
  | { type: 'status'; text: string }
  | { type: 'search'; query: string; why: string | null }
  | { type: 'search_done'; query: string; hits: { title: string; url: string }[] }
  | { type: 'open'; url: string; why: string | null }
  | { type: 'open_done'; url: string; title: string; image_count: number; site?: string; author?: string | null; language?: string | null;
      images?: { url: string; alt: string; caption: string | null; context: string | null }[] }
  | { type: 'image_search'; query: string; why: string | null }
  | { type: 'image_search_done'; query: string; images: ImageHit[] }
  | { type: 'look'; count: number; why: string | null }
  | { type: 'look_done'; summary: string }
  | { type: 'phase'; phase: 'official' | 'broad'; text: string }
  | { type: 'anchor'; anchor: HuntAnchor }
  | { type: 'tool_error'; action: string; target: string; error: string }
  | { type: 'final'; message: string; proposals: unknown[]; model: string; warnings: string[]; trace: TraceStep[]; pages?: PageSeen[] }
  | { type: 'error'; error: string };

import type { HuntAnchor } from './agent';

/** One picture from an image search, with the page it was found on. */
export interface ImageHit {
  image_url: string;
  thumbnail_url: string | null;
  page_url: string;
  title: string;
  site: string;
}

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
  /** Asks UiB a question with the built-in web_search tool on. */
  testHostedSearch(model?: string, tool?: HostedSearchSetting): Promise<HostedSearchTest>;
  /** Runs one research turn; `onEvent` receives each step as it happens. */
  runAgent(input: AgentTurnInput, onEvent: (e: ResearchEvent) => void, signal?: AbortSignal): Promise<FinalEvent>;
  /** Address the browser can use to show an image found on the web (fetched by the server). */
  imageProxyUrl(url: string): string;
  fetchImage(url: string): Promise<Blob>;
  /** Reads a web page through the server and lists its images (no agent). */
  pageImages(url: string): Promise<{ url: string; title: string; site: string; author: string | null; images: { url: string; alt: string; caption: string | null }[] }>;

  getSearchCredential(): Promise<SearchCredentialView | null>;
  saveSearchCredential(input: { provider: 'tavily' | 'brave'; api_key?: string }): Promise<SearchCredentialView>;
  deleteSearchCredential(): Promise<void>;
  testSearch(query?: string): Promise<{ count: number; first: { title: string; url: string } | null; latency_ms: number }>;
}
