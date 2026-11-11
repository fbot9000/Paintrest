/**
 * Two command sets for research (skjema §4–5, §7–8):
 * - ResearchCommands are the user's: start a task, write, open a revision
 *   target, curate, approve and reject. The agent never gets these.
 * - AgentCommands are the agent's: its own messages and draft proposals,
 *   always checked against the task's scope before anything is written.
 */
import type { NormalisedProposal } from './agent';
import type { CatalogSubjectPayload, PaintPlanPayload, ReferenceImage, SourceRead } from './agent';
import type { PageSeen } from './ai';
import type { Id, PaintChoice, SourceRole, SubjectFocus, SubjectIdentity } from './types';

export interface ApproveOptions {
  /** productKey → existing product id, or 'create' to create an unconfirmed product. */
  product_choices?: Record<string, Id | 'create'>;
  /** reference_selection: the images the user kept (default: all). */
  image_urls?: string[];
  /** reference_selection: use the first image as the miniature's picture if it has none. */
  set_cover?: boolean;
  /** reference_selection: this image becomes the miniature's illustration (replaces the current one). */
  cover_image_url?: string;
  /** technique/recipe (bit 7.5): the variant the user wants to test first (index in comparison.variants). */
  primary_variant?: number;
}

export interface ApplyResult {
  change_set_id: Id | null;
  applied: Id[];
  kept_as_proposal: { id: Id; reason: string }[];
}

/** «image»: suggestions for recipes and techniques from pictures the user posts. */
export type KnowledgeTarget = 'technique' | 'recipe' | 'image';

export interface ResearchCommands {
  /** Opens a task in the project: the panel's (no focus) or the workspace's own for one miniature and kind. */
  /** focus: a workspace task for one miniature, or 'game' for the game survey's task. */
  startTask(project_id: Id, focus?: SubjectFocus | 'game'): Promise<Id>;
  /**
   * A library task (bit 7.4): area new_knowledge, no work project, and one result type
   * (technique or recipe). The agent only drafts; the user approves into the library.
   */
  startKnowledgeTask(target: KnowledgeTarget, opts?: { paint_choice?: PaintChoice; image_file_ids?: Id[] }): Promise<Id>;
  /** The user changes which paints a recipe task may use; applies from the next turn. */
  setPaintChoice(task_id: Id, choice: PaintChoice): Promise<void>;
  /**
   * Bit 7.6: a library task that improves one technique, for example after an experience.
   * The agent drafts a changed technique; approving writes it into the technique.
   */
  startTechniqueRevision(technique_id: Id): Promise<Id>;
  closeTask(task_id: Id): Promise<void>;
  addUserMessage(task_id: Id, body: string): Promise<Id>;
  openRevisionTarget(task_id: Id, subject_id: Id): Promise<void>;
  /**
   * Gives an open task the result types this version of Paintrest supports for its area.
   * Run when the user starts a turn, so tasks created before a new type existed can use it.
   * The agent has no access to this command.
   */
  syncResultTypes(task_id: Id): Promise<void>;
  editCatalogProposal(proposal_id: Id, payload: CatalogSubjectPayload): Promise<void>;
  /** The user curates a plan proposal before approval: steps, paints, palette. */
  editPlanProposal(proposal_id: Id, payload: PaintPlanPayload): Promise<void>;
  approveProposal(proposal_id: Id, opts?: ApproveOptions): Promise<void>;
  /**
   * Puts found pictures on a miniature (fordelingstavlen and the Bilder tab). The image proposals they
   * came from stay open for their other pictures, and close by themselves when nothing is left in them.
   * The first picture becomes the illustration when `auto_cover` and the miniature has none.
   * Returns the new asset id for each picture address, so it can be undone.
   */
  placeImages(subject_id: Id, images: ReferenceImage[], opts?: { cover_image_url?: string; auto_cover?: boolean }): Promise<Record<string, Id>>;
  /** Sets found pictures aside in every open image proposal in the project that has them. */
  dismissImages(project_id: Id, image_urls: string[]): Promise<void>;
  /** Undoes dismissImages. */
  restoreImages(project_id: Id, image_urls: string[]): Promise<void>;
  rejectProposal(proposal_id: Id): Promise<void>;
  /**
   * Open zone (user decision 10.11.2026): applies the agent's proposals directly
   * where no choice from the user is needed, as one undoable change set.
   * Image selections and plans with paints missing from the catalogue stay as proposals.
   */
  applyAgentChanges(task_id: Id, proposal_ids: Id[]): Promise<ApplyResult>;
  /** Reverts a change set. Refuses, without changing anything, if the rows were changed afterwards. */
  undoChangeSet(change_set_id: Id): Promise<void>;
}

export type ProposalWrite = { ok: true; id: Id; ref: string; updated: boolean } | { ok: false; reason: string };

export interface AgentCommands {
  addAssistantMessage(task_id: Id, body: string, model_id: string | null, trace?: { action: 'search' | 'open' | 'look' | 'anchor' | 'identify' | 'image_search' | 'hint'; target: string; result: string }[]): Id;
  addSystemMessage(task_id: Id, body: string): Id;
  /** Creates a draft, or updates the agent's own pending draft when `update_of` names one. */
  writeProposal(task_id: Id, p: NormalisedProposal, provider: string, model_id: string): ProposalWrite;
  recordContext(task_id: Id, refs: { target_type: 'project' | 'paint_plan'; target_id: Id; revision: string }[]): void;
  /**
   * Keeps every page the agent read as a draft source (retention draft, skjema §6),
   * with the agent's summary and original excerpt as layers, so it is not rediscovered.
   */
  /** Returns the titles of the sources it created, so the panel can say so. */
  recordSources(task_id: Id, pages: PageSeen[], read: SourceRead[]): string[];
  /**
   * Image hunt: keeps who the figure is on the miniature, as «proposed» (PROTOTYPE, brukerønske 11.11.2026).
   * A confirmed identity is left alone. Returns the name it was stored under, or null when nothing was stored.
   */
  recordIdentity(task_id: Id, subject_id: Id, identity: SubjectIdentity): string | null;
  /**
   * Game survey: keeps the sources for the whole game (draft sources, with role and summary) and
   * suggests which miniatures each page shows (evidence links marked as suggestions). Only pages and
   * miniatures in the task's project are written. Returns what was stored, for the conversation.
   */
  recordGameSources(task_id: Id, sources: GameSourceIn[], subjectRefs: Record<string, Id>): { sources: number; links: number };
}

/** A source for the whole game from a survey (server/research-agent.ts GameSource). */
export interface GameSourceIn {
  url: string;
  title: string;
  role: SourceRole;
  shows: string[];
  summary: string | null;
  read: boolean;
}
