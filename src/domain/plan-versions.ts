/**
 * Plan versions (O-1, beslutning 24.11.2026 «Ny planversjon: avvikene kan bakes inn,
 * og fremdriften følger med»).
 *
 * A new version gets new ids for its parts and steps. This module says which part
 * and step of the new version is the «same» as one in the version it replaces, so
 * open deviations, ticks and group counts can follow. See docs/ARKITEKTUR.md
 * «Maleplan: nye versjoner».
 */
import type { PaintPlanPayload, PlanElementPayload, PlanStepPayload, ProductRef } from './agent';
import type { Id, LocalDeviation, PaintProduct, PlanElement, PlanStep, Tables } from './types';

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position;
const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export function refOf(p: PaintProduct): ProductRef {
  return { manufacturer: p.manufacturer, range: p.range_name, name: p.name, hex: p.swatch_hex, product_id: p.id };
}

export function versionElements(t: Tables, version_id: Id): PlanElement[] {
  return Object.values(t.plan_element).filter((e) => e.plan_version_id === version_id).sort(byPosition);
}

export function elementSteps(t: Tables, element_id: Id): PlanStep[] {
  return Object.values(t.plan_step).filter((s) => s.element_id === element_id).sort(byPosition);
}

/** Open (not sealed, not closed) deviations on a plan version, oldest first. */
export function openDeviations(t: Tables, version_id: Id): LocalDeviation[] {
  return Object.values(t.local_deviation)
    .filter((d) => d.plan_version_id === version_id && !d.sealed_at && !d.closed_in_version_id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

/**
 * The approved version as an editable payload. Parts and steps remember where they
 * came from (`from_element_id`, `from_step_id`), and paints name the exact product.
 */
export function payloadFromVersion(t: Tables, version_id: Id): PaintPlanPayload {
  const v = t.paint_plan_version[version_id];
  if (!v) throw new Error('Planversjonen finnes ikke');
  const ref = (id: Id): ProductRef => {
    const p = t.paint_product[id];
    return p ? refOf(p) : { manufacturer: null, range: null, name: '?', product_id: id };
  };
  return {
    subject_id: v.subject_id,
    summary: v.summary ?? null,
    note: null,
    elements: versionElements(t, version_id).map((e): PlanElementPayload => ({
      kind: e.kind, name: e.name, from_element_id: e.id,
      steps: elementSteps(t, e.id).map((s): PlanStepPayload => {
        const mg = Object.values(t.mix_group).find((g) => g.step_id === s.id);
        return {
          instruction: s.instruction, from_step_id: s.id,
          materials: Object.values(t.step_material).filter((m) => m.step_id === s.id).sort(byPosition)
            .map((m) => ({ product: ref(m.product_id), role: m.role, role_label: m.role_label })),
          mix: mg
            ? { label: mg.label, components: t.mix_component.filter((c) => c.mix_group_id === mg.id).sort(byPosition).map((c) => ({ product: ref(c.product_id), parts: c.parts })) }
            : null,
        };
      }),
    })),
  };
}

/** Drops empty steps and parts, and gives unnamed parts a name. Throws when nothing is left. */
export function cleanPlanPayload(p: PaintPlanPayload): PaintPlanPayload {
  const elements = p.elements
    .map((e) => ({ ...e, name: e.name.trim() || 'Del', steps: e.steps.filter((st) => st.instruction.trim() || st.materials.length || st.mix) }))
    .filter((e) => e.steps.length);
  if (!elements.length) throw new Error('Planen må ha minst ett steg');
  return { ...p, elements };
}

export interface VersionMatch {
  /** For each part in the payload (by index): the part in the earlier version, or null. */
  elements: (Id | null)[];
  /** For each step in the payload ([part][step]): the step in the earlier version, or null. */
  steps: (Id | null)[][];
}

/**
 * Which parts and steps of a new version are the same as in the earlier one.
 *
 * A part: first the part it was edited from (`from_element_id`), else the only unused
 * part of the same kind with the same name (case and spaces ignored).
 * A step, inside a matched part: first the step it was edited from (`from_step_id`),
 * else the first unused step with the same instruction text. Steps are not matched
 * by position, because a moved or rewritten step would take the wrong deviations along.
 */
export function matchVersion(t: Tables, prev_version_id: Id | null, p: PaintPlanPayload): VersionMatch {
  const prev = prev_version_id ? versionElements(t, prev_version_id) : [];
  const used = new Set<Id>();
  const elements = p.elements.map((el) => {
    const byId = el.from_element_id ? prev.find((e) => e.id === el.from_element_id && !used.has(e.id)) : undefined;
    const sameName = byId ? [] : prev.filter((e) => !used.has(e.id) && e.kind === el.kind && norm(e.name) === norm(el.name));
    const hit = byId ?? (sameName.length === 1 ? sameName[0] : undefined);
    if (hit) used.add(hit.id);
    return hit?.id ?? null;
  });
  const steps = p.elements.map((el, ei) => {
    const old = elements[ei];
    if (!old) return el.steps.map(() => null);
    const prevSteps = elementSteps(t, old);
    const usedSteps = new Set<Id>();
    return el.steps.map((st) => {
      const byId = st.from_step_id ? prevSteps.find((s) => s.id === st.from_step_id && !usedSteps.has(s.id)) : undefined;
      const hit = byId ?? (st.instruction.trim() ? prevSteps.find((s) => !usedSteps.has(s.id) && norm(s.instruction) === norm(st.instruction)) : undefined);
      if (hit) usedSteps.add(hit.id);
      return hit?.id ?? null;
    });
  });
  return { elements, steps };
}

/** Where a deviation on the earlier version lands in the payload. */
export function locateDeviation(m: VersionMatch, d: LocalDeviation): { element: number | null; step: number | null } {
  const element = d.element_id ? m.elements.indexOf(d.element_id) : -1;
  if (element < 0) return { element: null, step: null };
  const step = d.step_id ? m.steps[element]!.indexOf(d.step_id) : -1;
  return { element, step: step < 0 ? null : step };
}

export interface BakeResult {
  payload: PaintPlanPayload;
  /** False when the part or step is not in the payload, so nothing could be written in. */
  applied: boolean;
}

/**
 * Writes a deviation into the plan: a swapped paint replaces the paint in the step
 * (or in the whole part, for a deviation on the part), a changed instruction replaces
 * the step's text, an extra step is added after the step (or last in the part), and a
 * note is added to the end of the step's text.
 */
export function bakeDeviation(t: Tables, prev_version_id: Id, payload: PaintPlanPayload, d: LocalDeviation): BakeResult {
  const next = structuredClone(payload);
  const where = locateDeviation(matchVersion(t, prev_version_id, next), d);
  if (where.element === null) return { payload, applied: false };
  const el = next.elements[where.element]!;
  const step = where.step !== null ? el.steps[where.step]! : null;
  const text = d.payload.text?.trim() ?? '';

  if (d.kind === 'swap_product') {
    const from = d.payload.from_product_id ? t.paint_product[d.payload.from_product_id] : undefined;
    const to = d.payload.to_product_id ? t.paint_product[d.payload.to_product_id] : undefined;
    if (!to) return { payload, applied: false };
    const isFrom = (r: ProductRef) => !!from && (r.product_id ? r.product_id === from.id : norm(r.name) === norm(from.name));
    let hits = 0;
    for (const st of step ? [step] : el.steps) {
      for (const m of st.materials) if (isFrom(m.product)) { m.product = refOf(to); hits++; }
      for (const c of st.mix?.components ?? []) if (isFrom(c.product)) { c.product = refOf(to); hits++; }
    }
    // The paint is not in the step (the agent may have swapped it already): make sure the new one is.
    if (!hits && step && !step.materials.some((m) => m.product.product_id === to.id || norm(m.product.name) === norm(to.name))) {
      step.materials.push({ product: refOf(to), role: 'other', role_label: null });
    }
    return { payload: next, applied: hits > 0 || !!step };
  }
  if (!text) return { payload, applied: false };
  if (d.kind === 'change_instruction') {
    if (!step) return { payload, applied: false };
    step.instruction = text;
  } else if (d.kind === 'extra_step') {
    const at = where.step !== null ? where.step + 1 : el.steps.length;
    el.steps.splice(at, 0, { instruction: text, materials: [], mix: null });
  } else {
    const target = step ?? el.steps[el.steps.length - 1];
    if (!target) return { payload, applied: false };
    target.instruction = `${target.instruction.trim()}${target.instruction.trim() ? ' ' : ''}Merknad: ${text}`;
  }
  return { payload: next, applied: true };
}

const KIND_LABEL: Record<LocalDeviation['kind'], string> = {
  swap_product: 'Byttet maling', change_instruction: 'Endret instruks', extra_step: 'Ekstra steg', note: 'Merknad',
};

/** One line for a deviation, e.g. «Byttet maling: Abaddon Black → Corax White». */
export function describeDeviation(t: Tables, d: LocalDeviation): string {
  if (d.kind === 'swap_product') {
    const from = d.payload.from_product_id ? t.paint_product[d.payload.from_product_id]?.name : null;
    const to = d.payload.to_product_id ? t.paint_product[d.payload.to_product_id]?.name : null;
    return `${KIND_LABEL[d.kind]}: ${from ?? '?'} → ${to ?? '?'}`;
  }
  return `${KIND_LABEL[d.kind]}: ${d.payload.text ?? ''}`;
}

/** Where the deviation was made in the earlier version: «Kappe, steg 2». */
export function deviationPlace(t: Tables, d: LocalDeviation): string {
  const el = d.element_id ? t.plan_element[d.element_id] : undefined;
  if (!el) return 'Hele planen';
  if (!d.step_id) return el.name;
  const i = elementSteps(t, el.id).findIndex((s) => s.id === d.step_id);
  return i >= 0 ? `${el.name}, steg ${i + 1}` : el.name;
}
