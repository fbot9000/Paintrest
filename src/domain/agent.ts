/**
 * Agent proposals: payload shapes, normalisation of what the model returns,
 * product matching and the context the agent reads (datamodell v3 §12–13).
 * Pure functions only; writes live in data/agent-commands.ts and data/research-commands.ts.
 */
import type {
  ElementKind, Evidence, Grouping, Id, MaterialRole, PaintChoice, PaintProduct, ResultType, StepBasis, SubjectIdentity, Tables, Uncertainty,
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
  /** 'uib' when UiB's own web search opened the page (the model read it; Paintrest did not get the text). */
  via?: 'uib' | null;
}

/** An example picture for a technique or recipe, from a page the agent opened or an image search (verified on the server). */
export interface KnowledgeImage {
  image_url: string;
  thumbnail_url: string | null;
  page_url: string;
  page_title: string;
  site: string;
  caption: string | null;
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
  /** Image search: a small copy from the search service, used when the original site blocks other servers. */
  thumbnail_url?: string | null;
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

/** A painting guide found in phase 3 of an image hunt (server/research-agent.ts GuideFound). */
export interface GuideRef {
  url: string;
  title: string;
  site: string;
  /** True when the agent read the page; false when it only saw it in a search. */
  read: boolean;
  why: string | null;
  /** Paints the guide names, as written there. */
  paints: string[];
  language: string | null;
}

/** A YouTube video found in an image hunt. Confirmed by YouTube or the search; nobody has watched it. */
export interface VideoRef {
  url: string;
  video_id: string;
  title: string;
  channel: string | null;
  thumbnail_url: string | null;
  why: string | null;
}

export interface ReferenceSelectionPayload {
  subject_id: Id;
  note: string | null;
  images: ReferenceImage[];
  sources_read?: SourceRead[];
  videos?: VideoRef[];
  guides?: GuideRef[];
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
  /** Game survey: who the missing figure is, checked by the server; kept on the miniature (proposed) when added. */
  identity?: SubjectIdentity | null;
  /** Game survey: pages that show the missing figure; they become «Trolig figuren» when it is added. */
  shown_on?: string[];
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
  /** Which paints the plan is built from, as the user chose (owned or best). */
  paint_choice?: Exclude<PaintChoice, 'both'> | null;
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
  payload: CatalogSubjectPayload | PaintPlanPayload | ReferenceSelectionPayload | CatalogChangePayload | TechniquePayload | RecipePayload;
}

// ---------- Bibliotek (bit 7.4): teknikk og oppskrift ----------

export interface TechniqueStepPayload {
  title: string;
  instruction: string;
  /** documented = a source shows it; synthesized = the agent's own suggestion. */
  basis: StepBasis | null;
}

/**
 * How the sources compare (bit 7.5, skisse 03): what they agree on, and the
 * different ways of doing it. One variant is the starting point.
 */
export interface KnowledgeComparison {
  common: string | null;
  variants: { label: string; description: string; sources: string[]; primary: boolean }[];
}

/** A technique draft for the library. Approved by the user into a new technique (status draft). */
export interface TechniquePayload {
  name: string;
  tags: string[];
  desired_result: string | null;
  use_area: string | null;
  materials: string[];
  variants: string | null;
  risk_note: string | null;
  steps: TechniqueStepPayload[];
  note: string | null;
  sources: SourceRef[];
  sources_read?: SourceRead[];
  comparison?: KnowledgeComparison | null;
  images?: KnowledgeImage[];
}

export interface RecipePaintPayload {
  product: ProductRef;
  role: MaterialRole | null;
  note: string | null;
}

export interface RecipeStepPayload {
  instruction: string;
  /** Positions (0-based) in `paints`. */
  paints: number[];
  /** A technique in the library, resolved from the ref shown to the agent (T1, T2 …). */
  technique_id: Id | null;
}

/** A recipe draft: a colour sequence, optionally with steps. */
export interface RecipePayload {
  name: string;
  tags: string[];
  effect: string | null;
  note: string | null;
  paints: RecipePaintPayload[];
  steps: RecipeStepPayload[];
  sources: SourceRef[];
  sources_read?: SourceRead[];
  comparison?: KnowledgeComparison | null;
  images?: KnowledgeImage[];
  /** «Med malinger du har» or «Beste valg», as the user chose. */
  paint_choice?: Exclude<PaintChoice, 'both'> | null;
}

/**
 * The variants as text for the library row, starting point first.
 * `primary` (index in comparison.variants) overrides the agent's choice.
 */
export function variantsText(c: KnowledgeComparison | null | undefined, primary?: number): string | null {
  if (!c?.variants.length) return null;
  const start = primary !== undefined && c.variants[primary] ? primary : Math.max(0, c.variants.findIndex((v) => v.primary));
  const ordered = [c.variants[start]!, ...c.variants.filter((_, i) => i !== start)];
  return ordered.map((v, i) => `${String.fromCharCode(65 + i)} · ${v.label}${i === 0 ? ' (utgangspunkt)' : ''}: ${v.description}`).join('\n');
}

/** The paints in a recipe draft, for matching against the catalogue. */
export function recipeProductRefs(p: RecipePayload): ProductRef[] {
  const seen = new Map<string, ProductRef>();
  for (const x of p.paints) if (!seen.has(productKey(x.product))) seen.set(productKey(x.product), x.product);
  return [...seen.values()];
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

export type ProposalKind = 'catalog_subject' | 'paint_plan' | 'reference_selection' | 'catalog_change' | 'technique' | 'recipe';

const ROLES: MaterialRole[] = ['base', 'shade', 'layer', 'highlight', 'wash', 'glaze', 'mix', 'other'];
const EVIDENCE: Evidence[] = ['documented', 'synthesized', 'unresolved'];

/**
 * Turns one model proposal into a typed payload, or explains why it cannot.
 * `subjectRefs` maps the short refs shown to the model (M1, M2 …) to subject ids.
 */
export function normaliseProposal(raw: RawProposal, subjectRefs: Record<string, Id>, techniqueRefs: Record<string, Id> = {}):
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

  if (raw.type === 'technique' || raw.type === 'recipe') {
    const name = str(o.name).trim();
    if (!name) return { ok: false, reason: `${raw.type === 'technique' ? 'Teknikken' : 'Oppskriften'} mangler navn` };
    const text = (v: unknown, max = 2000) => str(v).trim().slice(0, max) || null;
    const list = (v: unknown, max = 40) => arr(v).map((x) => str(x).trim()).filter(Boolean).slice(0, max);
    const sources = sourceRefs(o.sources);
    const read = sourcesRead(o.sources_read);
    const comparison = knowledgeComparison(o.comparison, sources);
    const images = knowledgeImages(o.images);
    if (raw.type === 'technique') {
      const steps = arr(o.steps).flatMap((x): TechniqueStepPayload[] => {
        const st = obj(x);
        const title = str(st.title).trim().slice(0, 200);
        const instruction = str(st.instruction).trim().slice(0, 2000);
        if (!title && !instruction) return [];
        return [{ title, instruction, basis: st.basis === 'documented' || st.basis === 'synthesized' ? st.basis : null }];
      }).slice(0, 40);
      const payload: TechniquePayload = {
        name: name.slice(0, 200), tags: list(o.tags, 12), desired_result: text(o.desired_result), use_area: text(o.use_area),
        materials: list(o.materials), variants: text(o.variants), risk_note: text(o.risk_note), steps, note: text(o.note),
        sources, ...(read.length ? { sources_read: read } : {}), ...(comparison ? { comparison } : {}), ...(images.length ? { images } : {}),
      };
      return { ok: true, value: { ...common, result_type: 'technique', payload } };
    }
    const paints = arr(o.paints).flatMap((x) => {
      const pe = obj(x);
      const product = productRef(typeof x === 'string' ? x : pe.product ?? pe);
      if (!product) return [];
      return [{ product, role: (ROLES as string[]).includes(String(pe.role)) ? pe.role as MaterialRole : null, note: text(pe.note, 400) }];
    }).slice(0, 40);
    if (!paints.length) return { ok: false, reason: `Oppskriften «${name}» har ingen malinger` };
    const steps = arr(o.steps).flatMap((x) => {
      const st = obj(x);
      const instruction = str(st.instruction).trim().slice(0, 2000);
      if (!instruction) return [];
      // The model numbers the paints from 1, as shown in the prompt.
      const idx = [...new Set(arr(st.paints).map((n) => Math.round(Number(n)) - 1).filter((n) => Number.isInteger(n) && n >= 0 && n < paints.length))];
      const ref = str(st.technique).trim();
      return [{ instruction, paints: idx, technique_id: techniqueRefs[ref] ?? techniqueRefs[ref.toUpperCase()] ?? null }];
    }).slice(0, 40);
    const payload: RecipePayload = {
      name: name.slice(0, 200), tags: list(o.tags, 12), effect: text(o.effect), note: text(o.note), paints, steps,
      sources, ...(read.length ? { sources_read: read } : {}), ...(comparison ? { comparison } : {}), ...(images.length ? { images } : {}),
      paint_choice: paintChoice(o.paint_choice),
    };
    return { ok: true, value: { ...common, result_type: 'recipe', payload } };
  }

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
          ...(normaliseIdentity(o.identity) ? { identity: normaliseIdentity(o.identity) } : {}),
          ...(arr(o.shown_on).length ? { shown_on: [...new Set(arr(o.shown_on).map(str).filter((u) => /^https?:\/\//.test(u)))].slice(0, 20) } : {}),
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
      paint_choice: paintChoice(o.paint_choice),
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
        thumbnail_url: /^https?:\/\//.test(str(io.thumbnail_url)) ? str(io.thumbnail_url) : null,
      }];
    });
    const videos = videoRefs(o.videos);
    const guides = guideRefs(o.guides);
    if (!images.length && !videos.length && !guides.length) return { ok: false, reason: 'Bildeutvalget har ingen gyldige bilder' };
    const sources_read = sourcesRead(o.sources_read);
    return { ok: true, value: { ...common, result_type: 'reference_selection', payload: { subject_id, images, note: str(o.note).trim() || null, sources_read, videos, guides } } };
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
  /** Library tasks: the short refs (T1, T2 …) shown for techniques. */
  techniqueRefs?: Record<string, Id>;
  allowedTypes: ResultType[];
}

/** What the agent may read for this task (datamodell v3 §12 «Lesing»). */
export function buildAgentContext(t: Tables, task_id: Id): AgentContext {
  const scope = t.task_scope[task_id];
  const project = scope?.work_project_id ? t.project[scope.work_project_id] : undefined;
  const game = project ? t.game[project.game_id] : undefined;
  const allowedTypes = t.task_result_type.filter((r) => r.task_id === task_id).map((r) => r.result_type);
  if (scope?.area_kind === 'new_knowledge') return knowledgeContext(t, task_id, allowedTypes);
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
      // Who the figure is, from an image hunt; «confirmed» means the user said it is right.
      ...(s.identity ? { identity: {
        status: s.identity.status, official_name: s.identity.official_name, aliases: s.identity.aliases,
        edition: s.identity.edition, description: s.identity.description,
      } } : {}),
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
      // Which miniatures each page shows, and what it is good for, so no agent has to find it again.
      known_sources: knownSources(t, project.id).slice(0, 80).map((k) => {
        const refOf = (id: Id) => Object.entries(subjectRefs).find(([, sid]) => sid === id)?.[0];
        const confirmed = k.shows_confirmed.map(refOf).filter(Boolean);
        const suggested = k.shows_suggested.map(refOf).filter(Boolean);
        return {
          url: k.source.url, title: k.source.title, status: k.status, saved_images: k.asset_count,
          ...(k.source.role ? { role: k.source.role } : {}),
          ...(confirmed.length ? { shows_confirmed: confirmed } : {}),
          ...(suggested.length ? { shows_suggested: suggested } : {}),
          ...(k.summary ? { summary: k.summary.slice(0, 300) } : {}),
        };
      }),
    },
  };
}

