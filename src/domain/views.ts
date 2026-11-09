/**
 * Read functions (skjema §9). Pure functions over the tables; screens never
 * read raw tables directly. Rows with `deleted_at` are left out unless a
 * function says otherwise.
 */
import type {
  Expansion, Game, GroupProgress, Id, LocalDeviation, MiniatureSubject, MixComponent,
  Ownership, PaintCompletion, PaintPlanVersion, PaintProduct, PlanElement, PlanStep,
  Project, SourceAsset, Source, StepMaterial, Tables,
} from './types';

export function liveExpansionsOfGame(t: Tables, game_id: Id): Expansion[] {
  return Object.values(t.expansion)
    .filter((e) => e.game_id === game_id && !e.deleted_at)
    .sort((a, b) => a.name.localeCompare(b.name, 'nb'));
}

export function currentPlanVersion(t: Tables, subject_id: Id): PaintPlanVersion | undefined {
  const s = t.miniature_subject[subject_id];
  return s?.current_plan_version_id ? t.paint_plan_version[s.current_plan_version_id] : undefined;
}

export function ownershipOf(t: Tables, product_id: Id): Ownership {
  return t.inventory_entry.find((e) => e.product_id === product_id)?.ownership ?? 'unknown';
}

// ---------- Fremdrift ----------

export type PhysicalStatus = 'not_started' | 'in_progress' | 'finished';

/** datamodell v3 §7: «Ikke startet» = no flag, no ticks, no group counts, nothing finished. */
export function physicalStatus(t: Tables, s: MiniatureSubject): PhysicalStatus {
  if (s.finished_count >= s.physical_count) return 'finished';
  if (s.in_progress || s.finished_count > 0) return 'in_progress';
  if (t.part_progress.some((p) => p.subject_id === s.id && p.done)) return 'in_progress';
  if (Object.values(t.group_progress).some((g) => g.subject_id === s.id && g.count > 0)) return 'in_progress';
  return 'not_started';
}

export interface ProjectSummary {
  project: Project;
  game: Game;
  expansions: Expansion[];
  subject_count: number;
  physical_total: number;
  physical_finished: number;
  plans_ready: number;
  in_progress: number;
  cover_file_id: Id | null;
}

export function projectSummary(t: Tables, project_id: Id): ProjectSummary | undefined {
  const project = t.project[project_id];
  const game = project ? t.game[project.game_id] : undefined;
  if (!project || !game) return undefined;
  const subjects = liveSubjects(t, project_id);
  return {
    project,
    game,
    expansions: attachedExpansions(t, project_id),
    subject_count: subjects.length,
    physical_total: subjects.reduce((n, s) => n + s.physical_count, 0),
    physical_finished: subjects.reduce((n, s) => n + s.finished_count, 0),
    plans_ready: subjects.filter((s) => s.plan_state === 'approved').length,
    in_progress: subjects.filter((s) => physicalStatus(t, s) === 'in_progress').length,
    cover_file_id: game.cover_file_id,
  };
}

export function projectList(t: Tables): { live: ProjectSummary[]; deleted: ProjectSummary[] } {
  const all = Object.values(t.project)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((p) => projectSummary(t, p.id))
    .filter((x): x is ProjectSummary => !!x);
  return {
    live: all.filter((s) => !s.project.deleted_at),
    deleted: all.filter((s) => !!s.project.deleted_at),
  };
}

export function attachedExpansions(t: Tables, project_id: Id): Expansion[] {
  const ids = new Set(t.project_expansion.filter((pe) => pe.project_id === project_id).map((pe) => pe.expansion_id));
  return Object.values(t.expansion)
    .filter((e) => ids.has(e.id) && !e.deleted_at)
    .sort((a, b) => a.name.localeCompare(b.name, 'nb'));
}

export function liveSubjects(t: Tables, project_id: Id): MiniatureSubject[] {
  return Object.values(t.miniature_subject)
    .filter((s) => s.project_id === project_id && !s.deleted_at)
    .sort((a, b) => a.name.localeCompare(b.name, 'nb'));
}

