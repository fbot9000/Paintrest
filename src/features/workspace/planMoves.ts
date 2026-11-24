/**
 * O-19: moving parts and steps in a plan draft, and putting a paint into a step. Pure functions
 * over the draft; dragging, the arrows and «tap a paint, then a step» all use them.
 */
import type { PaintPlanPayload } from '../../domain/agent';
import { refOf } from '../../domain/plan-versions';
import type { MaterialRole, PaintProduct } from '../../domain/types';

/** Moves part `from` so it ends up just before the part that is now at `to` (`to` = length: last). */
export function moveElement(p: PaintPlanPayload, from: number, to: number): PaintPlanPayload {
  if (from === to || from + 1 === to || !p.elements[from]) return p;
  const elements = [...p.elements];
  const [x] = elements.splice(from, 1);
  elements.splice(to > from ? to - 1 : to, 0, x!);
  return { ...p, elements };
}

/** Moves a step to just before step `to.s` of part `to.e` (`to.s` = its length: last in that part). */
export function moveStep(p: PaintPlanPayload, from: { e: number; s: number }, to: { e: number; s: number }): PaintPlanPayload {
  const src = p.elements[from.e];
  if (!src?.steps[from.s] || !p.elements[to.e]) return p;
  if (from.e === to.e && (from.s === to.s || from.s + 1 === to.s)) return p;
  const elements = p.elements.map((e) => ({ ...e, steps: [...e.steps] }));
  const [step] = elements[from.e]!.steps.splice(from.s, 1);
  const at = from.e === to.e && to.s > from.s ? to.s - 1 : to.s;
  elements[to.e]!.steps.splice(at, 0, step!);
  return { ...p, elements };
}

/** A palette role in free text («kappe – skygge») to the step's role, when it says which. */
export function roleFromLabel(label: string | null | undefined): MaterialRole {
  const l = (label ?? '').toLowerCase();
  const pairs: [RegExp, MaterialRole][] = [
    [/høylys|highlight/, 'highlight'], [/skygge|shade/, 'shade'], [/wash/, 'wash'], [/glasur|glaze/, 'glaze'],
    [/\blag\b|layer/, 'layer'], [/base|grunn/, 'base'], [/blanding|mix/, 'mix'],
  ];
  return pairs.find(([re]) => re.test(l))?.[1] ?? 'other';
}

/** Puts a paint in a step, unless it is there already. */
export function addPaint(p: PaintPlanPayload, e: number, s: number, product: PaintProduct, role_label: string | null): PaintPlanPayload {
  const step = p.elements[e]?.steps[s];
  if (!step || step.materials.some((m) => m.product.product_id === product.id)) return p;
  const elements = p.elements.map((el, ei) => ei !== e ? el : {
    ...el,
    steps: el.steps.map((st, si) => si !== s ? st : {
      ...st, materials: [...st.materials, { product: refOf(product), role: roleFromLabel(role_label), role_label: null }],
    }),
  });
  return { ...p, elements };
}
