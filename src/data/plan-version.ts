/**
 * Writes a new approved plan version, from the user's edit or from an agent proposal
 * (O-1, beslutning 24.11.2026). The earlier version becomes superseded; its parts,
 * steps and paints are not changed. Open deviations are either baked into the new
 * version (closed as «baked») or copied to it (closed as «carried» on the earlier
 * version). Ticks and group counts follow for the parts found in both versions.
 * Sealed deviations and paint_completion are not touched.
 */
import { CommandError } from '../domain/commands';
import { newId, now } from '../domain/ids';
import { productKey } from '../domain/agent';
import type { PaintPlanPayload } from '../domain/agent';
import { matchVersion, openDeviations, versionElements } from '../domain/plan-versions';
import type { ChangeAction, Id, MiniatureSubject, Tables, VersionOrigin } from '../domain/types';

export type RecordFn = (target_type: string, target_id: Id, action: ChangeAction, from?: Id | null, to?: Id | null) => void;

export interface WritePlanInput {
  subject: MiniatureSubject;
  payload: PaintPlanPayload;
  /** productKey → product id, for every product the payload names. */
  products: Record<string, Id>;
  origin: VersionOrigin;
  /** Open deviations on the current version that the user made part of the new one. */
  baked: Id[];
  record: RecordFn;
}

export function writePlanVersion(t: Tables, { subject: s, payload: plan, products, origin, baked, record }: WritePlanInput): Id {
  const prev = s.current_plan_version_id ? t.paint_plan_version[s.current_plan_version_id] : undefined;
  const open = prev ? openDeviations(t, prev.id) : [];
  const unknown = baked.filter((id) => !open.some((d) => d.id === id));
  if (unknown.length) throw new CommandError('Et av avvikene du valgte, er ikke åpent på gjeldende versjon lenger');

  // Matched against the earlier version before anything is written.
  const match = matchVersion(t, prev?.id ?? null, plan);

  const version_number = Math.max(0, ...Object.values(t.paint_plan_version).filter((v) => v.subject_id === s.id).map((v) => v.version_number)) + 1;
  const pv = newId();
  t.paint_plan_version[pv] = {
    id: pv, subject_id: s.id, version_number, state: 'approved', origin,
    supersedes_id: prev?.id ?? null, created_at: now(), summary: plan.summary ?? null,
  };
  const elementMap = new Map<Id, Id>();
  const stepMap = new Map<Id, Id>();
  plan.elements.forEach((el, ei) => {
    const eid = newId();
    t.plan_element[eid] = { id: eid, plan_version_id: pv, kind: el.kind, position: ei, name: el.name };
    const oldEl = match.elements[ei];
    if (oldEl) elementMap.set(oldEl, eid);
    el.steps.forEach((st, si) => {
      const sid = newId();
      t.plan_step[sid] = { id: sid, element_id: eid, position: si, instruction: st.instruction, technique_version_id: null, recipe_version_id: null };
      const oldStep = match.steps[ei]![si];
      if (oldStep) stepMap.set(oldStep, sid);
      st.materials.forEach((m, mi) => {
        const product_id = products[productKey(m.product)];
        if (!product_id) throw new CommandError(`Velg eller opprett produkt for: ${m.product.name}`);
        const mid = newId();
        t.step_material[mid] = { id: mid, step_id: sid, position: mi, product_id, role: m.role, role_label: m.role_label };
      });
      if (st.mix) {
        const gid = newId();
        t.mix_group[gid] = { id: gid, step_id: sid, label: st.mix.label };
        st.mix.components.forEach((c, ci) => {
          const product_id = products[productKey(c.product)];
          if (!product_id) throw new CommandError(`Velg eller opprett produkt for: ${c.product.name}`);
          t.mix_component.push({ mix_group_id: gid, position: ci, product_id, parts: c.parts });
        });
      }
    });
  });

  if (prev) {
    for (const d of open) {
      if (baked.includes(d.id)) {
        d.closed_in_version_id = pv;
        d.closed_as = 'baked';
        record('local_deviation', d.id, 'update', prev.id, pv);
        continue;
      }
      // Copied, so the earlier version keeps what was open when it was replaced.
      const element_id = d.element_id ? elementMap.get(d.element_id) ?? null : null;
      const step_id = element_id && d.step_id ? stepMap.get(d.step_id) ?? null : null;
      const id = newId();
      t.local_deviation[id] = {
        id, plan_version_id: pv, element_id, step_id,
        kind: d.kind, payload: structuredClone(d.payload),
        created_at: d.created_at, sealed_at: null, carried_from_id: d.id,
      };
      d.closed_in_version_id = pv;
      d.closed_as = 'carried';
      record('local_deviation', id, 'deviation', prev.id, pv);
    }

    // Ticks (part_progress) are per part id, so the new parts get their own rows.
    for (const oldEl of versionElements(t, prev.id)) {
      const newEl = elementMap.get(oldEl.id);
      if (!newEl) continue;
      const p = t.part_progress.find((x) => x.subject_id === s.id && x.element_id === oldEl.id);
      if (p && (p.done || p.last_opened_at)) t.part_progress.push({ subject_id: s.id, element_id: newEl, done: p.done, last_opened_at: p.last_opened_at });
      const g = Object.values(t.group_progress).find((x) => x.subject_id === s.id && x.plan_version_id === prev.id && x.element_id === oldEl.id);
      if (g && g.count > 0) {
        const id = newId();
        t.group_progress[id] = { id, subject_id: s.id, plan_version_id: pv, element_id: newEl, count: g.count };
      }
    }
    prev.state = 'superseded';
  }
  s.current_plan_version_id = pv;
  s.plan_state = 'approved';
  record('paint_plan', s.id, 'new_version', prev?.id ?? null, pv);
  return pv;
}
