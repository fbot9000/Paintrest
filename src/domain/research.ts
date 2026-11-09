/**
 * Two command sets for research (skjema §4–5, §7–8):
 * - ResearchCommands are the user's: start a task, write, open a revision
 *   target, curate, approve and reject. The agent never gets these.
 * - AgentCommands are the agent's: its own messages and draft proposals,
 *   always checked against the task's scope before anything is written.
 */
import type { NormalisedProposal } from './agent';
import type { CatalogSubjectPayload } from './agent';
import type { Id } from './types';

export interface ApproveOptions {
  /** productKey → existing product id, or 'create' to create an unconfirmed product. */
  product_choices?: Record<string, Id | 'create'>;
  /** reference_selection: the images the user kept (default: all). */
  image_urls?: string[];
  /** reference_selection: use the first image as the miniature's picture if it has none. */
  set_cover?: boolean;
}

export interface ResearchCommands {
  startTask(project_id: Id): Promise<Id>;
  closeTask(task_id: Id): Promise<void>;
  addUserMessage(task_id: Id, body: string): Promise<Id>;
  openRevisionTarget(task_id: Id, subject_id: Id): Promise<void>;
  editCatalogProposal(proposal_id: Id, payload: CatalogSubjectPayload): Promise<void>;
  approveProposal(proposal_id: Id, opts?: ApproveOptions): Promise<void>;
  rejectProposal(proposal_id: Id): Promise<void>;
}

export type ProposalWrite = { ok: true; id: Id; ref: string; updated: boolean } | { ok: false; reason: string };

export interface AgentCommands {
  addAssistantMessage(task_id: Id, body: string, model_id: string | null, trace?: { action: 'search' | 'open'; target: string; result: string }[]): Id;
  addSystemMessage(task_id: Id, body: string): Id;
  /** Creates a draft, or updates the agent's own pending draft when `update_of` names one. */
  writeProposal(task_id: Id, p: NormalisedProposal, provider: string, model_id: string): ProposalWrite;
  recordContext(task_id: Id, refs: { target_type: 'project' | 'paint_plan'; target_id: Id; revision: string }[]): void;
}
