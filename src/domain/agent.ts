/**
 * Agent proposals: payload shapes, normalisation of what the model returns,
 * product matching and the context the agent reads (datamodell v3 §12–13).
 * Pure functions only; writes live in data/agent-commands.ts and data/research-commands.ts.
 */
import type {
  ElementKind, Evidence, Grouping, Id, MaterialRole, PaintProduct, ResultType, Tables, Uncertainty,
} from './types';
import { attachedExpansions, liveSubjects, ownershipOf } from './views';

// ---------- Payloads ----------

export interface ProductRef {
  manufacturer: string | null;
  range: string | null;
  name: string;
  /** Approximate colour from the agent; used as swatch when the product is created. */
  hex?: string | null;
}

/** One paint in the miniature's palette, with what it is used for. */
export interface PaletteItem {
  product: ProductRef;
  role_label: string | null;
  part: string | null;
}

/** A web page the agent searched or opened (verified on the server). */
export interface SourceRef {
  url: string;
  title: string;
  author: string | null;
  /** True when the agent opened the page, not only saw it in search results. */
  opened: boolean;
}

export type ImageKind = 'concept_art' | 'official' | 'painted' | 'other';

export interface ReferenceImage {
  image_url: string;
  page_url: string;
  page_title: string;
  site: string;
  creator: string | null;
  caption: string | null;
  kind?: ImageKind | null;
  /** Image hunt: how sure the agent is, why (in Norwegian), and the original text it relied on. */
  confidence?: 'high' | 'medium' | 'low' | null;
  reason?: string | null;
  original_text?: string | null;
  page_language?: string | null;
}

/** A page the agent read during an image hunt, with a Norwegian summary. */
export interface SourceRead {
  url: string;
  title: string;
  site: string;
  language: string | null;
  summary: string | null;
  original_excerpt: string | null;
}

export interface ReferenceSelectionPayload {
  subject_id: Id;
  note: string | null;
  images: ReferenceImage[];
  sources_read?: SourceRead[];
}

export interface CatalogSubjectPayload {
  name: string;
  grouping: Grouping;
  physical_count: number;
  expansion_name: string | null;
  category_label: string | null;
  count_basis: 'documented' | 'inferred' | null;
  grouping_basis: 'documented' | 'inferred' | null;
  note: string | null;
  sources: SourceRef[];
}

export interface PlanMaterialPayload {
  product: ProductRef;
  role: MaterialRole;
  role_label: string | null;
}

export interface PlanStepPayload {
  instruction: string;
  materials: PlanMaterialPayload[];
  mix: { label: string | null; components: { product: ProductRef; parts: number }[] } | null;
}

export interface PlanElementPayload {
  kind: ElementKind;
  name: string;
  steps: PlanStepPayload[];
}

export interface PaintPlanPayload {
  subject_id: Id;
  elements: PlanElementPayload[];
  note: string | null;
  sources?: SourceRef[];
  /** Plan focus: the approach and colour choices in a few sentences (Norwegian). */
  summary?: string | null;
  palette?: PaletteItem[];
  sources_read?: SourceRead[];
}

/** What the server hands back for each proposal, before validation. */
export interface RawProposal {
  type?: unknown;
  update_of?: unknown;
  evidence?: unknown;
  uncertainty?: unknown;
  payload?: unknown;
}

export interface NormalisedProposal {
  result_type: ProposalKind;
  update_of: string | null;
  evidence: Evidence;
  uncertainty: Uncertainty[];
  payload: CatalogSubjectPayload | PaintPlanPayload | ReferenceSelectionPayload | CatalogChangePayload;
}

/** Fields of a miniature the agent may set; omitted fields are left as they are. */
export interface SubjectFields {
  name?: string;
  grouping?: Grouping;
  physical_count?: number;
  expansion_name?: string | null;
  category_label?: string | null;
}

export type CatalogOp =
  | { op: 'update'; subject_id: Id; set: SubjectFields }
  | { op: 'delete'; subject_id: Id }
  | { op: 'split'; subject_id: Id; into: (SubjectFields & { name: string })[] }
  | { op: 'merge'; subject_ids: Id[]; into: SubjectFields & { name: string } }
  | { op: 'create'; fields: SubjectFields & { name: string } };

