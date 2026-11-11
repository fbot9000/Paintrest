/**
 * Domain types, written directly from «Paintrest – databaseskjema og arkitektur» §6.
 * Column names keep the schema's snake_case so the same shapes can be reused
 * when the local store is replaced by the application layer + PostgreSQL.
 *
 * Only the tables needed by the current slices are present. Where the prototype
 * deviates from the schema, it is marked with `PROTOTYPE:` and listed in docs/AVVIK.md.
 */

export type Id = string;
/** ISO-8601 string; maps to `timestamptz`. */
export type Timestamp = string;

export interface Workspace {
  id: Id;
  display_name: string;
  created_at: Timestamp;
}

// ---------- Filer ----------

export type FilePurpose = 'cover' | 'source_asset' | 'import';

export interface StoredFile {
  id: Id;
  workspace_id: Id;
  purpose: FilePurpose;
  /** Key in the blob store. */
  storage_key: string;
  media_type: string;
  byte_size: number;
  created_at: Timestamp;
  deleted_at: Timestamp | null;
}

// ---------- Maling og inventar ----------

export type ProductKind =
  | 'primer' | 'base' | 'layer' | 'shade' | 'contrast'
  | 'technical' | 'metallic' | 'medium' | 'other';

export type IdentityStatus = 'unconfirmed' | 'confirmed';

export interface PaintProduct {
  id: Id;
  workspace_id: Id;
  manufacturer: string | null;
  range_name: string | null;
  name: string;
  product_kind: ProductKind;
  coverage: string | null;
  finish: string | null;
  identity_status: IdentityStatus;
  /**
   * PROTOTYPE: datamodell v3 §14 says the painting view shows a «fargeprøve»,
   * but the schema has no column for it. Nullable hex colour.
   */
  swatch_hex: string | null;
  created_at: Timestamp;
  deleted_at: Timestamp | null;
}

export type Ownership = 'owns' | 'not_owned' | 'unknown';
export type OwnershipSource = 'manual' | 'import' | 'purchase';

export interface InventoryEntry {
  workspace_id: Id;
  product_id: Id;
  ownership: Ownership;
  ownership_source: OwnershipSource;
  updated_at: Timestamp;
}

// ---------- Spill og prosjekt ----------

export type Origin = 'manual' | 'bgg';

export interface Game {
  id: Id;
  workspace_id: Id;
  origin: Origin;
  bgg_thing_id: number | null;
  primary_name: string;
  year_published: number | null;
  publishers: string[];
  cover_file_id: Id | null;
  created_at: Timestamp;
  deleted_at: Timestamp | null;
}

export interface Expansion {
  id: Id;
  game_id: Id;
  origin: Origin;
  bgg_thing_id: number | null;
  name: string;
  year_published: number | null;
  deleted_at: Timestamp | null;
}

export interface Project {
  id: Id;
  workspace_id: Id;
  game_id: Id;
  content_revision: number;
  created_at: Timestamp;
  deleted_at: Timestamp | null;
}

export interface ProjectExpansion {
  project_id: Id;
  expansion_id: Id;
}

export type Grouping = 'single' | 'group';
export type PlanState = 'none' | 'draft' | 'approved';
export type Basis = 'documented' | 'inferred' | null;

export interface MiniatureSubject {
  id: Id;
  project_id: Id;
  expansion_id: Id | null;
  name: string;
  grouping: Grouping;
  physical_count: number;
  category_label: string | null;
  official_asset_id: Id | null;
  plan_state: PlanState;
  in_progress: boolean;
  finished_count: number;
  count_basis: Basis;
  grouping_basis: Basis;
  uncertainty: unknown[] | null;
  current_plan_version_id: Id | null;
  deleted_at: Timestamp | null;
}

export type ScopeKind = 'project' | 'expansion' | 'category' | 'subjects';

export interface PaletteEntry {
  id: Id;
  project_id: Id;
  product_id: Id;
  role_label: string | null;
  note: string | null;
  scope_kind: ScopeKind;
  expansion_id: Id | null;
  category_label: string | null;
  deleted_at: Timestamp | null;
}

export interface PaletteEntrySubject {
  palette_entry_id: Id;
  subject_id: Id;
}

// ---------- Maleplan ----------

export type VersionState = 'approved' | 'superseded';
export type VersionOrigin = 'user' | 'proposal';

export interface PaintPlanVersion {
  id: Id;
  subject_id: Id;
  version_number: number;
  state: VersionState;
  origin: VersionOrigin;
  supersedes_id: Id | null;
  created_at: Timestamp;
  /** PROTOTYPE: short description of the approach and colour choices. Not in skjema. */
  summary?: string | null;
}

export type ElementKind = 'operation' | 'part';

