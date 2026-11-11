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
  /** Lets the user's actions during the run (tagged sources) reach the agent through AiGateway.sendHint. */
  run_id?: string | null;
  /** Image hunt for one miniature (own strategy, more steps, may look at images). */
  focus?:
    | { kind: 'images'; subject_ref: string; subject_name: string; game: string; reference_image?: string | null;
        /** Pictures the user found themselves (for example from Google Images), with their pages. */
        user_images?: { image_url: string; page_url: string; title: string }[];
        /** Who the figure is, from an earlier hunt. Confirmed: phase 1 is skipped. */
        identity?: SubjectIdentityRecord | null;
        /** Identifications the user said were wrong. */
        rejected?: { official_name: string | null; image_urls: string[] }[];
        /** Pages the user tagged as showing the figure («Viser figuren»). */
        tagged_sources?: TaggedSourceRef[] }
    | { kind: 'plan'; subject_ref: string; subject_name: string; game: string; reference_images: string[]; revision: boolean; paints?: 'owned' | 'best' | null;
        /** Who the figure is, when the user has confirmed it. */
        identity?: SubjectIdentityRecord | null;
        /** Painting guides and videos saved for the miniature. */
        guides?: TaggedSourceRef[];
        tagged_sources?: TaggedSourceRef[] }
    /** Library research (bit 7.4): a technique or recipe for the user's own library. */
    | { kind: 'knowledge'; target: 'technique' | 'recipe'; revision?: { name: string } | null; paints?: 'both' | 'owned' | 'best' | null }
    | null;
}

/** A page the user tagged or saved for the miniature, as the agent gets it. */
export interface TaggedSourceRef {
  url: string;
  title: string;
  summary?: string | null;
}

/** What the user did while a run was going; the server hands it to the agent before its next step. */
export type RunHint =
  | { kind: 'tagged_source'; url: string; title: string }
  | { kind: 'untagged_source'; url: string; title: string };

export interface PageSeen {
  url: string;
  title: string;
  site: string;
  author: string | null;
  language: string | null;
  image_count: number;
}

export interface TraceStep {
  /** 'anchor' is from hunts before the three phases (stored messages keep it). */
  action: 'search' | 'open' | 'look' | 'anchor' | 'identify' | 'image_search' | 'hint';
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
  | { type: 'phase'; phase: 'identify' | 'painted' | 'guides'; text: string }
  | { type: 'identity'; identity: SubjectIdentity }
  /** The agent was told about something the user did while it worked (a tagged source). */
  | { type: 'hint'; text: string }
  | { type: 'tool_error'; action: string; target: string; error: string }
  | { type: 'final'; message: string; proposals: unknown[]; model: string; warnings: string[]; trace: TraceStep[]; pages?: PageSeen[];
      /** Image hunt: who the figure is, found in phase 1 of this run. */
      identity?: SubjectIdentity | null }
  | { type: 'error'; error: string };

import type { SubjectIdentity, SubjectIdentityRecord } from './types';

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
  /** Passes something the user did to a running turn (by its run_id). False when that run has ended. */
  sendHint(run_id: string, hint: RunHint): Promise<boolean>;
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
