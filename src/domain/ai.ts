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
        tagged_sources?: TaggedSourceRef[];
        /** Pages a game survey found that probably show the figure (not confirmed). */
        suggested_sources?: TaggedSourceRef[] }
    | { kind: 'plan'; subject_ref: string; subject_name: string; game: string; reference_images: string[]; revision: boolean; paints?: 'owned' | 'best' | null;
        /** Who the figure is, when the user has confirmed it. */
        identity?: SubjectIdentityRecord | null;
        /** Painting guides and videos saved for the miniature. */
        guides?: TaggedSourceRef[];
        /** Painting guides for the whole game (game survey). */
        game_guides?: TaggedSourceRef[];
        tagged_sources?: TaggedSourceRef[] }
    /** Game survey: sources for the whole game, and which miniature is which (started from the miniature list). */
    | { kind: 'game'; game: string; miniatures: { ref: string; name: string; images: number; identity?: SubjectIdentityRecord | null;
        rejected?: { official_name: string | null; image_urls: string[] }[] }[] }
    /** Library research (bit 7.4): a technique or recipe for the user's own library. */
    | { kind: 'knowledge'; target: 'technique' | 'recipe' | 'image'; revision?: { name: string } | null; paints?: 'both' | 'owned' | 'best' | null;
        /** «Fra bilde»: the user's pictures as data URLs, sent to the model with the request. */
        reference_images?: string[] }
    /** Game page: facts (year, publisher, official website) and pictures for the game's illustration. */
    | { kind: 'game_info'; game: string; year: number | null; publishers: string[]; website: string | null; expansions: string[];
        /** Official pages a game survey found for the game. */
        known_pages: TaggedSourceRef[] }
    | null;
}

/**
 * One fact the game lookup found, with the page it builds on (server/research-agent.ts, verifyGameInfo).
 * checked: Paintrest found the value in the page's text; source: the page was read or found, but the value
 * could not be checked there; model: no page behind it.
 */
export interface GameFact<T> {
  value: T;
  source: { url: string; title: string } | null;
  basis: 'checked' | 'source' | 'model';
}

export interface GameInfoImage {
  image_url: string;
  thumbnail_url: string | null;
  page_url: string;
  page_title: string | null;
  site: string;
  kind: 'box' | 'cover_art' | 'other';
  caption: string | null;
  confidence: 'high' | 'medium' | 'low' | null;
}

/** What the game lookup found, after the server's checks. */
export interface GameInfo {
  official_name: string | null;
  year_published: GameFact<number> | null;
  publishers: GameFact<string[]> | null;
  /** read: the agent opened the page; found: it came up in a search. */
  website: { url: string; title: string | null; basis: 'read' | 'found'; why: string | null } | null;
  images: GameInfoImage[];
  sources: { url: string; title: string; opened: boolean }[];
  uncertainty: string | null;
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
  | { type: 'phase'; phase: 'identify' | 'painted' | 'guides' | 'sources' | 'match'; text: string }
  /** subject_ref is set when a game survey identifies one of several miniatures. */
  | { type: 'identity'; identity: SubjectIdentity; subject_ref?: string }
  /** The agent was told about something the user did while it worked (a tagged source). */
  | { type: 'hint'; text: string }
  | { type: 'tool_error'; action: string; target: string; error: string }
  | { type: 'final'; message: string; proposals: unknown[]; model: string; warnings: string[]; trace: TraceStep[]; pages?: PageSeen[];
      /** Image hunt: who the figure is, found in phase 1 of this run. */
      identity?: SubjectIdentity | null;
      /** Game survey: who each miniature is, by ref. */
      identities?: { subject_ref: string; identity: SubjectIdentity }[];
      /** Game survey: sources for the whole game, with role and which miniatures they show. */
      game_sources?: GameSourceIn[];
      /** Game lookup (game page): facts and picture suggestions. */
      game_info?: GameInfo | null }
  | { type: 'error'; error: string };

import type { SubjectIdentity, SubjectIdentityRecord } from './types';
import type { GameSourceIn } from './research';

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

  /** Reads part of a paint list (one AI call, no web). */
  readPaints(req: Extract<PaintInterpretRequest, { mode: 'read' }>, signal?: AbortSignal): Promise<PaintReadResult>;
  /** One dialog turn about the draft list: answers to questions or an instruction from the user. */
  discussPaints(req: Extract<PaintInterpretRequest, { mode: 'discuss' }>, signal?: AbortSignal): Promise<PaintDiscussResult>;
}
