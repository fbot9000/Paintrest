/**
 * The user's command set (skjema §1, §5). Screens only write through this
 * interface. v0 implements it against the local store; later an HTTP client
 * implements the same interface against the application layer.
 *
 * All commands are async so that swapping the implementation does not change
 * the call sites.
 */
import type {
  DeviationKind, DeviationPayload, Evidence, ExperienceOutcome, GameCoverSource, Grouping, Id, IdentityStatus, KnowledgeStatus,
  MaterialRole, Ownership, ProductKind, StepBasis, Uncertainty,
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
  /** The official website; an address without https:// gets it. Empty or null removes it. */
  website_url?: string | null;
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
  product_code?: string | null;
  finish?: string | null;
  /** The colour is the AI's estimate. */
  swatch_estimated?: boolean;
  /** Set inventory to `owns` in the same command (skjema §6, inventory_entry). */
  owns?: boolean;
  /** Ownership to record (wins over `owns`). Unset = no inventory row. */
  ownership?: Ownership;
  /** The user entered the exact product (maker and name) in the paint collection. Default: unconfirmed. */
  confirmed?: boolean;
}

export interface ProductPatch {
  name?: string;
  manufacturer?: string | null;
  range_name?: string | null;
  product_kind?: ProductKind;
  /** A colour the user sets is no longer an estimate (unless swatch_estimated says so). */
  swatch_hex?: string | null;
  swatch_estimated?: boolean;
  product_code?: string | null;
  finish?: string | null;
  identity_status?: IdentityStatus;
}

/** One paint from an import, after the user checked the list. */
export interface ImportPaintInput {
  manufacturer: string | null;
  range_name: string | null;
  name: string;
  product_code: string | null;
  product_kind: ProductKind;
  finish: string | null;
  swatch_hex: string | null;
  /** The colour is the AI's estimate. */
  swatch_estimated: boolean;
  ownership: Ownership;
  confirmed: boolean;
}

export interface ImportSummary {
  created: number;
  /** Already in the catalogue: missing fields filled in, ownership set. */
  updated: number;
  /** Hidden paints taken into use again (plans and recipes that use them follow). */
  restored: number;
  /** The same paint twice in the list: saved once. */
  duplicates: number;
}

// ---------- Bibliotek (bit 7) ----------

export interface TechniquePatch {
  name?: string;
  tags?: string[];
  desired_result?: string | null;
  use_area?: string | null;
  materials?: string[];
  variants?: string | null;
  risk_note?: string | null;
  evidence?: Evidence | null;
  uncertainty?: Uncertainty[];
}

/** One step when the whole step list is saved. Give `id` to keep an existing step. */
export interface TechniqueStepInput {
  id?: Id;
  title?: string;
  instruction?: string;
  basis?: StepBasis | null;
}

export interface ExperienceInput {
  outcome: ExperienceOutcome;
  note?: string | null;
  subject_id?: Id | null;
}

export interface RecipePatch {
  name?: string;
  tags?: string[];
  effect?: string | null;
  note?: string | null;
  evidence?: Evidence | null;
  uncertainty?: Uncertainty[];
}

/** One paint in the colour sequence. Give `id` to keep an existing row (steps refer to it). */
export interface RecipePaintInput {
  id?: Id;
  product_id: Id;
  role?: MaterialRole | null;
  note?: string | null;
}

export interface RecipeStepInput {
  id?: Id;
  instruction?: string;
  /** recipe_paint ids from the same recipe. */
  paint_ids?: Id[];
  technique_id?: Id | null;
}

export interface KnowledgeCommands {
  createTechnique(input?: TechniquePatch): Promise<Id>;
  updateTechnique(technique_id: Id, patch: TechniquePatch): Promise<void>;
  setTechniqueStatus(technique_id: Id, status: KnowledgeStatus): Promise<void>;
  /** Replaces the step list in the given order. Steps left out are removed. */
  setTechniqueSteps(technique_id: Id, steps: TechniqueStepInput[]): Promise<void>;
  deleteTechnique(technique_id: Id): Promise<void>;
  restoreTechnique(technique_id: Id): Promise<void>;
  recordExperience(technique_id: Id, input: ExperienceInput): Promise<Id>;
  deleteExperience(experience_id: Id): Promise<void>;