/**
 * What the agent reads in a library task (bit 7.4): the library itself (to avoid
 * duplicates and to refer to techniques), the paint catalogue for recipes, its own
 * pending drafts, and sources already found for the library. No project data.
 */
function knowledgeContext(t: Tables, task_id: Id, allowedTypes: ResultType[]): AgentContext {
  const techniqueRefs: Record<string, Id> = {};
  const techniques = Object.values(t.technique).filter((x) => !x.deleted_at)
    .sort((a, b) => a.name.localeCompare(b.name, 'nb'))
    .map((x, i) => {
      const ref = `T${i + 1}`;
      techniqueRefs[ref] = x.id;
      return { ref, name: x.name, tags: x.tags, desired_result: x.desired_result, materials: x.materials };
    });
  const recipes = Object.values(t.recipe).filter((x) => !x.deleted_at).map((x) => ({
    name: x.name, tags: x.tags, effect: x.effect,
    paints: Object.values(t.recipe_paint).filter((p) => p.recipe_id === x.id).sort((a, b) => a.position - b.position)
      .map((p) => { const pr = t.paint_product[p.product_id]; return pr ? fullName(pr) : '?'; }),
  }));
  const paints = Object.values(t.paint_product)
    .filter((p) => !p.deleted_at)
    .map((p) => ({ manufacturer: p.manufacturer, range: p.range_name, name: p.name, kind: p.product_kind, ownership: ownershipOf(t, p.id) }))
    .sort((a, b) => Number(b.ownership === 'owns') - Number(a.ownership === 'owns'))
    .slice(0, 300);
  const pending = Object.values(t.research_proposal)
    .filter((p) => p.task_id === task_id && p.decision === 'pending')
    .map((p) => ({ ref: p.ref, type: p.result_type, summary: proposalTitle(t, p.result_type, p.payload) }));
  // Improvement task (bit 7.6): the whole technique and what the user experienced with it.
  const target = Object.values(t.task_revision_target).find((r) => r.task_id === task_id && r.target_type === 'technique');
  const tech = target ? t.technique[target.target_id] : undefined;
  const revision = tech && !tech.deleted_at ? {
    name: tech.name, tags: tech.tags, status: tech.status, desired_result: tech.desired_result, use_area: tech.use_area,
    materials: tech.materials, variants: tech.variants, risk_note: tech.risk_note,
    steps: Object.values(t.technique_step).filter((st) => st.technique_id === tech.id).sort((a, b) => a.position - b.position)
      .map((st) => ({ title: st.title, instruction: st.instruction, basis: st.basis })),
    experiences: Object.values(t.technique_experience).filter((e) => e.technique_id === tech.id && !e.deleted_at)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map((e) => ({ outcome: e.outcome === 'worked' ? 'fungerte' : 'trenger justering', note: e.note, date: e.created_at.slice(0, 10) })),
    sources: Object.values(t.source_link).filter((l) => !l.deleted_at && l.target_type === 'technique' && l.target_id === tech.id)
      .map((l) => t.source[l.source_id]).filter((x): x is NonNullable<typeof x> => !!x && !!x.url).map((x) => ({ url: x.url, title: x.title })),
  } : null;
  return {
    subjectRefs: {},
    techniqueRefs,
    allowedTypes,
    data: {
      ...(revision ? { technique_to_improve: revision } : {}),
      ...(t.task_scope[task_id]?.paint_choice ? { paint_choice: t.task_scope[task_id]!.paint_choice } : {}),
      library: { techniques, recipes },
      paints,
      your_pending_proposals: pending,
      known_sources: libraryKnownSources(t).slice(0, 60).map((k) => ({
        url: k.source.url, title: k.source.title, status: k.status, ...(k.summary ? { summary: k.summary.slice(0, 300) } : {}),
      })),
    },
  };
}