export function deletedSubjects(t: Tables, project_id: Id): MiniatureSubject[] {
  return Object.values(t.miniature_subject).filter((s) => s.project_id === project_id && !!s.deleted_at);
}

export function assetFileId(t: Tables, asset_id: Id | null): Id | null {
  if (!asset_id) return null;
  const a = t.source_asset[asset_id];
  if (!a || a.deleted_at) return null;
  return a.file_id;
}

// ---------- Malevisning ----------

export interface MaterialView {
  material: StepMaterial;
  product: PaintProduct;
  ownership: Ownership;
  /** Set when an open deviation swaps this product. */
  swapped_to?: { product: PaintProduct; ownership: Ownership; deviation_id: Id };
}

export interface MixView {
  label: string | null;
  components: { component: MixComponent; product: PaintProduct; ownership: Ownership }[];
}

export interface StepView {
  step: PlanStep;
  materials: MaterialView[];
  mix: MixView | null;
  deviations: LocalDeviation[];
}

export interface ElementView {
  element: PlanElement;
  steps: StepView[];
  /** Deviations on the element itself (not tied to a step), e.g. an extra step. */
  deviations: LocalDeviation[];
  done: boolean;
  last_opened_at: string | null;
  group_count: number | null;
}

export interface ReferenceView {
  asset: SourceAsset;
  source: Source;
  file_id: Id | null;
  label: string;
}

export interface PaintingView {
  subject: MiniatureSubject;
  project: Project;
  game: Game;
  plan: PaintPlanVersion | null;
  elements: ElementView[];
  references: ReferenceView[];
  open_deviations: LocalDeviation[];
  completions: PaintCompletion[];
  last_opened_element_id: Id | null;
}

