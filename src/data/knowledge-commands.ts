/**
 * The library (bit 7): techniques and recipes, edited directly by the user.
 * PROTOTYPE (brukerbeslutning 11.11.2026): no versions and no lock. «Godkjent»
 * is a label. Every command is one transaction and writes change_record.
 * See docs/BIT7-KUNNSKAP.md.
 */
import type {
  KnowledgeCommands, RecipePatch, RecipePaintInput, RecipeStepInput, TechniquePatch, TechniqueStepInput,
} from '../domain/commands';
import { CommandError } from '../domain/commands';
import { newId, now } from '../domain/ids';
import { AUTO, nextAutoName } from '../domain/naming';
import type {
  Evidence, Id, KnowledgeStatus, MaterialRole, Recipe, StepBasis, Tables, Technique, Uncertainty,
} from '../domain/types';
import type { Store } from './store';
import { must, record } from './tx-helpers';

const EVIDENCE: readonly Evidence[] = ['documented', 'synthesized', 'unresolved'];
const STATUS: readonly KnowledgeStatus[] = ['draft', 'approved'];
const BASIS: readonly StepBasis[] = ['documented', 'synthesized'];
const ROLES: readonly MaterialRole[] = ['base', 'shade', 'layer', 'highlight', 'wash', 'glaze', 'mix', 'other'];

/** Trimmed, single spaces, no empties, unique regardless of case (first spelling wins). */
export function cleanTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = String(raw).trim().replace(/\s+/g, ' ');
    const key = tag.toLocaleLowerCase('nb');
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

function cleanList(items: string[]): string[] {
  return items.map((s) => String(s).trim()).filter(Boolean);
}

function text(s: string | null | undefined): string | null {
  return s?.trim() || null;
}

function name(s: string): string {
  const n = s.trim();
  if (!n) throw new CommandError('Navnet kan ikke være tomt');
  return n;
}

function evidence(e: Evidence | null): Evidence | null {
  if (e !== null && !EVIDENCE.includes(e)) throw new CommandError('Ukjent kildegrunnlag');
  return e;
}

function status(s: KnowledgeStatus): KnowledgeStatus {
  if (!STATUS.includes(s)) throw new CommandError('Ukjent status');
  return s;
}

function uncertainty(u: Uncertainty[]): Uncertainty[] {
  return u.map((x) => ({ path: String(x.path ?? ''), reason: String(x.reason ?? '').trim() })).filter((x) => x.reason);
}

function liveTechnique(t: Tables, id: Id): Technique {
  const row = must(t.technique[id], 'Teknikken');
  if (row.deleted_at) throw new CommandError('Teknikken er slettet');
  return row;
}

function liveRecipe(t: Tables, id: Id): Recipe {
  const row = must(t.recipe[id], 'Oppskriften');
  if (row.deleted_at) throw new CommandError('Oppskriften er slettet');
  return row;
}

function applyTechniquePatch(row: Technique, p: TechniquePatch): void {
  if (p.name !== undefined) row.name = name(p.name);
  if (p.tags !== undefined) row.tags = cleanTags(p.tags);
  if (p.desired_result !== undefined) row.desired_result = text(p.desired_result);
  if (p.use_area !== undefined) row.use_area = text(p.use_area);
  if (p.materials !== undefined) row.materials = cleanList(p.materials);
  if (p.variants !== undefined) row.variants = text(p.variants);
  if (p.risk_note !== undefined) row.risk_note = text(p.risk_note);
  if (p.evidence !== undefined) row.evidence = evidence(p.evidence);
  if (p.uncertainty !== undefined) row.uncertainty = uncertainty(p.uncertainty);
}

function applyRecipePatch(row: Recipe, p: RecipePatch): void {
  if (p.name !== undefined) row.name = name(p.name);
  if (p.tags !== undefined) row.tags = cleanTags(p.tags);
  if (p.effect !== undefined) row.effect = text(p.effect);
  if (p.note !== undefined) row.note = text(p.note);
  if (p.evidence !== undefined) row.evidence = evidence(p.evidence);
  if (p.uncertainty !== undefined) row.uncertainty = uncertainty(p.uncertainty);
}

/** Checks that every given id is a row of this parent and appears once. */
function checkOwnIds(ids: (Id | undefined)[], owns: (id: Id) => boolean, what: string): void {
  const seen = new Set<Id>();
  for (const id of ids) {
    if (id === undefined) continue;
    if (!owns(id)) throw new CommandError(`${what} hører ikke til her`);
    if (seen.has(id)) throw new CommandError(`${what} står to ganger`);
    seen.add(id);
  }
}