/** Sources for the library: linked to a technique or recipe, or read in a library task. */
export function libraryKnownSources(t: Tables): KnownSource[] {
  const ids = new Set(Object.values(t.source_link)
    .filter((l) => !l.deleted_at && (l.target_type === 'technique' || l.target_type === 'recipe'))
    .map((l) => l.source_id));
  for (const s of Object.values(t.source)) {
    if (s.created_by_task_id && t.task_scope[s.created_by_task_id]?.area_kind === 'new_knowledge') ids.add(s.id);
  }
  return [...ids]
    .map((id) => t.source[id])
    .filter((x): x is NonNullable<typeof x> => !!x && !x.deleted_at && !!x.url)
    .map((source) => ({
      source,
      asset_count: 0,
      status: source.retention === 'kept' ? 'kept' as const : 'found' as const,
      summary: Object.values(t.source_layer).find((l) => l.source_id === source.id && l.layer === 'translation' && !l.deleted_at)?.body ?? null,
      // The library has no miniatures.
      shows_confirmed: [], shows_suggested: [],
    }))
    .sort((a, b) => Number(b.status === 'kept') - Number(a.status === 'kept'));
}

export interface KnownSource {
  source: import('./types').Source;
  asset_count: number;
  /** kept: the user saved images or evidence from it; found: the agent read it (draft). */
  status: 'kept' | 'found';
  summary: string | null;
  /** Miniatures the page shows: confirmed by the user (tag or approval), or suggested by a game survey. */
  shows_confirmed: Id[];
  shows_suggested: Id[];
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
      ...showsOf(t, source.id, subjectIds),
    }))
    .sort((a, b) => Number(b.status === 'kept') - Number(a.status === 'kept') || b.asset_count - a.asset_count);
}

