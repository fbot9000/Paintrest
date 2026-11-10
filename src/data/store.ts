/**
 * Local store: the stand-in for the application layer + PostgreSQL in v0.
 *
 * Every command runs inside `transaction()`. The callback works on a deep copy
 * of all tables; if it throws, nothing is kept (like a rolled-back transaction).
 * On success the copy replaces the current state, is persisted, and subscribers
 * are notified.
 */
import type { Id, RowPatch, Tables } from '../domain/types';
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
    source_layer: {},
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
    agent_change_set: {},
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
  if (state.schema_version === 2) {
    // v3: source_layer (original text and translation of a source).
    state = { ...state, schema_version: 3, tables: { ...emptyTables(), ...state.tables } };
  }
  if (state.schema_version === 3) {
    // v4: agent_change_set (direct agent changes with undo).
    state = { ...state, schema_version: 4, tables: { ...emptyTables(), ...state.tables } };
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

  /**
   * Like transaction(), and also returns the row-level changes it made to the
   * tracked tables, so they can be undone later (see diffTables).
   */
  transactionWithDiff<T>(fn: (t: Tables, workspaceId: Id) => T): { result: T; patches: RowPatch[] } {
    const before = this.state.tables;
    const result = this.transaction(fn);
    return { result, patches: diffTables(before, this.state.tables) };
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

/** Tables whose changes are undoable content. Logs and research records are kept as history. */
const UNTRACKED = new Set<keyof Tables>(['change_record', 'research_task', 'task_scope', 'task_result_type', 'task_revision_target',
  'research_message', 'research_proposal', 'context_ref', 'agent_change_set']);

export function diffTables(a: Tables, b: Tables): RowPatch[] {
  const out: RowPatch[] = [];
  for (const table of Object.keys(b) as (keyof Tables)[]) {
    if (UNTRACKED.has(table) || a[table] === b[table]) continue;
    const before = a[table] as unknown;
    const after = b[table] as unknown;
    if (Array.isArray(after)) {
      const count = (rows: unknown[]) => {
        const m = new Map<string, number>();
        for (const r of rows) { const k = JSON.stringify(r); m.set(k, (m.get(k) ?? 0) + 1); }
        return m;
      };
      const ma = count((before as unknown[]) ?? []);
      const mb = count(after);
      for (const [k, n] of mb) for (let i = (ma.get(k) ?? 0); i < n; i++) out.push({ table, key: k, before: null, after: JSON.parse(k) });
      for (const [k, n] of ma) for (let i = (mb.get(k) ?? 0); i < n; i++) out.push({ table, key: k, before: JSON.parse(k), after: null });
    } else {
      const ra = (before ?? {}) as Record<string, unknown>;
      const rb = after as Record<string, unknown>;
      for (const key of new Set([...Object.keys(ra), ...Object.keys(rb)])) {
        if (ra[key] === rb[key]) continue;
        if (JSON.stringify(ra[key]) === JSON.stringify(rb[key])) continue;
        out.push({ table, key, before: ra[key] ?? null, after: rb[key] ?? null });
      }
    }
  }
  return out;
}

/**
 * Reverts patches (newest first) on a draft. Refuses when a row no longer
 * looks like it did after the change: the user (or a later turn) changed it.
 * Returns the conflicting rows instead of overwriting them.
 */
export function revertPatches(t: Tables, patches: RowPatch[]): { conflicts: RowPatch[] } {
  const same = (x: unknown, y: unknown) => JSON.stringify(x ?? null) === JSON.stringify(y ?? null);
  const conflicts = patches.filter((p) => {
    const table = t[p.table as keyof Tables] as unknown;
    if (Array.isArray(table)) {
      const present = table.some((r) => JSON.stringify(r) === p.key);
      return p.after !== null ? !present : false;
    }
    return !same((table as Record<string, unknown>)[p.key], p.after);
  });
  if (conflicts.length) return { conflicts };
  for (const p of [...patches].reverse()) {
    const table = t[p.table as keyof Tables] as unknown;
    if (Array.isArray(table)) {
      if (p.after !== null) {
        const i = table.findIndex((r) => JSON.stringify(r) === p.key);
        if (i >= 0) table.splice(i, 1);
      }
      if (p.before !== null) table.push(structuredClone(p.before));
    } else {
      const rec = table as Record<string, unknown>;
      if (p.before === null) delete rec[p.key];
      else rec[p.key] = structuredClone(p.before);
    }
  }
  return { conflicts: [] };
}
