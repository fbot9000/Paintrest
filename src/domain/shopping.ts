/**
 * Handlelisten (O-14, brukerbeslutning 24.11.2026): one row per paint.
 *
 * - Paints you do not own (or do not know if you own) that the current, approved
 *   plan of a miniature uses are on the list as «nødvendig». Nothing is stored for
 *   them; they leave the list when you own the paint or no plan uses it any more.
 *   Miniatures that are painted, and hidden miniatures and projects, do not count.
 * - Paints you add yourself are stored as shopping_need (origin `manual`) and stay
 *   until you buy them or remove them.
 * - Changing the priority of a paint from the plans stores a shopping_need with
 *   origin `plan`. It only shows while the plans still need the paint.
 */
import type { Id, Ownership, PaintProduct, ShoppingNeed, ShoppingPriority, Tables } from './types';
import { ownershipOf, physicalStatus } from './views';

export const SHOPPING_PRIORITIES: ShoppingPriority[] = ['necessary', 'recommended', 'wishlist'];

export const PRIORITY_LABEL: Record<ShoppingPriority, string> = {
  necessary: 'Nødvendig', recommended: 'Anbefalt', wishlist: 'Ønskeliste',
};

export interface ShoppingProject { id: Id; name: string }

export interface ShoppingRow {
  product: PaintProduct;
  ownership: Ownership;
  priority: ShoppingPriority;
  need: ShoppingNeed | null;
  /** You added it yourself. */
  manual: boolean;
  /** Miniatures whose current plan uses the paint: «Merlin (Avalon)». */
  plans: { subject_id: Id; name: string; project_id: Id }[];
  /** Projects from the plans and the ones you chose, sorted by name. */
  projects: ShoppingProject[];
}

export function projectName(t: Tables, project_id: Id): string {
  const p = t.project[project_id];
  return (p && t.game[p.game_id]?.primary_name) || 'Prosjekt uten navn';
}

/** Paint id → the miniatures whose current, approved plan uses it (not painted, not hidden). */
export function planNeeds(t: Tables): Map<Id, ShoppingRow['plans']> {
  const versionOf = new Map<Id, { subject_id: Id; name: string; project_id: Id }>();
  for (const s of Object.values(t.miniature_subject)) {
    if (s.deleted_at || !s.current_plan_version_id) continue;
    const v = t.paint_plan_version[s.current_plan_version_id];
    if (!v || v.state !== 'approved') continue;
    const p = t.project[s.project_id];
    if (!p || p.deleted_at) continue;
    if (physicalStatus(t, s) === 'finished') continue;
    versionOf.set(v.id, { subject_id: s.id, name: s.name, project_id: s.project_id });
  }
  const out = new Map<Id, ShoppingRow['plans']>();
  const add = (step_id: Id, product_id: Id) => {
    const step = t.plan_step[step_id];
    const el = step ? t.plan_element[step.element_id] : undefined;
    const who = el ? versionOf.get(el.plan_version_id) : undefined;
    if (!who) return;
    const list = out.get(product_id) ?? [];
    if (!list.some((x) => x.subject_id === who.subject_id)) list.push(who);
    out.set(product_id, list);
  };
  for (const m of Object.values(t.step_material)) add(m.step_id, m.product_id);
  for (const c of t.mix_component) {
    const g = t.mix_group[c.mix_group_id];
    if (g) add(g.step_id, c.product_id);
  }
  return out;
}

export function needOf(t: Tables, product_id: Id): ShoppingNeed | undefined {
  return Object.values(t.shopping_need).find((n) => n.product_id === product_id);
}

/** The whole list, or the rows for one project. Sorted by priority, then maker, range and name. */
export function shoppingList(t: Tables, filter: { project_id?: Id | null } = {}): ShoppingRow[] {
  const fromPlans = planNeeds(t);
  const needs = new Map(Object.values(t.shopping_need).map((n) => [n.product_id, n]));
  const ids = new Set<Id>([...fromPlans.keys(), ...[...needs.values()].filter((n) => n.origin === 'manual').map((n) => n.product_id)]);
  const rows: ShoppingRow[] = [];
  for (const id of ids) {
    const product = t.paint_product[id];
    if (!product || product.deleted_at) continue;
    const ownership = ownershipOf(t, id);
    const need = needs.get(id) ?? null;
    const manual = need?.origin === 'manual';
    // A paint you own leaves the plan part of the list; one you added yourself stays until you buy it.
    if (!manual && ownership === 'owns') continue;
    const plans = ownership === 'owns' ? [] : (fromPlans.get(id) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name, 'nb'));
    const projectIds = new Set<Id>(plans.map((p) => p.project_id));
    if (need) {
      for (const l of t.shopping_need_project) {
        if (l.need_id === need.id && t.project[l.project_id] && !t.project[l.project_id]!.deleted_at) projectIds.add(l.project_id);
      }
    }
    const projects = [...projectIds].map((pid) => ({ id: pid, name: projectName(t, pid) })).sort((a, b) => a.name.localeCompare(b.name, 'nb'));
    rows.push({ product, ownership, priority: need?.priority ?? 'necessary', need, manual, plans, projects });
  }
  const order = (r: ShoppingRow) => SHOPPING_PRIORITIES.indexOf(r.priority);
  return rows
    .filter((r) => !filter.project_id || r.projects.some((p) => p.id === filter.project_id))
    .sort((a, b) => order(a) - order(b)
      || (a.product.manufacturer ?? '￿').localeCompare(b.product.manufacturer ?? '￿', 'nb')
      || (a.product.range_name ?? '').localeCompare(b.product.range_name ?? '', 'nb')
      || a.product.name.localeCompare(b.product.name, 'nb'));
}

/** Projects that have rows on the list, with how many, for the filter. */
export function shoppingProjects(rows: ShoppingRow[]): (ShoppingProject & { count: number })[] {
  const m = new Map<Id, ShoppingProject & { count: number }>();
  for (const r of rows) for (const p of r.projects) {
    const e = m.get(p.id) ?? { ...p, count: 0 };
    e.count++;
    m.set(p.id, e);
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, 'nb'));
}