export interface PlanElement {
  id: Id;
  plan_version_id: Id;
  kind: ElementKind;
  position: number;
  name: string;
}

export interface PlanStep {
  id: Id;
  element_id: Id;
  position: number;
  instruction: string;
  /** PROTOTYPE (bit 7): points to technique.id while the library has no versions. */
  technique_version_id: Id | null;
  /** PROTOTYPE (bit 7): points to recipe.id while the library has no versions. */
  recipe_version_id: Id | null;
}

export type MaterialRole =
  | 'base' | 'shade' | 'layer' | 'highlight' | 'wash' | 'glaze' | 'mix' | 'other';

export interface StepMaterial {
  id: Id;
  step_id: Id;
  position: number;
  product_id: Id;
  role: MaterialRole;
  role_label: string | null;
}

export interface MixGroup {
  id: Id;
  step_id: Id;
  label: string | null;
}

export interface MixComponent {
  mix_group_id: Id;
  position: number;
  product_id: Id;
  parts: number;
}

export interface PlanStepAsset {
  step_id: Id;
  source_asset_id: Id;
}

export type DeviationKind = 'swap_product' | 'change_instruction' | 'extra_step' | 'note';

export interface DeviationPayload {
  /** swap_product */
  from_product_id?: Id;
  to_product_id?: Id;
  /** change_instruction / extra_step / note */
  text?: string;
}

export interface LocalDeviation {
  id: Id;
  plan_version_id: Id;
  element_id: Id | null;
  step_id: Id | null;
  kind: DeviationKind;
  payload: DeviationPayload;
  created_at: Timestamp;
  sealed_at: Timestamp | null;
}

export interface PartProgress {
  subject_id: Id;
  element_id: Id;
  done: boolean;
  last_opened_at: Timestamp | null;
}

export interface GroupProgress {
  id: Id;
  subject_id: Id;
  plan_version_id: Id;
  element_id: Id;
  count: number;
}

export interface PaintCompletion {
  id: Id;
  subject_id: Id;
  plan_version_id: Id;
  deviation_snapshot: LocalDeviation[];
  quantity: number;
  finished_count_after: number;
  created_at: Timestamp;
}

// ---------- Kilder ----------

export type SourceKind = 'image' | 'article' | 'forum' | 'video' | 'book' | 'guide' | 'gallery';
export type AnalysisState = 'stored' | 'extracted';
export type Retention = 'draft' | 'kept';

export interface Source {
  id: Id;
  workspace_id: Id;
  kind: SourceKind;
  title: string;
  creator: string | null;
  url: string | null;
  locator: string | null;
  analysis_state: AnalysisState;
  retention: Retention;
  created_by_task_id: Id | null;
  created_at: Timestamp;
  deleted_at: Timestamp | null;
  /** PROTOTYPE: the page's language when known (html lang or guessed). */
  language?: string | null;
}

export interface SourceAsset {
  id: Id;
  source_id: Id;
  position: number;
  locator: string | null;
  caption: string | null;
  file_id: Id | null;
  deleted_at: Timestamp | null;
  /** PROTOTYPE: what the picture shows (concept_art, official, painted, other). Not in skjema. */
  image_kind?: 'concept_art' | 'official' | 'painted' | 'other' | null;
}

export interface SourceLayer {
  id: Id;
  source_id: Id;
  layer: 'original' | 'translation' | 'extract';
  language: string | null;
  body: string;
  deleted_at: Timestamp | null;
}

export type LinkTargetType = 'project' | 'subject' | 'technique' | 'recipe' | 'plan_step';
export type LinkUse = 'evidence' | 'visual_reference' | 'method';

export interface SourceLink {
  id: Id;
  source_id: Id;
  target_type: LinkTargetType;
  target_id: Id;
  use: LinkUse;
  layer_id: Id | null;
  deleted_at: Timestamp | null;
}

export interface SourceLinkAsset {
  link_id: Id;
  source_asset_id: Id;
}

// ---------- Bibliotek: teknikker og oppskrifter (bit 7, PROTOTYPE, brukerbeslutning 11.11.2026) ----------
// No version tables: the user edits rows directly, and change_record keeps the history.
// See docs/BIT7-KUNNSKAP.md and docs/AVVIK.md.

/** The «godkjenning» dimension. A label, not a lock: an approved row can still be edited. */
export type KnowledgeStatus = 'draft' | 'approved';
/** documented = a source shows it; synthesized = the agent's own suggestion. */
export type StepBasis = 'documented' | 'synthesized';

