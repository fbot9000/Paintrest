/**
 * The user's command set (skjema §1, §5). Screens only write through this
 * interface. v0 implements it against the local store; later an HTTP client
 * implements the same interface against the application layer.
 *
 * All commands are async so that swapping the implementation does not change
 * the call sites.
 */
import type {
  DeviationKind, DeviationPayload, Grouping, Id, Ownership, ProductKind,
} from './types';
import type { ReferenceImage } from './agent';

export interface BggCandidate {
  thing_id: number;
  primary_name: string;
  year_published: number | null;
  publishers: string[];
  expansions: { thing_id: number; name: string; year_published: number | null }[];
}

export type LinkBggResult =
  | { status: 'linked' }
  | { status: 'duplicate'; other_game_id: Id; other_name: string };

export interface GamePatch {
  primary_name?: string;
  year_published?: number | null;
  publishers?: string[];
}

export interface SubjectPatch {
  name?: string;
  grouping?: Grouping;
  physical_count?: number;
  expansion_id?: Id | null;
  category_label?: string | null;
}

export interface ProductInput {
  name?: string;
  manufacturer?: string | null;
  range_name?: string | null;
  product_kind?: ProductKind;
  swatch_hex?: string | null;
  /** Set inventory to `owns` in the same command (skjema §6, inventory_entry). */
  owns?: boolean;
}

export interface Commands {
  // Prosjekt
  createProject(input?: { name?: string }): Promise<{ project_id: Id; game_id: Id }>;
  deleteProject(project_id: Id): Promise<void>;
  restoreProject(project_id: Id): Promise<void>;
  updateGame(game_id: Id, patch: GamePatch): Promise<void>;
  setGameCover(game_id: Id, file: Blob | null, filename?: string): Promise<void>;
  linkBgg(game_id: Id, candidate: BggCandidate, opts?: { replace?: boolean; expansion_thing_ids?: number[]; project_id?: Id }): Promise<LinkBggResult>;
  unlinkBgg(game_id: Id): Promise<void>;

  createExpansion(game_id: Id, input?: { name?: string; attach_to_project_id?: Id }): Promise<Id>;
  updateExpansion(expansion_id: Id, patch: { name?: string; year_published?: number | null }): Promise<void>;
  deleteExpansion(expansion_id: Id): Promise<void>;
  restoreExpansion(expansion_id: Id): Promise<void>;
  attachExpansion(project_id: Id, expansion_id: Id): Promise<void>;
  detachExpansion(project_id: Id, expansion_id: Id): Promise<void>;

  createSubject(project_id: Id, input?: SubjectPatch): Promise<Id>;
  updateSubject(subject_id: Id, patch: SubjectPatch): Promise<void>;
  deleteSubject(subject_id: Id): Promise<void>;
  restoreSubject(subject_id: Id): Promise<void>;
  setSubjectImage(subject_id: Id, file: Blob | null, filename?: string): Promise<void>;
  /** The user picks images from a web page directly (no agent). Downloads, stores and links them. */
  attachWebImages(subject_id: Id, images: ReferenceImage[], cover_image_url?: string): Promise<void>;
  /** Chooses which stored image is the miniature's illustration (null clears it). */
  setSubjectCover(subject_id: Id, asset_id: Id | null): Promise<void>;
  /** Removes an image from the miniature. The source and the file stay, as history. */
  detachSubjectImage(subject_id: Id, asset_id: Id): Promise<void>;

  // Palett (datamodell v3 §8)
  /** Adds a paint to one miniature's palette. */
  addPaletteEntry(subject_id: Id, product_id: Id, input?: { role_label?: string | null; part?: string | null }): Promise<Id>;
  updatePaletteEntry(entry_id: Id, patch: { role_label?: string | null; part?: string | null }): Promise<void>;
  /** Hides the entry (restorable); plans that use the paint are not changed. */
  removePaletteEntry(entry_id: Id): Promise<void>;

  // Katalog
  createProduct(input?: ProductInput): Promise<Id>;
  setOwnership(product_id: Id, ownership: Ownership): Promise<void>;

  // Plan og malevisning
  createEmptyPlan(subject_id: Id): Promise<Id>;
  setInProgress(subject_id: Id, in_progress: boolean): Promise<void>;
  setPartDone(subject_id: Id, element_id: Id, done: boolean): Promise<void>;
  openPart(subject_id: Id, element_id: Id): Promise<void>;
  setGroupProgress(subject_id: Id, element_id: Id, count: number): Promise<void>;
  addDeviation(plan_version_id: Id, input: { element_id: Id | null; step_id: Id | null; kind: DeviationKind; payload: DeviationPayload }): Promise<Id>;
  deleteDeviation(deviation_id: Id): Promise<void>;
  markFinished(subject_id: Id, quantity: number): Promise<Id>;

  // Filer
  getFileUrl(file_id: Id): Promise<string | null>;

  // Utvikling
  resetToSampleData(): Promise<void>;
}

export class CommandError extends Error {}
