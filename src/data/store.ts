/**
 * Local store: the stand-in for the application layer + PostgreSQL in v0.
 *
 * Every command runs inside `transaction()`. The callback works on a deep copy
 * of all tables; if it throws, nothing is kept (like a rolled-back transaction).
 * On success the copy replaces the current state, is persisted, and subscribers
 * are notified.
 */
import type { Tables, Id } from '../domain/types';
import { SCHEMA_VERSION } from '../domain/types';

export interface DbState {
  schema_version: number;
  workspace_id: Id;
  tables: Tables;
}

export interface Persistence {
  load(): Promise<DbState | undefined>;
  save(state: DbState): Promise<void>;
  putBlob(key: string, blob: Blob): Promise<void>;
  getBlob(key: string): Promise<Blob | undefined>;
  deleteBlob(key: string): Promise<void>;
}

export function emptyTables(): Tables {
  return {
    workspace: {},
    stored_file: {},
    paint_product: {},
    inventory_entry: [],
    game: {},
    expansion: {},
    project: {},
    project_expansion: [],
    miniature_subject: {},
    palette_entry: {},
    palette_entry_subject: [],
    paint_plan_version: {},
    plan_element: {},
    plan_step: {},
    step_material: {},
    mix_group: {},
    mix_component: [],
    plan_step_asset: [],
    local_deviation: {},
    part_progress: [],
    group_progress: {},
    paint_completion: {},
    source: {},
    source_asset: {},
    source_link: {},
    source_link_asset: [],
    change_record: {},
    research_task: {},
    task_scope: {},
    task_result_type: [],
    task_revision_target: {},
    research_message: {},
    research_proposal: {},
    context_ref: {},
  };
}

/**
 * Brings stored data up to the current schema without losing it.
 * Returns undefined when the data is unknown or newer than this app.
 */
export function migrate(s: DbState | undefined): DbState | undefined {
  if (!s || typeof s.schema_version !== 'number' || s.schema_version > SCHEMA_VERSION) return undefined;
  let state = s;
  if (state.schema_version === 1) {
    // v2: research tables (agent). New tables start empty.
    state = { ...state, schema_version: 2, tables: { ...emptyTables(), ...state.tables } };
  }
  return state.schema_version === SCHEMA_VERSION ? state : undefined;
}

export class Store {
  private state: DbState;
  private listeners = new Set<() => void>();
  private saving: Promise<void> = Promise.resolve();

  constructor(initial: DbState, readonly persistence: Persistence) {
    this.state = initial;
  }

  get snapshot(): DbState {
    return this.state;
  }

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getTables = (): Tables => this.state.tables;

  transaction<T>(fn: (t: Tables, workspaceId: Id) => T): T {
    const draft = structuredClone(this.state.tables);
    const result = fn(draft, this.state.workspace_id);
    this.state = { ...this.state, tables: draft };
    const toSave = this.state;
    this.saving = this.saving
      .then(() => this.persistence.save(toSave))
      .catch((err) => console.error('Kunne ikke lagre lokalt', err));
    this.listeners.forEach((l) => l());
    return result;
  }

  /** Resolves when all queued writes have reached persistence. */
  flush(): Promise<void> {
    return this.saving;
  }

  replace(state: DbState): void {
    this.state = state;
    this.saving = this.saving.then(() => this.persistence.save(state));
    this.listeners.forEach((l) => l());
  }
}

export function isCurrentSchema(s: DbState | undefined): s is DbState {
  return !!s && s.schema_version === SCHEMA_VERSION;
}