export interface Technique {
  id: Id;
  workspace_id: Id;
  name: string;
  /** Free tags, trimmed and unique (case-insensitive). */
  tags: string[];
  status: KnowledgeStatus;
  desired_result: string | null;
  use_area: string | null;
  /** «Dette trenger du»: general materials, not paint products. */
  materials: string[];
  /** Free text describing alternative ways of doing it. */
  variants: string | null;
  risk_note: string | null;
  /** The «kildegrunnlag» dimension. null = not assessed (the user's own knowledge). */
  evidence: Evidence | null;
  uncertainty: Uncertainty[];
  created_at: Timestamp;
  updated_at: Timestamp;
  deleted_at: Timestamp | null;
}

export interface TechniqueStep {
  id: Id;
  technique_id: Id;
  position: number;
  title: string;
  instruction: string;
  basis: StepBasis | null;
}

export type ExperienceOutcome = 'worked' | 'needs_adjustment';

export interface TechniqueExperience {
  id: Id;
  technique_id: Id;
  outcome: ExperienceOutcome;
  note: string | null;
  subject_id: Id | null;
  created_at: Timestamp;
  deleted_at: Timestamp | null;
}

/** A colour sequence (recipe_paint), optionally with a method (recipe_step) for a certain effect. */
export interface Recipe {
  id: Id;
  workspace_id: Id;
  name: string;
  tags: string[];
  status: KnowledgeStatus;
  /** What the recipe achieves. Empty for a plain colour sequence. */
  effect: string | null;
  note: string | null;
  evidence: Evidence | null;
  uncertainty: Uncertainty[];
  created_at: Timestamp;
  updated_at: Timestamp;
  deleted_at: Timestamp | null;
}

export interface RecipePaint {
  id: Id;
  recipe_id: Id;
  position: number;
  product_id: Id;
  role: MaterialRole | null;
  note: string | null;
}

export interface RecipeStep {
  id: Id;
  recipe_id: Id;
  position: number;
  instruction: string;
  /** recipe_paint ids from the same recipe. */
  paint_ids: Id[];
  technique_id: Id | null;
}

// ---------- Historikk ----------

export type ChangeAction =
  | 'create' | 'update' | 'delete' | 'attach' | 'detach' | 'restore'
  | 'link_bgg' | 'new_version' | 'deviation' | 'completion' | 'progress' | 'undo';

export interface ChangeRecord {
  id: Id;
  workspace_id: Id;
  target_type: string;
  target_id: Id;
  from_version_id: Id | null;
  to_version_id: Id | null;
  action: ChangeAction;
  initiated_by: 'user' | 'agent';
  task_id: Id | null;
  proposal_id: Id | null;
  created_at: Timestamp;
}

/** All rows, keyed by table. Composite-key tables are plain arrays. */
export interface Tables {
  workspace: Record<Id, Workspace>;
  stored_file: Record<Id, StoredFile>;
  paint_product: Record<Id, PaintProduct>;
  inventory_entry: InventoryEntry[];
  game: Record<Id, Game>;
  expansion: Record<Id, Expansion>;
  project: Record<Id, Project>;
  project_expansion: ProjectExpansion[];
  miniature_subject: Record<Id, MiniatureSubject>;
  palette_entry: Record<Id, PaletteEntry>;
  palette_entry_subject: PaletteEntrySubject[];
  paint_plan_version: Record<Id, PaintPlanVersion>;
  plan_element: Record<Id, PlanElement>;
  plan_step: Record<Id, PlanStep>;
  step_material: Record<Id, StepMaterial>;
  mix_group: Record<Id, MixGroup>;
  mix_component: MixComponent[];
  plan_step_asset: PlanStepAsset[];
  local_deviation: Record<Id, LocalDeviation>;
  part_progress: PartProgress[];
  group_progress: Record<Id, GroupProgress>;
  paint_completion: Record<Id, PaintCompletion>;
  source: Record<Id, Source>;
  source_asset: Record<Id, SourceAsset>;
  source_layer: Record<Id, SourceLayer>;
  source_link: Record<Id, SourceLink>;
  source_link_asset: SourceLinkAsset[];
  change_record: Record<Id, ChangeRecord>;
  research_task: Record<Id, ResearchTask>;
  task_scope: Record<Id, TaskScope>;
  task_result_type: TaskResultType[];
  task_revision_target: Record<Id, TaskRevisionTarget>;
  research_message: Record<Id, ResearchMessage>;
  research_proposal: Record<Id, ResearchProposal>;
  context_ref: Record<Id, ContextRef>;
  agent_change_set: Record<Id, AgentChangeSet>;
  technique: Record<Id, Technique>;
  technique_step: Record<Id, TechniqueStep>;
  technique_experience: Record<Id, TechniqueExperience>;
  recipe: Record<Id, Recipe>;
  recipe_paint: Record<Id, RecipePaint>;
  recipe_step: Record<Id, RecipeStep>;
}

// ---------- Agentens direkte endringer (PROTOTYPE, brukerbeslutning 10.11.2026) ----------