export function paintingView(t: Tables, subject_id: Id): PaintingView | undefined {
  const subject = t.miniature_subject[subject_id];
  const project = subject ? t.project[subject.project_id] : undefined;
  const game = project ? t.game[project.game_id] : undefined;
  if (!subject || !project || !game || subject.deleted_at) return undefined;

  const plan = currentPlanVersion(t, subject_id) ?? null;
  const open = plan
    ? Object.values(t.local_deviation)
        .filter((d) => d.plan_version_id === plan.id && !d.sealed_at)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
    : [];
  const groupRows: GroupProgress[] = plan
    ? Object.values(t.group_progress).filter((g) => g.subject_id === subject_id && g.plan_version_id === plan.id)
    : [];

  const product = (id: Id) => t.paint_product[id];

  const elements: ElementView[] = plan
    ? Object.values(t.plan_element)
        .filter((e) => e.plan_version_id === plan.id)
        .sort(byPosition)
        .map((element) => {
          const progress = t.part_progress.find((p) => p.subject_id === subject_id && p.element_id === element.id);
          const steps = Object.values(t.plan_step)
            .filter((s) => s.element_id === element.id)
            .sort(byPosition)
            .map((step): StepView => {
              const stepDevs = open.filter((d) => d.step_id === step.id);
              const materials = Object.values(t.step_material)
                .filter((m) => m.step_id === step.id)
                .sort(byPosition)
                .flatMap((material): MaterialView[] => {
                  const p = product(material.product_id);
                  if (!p) return [];
                  const swap = stepDevs.find((d) => d.kind === 'swap_product' && d.payload.from_product_id === p.id);
                  const to = swap?.payload.to_product_id ? product(swap.payload.to_product_id) : undefined;
                  return [{
                    material, product: p, ownership: ownershipOf(t, p.id),
                    swapped_to: swap && to ? { product: to, ownership: ownershipOf(t, to.id), deviation_id: swap.id } : undefined,
                  }];
                });
              const mg = Object.values(t.mix_group).find((g) => g.step_id === step.id);
              const mix: MixView | null = mg
                ? {
                    label: mg.label,
                    components: t.mix_component
                      .filter((c) => c.mix_group_id === mg.id)
                      .sort(byPosition)
                      .flatMap((component) => {
                        const p = product(component.product_id);
                        return p ? [{ component, product: p, ownership: ownershipOf(t, p.id) }] : [];
                      }),
                  }
                : null;
              return { step, materials, mix, deviations: stepDevs };
            });
          return {
            element,
            steps,
            deviations: open.filter((d) => d.element_id === element.id && !d.step_id),
            done: progress?.done ?? false,
            last_opened_at: progress?.last_opened_at ?? null,
            group_count: subject.grouping === 'group'
              ? groupRows.find((g) => g.element_id === element.id)?.count ?? 0
              : null,
          };
        })
    : [];

  const last = elements
    .filter((e) => e.last_opened_at)
    .sort((a, b) => (b.last_opened_at ?? '').localeCompare(a.last_opened_at ?? ''))[0];

  return {
    subject, project, game, plan, elements,
    references: subjectReferences(t, subject),
    open_deviations: open,
    completions: Object.values(t.paint_completion)
      .filter((c) => c.subject_id === subject_id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    last_opened_element_id: last?.element.id ?? null,
  };
}

/** Official image first, then visual references linked to the subject (datamodell v3 §11). */
export function subjectReferences(t: Tables, subject: MiniatureSubject): ReferenceView[] {
  const out: ReferenceView[] = [];
  const seen = new Set<Id>();
  const push = (asset: SourceAsset | undefined) => {
    if (!asset || asset.deleted_at || seen.has(asset.id)) return;
    const source = t.source[asset.source_id];
    if (!source || source.deleted_at) return;
    seen.add(asset.id);
    out.push({ asset, source, file_id: asset.file_id, label: asset.caption ?? source.title });
  };
  if (subject.official_asset_id) push(t.source_asset[subject.official_asset_id]);
  const links = Object.values(t.source_link).filter(
    (l) => !l.deleted_at && l.target_type === 'subject' && l.target_id === subject.id && l.use === 'visual_reference',
  );
  for (const link of links) {
    const scoped = t.source_link_asset.filter((x) => x.link_id === link.id).map((x) => t.source_asset[x.source_asset_id]);
    const assets = scoped.length
      ? scoped
      : Object.values(t.source_asset).filter((a) => a.source_id === link.source_id).sort(byPosition);
    assets.forEach(push);
  }
  return out;
}

export interface ShoppingRow {
  product: PaintProduct;
  ownership: Ownership;
  roles: string[];
  element_names: string[];
}

/** «Finn fram malingene»: one row per exact product (spesifikasjon §5). Applies open swaps. */
export function productList(view: PaintingView, element_ids?: Id[]): ShoppingRow[] {
  const rows = new Map<Id, ShoppingRow>();
  const add = (p: PaintProduct, o: Ownership, role: string, el: string) => {
    const r = rows.get(p.id) ?? { product: p, ownership: o, roles: [], element_names: [] };
    if (!r.roles.includes(role)) r.roles.push(role);
    if (!r.element_names.includes(el)) r.element_names.push(el);
    rows.set(p.id, r);
  };
  for (const ev of view.elements) {
    if (element_ids && !element_ids.includes(ev.element.id)) continue;
    for (const sv of ev.steps) {
      for (const m of sv.materials) {
        const use = m.swapped_to ?? { product: m.product, ownership: m.ownership };
        add(use.product, use.ownership, m.material.role_label ?? m.material.role, ev.element.name);
      }
      for (const c of sv.mix?.components ?? []) add(c.product, c.ownership, 'mix', ev.element.name);
    }
  }
  return [...rows.values()].sort((a, b) =>
    (a.product.manufacturer ?? '~').localeCompare(b.product.manufacturer ?? '~', 'nb') ||
    a.product.name.localeCompare(b.product.name, 'nb'));
}

function byPosition(a: { position: number }, b: { position: number }): number {
  return a.position - b.position;
}