export function createKnowledgeCommands(store: Store): KnowledgeCommands {
  const tx = store.transaction.bind(store);

  return {
    // ---------- Teknikker ----------
    async createTechnique(input) {
      return tx((t, ws) => {
        const taken = Object.values(t.technique).filter((x) => !x.deleted_at).map((x) => x.name);
        const id = newId();
        const ts = now();
        const row: Technique = {
          id, workspace_id: ws, name: nextAutoName(AUTO.technique, taken), tags: [], status: 'draft',
          desired_result: null, use_area: null, materials: [], variants: null, risk_note: null,
          evidence: null, uncertainty: [], created_at: ts, updated_at: ts, deleted_at: null,
        };
        if (input) applyTechniquePatch(row, input);
        t.technique[id] = row;
        record(t, ws, { target_type: 'technique', target_id: id, action: 'create' });
        return id;
      });
    },

    async updateTechnique(technique_id, patch) {
      tx((t, ws) => {
        const row = liveTechnique(t, technique_id);
        applyTechniquePatch(row, patch);
        row.updated_at = now();
        record(t, ws, { target_type: 'technique', target_id: technique_id, action: 'update' });
      });
    },

    async setTechniqueStatus(technique_id, s) {
      tx((t, ws) => {
        const row = liveTechnique(t, technique_id);
        row.status = status(s);
        row.updated_at = now();
        record(t, ws, { target_type: 'technique', target_id: technique_id, action: 'update' });
      });
    },

    async setTechniqueSteps(technique_id, steps: TechniqueStepInput[]) {
      tx((t, ws) => {
        const row = liveTechnique(t, technique_id);
        checkOwnIds(steps.map((s) => s.id), (id) => t.technique_step[id]?.technique_id === technique_id, 'Steget');
        const keep = new Set(steps.map((s) => s.id).filter(Boolean));
        for (const s of Object.values(t.technique_step)) {
          if (s.technique_id === technique_id && !keep.has(s.id)) delete t.technique_step[s.id];
        }
        steps.forEach((s, position) => {
          if (s.basis != null && !BASIS.includes(s.basis)) throw new CommandError('Ukjent grunnlag for steget');
          const id = s.id ?? newId();
          const old = t.technique_step[id];
          t.technique_step[id] = {
            id, technique_id, position,
            title: s.title !== undefined ? s.title.trim() : old?.title ?? '',
            instruction: s.instruction !== undefined ? s.instruction.trim() : old?.instruction ?? '',
            basis: s.basis !== undefined ? s.basis : old?.basis ?? null,
          };
        });
        row.updated_at = now();
        record(t, ws, { target_type: 'technique', target_id: technique_id, action: 'update' });
      });
    },

    async deleteTechnique(technique_id) {
      tx((t, ws) => {
        const row = must(t.technique[technique_id], 'Teknikken');
        row.deleted_at = now();
        record(t, ws, { target_type: 'technique', target_id: technique_id, action: 'delete' });
      });
    },

    async restoreTechnique(technique_id) {
      tx((t, ws) => {
        const row = must(t.technique[technique_id], 'Teknikken');
        row.deleted_at = null;
        record(t, ws, { target_type: 'technique', target_id: technique_id, action: 'restore' });
      });
    },

    async recordExperience(technique_id, input) {
      return tx((t, ws) => {
        liveTechnique(t, technique_id);
        if (input.outcome !== 'worked' && input.outcome !== 'needs_adjustment') throw new CommandError('Ukjent utfall');
        const subject_id = input.subject_id ?? null;
        if (subject_id) must(t.miniature_subject[subject_id], 'Miniatyren');
        const id = newId();
        t.technique_experience[id] = {
          id, technique_id, outcome: input.outcome, note: text(input.note), subject_id,
          created_at: now(), deleted_at: null,
        };
        record(t, ws, { target_type: 'technique_experience', target_id: id, action: 'create' });
        return id;
      });
    },

    async deleteExperience(experience_id) {
      tx((t, ws) => {
        must(t.technique_experience[experience_id], 'Erfaringen').deleted_at = now();
        record(t, ws, { target_type: 'technique_experience', target_id: experience_id, action: 'delete' });
      });
    },

    // ---------- Oppskrifter ----------
    async createRecipe(input) {
      return tx((t, ws) => {
        const taken = Object.values(t.recipe).filter((x) => !x.deleted_at).map((x) => x.name);
        const id = newId();
        const ts = now();
        const row: Recipe = {
          id, workspace_id: ws, name: nextAutoName(AUTO.recipe, taken), tags: [], status: 'draft',
          effect: null, note: null, evidence: null, uncertainty: [],
          created_at: ts, updated_at: ts, deleted_at: null,
        };
        if (input) applyRecipePatch(row, input);
        t.recipe[id] = row;
        record(t, ws, { target_type: 'recipe', target_id: id, action: 'create' });
        return id;
      });
    },

    async updateRecipe(recipe_id, patch) {
      tx((t, ws) => {
        const row = liveRecipe(t, recipe_id);
        applyRecipePatch(row, patch);
        row.updated_at = now();
        record(t, ws, { target_type: 'recipe', target_id: recipe_id, action: 'update' });
      });
    },

    async setRecipeStatus(recipe_id, s) {
      tx((t, ws) => {
        const row = liveRecipe(t, recipe_id);
        row.status = status(s);
        row.updated_at = now();
        record(t, ws, { target_type: 'recipe', target_id: recipe_id, action: 'update' });
      });
    },

    async setRecipePaints(recipe_id, paints: RecipePaintInput[]) {
      tx((t, ws) => {
        const row = liveRecipe(t, recipe_id);
        checkOwnIds(paints.map((p) => p.id), (id) => t.recipe_paint[id]?.recipe_id === recipe_id, 'Malingen');
        const keep = new Set(paints.map((p) => p.id).filter(Boolean));
        const removed = new Set<Id>();
        for (const p of Object.values(t.recipe_paint)) {
          if (p.recipe_id === recipe_id && !keep.has(p.id)) { removed.add(p.id); delete t.recipe_paint[p.id]; }
        }
        paints.forEach((p, position) => {
          const id = p.id ?? newId();
          const old = t.recipe_paint[id];
          const product = must(t.paint_product[p.product_id], 'Malingen');
          // A deleted paint may stay where it already is, but cannot be added again.
          if (product.deleted_at && old?.product_id !== p.product_id) throw new CommandError('Malingen er slettet');
          const role = p.role !== undefined ? p.role : old?.role ?? null;
          if (role !== null && !ROLES.includes(role)) throw new CommandError('Ukjent rolle');
          t.recipe_paint[id] = {
            id, recipe_id, position, product_id: p.product_id, role,
            note: p.note !== undefined ? text(p.note) : old?.note ?? null,
          };
        });
        if (removed.size) {
          for (const s of Object.values(t.recipe_step)) {
            if (s.recipe_id === recipe_id) s.paint_ids = s.paint_ids.filter((id) => !removed.has(id));
          }
        }
        row.updated_at = now();
        record(t, ws, { target_type: 'recipe', target_id: recipe_id, action: 'update' });
      });
    },

    async setRecipeSteps(recipe_id, steps: RecipeStepInput[]) {
      tx((t, ws) => {
        const row = liveRecipe(t, recipe_id);
        checkOwnIds(steps.map((s) => s.id), (id) => t.recipe_step[id]?.recipe_id === recipe_id, 'Steget');
        const keep = new Set(steps.map((s) => s.id).filter(Boolean));
        for (const s of Object.values(t.recipe_step)) {
          if (s.recipe_id === recipe_id && !keep.has(s.id)) delete t.recipe_step[s.id];
        }
        steps.forEach((s, position) => {
          const id = s.id ?? newId();
          const old = t.recipe_step[id];
          const paint_ids = s.paint_ids !== undefined ? [...new Set(s.paint_ids)] : old?.paint_ids ?? [];
          for (const pid of paint_ids) {
            if (t.recipe_paint[pid]?.recipe_id !== recipe_id) throw new CommandError('Steget bruker en maling som ikke er i fargerekken');
          }
          const technique_id = s.technique_id !== undefined ? s.technique_id : old?.technique_id ?? null;
          if (technique_id && technique_id !== old?.technique_id) liveTechnique(t, technique_id);
          t.recipe_step[id] = {
            id, recipe_id, position,
            instruction: s.instruction !== undefined ? s.instruction.trim() : old?.instruction ?? '',
            paint_ids, technique_id,
          };
        });
        row.updated_at = now();
        record(t, ws, { target_type: 'recipe', target_id: recipe_id, action: 'update' });
      });
    },

    async deleteRecipe(recipe_id) {
      tx((t, ws) => {
        must(t.recipe[recipe_id], 'Oppskriften').deleted_at = now();
        record(t, ws, { target_type: 'recipe', target_id: recipe_id, action: 'delete' });
      });
    },

    async restoreRecipe(recipe_id) {
      tx((t, ws) => {
        must(t.recipe[recipe_id], 'Oppskriften').deleted_at = null;
        record(t, ws, { target_type: 'recipe', target_id: recipe_id, action: 'restore' });
      });
    },
  };
}