/** One row change: `before`/`after` are the whole row, or null when it did not exist. */
export interface RowPatch {
  table: string;
  /** Row id for keyed tables; the row's JSON for list tables (composite keys). */
  key: string;
  before: unknown;
  after: unknown;
}

/** Everything the agent changed directly in one turn; can be undone as a unit. */
export interface AgentChangeSet {
  id: Id;
  task_id: Id;
  created_at: Timestamp;
  /** Short lines describing the changes (Norwegian). */
  summary: string[];
  proposal_ids: Id[];
  patches: RowPatch[];
  undone_at: Timestamp | null;
}

// ---------- Research og handlingsrom (skjema §6, §7) ----------

export type AreaKind = 'new_project' | 'new_knowledge' | 'revision_only';

export type ResultType =
  | 'game_identity' | 'catalog_subject' | 'palette_entry' | 'project_method'
  | 'reference_selection' | 'paint_plan' | 'recipe' | 'technique' | 'plan_revision'
  /** PROTOTYPE: changes to existing miniatures in the work project (update, split, merge, delete). */
  | 'catalog_change';

export interface ResearchTask {
  id: Id;
  workspace_id: Id;
  status: 'open' | 'closed';
  created_at: Timestamp;
}

/** Keyed by task_id. The agent has no write path to this row. */
/**
 * PROTOTYPE (brukerbeslutning 11.11.2026): which paints the agent may use. The user
 * chooses this actively; the agent never prefers owned paints on its own.
 * both = two drafts, one with paints you own and one with the best paints.
 */
export type PaintChoice = 'both' | 'owned' | 'best';

export interface TaskScope {
  task_id: Id;
  area_kind: AreaKind;
  work_project_id: Id | null;
  allow_new_knowledge: boolean;
  /** PROTOTYPE: the user's paint choice for recipe research (library tasks). */
  paint_choice?: PaintChoice | null;
  /** PROTOTYPE: «Fra bilde» research: the pictures the user posted (stored_file ids, 1–4). */
  image_file_ids?: Id[];
  /**
   * PROTOTYPE: set for the workspace's own task for one miniature and one kind of run
   * (image hunt or paint plan), so those runs never share a conversation with the
   * project's agent panel or with each other. Absent or null: the panel's task.
   */
  subject_focus?: SubjectFocus | null;
}

export interface SubjectFocus {
  subject_id: Id;
  kind: 'images' | 'plan';
}

export interface TaskResultType {
  task_id: Id;
  result_type: ResultType;
}

export interface TaskRevisionTarget {
  id: Id;
  task_id: Id;
  /** PROTOTYPE (bit 7.6): 'technique' for an improvement of a technique in the library. */
  target_type: 'paint_plan' | 'technique';
  /** For paint_plan: the subject whose plan is opened for revision. For technique: the technique. */
  target_id: Id;
  /** For technique: technique.updated_at when the task was opened (the library has no versions). */
  base_version_id: Id;
  opened_at: Timestamp;
}

export interface ResearchMessage {
  id: Id;
  task_id: Id;
  role: 'user' | 'assistant' | 'system';
  body: string;
  created_at: Timestamp;
  /** PROTOTYPE: which model answered (skjema stores provider/model on proposals only). */
  model_id?: string | null;
  /** PROTOTYPE: the searches and pages behind an answer, shown as «Slik fant agenten dette». */
  trace?: { action: 'search' | 'open' | 'look' | 'anchor' | 'image_search'; target: string; result: string }[];
}

export type Evidence = 'documented' | 'synthesized' | 'unresolved';

export interface Uncertainty {
  path: string;
  reason: string;
}

export interface ResearchProposal {
  id: Id;
  task_id: Id;
  result_type: ResultType;
  payload: unknown;
  evidence: Evidence;
  uncertainty: Uncertainty[];
  decision: 'pending' | 'approved' | 'rejected';
  base_version_id: Id | null;
  provider: string;
  model_id: string;
  created_at: Timestamp;
  updated_at: Timestamp;
  /** PROTOTYPE: short label shown to the agent so it can refer to its own drafts. */
  ref: string;
  /** PROTOTYPE: why approval failed last time, shown on the card. */
  last_error?: string | null;
  /** PROTOTYPE: set when the change was applied directly by the agent (open zone), as part of this change set. */
  change_set_id?: Id | null;
  /** PROTOTYPE (bit 7.4): the technique or recipe created when a library draft was approved. */
  applied_target_id?: Id | null;
}

export interface ContextRef {
  id: Id;
  task_id: Id;
  target_type: 'project' | 'paint_plan';
  target_id: Id;
  /** Version id for plans, content_revision for the project. */
  revision: string;
  captured_at: Timestamp;
}

export const SCHEMA_VERSION = 5;
