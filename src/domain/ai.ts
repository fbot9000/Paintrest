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
    | { kind: 'images'; subject_ref: string; subject_name: string; game: string; reference_image?: string | null;
        /** Pictures the user found themselves (for example from Google Images), with their pages. */
        user_images?: { image_url: string; page_url: string; title: string }[] }
    | { kind: 'plan'; subject_ref: string; subject_name: string; game: string; reference_images: string[]; revision: boolean; paints?: 'owned' | 'best' | null }
    /** Library research (bit 7.4): a technique or recipe for the user's own library. */
    | { kind: 'knowledge'; target: 'technique' | 'recipe'; revision?: { name: string } | null; paints?: 'both' | 'owned' | 'best' | null }
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

// ---------- Import av malinger (server/paint-import.ts) ----------

/** One paint as the AI describes it. `guessed` lists wire field names filled in from the AI's own knowledge. */
export interface PaintWire {
  /** The AI's own short id in a read answer (p1, p2 …), so questions can point to it. */
  id: string | null;
  lines: number[];
  maker: string | null;
  range: string | null;
  name: string;
  code: string | null;
  kind: string;
  finish: string | null;
  hex: string | null;
  own: 'owns' | 'not_owned';
  guessed: string[];
  unsure: string | null;
}

export interface PaintQuestionWire {
  text: string;
  /** Paint ids (read) or row refs (discuss) the question is about. */
  refs: string[];
  options: string[];
}

export type PaintChangeWire =
  | { op: 'update'; ref: string; set: Partial<Record<'maker' | 'range' | 'name' | 'code' | 'kind' | 'finish' | 'hex' | 'own', string | null>>;
      guessed: string[]; unsure?: string | null; include?: boolean }
  | { op: 'add'; paint: PaintWire }
  | { op: 'remove'; ref: string; reason: string | null };

export type PaintInterpretRequest =
  | { mode: 'read'; lines: { n: number; text: string }[]; context: { n: number; text: string }[]; note: string }
  | { mode: 'discuss'; table: string; unused_lines: { n: number; text: string }[]; questions: { id: string; text: string }[];
      history: { role: 'user' | 'assistant'; text: string }[]; message: string; note: string };

export interface PaintReadResult {
  mode: 'read';
  message: string;
  paints: PaintWire[];
  skipped: { line: number; reason: string }[];
  questions: PaintQuestionWire[];
  model: string;
}

export interface PaintDiscussResult {
  mode: 'discuss';
  message: string;
  changes: PaintChangeWire[];
  /** Question ids the user's message answered. */
  answered: string[];
  questions: PaintQuestionWire[];
  model: string;
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

  /** Reads part of a paint list (one AI call, no web). */
  readPaints(req: Extract<PaintInterpretRequest, { mode: 'read' }>, signal?: AbortSignal): Promise<PaintReadResult>;
  /** One dialog turn about the draft list: answers to questions or an instruction from the user. */
  discussPaints(req: Extract<PaintInterpretRequest, { mode: 'discuss' }>, signal?: AbortSignal): Promise<PaintDiscussResult>;
}