  createRecipe(input?: RecipePatch): Promise<Id>;
  updateRecipe(recipe_id: Id, patch: RecipePatch): Promise<void>;
  setRecipeStatus(recipe_id: Id, status: KnowledgeStatus): Promise<void>;
  /** Replaces the colour sequence in the given order. Removed paints are also removed from the steps. */
  setRecipePaints(recipe_id: Id, paints: RecipePaintInput[]): Promise<void>;
  /** Replaces the method in the given order. An empty list makes it a plain colour sequence. */
  setRecipeSteps(recipe_id: Id, steps: RecipeStepInput[]): Promise<void>;
  deleteRecipe(recipe_id: Id): Promise<void>;
  restoreRecipe(recipe_id: Id): Promise<void>;
}

export interface Commands extends KnowledgeCommands {
  // Prosjekt
  createProject(input?: { name?: string }): Promise<{ project_id: Id; game_id: Id }>;
  deleteProject(project_id: Id): Promise<void>;
  restoreProject(project_id: Id): Promise<void>;
  updateGame(game_id: Id, patch: GamePatch): Promise<void>;
  /** `source`: the page and picture the file came from, when it was taken from the web (kept with the cover). */
  setGameCover(game_id: Id, file: Blob | null, filename?: string, source?: GameCoverSource | null): Promise<void>;
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
  /** Pictures the user pasted or dropped (not links): stored as kept sources and linked as references. The first becomes the illustration if there is none. */
  addSubjectImages(subject_id: Id, files: { blob: Blob; title?: string | null; page_url?: string | null }[]): Promise<void>;
  /** Chooses which stored image is the miniature's illustration (null clears it). */
  setSubjectCover(subject_id: Id, asset_id: Id | null): Promise<void>;
  /** Removes an image from the miniature. The source and the file stay, as history. */
  detachSubjectImage(subject_id: Id, asset_id: Id): Promise<void>;
  /** Keeps a video (from an image hunt) as a source for the miniature: a link, nothing is downloaded. */
  saveVideoSource(subject_id: Id, video: { url: string; title: string; channel: string | null }): Promise<void>;
  /** Keeps a painting guide (from an image hunt) as a method source for the miniature: a link, nothing is downloaded. */
  saveGuideSource(subject_id: Id, guide: { url: string; title: string; site: string | null }): Promise<void>;
  /**
   * «Viser figuren»: the user says this page shows the miniature (on) or not (off). On keeps the page
   * as a source with an evidence link to the miniature; off removes that link. The agent opens tagged pages first.
   */
  tagSource(subject_id: Id, page: { url: string; title: string }, on: boolean): Promise<void>;
  /** «Riktig figur»: the agent's identification is right; later hunts and the paint plan build on it. */
  confirmIdentity(subject_id: Id): Promise<void>;
  /** «Feil figur»: the identification is wrong; it is removed and the agent is told not to choose it again. */
  rejectIdentity(subject_id: Id): Promise<void>;

  // Palett (datamodell v3 §8)
  /** Adds a paint to one miniature's palette. */
  addPaletteEntry(subject_id: Id, product_id: Id, input?: { role_label?: string | null; part?: string | null }): Promise<Id>;
  updatePaletteEntry(entry_id: Id, patch: { role_label?: string | null; part?: string | null }): Promise<void>;
  /** Hides the entry (restorable); plans that use the paint are not changed. */
  removePaletteEntry(entry_id: Id): Promise<void>;

  // Katalog og malingssamling
  createProduct(input?: ProductInput): Promise<Id>;
  updateProduct(product_id: Id, patch: ProductPatch): Promise<void>;
  /** Hides the paint from the catalogue. Plans, recipes and palettes that use it keep it. */
  deleteProduct(product_id: Id): Promise<void>;
  restoreProduct(product_id: Id): Promise<void>;
  setOwnership(product_id: Id, ownership: Ownership): Promise<void>;
  /** Saves a checked import list in one transaction (matching existing and hidden paints). */
  importProducts(paints: ImportPaintInput[], opts?: { source?: 'manual' | 'import' }): Promise<ImportSummary>;
  /** Hides the paints from the old sample data and clears their ownership. Returns how many. */
  removeSampleProducts(): Promise<number>;
  /**
   * Deletes hidden paints for good, and removes them from plan steps, mixes, open
   * deviations, recipes and palettes (the steps and recipes stay). Takes a backup of the
   * data folder first. Refuses paints that are not hidden. Returns how many were deleted.
   */
  purgeProducts(product_ids: Id[]): Promise<number>;

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

  /** Stores a picture the user posts (for example to research from a picture). Returns the file id. */
  storeImage(file: Blob): Promise<Id>;

  // Utvikling
  resetToSampleData(): Promise<void>;
}

export class CommandError extends Error {}