function showsOf(t: Tables, source_id: Id, subjectIds: Set<Id>): { shows_confirmed: Id[]; shows_suggested: Id[] } {
  const links = Object.values(t.source_link).filter((l) => !l.deleted_at && l.source_id === source_id && l.target_type === 'subject' && l.use === 'evidence' && subjectIds.has(l.target_id)
    && !t.miniature_subject[l.target_id]?.deleted_at);
  const confirmed = [...new Set(links.filter((l) => !l.suggested_by_task_id).map((l) => l.target_id))];
  return { shows_confirmed: confirmed, shows_suggested: [...new Set(links.filter((l) => l.suggested_by_task_id && !confirmed.includes(l.target_id)).map((l) => l.target_id))] };
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
  if (type === 'technique') return `Teknikk: ${(payload as TechniquePayload).name}`;
  if (type === 'recipe') return `Oppskrift: ${(payload as RecipePayload).name}`;
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

function guideRefs(v: unknown): GuideRef[] {
  return arr(v).flatMap((x) => {
    const o = obj(x);
    const url = str(o.url).trim();
    if (!/^https?:\/\//.test(url)) return [];
    return [{
      url, title: str(o.title).trim() || url, site: str(o.site).trim() || hostOf(url), read: o.read === true, why: str(o.why).trim() || null,
      paints: arr(o.paints).map((p) => str(p).trim()).filter(Boolean).slice(0, 20), language: str(o.language).trim() || null,
    }];
  }).slice(0, 8);
}

/** The identification from an image hunt's final event, checked for shape (the server has checked the sources). */
export function normaliseIdentity(v: unknown): SubjectIdentity | null {
  if (!v || typeof v !== 'object') return null;
  const o = obj(v);
  const s = (x: unknown, n: number) => str(x).trim().slice(0, n) || null;
  const http = (x: unknown) => /^https?:\/\//.test(str(x));
  const images = arr(o.images).flatMap((x) => {
    const i = obj(x);
    if (!http(i.image_url) || !http(i.page_url)) return [];
    return [{
      image_url: str(i.image_url), page_url: str(i.page_url), page_title: s(i.page_title, 200), site: s(i.site, 120),
      kind: i.kind === 'concept_art' ? 'concept_art' as const : i.kind === 'render' ? 'render' as const : 'official' as const,
      thumbnail_url: http(i.thumbnail_url) ? str(i.thumbnail_url) : null,
    }];
  }).slice(0, 3);
  const id: SubjectIdentity = {
    official_name: s(o.official_name, 160), aliases: arr(o.aliases).map((a) => str(a).trim().slice(0, 120)).filter(Boolean).slice(0, 8),
    edition: s(o.edition, 200), faction: s(o.faction, 160), description: s(o.description, 800), images, painter: s(o.painter, 120),
    confidence: (['high', 'medium', 'low'] as const).find((c) => c === o.confidence) ?? null, why: s(o.why, 600),
    sources: arr(o.sources).flatMap((x) => { const q = obj(x); return http(q.url) ? [{ url: str(q.url), title: str(q.title).trim() || str(q.url) }] : []; }).slice(0, 10),
  };
  return id.official_name || id.description || id.images.length ? id : null;
}

function videoRefs(v: unknown): VideoRef[] {
  return arr(v).flatMap((x) => {
    const o = obj(x);
    const url = str(o.url).trim();
    const video_id = str(o.video_id).trim();
    const title = str(o.title).trim();
    if (!/^https:\/\/(www\.)?youtube\.com\/watch\?v=[A-Za-z0-9_-]{11}$/.test(url) || !video_id || !title) return [];
    const thumb = str(o.thumbnail_url).trim();
    return [{ url, video_id, title, channel: str(o.channel).trim() || null, thumbnail_url: /^https?:\/\//.test(thumb) ? thumb : null, why: str(o.why).trim() || null }];
  }).slice(0, 8);
}

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

function knowledgeImages(v: unknown): KnowledgeImage[] {
  return arr(v).flatMap((x) => {
    const o = obj(x);
    const image_url = str(o.image_url).trim();
    const page_url = str(o.page_url).trim();
    if (!/^https?:\/\//.test(image_url) || !/^https?:\/\//.test(page_url)) return [];
    const thumb = str(o.thumbnail_url).trim();
    return [{ image_url, thumbnail_url: /^https?:\/\//.test(thumb) ? thumb : null, page_url, page_title: str(o.page_title).trim() || hostOf(page_url),
      site: str(o.site).trim() || hostOf(page_url), caption: str(o.caption).trim().slice(0, 300) || null }];
  }).slice(0, 12);
}

function paintChoice(v: unknown): Exclude<PaintChoice, 'both'> | null {
  return v === 'owned' || v === 'best' ? v : null;
}

/** Variants may only point to sources in the draft. Exactly one variant is the starting point. */
function knowledgeComparison(v: unknown, sources: SourceRef[]): KnowledgeComparison | null {
  const o = obj(v);
  const key = (u: string) => u.trim().replace(/\/+$/, '').replace(/^https?:\/\/(www\.)?/, '').toLowerCase();
  const known = new Map(sources.map((s) => [key(s.url), s.url]));
  const variants = arr(o.variants).flatMap((x) => {
    const vo = obj(x);
    const label = str(vo.label).trim().slice(0, 120);
    const description = str(vo.description).trim().slice(0, 1000);
    if (!label && !description) return [];
    const urls = [...new Set(arr(vo.sources).map((u) => known.get(key(str(u)))).filter((u): u is string => !!u))];
    return [{ label: label || description.slice(0, 40), description, sources: urls, primary: vo.primary === true }];
  }).slice(0, 6);
  const common = str(o.common).trim().slice(0, 1500) || null;
  if (!variants.length && !common) return null;
  const first = Math.max(0, variants.findIndex((x) => x.primary));
  variants.forEach((x, i) => { x.primary = i === first; });
  return { common, variants };
}

function sourceRefs(v: unknown): SourceRef[] {
  return arr(v).flatMap((x) => {
    const o = obj(x);
    const url = str(o.url).trim();
    if (!/^https?:\/\//.test(url)) return [];
    return [{ url, title: str(o.title).trim() || url, author: str(o.author).trim() || null, opened: o.opened === true, ...(o.via === 'uib' ? { via: 'uib' as const } : {}) }];
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