/** Several changes to the project's miniatures, approved together in one transaction. */
export interface CatalogChangePayload {
  operations: CatalogOp[];
  note: string | null;
}

export type ProposalKind = 'catalog_subject' | 'paint_plan' | 'reference_selection' | 'catalog_change';

const ROLES: MaterialRole[] = ['base', 'shade', 'layer', 'highlight', 'wash', 'glaze', 'mix', 'other'];
const EVIDENCE: Evidence[] = ['documented', 'synthesized', 'unresolved'];

/**
 * Turns one model proposal into a typed payload, or explains why it cannot.
 * `subjectRefs` maps the short refs shown to the model (M1, M2 …) to subject ids.
 */
export function normaliseProposal(raw: RawProposal, subjectRefs: Record<string, Id>):
  { ok: true; value: NormalisedProposal } | { ok: false; reason: string } {
  const o = obj(raw.payload);
  const common = {
    update_of: typeof raw.update_of === 'string' && raw.update_of.trim() ? raw.update_of.trim() : null,
    evidence: (EVIDENCE as string[]).includes(String(raw.evidence)) ? (raw.evidence as Evidence) : 'synthesized' as Evidence,
    uncertainty: arr(raw.uncertainty).flatMap((u) => {
      const x = obj(u);
      const reason = str(x.reason);
      return reason ? [{ path: str(x.path) || '', reason }] : [];
    }),
  };

  if (raw.type === 'catalog_change') {
    const ref = (v: unknown): Id | null => {
      const r = str(v).trim();
      return subjectRefs[r] ?? subjectRefs[r.toUpperCase()] ?? null;
    };
    const fields = (v: unknown): SubjectFields => {
      const f = obj(v);
      const out: SubjectFields = {};
      if (str(f.name).trim()) out.name = str(f.name).trim();
      if (f.grouping === 'single' || f.grouping === 'group') out.grouping = f.grouping;
      if (f.physical_count !== undefined && Number.isFinite(Number(f.physical_count))) out.physical_count = Math.max(1, Math.round(Number(f.physical_count)));
      if ('expansion_name' in f) out.expansion_name = str(f.expansion_name).trim() || null;
      if ('category_label' in f) out.category_label = str(f.category_label).trim() || null;
      if (out.physical_count && out.physical_count > 1 && !out.grouping) out.grouping = 'group';
      return out;
    };
    const named = (v: unknown) => {
      const f = fields(v);
      return f.name ? [{ ...f, name: f.name }] : [];
    };
    const operations: CatalogOp[] = [];
    for (const raw2 of arr(o.operations)) {
      const op = obj(raw2);
      if (op.op === 'update') {
        const id = ref(op.subject);
        if (!id) return { ok: false, reason: `Endringen viser til en ukjent miniatyr (${str(op.subject) || 'ingen'})` };
        operations.push({ op: 'update', subject_id: id, set: fields(op.set) });
      } else if (op.op === 'delete') {
        const id = ref(op.subject);
        if (!id) return { ok: false, reason: `Slettingen viser til en ukjent miniatyr (${str(op.subject) || 'ingen'})` };
        operations.push({ op: 'delete', subject_id: id });
      } else if (op.op === 'split') {
        const id = ref(op.subject);
        const into = arr(op.into).flatMap(named);
        if (!id || into.length < 2) return { ok: false, reason: 'En deling må vise til en miniatyr og ha minst to nye grupper med navn' };
        operations.push({ op: 'split', subject_id: id, into });
      } else if (op.op === 'merge') {
        const ids = arr(op.subjects).map(ref);
        const into = named(op.into)[0];
        if (ids.length < 2 || ids.some((x) => !x) || !into) return { ok: false, reason: 'En sammenslåing må vise til minst to kjente miniatyrer og ha et navn' };
        operations.push({ op: 'merge', subject_ids: ids as Id[], into });
      } else if (op.op === 'create') {
        const f = named(op.fields ?? op)[0];
        if (f) operations.push({ op: 'create', fields: f });
      }
    }
    if (!operations.length) return { ok: false, reason: 'Endringsforslaget har ingen gyldige operasjoner' };
    return { ok: true, value: { ...common, result_type: 'catalog_change', payload: { operations, note: str(o.note).trim() || null } } };
  }

  if (raw.type === 'catalog_subject') {
    const name = str(o.name).trim();
    if (!name) return { ok: false, reason: 'Miniatyrforslaget mangler navn' };
    const grouping: Grouping = o.grouping === 'group' ? 'group' : 'single';
    const count = Math.max(1, Math.round(Number(o.physical_count) || 1));
    return {
      ok: true,
      value: {
        ...common,
        result_type: 'catalog_subject',
        payload: {
          name,
          grouping,
          physical_count: grouping === 'single' ? 1 : count,
          expansion_name: str(o.expansion_name).trim() || null,
          category_label: str(o.category_label).trim() || null,
          count_basis: basis(o.count_basis),
          grouping_basis: basis(o.grouping_basis),
          note: str(o.note).trim() || null,
          sources: sourceRefs(o.sources),
        },
      },
    };
  }

  if (raw.type === 'paint_plan') {
    const ref = str(o.subject).trim();
    const subject_id = subjectRefs[ref] ?? subjectRefs[ref.toUpperCase()];
    if (!subject_id) return { ok: false, reason: `Maleplanen viser til en ukjent miniatyr (${ref || 'ingen'})` };
    const elements: PlanElementPayload[] = arr(o.elements).map((e, i) => {
      const eo = obj(e);
      return {
        kind: eo.kind === 'operation' ? 'operation' : 'part',
        name: str(eo.name).trim() || `Del ${i + 1}`,
        steps: arr(eo.steps).map((s) => {
          const so = obj(s);
          const mixO = so.mix ? obj(so.mix) : null;
          const mixComponents = mixO ? arr(mixO.components).flatMap((c) => {
            const co = obj(c);
            const product = productRef(co.product);
            return product ? [{ product, parts: Math.max(1, Math.round(Number(co.parts) || 1)) }] : [];
          }) : [];
          return {
            instruction: str(so.instruction).trim(),
            materials: arr(so.materials).flatMap((m) => {
              const mo = obj(m);
              const product = productRef(mo.product);
              if (!product) return [];
              const role = (ROLES as string[]).includes(str(mo.role)) ? (mo.role as MaterialRole) : 'other';
              return [{ product, role, role_label: str(mo.role_label).trim() || null }];
            }),
            mix: mixComponents.length >= 2 ? { label: str(mixO!.label).trim() || null, components: mixComponents } : null,
          };
        }),
      };
    });
    if (!elements.length) return { ok: false, reason: 'Maleplanen har ingen deler' };
    const palette: PaletteItem[] = arr(o.palette).flatMap((x) => {
      const po = obj(x);
      const product = productRef(po.product);
      return product ? [{ product, role_label: str(po.role_label).trim() || null, part: str(po.part).trim() || null }] : [];
    });
    return { ok: true, value: { ...common, result_type: 'paint_plan', payload: {
      subject_id, elements, note: str(o.note).trim() || null, sources: sourceRefs(o.sources),
      summary: str(o.summary).trim() || null, palette, sources_read: sourcesRead(o.sources_read),
    } } };
  }

  if (raw.type === 'reference_selection') {
    const ref = str(o.subject).trim();
    const subject_id = subjectRefs[ref] ?? subjectRefs[ref.toUpperCase()];
    if (!subject_id) return { ok: false, reason: `Bildeutvalget viser til en ukjent miniatyr (${ref || 'ingen'})` };
    const images: ReferenceImage[] = arr(o.images).flatMap((i) => {
      const io = obj(i);
      const image_url = str(io.image_url).trim();
      const page_url = str(io.page_url).trim();
      if (!/^https?:\/\//.test(image_url) || !/^https?:\/\//.test(page_url)) return [];
      return [{
        image_url, page_url,
        page_title: str(io.page_title).trim() || page_url,
        site: str(io.site).trim() || hostOf(page_url),
        creator: str(io.creator).trim() || null,
        caption: str(io.caption).trim() || null,
        kind: (['concept_art', 'official', 'painted', 'other'] as const).find((k) => k === io.kind) ?? null,
        confidence: (['high', 'medium', 'low'] as const).find((k) => k === io.confidence) ?? null,
        reason: str(io.reason).trim() || null,
        original_text: str(io.original_text).trim() || null,
        page_language: str(io.page_language).trim() || null,
      }];
    });
    if (!images.length) return { ok: false, reason: 'Bildeutvalget har ingen gyldige bilder' };
    const sources_read = sourcesRead(o.sources_read);
    return { ok: true, value: { ...common, result_type: 'reference_selection', payload: { subject_id, images, note: str(o.note).trim() || null, sources_read } } };
  }

  return { ok: false, reason: `Ukjent forslagstype (${String(raw.type)})` };
}

// ---------- Produkter ----------

export function productKey(p: ProductRef): string {
  return `${(p.manufacturer ?? '').trim().toLowerCase()}|${p.name.trim().toLowerCase()}`;
}

/**
 * Exact-name match against the catalogue. A manufacturer, when both sides
 * have one, must match too. Ambiguous matches return null: the user decides.
 */
export function matchProduct(t: Tables, ref: ProductRef): PaintProduct | null {
  const name = ref.name.trim().toLowerCase();
  const maker = ref.manufacturer?.trim().toLowerCase() || null;
  const hits = Object.values(t.paint_product).filter((p) => {
    if (p.deleted_at || p.name.trim().toLowerCase() !== name) return false;
    const pm = p.manufacturer?.trim().toLowerCase() || null;
    return !maker || !pm || maker === pm;
  });
  return hits.length === 1 ? hits[0]! : null;
}

/** Every distinct product a plan payload names. */
export function planProductRefs(p: PaintPlanPayload): ProductRef[] {
  const out = new Map<string, ProductRef>();
  for (const e of p.elements) for (const s of e.steps) {
    for (const m of s.materials) out.set(productKey(m.product), m.product);
    for (const c of s.mix?.components ?? []) out.set(productKey(c.product), c.product);
  }
  for (const x of p.palette ?? []) if (!out.has(productKey(x.product))) out.set(productKey(x.product), x.product);
  return [...out.values()];
}

// ---------- Kontekst ----------

export interface AgentContext {
  /** Sent to the model as JSON. */
  data: Record<string, unknown>;
  subjectRefs: Record<string, Id>;
  allowedTypes: ResultType[];
}

/** What the agent may read for this task (datamodell v3 §12 «Lesing»). */
export function buildAgentContext(t: Tables, task_id: Id): AgentContext {
  const scope = t.task_scope[task_id];
  const project = scope?.work_project_id ? t.project[scope.work_project_id] : undefined;
  const game = project ? t.game[project.game_id] : undefined;
  const allowedTypes = t.task_result_type.filter((r) => r.task_id === task_id).map((r) => r.result_type);
  if (!project || !game) return { data: {}, subjectRefs: {}, allowedTypes };

  const subjects = liveSubjects(t, project.id);
  const subjectRefs: Record<string, Id> = {};
  const expansions = attachedExpansions(t, project.id);

  const subjectData = subjects.map((s, i) => {
    const ref = `M${i + 1}`;
    subjectRefs[ref] = s.id;
    const pv = s.current_plan_version_id ? t.paint_plan_version[s.current_plan_version_id] : undefined;
    const elements = pv ? Object.values(t.plan_element).filter((e) => e.plan_version_id === pv.id).sort((a, b) => a.position - b.position) : [];
    return {
      ref,
      name: s.name,
      grouping: s.grouping,
      physical_count: s.physical_count,
      expansion: expansions.find((e) => e.id === s.expansion_id)?.name ?? null,
      category: s.category_label,
      reference_images: Object.values(t.source_link).filter((l) => !l.deleted_at && l.target_type === 'subject' && l.target_id === s.id && l.use === 'visual_reference').length
        + (s.official_asset_id ? 1 : 0),
      plan: pv
        ? {
            version: pv.version_number,
            elements: elements.map((e) => ({
              kind: e.kind,
              name: e.name,
              steps: Object.values(t.plan_step).filter((st) => st.element_id === e.id).sort((a, b) => a.position - b.position).map((st) => ({
                instruction: st.instruction,
                materials: Object.values(t.step_material).filter((m) => m.step_id === st.id).map((m) => {
                  const p = t.paint_product[m.product_id];
                  return { product: p ? fullName(p) : '?', role: m.role };
                }),
              })),
            })),
          }
        : null,
    };
  });

  const paints = Object.values(t.paint_product)
    .filter((p) => !p.deleted_at)
    .map((p) => ({ manufacturer: p.manufacturer, range: p.range_name, name: p.name, kind: p.product_kind, ownership: ownershipOf(t, p.id) }))
    .sort((a, b) => Number(b.ownership === 'owns') - Number(a.ownership === 'owns'))
    .slice(0, 300);

  const pending = Object.values(t.research_proposal)
    .filter((p) => p.task_id === task_id && p.decision === 'pending')
    .map((p) => ({ ref: p.ref, type: p.result_type, summary: proposalTitle(t, p.result_type, p.payload) }));

  return {
    subjectRefs,
    allowedTypes,
    data: {
      project: {
        game: game.primary_name,
        year: game.year_published,
        publishers: game.publishers,
        expansions_in_project: expansions.map((e) => e.name),
      },
      miniatures: subjectData,
      paints,
      your_pending_proposals: pending,
      known_sources: knownSources(t, project.id).slice(0, 60).map((k) => ({
        url: k.source.url, title: k.source.title, status: k.status, saved_images: k.asset_count,
        ...(k.summary ? { summary: k.summary.slice(0, 300) } : {}),
      })),
    },
  };
}

export interface KnownSource {
  source: import('./types').Source;
  asset_count: number;
  /** kept: the user saved images or evidence from it; found: the agent read it (draft). */
  status: 'kept' | 'found';
  summary: string | null;
}

/**
 * Web sources for this game: kept sources linked to the project or its
 * miniatures, and draft sources the agent read in this project's tasks.
 */
export function knownSources(t: Tables, project_id: Id): KnownSource[] {
  const subjectIds = new Set(Object.values(t.miniature_subject).filter((s) => s.project_id === project_id).map((s) => s.id));
  const ids = new Set(Object.values(t.source_link)
    .filter((l) => !l.deleted_at && ((l.target_type === 'subject' && subjectIds.has(l.target_id)) || (l.target_type === 'project' && l.target_id === project_id)))
    .map((l) => l.source_id));
  for (const s of Object.values(t.source)) {
    if (s.created_by_task_id && t.task_scope[s.created_by_task_id]?.work_project_id === project_id) ids.add(s.id);
  }
  return [...ids]
    .map((id) => t.source[id])
    .filter((x): x is NonNullable<typeof x> => !!x && !x.deleted_at && !!x.url)
    .map((source) => ({
      source,
      asset_count: Object.values(t.source_asset).filter((a) => a.source_id === source.id && !a.deleted_at).length,
      status: source.retention === 'kept' ? 'kept' as const : 'found' as const,
      summary: Object.values(t.source_layer).find((l) => l.source_id === source.id && l.layer === 'translation' && !l.deleted_at)?.body ?? null,
    }))
    .sort((a, b) => Number(b.status === 'kept') - Number(a.status === 'kept') || b.asset_count - a.asset_count);
}

export function proposalTitle(t: Tables, type: ResultType, payload: unknown): string {
  if (type === 'catalog_subject') {
    const p = payload as CatalogSubjectPayload;
    return `${p.name} (${p.grouping === 'group' ? `gruppe, ${p.physical_count}` : 'enkeltfigur'})`;
  }
  if (type === 'catalog_change') {
    const p = payload as CatalogChangePayload;
    const name = (id: Id) => t.miniature_subject[id]?.name ?? 'ukjent';
    const short = p.operations.map((o) => o.op === 'update' ? `Endre «${name(o.subject_id)}»` : o.op === 'delete' ? `Slett «${name(o.subject_id)}»`
      : o.op === 'split' ? `Del «${name(o.subject_id)}» i ${o.into.length}` : o.op === 'merge' ? `Slå sammen ${o.subject_ids.length} miniatyrer` : `Ny «${o.fields.name}»`);
    return short.length > 2 ? `${short.slice(0, 2).join(' · ')} + ${short.length - 2} til` : short.join(' · ') || 'Endring i katalogen';
  }
  if (type === 'reference_selection') {
    const p = payload as ReferenceSelectionPayload;
    return `${p.images.length} referansebilde${p.images.length === 1 ? '' : 'r'} for ${t.miniature_subject[p.subject_id]?.name ?? 'ukjent miniatyr'}`;
  }
  if (type === 'paint_plan' || type === 'plan_revision') {
    const p = payload as PaintPlanPayload;
    return `Maleplan for ${t.miniature_subject[p.subject_id]?.name ?? 'ukjent miniatyr'}`;
  }
  return type;
}

/** Human-readable lines for catalog operations (Norwegian). */
export function describeOps(t: Tables, ops: CatalogOp[]): string[] {
  const name = (id: Id) => t.miniature_subject[id]?.name ?? 'ukjent';
  const fmt = (f: SubjectFields) => [
    f.name, f.grouping === 'group' ? `gruppe${f.physical_count ? ` på ${f.physical_count}` : ''}` : f.grouping === 'single' ? 'enkeltfigur' : f.physical_count ? `${f.physical_count} stk.` : null,
    f.expansion_name !== undefined ? (f.expansion_name ?? 'grunnspill') : null, f.category_label ? `kategori ${f.category_label}` : null,
  ].filter(Boolean).join(', ');
  return ops.map((o) => {
    switch (o.op) {
      case 'update': return `Endre «${name(o.subject_id)}»: ${fmt(o.set) || 'ingen felt'}`;
      case 'delete': return `Slett «${name(o.subject_id)}»`;
      case 'split': return `Del «${name(o.subject_id)}» i ${o.into.length}: ${o.into.map(fmt).join(' / ')}`;
      case 'merge': return `Slå sammen ${o.subject_ids.map((i) => `«${name(i)}»`).join(', ')} til ${fmt(o.into)}`;
      case 'create': return `Ny: ${fmt(o.fields)}`;
    }
  });
}

function fullName(p: PaintProduct): string {
  return [p.manufacturer, p.range_name, p.name].filter(Boolean).join(' · ');
}

// ---------- små hjelpere ----------

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}
function sourcesRead(v: unknown): SourceRead[] {
  return arr(v).flatMap((x) => {
    const so = obj(x);
    const url = str(so.url).trim();
    if (!/^https?:\/\//.test(url)) return [];
    return [{ url, title: str(so.title).trim() || url, site: str(so.site).trim() || hostOf(url), language: str(so.language).trim() || null,
      summary: str(so.summary).trim() || null, original_excerpt: str(so.original_excerpt).trim() || null }];
  });
}

function sourceRefs(v: unknown): SourceRef[] {
  return arr(v).flatMap((x) => {
    const o = obj(x);
    const url = str(o.url).trim();
    if (!/^https?:\/\//.test(url)) return [];
    return [{ url, title: str(o.title).trim() || url, author: str(o.author).trim() || null, opened: o.opened === true }];
  });
}
function hostOf(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; }
}
function basis(v: unknown): 'documented' | 'inferred' | null {
  return v === 'documented' || v === 'inferred' ? v : null;
}
function productRef(v: unknown): ProductRef | null {
  if (typeof v === 'string' && v.trim()) return { manufacturer: null, range: null, name: v.trim() };
  const o = obj(v);
  const name = str(o.name).trim();
  if (!name) return null;
  const hex = str(o.hex).trim();
  return { manufacturer: str(o.manufacturer).trim() || null, range: str(o.range).trim() || null, name, hex: /^#[0-9a-fA-F]{6}$/.test(hex) ? hex.toLowerCase() : null };
}
