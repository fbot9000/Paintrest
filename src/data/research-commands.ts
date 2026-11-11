import { CommandError } from '../domain/commands';
import { newId, now } from '../domain/ids';
import { describeOps, matchProduct, planProductRefs, productKey, proposalTitle, recipeProductRefs, variantsText } from '../domain/agent';
import type { CatalogChangePayload, CatalogSubjectPayload, KnowledgeImage, NormalisedProposal, PaintPlanPayload, PaletteItem, ProductRef, ProposalKind, RecipePayload, ReferenceSelectionPayload, SourceRead, SourceRef, SubjectFields, TechniquePayload } from '../domain/agent';
import type { AgentCommands, ApproveOptions, ProposalWrite, ResearchCommands } from '../domain/research';
import type { ChangeAction, Id, MiniatureSubject, PaintChoice, ResearchProposal, ResultType, RowPatch, Tables, Uncertainty } from '../domain/types';
import { attachedExpansions } from '../domain/views';
import type { Store } from './store';
import { revertPatches } from './store';
import { addSourceLayers, attachImages, attachImagesTo, downloadImages, setCover, sourceBelongsTo, sourceFor } from './images-tx';
import type { Downloaded } from './images-tx';

/** Result types implemented in this version. See docs/AVVIK.md. */
/**
 * Result types for a project task in this version. catalog_change and plan_revision
 * let the agent change what already exists in the work project (user decision
 * 10 November 2026, see docs/AVVIK.md). Nothing outside the project is reachable.
 */
export const IMPLEMENTED_TYPES: ResultType[] = ['catalog_subject', 'paint_plan', 'reference_selection', 'catalog_change', 'plan_revision'];

/** The game survey's task: pictures for the miniatures, and miniatures missing from the list (brukerønske 11.11.2026). */
export const GAME_TYPES: ResultType[] = ['reference_selection', 'catalog_subject'];

const PAINT_CHOICES: PaintChoice[] = ['both', 'owned', 'best'];

/**
 * Why a proposed new miniature would be a duplicate: a miniature in the project with the same name or
 * official name, or a pending proposal for one. Null when it is new. Names are compared without case.
 */
export function duplicateMiniature(t: Tables, task_id: Id, c: CatalogSubjectPayload): string | null {
  const project_id = t.task_scope[task_id]?.work_project_id;
  if (!project_id) return null;
  const norm = (x: string | null | undefined) => (x ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const names = new Set([c.name, c.identity?.official_name].map(norm).filter(Boolean));
  const same = (x: string | null | undefined) => !!norm(x) && names.has(norm(x));
  const existing = Object.values(t.miniature_subject).find((s) => s.project_id === project_id && !s.deleted_at && (same(s.name) || same(s.identity?.official_name)));
  if (existing) return `«${c.name}» finnes allerede i prosjektet (${existing.name})`;
  const open = new Set(Object.values(t.research_task).filter((x) => x.status === 'open' && t.task_scope[x.id]?.work_project_id === project_id).map((x) => x.id));
  const pending = Object.values(t.research_proposal).find((x) => x.decision === 'pending' && x.result_type === 'catalog_subject' && open.has(x.task_id)
    && (same((x.payload as CatalogSubjectPayload).name) || same((x.payload as CatalogSubjectPayload).identity?.official_name)));
  if (pending) return `«${c.name}» venter allerede som forslag (${pending.ref})`;
  return null;
}

type Who = { initiated_by: 'user' | 'agent'; task_id?: Id | null; proposal_id?: Id | null };

function record(t: Tables, ws: Id, target_type: string, target_id: Id, action: ChangeAction, who: Who, from?: Id | null, to?: Id | null) {
  const id = newId();
  t.change_record[id] = {
    id, workspace_id: ws, target_type, target_id,
    from_version_id: from ?? null, to_version_id: to ?? null, action,
    initiated_by: who.initiated_by, task_id: who.task_id ?? null, proposal_id: who.proposal_id ?? null,
    created_at: now(),
  };
}

function must<T>(v: T | undefined, what: string): T {
  if (!v) throw new CommandError(`${what} finnes ikke`);
  return v;
}

// ---------- Omfangssjekk (skjema §7) ----------

type ScopeOk = { result_type: ResultType; base_version_id: Id | null };

/**
 * Runs before every agent write and again inside approval.
 * Returns the stored result type (paint_plan or plan_revision) and the base version.
 */
export function checkScope(t: Tables, task_id: Id, p: { result_type: ProposalKind; payload: unknown }): ScopeOk {
  const task = must(t.research_task[task_id], 'Oppgaven');
  if (task.status !== 'open') throw new CommandError('Oppgaven er lukket');
  const scope = must(t.task_scope[task_id], 'Omfanget');
  const types = new Set(t.task_result_type.filter((r) => r.task_id === task_id).map((r) => r.result_type));

  // Library tasks (bit 7.4): only drafts for the library, never anything in a project.
  if (p.result_type === 'technique' || p.result_type === 'recipe') {
    if (scope.area_kind !== 'new_knowledge' || !scope.allow_new_knowledge || !types.has(p.result_type)) {
      throw new CommandError(p.result_type === 'technique' ? 'Oppgaven tillater ikke nye teknikker' : 'Oppgaven tillater ikke nye oppskrifter');
    }
    // An improvement task (bit 7.6): the draft is based on the technique as it is now.
    const target = libraryRevisionTarget(t, task_id);
    if (target && p.result_type === 'technique') {
      const tech = t.technique[target.target_id];
      if (!tech || tech.deleted_at) throw new CommandError('Teknikken som skal forbedres, finnes ikke lenger');
      return { result_type: 'technique', base_version_id: tech.updated_at };
    }
    return { result_type: p.result_type, base_version_id: null };
  }
  if (scope.area_kind === 'new_knowledge') throw new CommandError('Oppgaven gjelder biblioteket og kan ikke endre prosjekter');

  const project = scope.work_project_id ? t.project[scope.work_project_id] : undefined;
  if (!project || project.deleted_at) throw new CommandError('Arbeidsprosjektet finnes ikke lenger');

  if (p.result_type === 'catalog_subject') {
    if (!types.has('catalog_subject')) throw new CommandError('Oppgaven tillater ikke nye miniatyrer');
    return { result_type: 'catalog_subject', base_version_id: null };
  }

  if (p.result_type === 'catalog_change') {
    if (!types.has('catalog_change')) throw new CommandError('Oppgaven tillater ikke endringer i katalogen');
    const ids = (p.payload as CatalogChangePayload).operations.flatMap((o) =>
      o.op === 'merge' ? o.subject_ids : o.op === 'create' ? [] : [o.subject_id]);
    for (const id of ids) {
      const s = t.miniature_subject[id];
      // Only miniatures in this task's project (skjema §7: no other project's ids).
      if (!s || s.deleted_at || s.project_id !== project.id) throw new CommandError('Endringen gjelder en miniatyr utenfor prosjektet eller en som er slettet');
    }
    return { result_type: 'catalog_change', base_version_id: null };
  }

  const payload = p.payload as PaintPlanPayload | ReferenceSelectionPayload;
  const subject = t.miniature_subject[payload.subject_id];
  // Payload may not carry another project's subject (skjema §7).
  if (!subject || subject.deleted_at || subject.project_id !== project.id) {
    throw new CommandError('Forslaget gjelder en miniatyr utenfor prosjektet');
  }
  if (p.result_type === 'reference_selection') {
    // New source links on a subject inside the work project (datamodell v3 §12).
    if (!types.has('reference_selection')) throw new CommandError('Oppgaven tillater ikke bildeutvalg');
    return { result_type: 'reference_selection', base_version_id: null };
  }
  if (!subject.current_plan_version_id) {
    if (!types.has('paint_plan')) throw new CommandError('Oppgaven tillater ikke nye maleplaner');
    return { result_type: 'paint_plan', base_version_id: null };
  }
  // An approved plan exists: a new version, based on the version current now.
  // Inside the work project no opened target is needed (user decision, docs/AVVIK.md).
  if (!types.has('plan_revision')) throw new CommandError(`«${subject.name}» har en godkjent maleplan, og oppgaven tillater ikke nye versjoner`);
  const target = Object.values(t.task_revision_target).find(
    (r) => r.task_id === task_id && r.target_type === 'paint_plan' && r.target_id === subject.id,
  );
  return { result_type: 'plan_revision', base_version_id: target?.base_version_id ?? subject.current_plan_version_id };
}

// ---------- Agentens kommandoer ----------

export function createAgentCommands(store: Store): AgentCommands {
  const tx = store.transaction.bind(store);
  return {
    addAssistantMessage(task_id, body, model_id, trace) {
      return tx((t) => {
        must(t.research_task[task_id], 'Oppgaven');
        const id = newId();
        t.research_message[id] = { id, task_id, role: 'assistant', body, created_at: now(), model_id, ...(trace?.length ? { trace } : {}) };
        return id;
      });
    },

    addSystemMessage(task_id, body) {
      return tx((t) => {
        const id = newId();
        t.research_message[id] = { id, task_id, role: 'system', body, created_at: now() };
        return id;
      });
    },

    writeProposal(task_id, p: NormalisedProposal, provider, model_id): ProposalWrite {
      try {
        return tx((t) => {
          const scope = checkScope(t, task_id, p);
          const ts = now();
          if (scope.result_type === 'catalog_subject' && !p.update_of) {
            const dup = duplicateMiniature(t, task_id, p.payload as CatalogSubjectPayload);
            if (dup) throw new Error(dup);
          }
          if (p.update_of) {
            // update_proposal: only the agent's own pending draft on the same task.
            const existing = Object.values(t.research_proposal).find((x) => x.task_id === task_id && x.ref === p.update_of);
            if (!existing) throw new Error(`Fant ikke utkastet ${p.update_of} på denne oppgaven`);
            if (existing.decision !== 'pending') throw new Error(`Utkastet ${p.update_of} er allerede behandlet`);
            Object.assign(existing, {
              result_type: scope.result_type, payload: p.payload, evidence: p.evidence, uncertainty: p.uncertainty,
              base_version_id: scope.base_version_id, provider, model_id, updated_at: ts, last_error: null,
            } satisfies Partial<ResearchProposal>);
            return { ok: true as const, id: existing.id, ref: existing.ref, updated: true };
          }
          const n = Object.values(t.research_proposal).filter((x) => x.task_id === task_id).length + 1;
          const id = newId();
          t.research_proposal[id] = {
            id, task_id, result_type: scope.result_type, payload: p.payload, evidence: p.evidence,
            uncertainty: p.uncertainty, decision: 'pending', base_version_id: scope.base_version_id,
            provider, model_id, created_at: ts, updated_at: ts, ref: `F${n}`, last_error: null,
          };
          return { ok: true as const, id, ref: `F${n}`, updated: false };
        });
      } catch (e) {
        return { ok: false, reason: e instanceof Error ? e.message : String(e) };
      }
    },

    recordSources(task_id, pages, read) {
      if (!pages.length && !read.length) return [];
      return tx((t, ws) => {
        const created: string[] = [];
        for (const pg of pages) {
          if (Object.values(t.source).some((x) => !x.deleted_at && x.url === pg.url)) continue;
          const id = newId();
          t.source[id] = {
            id, workspace_id: ws, kind: 'article', title: pg.title, creator: pg.author ?? pg.site, url: pg.url, locator: null,
            analysis_state: 'stored', retention: 'draft', created_by_task_id: task_id, created_at: now(), deleted_at: null,
            ...(pg.language ? { language: pg.language } : {}),
          };
          record(t, ws, 'source', id, 'create', { initiated_by: 'agent', task_id });
          created.push(pg.title);
        }
        const scope = t.task_scope[task_id];
        if (scope?.area_kind === 'new_knowledge') addSourceLayers(t, read.filter((r) => libraryMayWrite(t, task_id, r.url)));
        else addSourceLayers(t, read, scope?.work_project_id ?? undefined);
        return created;
      });
    },

    recordIdentity(task_id, subject_id, identity) {
      return tx((t, ws) => {
        const s = t.miniature_subject[subject_id];
        const project_id = t.task_scope[task_id]?.work_project_id;
        // Only a miniature in the task's own project (open zone), and never over what the user confirmed.
        if (!s || s.deleted_at || !project_id || s.project_id !== project_id) return null;
        if (s.identity?.status === 'confirmed') return null;
        const name = identity.official_name ?? s.name;
        const wrong = (s.identity_rejected ?? []).some((r) => (r.official_name && identity.official_name && r.official_name.trim().toLowerCase() === identity.official_name.trim().toLowerCase())
          || identity.images.some((i) => r.image_urls.includes(i.image_url)));
        if (wrong) return null;
        s.identity = { ...structuredClone(identity), status: 'proposed', found_by_task_id: task_id, updated_at: now() };
        record(t, ws, 'miniature_subject', subject_id, 'update', { initiated_by: 'agent', task_id });
        return name;
      });
    },

    recordGameSources(task_id, sources, subjectRefs) {
      if (!sources.length) return { sources: 0, links: 0 };
      return tx((t, ws) => {
        const project_id = t.task_scope[task_id]?.work_project_id;
        if (!project_id) return { sources: 0, links: 0 };
        const who: Who = { initiated_by: 'agent', task_id };
        let saved = 0;
        let links = 0;
        for (const g of sources) {
          if (!/^https?:\/\//.test(g.url)) continue;
          let src = Object.values(t.source).find((x) => !x.deleted_at && x.url === g.url);
          if (!src) {
            // Also pages only seen in a search (Reddit, Instagram …): kept as drafts so the next run finds them.
            const id = newId();
            src = { id, workspace_id: ws, kind: g.role === 'guide' ? 'guide' : 'article', title: g.title, creator: null, url: g.url, locator: null,
              analysis_state: 'stored', retention: 'draft', created_by_task_id: task_id, created_at: now(), deleted_at: null };
            t.source[id] = src;
            record(t, ws, 'source', id, 'create', who);
            saved++;
          }
          // A page shared with another game may get a link, but its content is left alone (AVVIK regel 1).
          if (sourceBelongsTo(t, src.id, project_id)) {
            if (g.role !== 'other' || !src.role) src.role = g.role;
            if (g.summary) addSourceLayers(t, [{ url: src.url!, title: src.title, site: '', language: null, summary: g.summary, original_excerpt: null }], project_id);
          }
          for (const ref of g.shows) {
            const subject_id = subjectRefs[ref];
            const s = subject_id ? t.miniature_subject[subject_id] : undefined;
            if (!s || s.deleted_at || s.project_id !== project_id) continue;
            // An existing link (the user's tag, or an earlier suggestion) is left as it is; a removed one is not suggested again.
            const before = Object.values(t.source_link).filter((l) => l.source_id === src!.id && l.target_type === 'subject' && l.target_id === s.id && l.use === 'evidence');
            if (before.length) continue;
            const id = newId();
            t.source_link[id] = { id, source_id: src.id, target_type: 'subject', target_id: s.id, use: 'evidence', layer_id: null, deleted_at: null, suggested_by_task_id: task_id };
            record(t, ws, 'source_link', id, 'attach', who);
            links++;
          }
        }
        return { sources: saved, links };
      });
    },

    recordContext(task_id, refs) {
      tx((t) => {
        const ts = now();
        for (const r of refs) {
          const id = newId();
          t.context_ref[id] = { id, task_id, ...r, captured_at: ts };
        }
      });
    },
  };
}

// ---------- Brukerens kommandoer ----------

export interface ResearchDeps {
  /** Downloads an image found by the agent (through the server, which checks the address). */
  fetchImage?: (url: string) => Promise<Blob>;
}

export function createResearchCommands(store: Store, deps: ResearchDeps = {}): ResearchCommands {
  const tx = store.transaction.bind(store);

  return {
    async startTask(project_id, focus) {
      return tx((t, ws) => {
        const p = must(t.project[project_id], 'Prosjektet');
        if (p.deleted_at) throw new CommandError('Prosjektet er slettet');
        const game = focus === 'game';
        if (focus && focus !== 'game' && t.miniature_subject[focus.subject_id]?.project_id !== project_id) throw new CommandError('Miniatyren hører til et annet prosjekt');
        const id = newId();
        t.research_task[id] = { id, workspace_id: ws, status: 'open', created_at: now() };
        // System sets scope and result types in the same transaction (skjema §7).
        t.task_scope[id] = { task_id: id, area_kind: 'new_project', work_project_id: project_id, allow_new_knowledge: false,
          ...(game ? { game_focus: true } : focus ? { subject_focus: { ...focus } } : {}) };
        // The game survey proposes pictures and missing miniatures; it never changes existing ones or the plans.
        for (const result_type of game ? GAME_TYPES : IMPLEMENTED_TYPES) t.task_result_type.push({ task_id: id, result_type });
        record(t, ws, 'research_task', id, 'create', { initiated_by: 'user', task_id: id });
        return id;
      });
    },

    async startKnowledgeTask(target, opts = {}) {
      if (target !== 'technique' && target !== 'recipe') throw new CommandError('Ukjent researchtype');
      const choice = opts.paint_choice ?? null;
      if (choice && !PAINT_CHOICES.includes(choice)) throw new CommandError('Ukjent malingsvalg');
      return tx((t, ws) => {
        const id = newId();
        t.research_task[id] = { id, workspace_id: ws, status: 'open', created_at: now() };
        t.task_scope[id] = {
          task_id: id, area_kind: 'new_knowledge', work_project_id: null, allow_new_knowledge: true,
          // Only recipes choose paints; the user picks this on the start screen.
          ...(target === 'recipe' ? { paint_choice: choice ?? 'both' } : {}),
        };
        t.task_result_type.push({ task_id: id, result_type: target });
        record(t, ws, 'research_task', id, 'create', { initiated_by: 'user', task_id: id });
        return id;
      });
    },

    async setPaintChoice(task_id, choice) {
      if (!PAINT_CHOICES.includes(choice)) throw new CommandError('Ukjent malingsvalg');
      tx((t, ws) => {
        const scope = must(t.task_scope[task_id], 'Oppgaven');
        if (scope.area_kind !== 'new_knowledge') throw new CommandError('Malingsvalget gjelder research til biblioteket');
        scope.paint_choice = choice;
        record(t, ws, 'task_scope', task_id, 'update', { initiated_by: 'user', task_id });
      });
    },

    async startTechniqueRevision(technique_id) {
      return tx((t, ws) => {
        const tech = must(t.technique[technique_id], 'Teknikken');
        if (tech.deleted_at) throw new CommandError('Teknikken er slettet');
        const id = newId();
        t.research_task[id] = { id, workspace_id: ws, status: 'open', created_at: now() };
        t.task_scope[id] = { task_id: id, area_kind: 'new_knowledge', work_project_id: null, allow_new_knowledge: true };
        t.task_result_type.push({ task_id: id, result_type: 'technique' });
        const rid = newId();
        t.task_revision_target[rid] = { id: rid, task_id: id, target_type: 'technique', target_id: technique_id, base_version_id: tech.updated_at, opened_at: now() };
        record(t, ws, 'research_task', id, 'create', { initiated_by: 'user', task_id: id });
        return id;
      });
    },

    async closeTask(task_id) {
      tx((t, ws) => {
        must(t.research_task[task_id], 'Oppgaven').status = 'closed';
        record(t, ws, 'research_task', task_id, 'update', { initiated_by: 'user', task_id });
      });
    },

    async addUserMessage(task_id, body) {
      return tx((t) => {
        const task = must(t.research_task[task_id], 'Oppgaven');
        if (task.status !== 'open') throw new CommandError('Oppgaven er lukket');
        if (!body.trim()) throw new CommandError('Skriv en melding');
        const id = newId();
        t.research_message[id] = { id, task_id, role: 'user', body: body.trim(), created_at: now() };
        return id;
      });
    },

    async syncResultTypes(task_id) {
      if (!store.getTables().research_task[task_id]) return;
      const wanted = store.getTables().task_scope[task_id]?.game_focus ? GAME_TYPES : IMPLEMENTED_TYPES;
      const missing = wanted.filter((rt) => !store.getTables().task_result_type.some((r) => r.task_id === task_id && r.result_type === rt));
      if (!missing.length) return;
      tx((t, ws) => {
        const task = must(t.research_task[task_id], 'Oppgaven');
        if (task.status !== 'open' || t.task_scope[task_id]?.area_kind !== 'new_project') return;
        for (const result_type of missing) t.task_result_type.push({ task_id, result_type });
        record(t, ws, 'task_result_type', task_id, 'update', { initiated_by: 'user', task_id });
      });
    },

    async openRevisionTarget(task_id, subject_id) {
      tx((t, ws) => {
        const scope = must(t.task_scope[task_id], 'Omfanget');
        const s = must(t.miniature_subject[subject_id], 'Miniatyren');
        if (s.project_id !== scope.work_project_id) throw new CommandError('Miniatyren hører til et annet prosjekt');
        if (!s.current_plan_version_id) throw new CommandError('Miniatyren har ingen maleplan å revidere');
        const existing = Object.values(t.task_revision_target).find(
          (r) => r.task_id === task_id && r.target_type === 'paint_plan' && r.target_id === subject_id,
        );
        if (existing) {
          existing.base_version_id = s.current_plan_version_id;
          existing.opened_at = now();
        } else {
          const id = newId();
          t.task_revision_target[id] = {
            id, task_id, target_type: 'paint_plan', target_id: subject_id,
            base_version_id: s.current_plan_version_id, opened_at: now(),
          };
        }
        if (!t.task_result_type.some((r) => r.task_id === task_id && r.result_type === 'plan_revision')) {
          t.task_result_type.push({ task_id, result_type: 'plan_revision' });
        }
        record(t, ws, 'task_revision_target', subject_id, 'create', { initiated_by: 'user', task_id });
      });
    },

    async editCatalogProposal(proposal_id, payload) {
      tx((t) => {
        const p = must(t.research_proposal[proposal_id], 'Forslaget');
        if (p.decision !== 'pending' || p.result_type !== 'catalog_subject') throw new CommandError('Forslaget kan ikke endres');
        if (!payload.name.trim()) throw new CommandError('Navnet kan ikke være tomt');
        p.payload = {
          ...payload,
          name: payload.name.trim(),
          physical_count: payload.grouping === 'single' ? 1 : Math.max(1, Math.round(payload.physical_count)),
        };
        p.updated_at = now();
      });
    },

    async editPlanProposal(proposal_id, payload) {
      tx((t) => {
        const p = must(t.research_proposal[proposal_id], 'Forslaget');
        if (p.decision !== 'pending' || (p.result_type !== 'paint_plan' && p.result_type !== 'plan_revision')) throw new CommandError('Forslaget kan ikke endres');
        const before = p.payload as PaintPlanPayload;
        // The subject and task cannot be changed by curation; only content.
        if (payload.subject_id !== before.subject_id) throw new CommandError('Miniatyren kan ikke byttes');
        const elements = payload.elements
          .map((e) => ({ ...e, name: e.name.trim() || 'Del', steps: e.steps.filter((st) => st.instruction.trim() || st.materials.length || st.mix) }))
          .filter((e) => e.steps.length);
        if (!elements.length) throw new CommandError('Planen må ha minst ett steg');
        p.payload = { ...before, ...payload, elements };
        p.updated_at = now();
      });
    },

    async approveProposal(proposal_id, opts: ApproveOptions = {}) {
      try {
        const files = await downloadSelected(store, deps, proposal_id, opts);
        tx((t, ws) => approve(t, ws, proposal_id, opts, files));
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        tx((t) => {
          const p = t.research_proposal[proposal_id];
          if (p) p.last_error = message;
        });
        throw e;
      }
    },

    async applyAgentChanges(task_id, proposal_ids) {
      const applied: Id[] = [];
      const kept: { id: Id; reason: string }[] = [];
      const patches: RowPatch[] = [];
      const summary: string[] = [];
      for (const id of proposal_ids) {
        const t = store.getTables();
        const p = t.research_proposal[id];
        if (!p || p.decision !== 'pending' || p.task_id !== task_id) continue;
        const why = needsUser(t, p);
        if (why) { kept.push({ id, reason: why }); continue; }
        // Described before applying, so renamed or split miniatures read as they were.
        const lines = p.result_type === 'catalog_change'
          ? describeOps(t, (p.payload as CatalogChangePayload).operations)
          : [proposalTitle(t, p.result_type, p.payload)];
        try {
          const r = store.transactionWithDiff((tt, ws) => approve(tt, ws, id, {}));
          patches.push(...r.patches);
          applied.push(id);
          summary.push(...lines);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          tx((tt) => { const x = tt.research_proposal[id]; if (x) x.last_error = message; });
          kept.push({ id, reason: message });
        }
      }
      if (!applied.length) return { change_set_id: null, applied, kept_as_proposal: kept };
      const change_set_id = newId();
      tx((t) => {
        t.agent_change_set[change_set_id] = { id: change_set_id, task_id, created_at: now(), summary, proposal_ids: applied, patches, undone_at: null };
        for (const id of applied) { const x = t.research_proposal[id]; if (x) x.change_set_id = change_set_id; }
      });
      return { change_set_id, applied, kept_as_proposal: kept };
    },

    async undoChangeSet(change_set_id) {
      tx((t, ws) => {
        const cs = must(t.agent_change_set[change_set_id], 'Endringen');
        if (cs.undone_at) throw new CommandError('Endringen er allerede angret');
        const { conflicts } = revertPatches(t, cs.patches);
        if (conflicts.length) {
          const what = [...new Set(conflicts.map((c) => TABLE_LABEL[c.table] ?? c.table))].join(', ');
          throw new CommandError(`Kan ikke angre: ${what} er endret etter at agenten gjorde dette. Endre tilbake for hånd, eller be agenten om å rette det.`);
        }
        cs.undone_at = now();
        for (const id of cs.proposal_ids) {
          const p = t.research_proposal[id];
          if (p) { p.decision = 'rejected'; p.last_error = 'Angret'; p.updated_at = now(); }
        }
        record(t, ws, 'agent_change_set', change_set_id, 'undo', { initiated_by: 'user', task_id: cs.task_id });
      });
    },

    async rejectProposal(proposal_id) {
      tx((t, ws) => {
        const p = must(t.research_proposal[proposal_id], 'Forslaget');
        if (p.decision !== 'pending') throw new CommandError('Forslaget er allerede behandlet');
        p.decision = 'rejected';
        p.updated_at = now();
        record(t, ws, 'research_proposal', proposal_id, 'update', { initiated_by: 'user', task_id: p.task_id, proposal_id });
      });
    },
  };
}

const TABLE_LABEL: Record<string, string> = {
  miniature_subject: 'miniatyrer', paint_plan_version: 'maleplaner', plan_element: 'maleplaner', plan_step: 'maleplaner',
  step_material: 'maleplaner', palette_entry: 'paletten', palette_entry_subject: 'paletten', project: 'prosjektet',
  source: 'kilder', source_link: 'kildelenker', source_asset: 'bilder', paint_product: 'malinger',
};

/** Why a proposal cannot be applied without the user (null when it can). */
function needsUser(t: Tables, p: ResearchProposal): string | null {
  if (p.result_type === 'reference_selection') return 'Bildeutvalg velger du selv';
  if (p.result_type === 'technique' || p.result_type === 'recipe') return 'Biblioteket endres bare når du godkjenner';
  if (p.result_type === 'paint_plan' || p.result_type === 'plan_revision') {
    const missing = planProductRefs(p.payload as PaintPlanPayload).filter((r) => !matchProduct(t, r));
    if (missing.length) return `Malinger som ikke finnes i katalogen: ${missing.map((m) => m.name).join(', ')}`;
  }
  return null;
}

/** Godkjenning (skjema §8). One proposal, one transaction. */
/** Images are fetched before the transaction (see images-tx). */
async function downloadSelected(store: Store, deps: ResearchDeps, proposal_id: Id, opts: ApproveOptions): Promise<Downloaded> {
  const p = store.getTables().research_proposal[proposal_id];
  if (p && (p.result_type === 'technique' || p.result_type === 'recipe')) {
    // Library drafts: the example pictures the user kept (default: all). None is fine.
    const wanted = chosenImages((p.payload as { images?: KnowledgeImage[] }).images, opts.image_urls);
    return wanted.length ? downloadImages(store, deps.fetchImage, wanted) : {};
  }
  if (!p || p.result_type !== 'reference_selection') return {};
  const payload = p.payload as ReferenceSelectionPayload;
  const wanted = payload.images.filter((i) => !opts.image_urls || opts.image_urls.includes(i.image_url));
  if (!wanted.length) throw new CommandError('Velg minst ett bilde');
  return downloadImages(store, deps.fetchImage, wanted);
}

function linkEvidence(t: Tables, ws: Id, sources: SourceRef[], subject_id: Id, who: Who) {
  for (const s of sources) {
    const source_id = sourceFor(t, ws, { url: s.url, title: s.title, creator: s.author, kind: 'article' }, who.task_id ?? null, (tt, id, a) => record(t, ws, tt, id, a, who));
    const id = newId();
    t.source_link[id] = { id, source_id, target_type: 'subject', target_id: subject_id, use: 'evidence', layer_id: null, deleted_at: null };
    record(t, ws, 'source_link', id, 'attach', who);
  }
}

function approve(t: Tables, ws: Id, proposal_id: Id, opts: ApproveOptions, files: Downloaded = {}): void {
  const p = must(t.research_proposal[proposal_id], 'Forslaget');
  if (p.decision !== 'pending') throw new CommandError('Forslaget er allerede behandlet');
  const who: Who = { initiated_by: 'agent', task_id: p.task_id, proposal_id };
  const kind: ProposalKind = p.result_type === 'catalog_subject' || p.result_type === 'reference_selection' || p.result_type === 'catalog_change'
    || p.result_type === 'technique' || p.result_type === 'recipe' ? p.result_type : 'paint_plan';
  const scope = checkScope(t, p.task_id, { result_type: kind, payload: p.payload });

  if (kind === 'technique' || kind === 'recipe') {
    // The user approves the draft into the library; it starts as «utkast» and is edited freely after.
    const userWho: Who = { ...who, initiated_by: 'user' };
    const revision = kind === 'technique' ? libraryRevisionTarget(t, p.task_id) : undefined;
    p.applied_target_id = revision
      ? reviseTechnique(t, ws, p, revision.target_id, opts.primary_variant, userWho)
      : kind === 'technique'
      ? approveTechnique(t, ws, p, opts.primary_variant, userWho)
      : approveRecipe(t, ws, p, opts.product_choices ?? {}, opts.primary_variant, userWho);
    // Example pictures go with the technique or recipe (visual_reference), with their pages as sources.
    const images = chosenImages((p.payload as { images?: KnowledgeImage[] }).images, opts.image_urls);
    if (images.length) {
      attachImagesTo(t, ws, { type: kind, id: p.applied_target_id }, images.map((i) => ({
        image_url: i.image_url, page_url: i.page_url, page_title: i.page_title, site: i.site, creator: null, caption: i.caption, kind: null,
      })), files, p.task_id, (tt, id, a) => record(t, ws, tt, id, a, userWho));
    }
    p.decision = 'approved';
    p.updated_at = now();
    p.last_error = null;
    record(t, ws, 'research_proposal', proposal_id, 'update', userWho);
    return;
  }
  const project_id = t.task_scope[p.task_id]!.work_project_id!;

  if (kind === 'catalog_change') {
    applyCatalogChange(t, ws, project_id, p.payload as CatalogChangePayload, p.uncertainty, who);
  } else if (kind === 'catalog_subject') {
    const c = p.payload as CatalogSubjectPayload;
    const ex = c.expansion_name
      ? attachedExpansions(t, project_id).find((e) => e.name.trim().toLowerCase() === c.expansion_name!.trim().toLowerCase())
      : undefined;
    const id = newId();
    t.miniature_subject[id] = {
      id, project_id, expansion_id: ex?.id ?? null, name: c.name, grouping: c.grouping,
      physical_count: c.grouping === 'single' ? 1 : c.physical_count, category_label: c.category_label,
      official_asset_id: null, plan_state: 'none', in_progress: false, finished_count: 0,
      count_basis: c.count_basis, grouping_basis: c.grouping_basis,
      uncertainty: [
        ...p.uncertainty,
        ...(c.expansion_name && !ex ? [{ path: 'expansion', reason: `Utvidelsen «${c.expansion_name}» er ikke med i prosjektet` }] : []),
      ],
      current_plan_version_id: null, deleted_at: null,
    };
    record(t, ws, 'miniature_subject', id, 'create', who);
    linkEvidence(t, ws, c.sources ?? [], id, who);
    // From a game survey: who the figure is (still to be confirmed), and the pages that probably show it.
    if (c.identity) t.miniature_subject[id]!.identity = { ...structuredClone(c.identity), status: 'proposed', found_by_task_id: p.task_id, updated_at: now() };
    for (const url of c.shown_on ?? []) {
      const src = Object.values(t.source).find((x) => !x.deleted_at && x.url === url);
      if (!src || Object.values(t.source_link).some((l) => l.source_id === src.id && l.target_type === 'subject' && l.target_id === id && l.use === 'evidence')) continue;
      const lid = newId();
      t.source_link[lid] = { id: lid, source_id: src.id, target_type: 'subject', target_id: id, use: 'evidence', layer_id: null, deleted_at: null, suggested_by_task_id: p.task_id };
      record(t, ws, 'source_link', lid, 'attach', who);
    }
  } else if (kind === 'reference_selection') {
    const r = p.payload as ReferenceSelectionPayload;
    const s = t.miniature_subject[r.subject_id]!;
    const chosen = r.images.filter((i) => !opts.image_urls || opts.image_urls.includes(i.image_url));
    const assets = attachImages(t, ws, s.id, chosen, files, p.task_id, (tt, id, a) => record(t, ws, tt, id, a, who));
    const keptPages = new Set(chosen.map((i) => i.page_url));
    addSourceLayers(t, (r.sources_read ?? []).filter((x) => keptPages.has(x.url)), project_id);
    const firstAsset = chosen[0] ? assets[chosen[0].image_url] : undefined;
    if (opts.cover_image_url && assets[opts.cover_image_url]) {
      setCover(t, s.id, assets[opts.cover_image_url]!, (tt, id, a) => record(t, ws, tt, id, a, who));
      record(t, ws, 'miniature_subject', s.id, 'update', { ...who, initiated_by: 'user' });
    } else if (opts.set_cover && firstAsset && !s.official_asset_id) {
      s.official_asset_id = firstAsset;
    }
  } else {
    const plan = p.payload as PaintPlanPayload;
    const s = t.miniature_subject[plan.subject_id]!;
    // Stale base: a newer version was approved meanwhile; it stays (skjema §8 step 4).
    if (scope.result_type === 'plan_revision' && s.current_plan_version_id !== p.base_version_id) {
      throw new CommandError('En nyere versjon av planen er godkjent etter at forslaget ble laget. Be agenten om et nytt forslag.');
    }
    const products = resolveProducts(t, ws, planProductRefs(plan), opts.product_choices ?? {}, who);
    const prev = s.current_plan_version_id ? t.paint_plan_version[s.current_plan_version_id] : undefined;
    const version_number = Math.max(0, ...Object.values(t.paint_plan_version).filter((v) => v.subject_id === s.id).map((v) => v.version_number)) + 1;
    const pv = newId();
    t.paint_plan_version[pv] = {
      id: pv, subject_id: s.id, version_number, state: 'approved', origin: 'proposal',
      supersedes_id: prev?.id ?? null, created_at: now(), summary: plan.summary ?? null,
    };
    plan.elements.forEach((el, ei) => {
      const eid = newId();
      t.plan_element[eid] = { id: eid, plan_version_id: pv, kind: el.kind, position: ei, name: el.name };
      el.steps.forEach((st, si) => {
        const sid = newId();
        t.plan_step[sid] = { id: sid, element_id: eid, position: si, instruction: st.instruction, technique_version_id: null, recipe_version_id: null };
        st.materials.forEach((m, mi) => {
          const mid = newId();
          t.step_material[mid] = { id: mid, step_id: sid, position: mi, product_id: products[productKey(m.product)]!, role: m.role, role_label: m.role_label };
        });
        if (st.mix) {
          const gid = newId();
          t.mix_group[gid] = { id: gid, step_id: sid, label: st.mix.label };
          st.mix.components.forEach((c, ci) => t.mix_component.push({ mix_group_id: gid, position: ci, product_id: products[productKey(c.product)]!, parts: c.parts }));
        }
      });
    });
    if (prev) prev.state = 'superseded';
    s.current_plan_version_id = pv;
    s.plan_state = 'approved';
    addPalette(t, ws, project_id, s.id, plan.palette ?? [], products, who);
    for (const src of plan.sources ?? []) {
      const source_id = sourceFor(t, ws, { url: src.url, title: src.title, creator: src.author, kind: 'article' }, p.task_id, (tt, id, a) => record(t, ws, tt, id, a, who));
      if (!Object.values(t.source_link).some((l) => !l.deleted_at && l.source_id === source_id && l.target_type === 'subject' && l.target_id === s.id && l.use === 'method')) {
        const id = newId();
        t.source_link[id] = { id, source_id, target_type: 'subject', target_id: s.id, use: 'method', layer_id: null, deleted_at: null };
        record(t, ws, 'source_link', id, 'attach', who);
      }
    }
    addSourceLayers(t, plan.sources_read ?? [], project_id);
    record(t, ws, 'paint_plan', s.id, 'new_version', who, prev?.id ?? null, pv);
  }

  p.decision = 'approved';
  p.updated_at = now();
  p.last_error = null;
}

/**
 * Applies catalog operations in the same transaction as the approval.
 * Deletes are soft (restorable); split and merge create new miniatures and
 * soft-delete the originals, carrying the illustration over.
 */
function applyCatalogChange(t: Tables, ws: Id, project_id: Id, payload: CatalogChangePayload, uncertainty: Uncertainty[], who: Who) {
  const expansions = attachedExpansions(t, project_id);
  const expansionId = (name: string | null | undefined, fallback: Id | null): Id | null => {
    if (name === undefined) return fallback;
    if (name === null) return null;
    return expansions.find((e) => e.name.trim().toLowerCase() === name.trim().toLowerCase())?.id ?? fallback;
  };
  const apply = (s: MiniatureSubject, f: SubjectFields) => {
    if (f.name !== undefined) s.name = f.name;
    if (f.grouping !== undefined) s.grouping = f.grouping;
    if (f.physical_count !== undefined) s.physical_count = f.physical_count;
    if (f.expansion_name !== undefined) s.expansion_id = expansionId(f.expansion_name, s.expansion_id);
    if (f.category_label !== undefined) s.category_label = f.category_label;
    if (s.grouping === 'single') s.physical_count = 1;
    if (s.physical_count < 1) s.physical_count = 1;
    if (s.finished_count > s.physical_count) s.finished_count = s.physical_count;
  };
  const create = (f: SubjectFields & { name: string }, from?: MiniatureSubject): Id => {
    const id = newId();
    const s: MiniatureSubject = {
      id, project_id, expansion_id: from?.expansion_id ?? null, name: f.name, grouping: 'single', physical_count: 1,
      category_label: from?.category_label ?? null, official_asset_id: from?.official_asset_id ?? null, plan_state: 'none',
      in_progress: false, finished_count: 0, count_basis: null, grouping_basis: null, uncertainty: uncertainty.length ? uncertainty : null,
      current_plan_version_id: null, deleted_at: null,
    };
    apply(s, f);
    t.miniature_subject[id] = s;
    record(t, ws, 'miniature_subject', id, 'create', who);
    return id;
  };
  const remove = (s: MiniatureSubject) => {
    s.deleted_at = now();
    record(t, ws, 'miniature_subject', s.id, 'delete', who);
  };
  for (const o of payload.operations) {
    if (o.op === 'create') { create(o.fields); continue; }
    if (o.op === 'merge') {
      const olds = o.subject_ids.map((id) => t.miniature_subject[id]!).filter((x) => !x.deleted_at);
      create(o.into, olds[0]);
      olds.forEach(remove);
      continue;
    }
    const s = t.miniature_subject[o.subject_id];
    if (!s || s.deleted_at) throw new CommandError('En miniatyr i endringen er allerede slettet');
    if (o.op === 'update') { apply(s, o.set); record(t, ws, 'miniature_subject', s.id, 'update', who); }
    else if (o.op === 'delete') remove(s);
    else if (o.op === 'split') { o.into.forEach((f) => create(f, s)); remove(s); }
  }
}

/**
 * The miniature's palette (datamodell v3 §8): one palette entry per product,
 * scoped to this subject. Existing entries for the same product and subject
 * are kept; the project's content revision goes up when anything is added.
 */
function addPalette(t: Tables, ws: Id, project_id: Id, subject_id: Id, items: PaletteItem[], products: Record<string, Id>, who: Who) {
  let added = 0;
  for (const it of items) {
    const product_id = products[productKey(it.product)];
    if (!product_id) continue;
    const exists = Object.values(t.palette_entry).some((e) => !e.deleted_at && e.project_id === project_id && e.product_id === product_id
      && e.scope_kind === 'subjects' && t.palette_entry_subject.some((x) => x.palette_entry_id === e.id && x.subject_id === subject_id));
    if (exists) continue;
    const id = newId();
    t.palette_entry[id] = {
      id, project_id, product_id, role_label: it.role_label, note: it.part, scope_kind: 'subjects',
      expansion_id: null, category_label: null, deleted_at: null,
    };
    t.palette_entry_subject.push({ palette_entry_id: id, subject_id });
    record(t, ws, 'palette_entry', id, 'create', who);
    added++;
  }
  if (added && t.project[project_id]) t.project[project_id]!.content_revision++;
}

// ---------- Bibliotek (bit 7.4) ----------

/**
 * A library task may add summaries only to sources it found itself, or to sources
 * already linked to the library. Sources of a game are left untouched (AVVIK regel 1).
 */
function libraryMayWrite(t: Tables, task_id: Id, url: string): boolean {
  const s = Object.values(t.source).find((x) => !x.deleted_at && x.url === url);
  if (!s) return false;
  if (s.created_by_task_id === task_id) return true;
  return Object.values(t.source_link).some((l) => !l.deleted_at && l.source_id === s.id && (l.target_type === 'technique' || l.target_type === 'recipe'));
}

/** Links the draft's sources to the new technique or recipe (use = method), with the agent's summaries. */
function linkMethodSources(t: Tables, ws: Id, target_type: 'technique' | 'recipe', target_id: Id, sources: SourceRef[], read: SourceRead[] | undefined, who: Who) {
  const linked = new Set<string>();
  // Decided before linking: a page that already belongs to a game keeps its content (AVVIK regel 1).
  const writable = new Set((read ?? []).map((r) => r.url).filter((url) =>
    !Object.values(t.source).some((x) => !x.deleted_at && x.url === url) || libraryMayWrite(t, who.task_id ?? '', url)));
  for (const s of sources) {
    if (linked.has(s.url)) continue;
    linked.add(s.url);
    const source_id = sourceFor(t, ws, { url: s.url, title: s.title, creator: s.author, kind: 'article' }, who.task_id ?? null, (tt, id, a) => record(t, ws, tt, id, a, who));
    const id = newId();
    t.source_link[id] = { id, source_id, target_type, target_id, use: 'method', layer_id: null, deleted_at: null };
    record(t, ws, 'source_link', id, 'attach', who);
  }
  // Summaries only for the pages that are now linked to the library.
  addSourceLayers(t, (read ?? []).filter((r) => linked.has(r.url) && writable.has(r.url)));
}

function chosenImages(images: KnowledgeImage[] | undefined, chosen: string[] | undefined): KnowledgeImage[] {
  return (images ?? []).filter((i) => !chosen || chosen.includes(i.image_url));
}

/** The technique an improvement task is about (bit 7.6), if any. */
export function libraryRevisionTarget(t: Tables, task_id: Id) {
  return Object.values(t.task_revision_target).find((r) => r.task_id === task_id && r.target_type === 'technique');
}

/**
 * Writes an approved improvement into the technique (no versions, brukerbeslutning 11.11.2026).
 * Refuses when the technique was changed after the draft was made; nothing is overwritten then.
 * Status and experiences stay. New sources are added; existing ones stay.
 */
function reviseTechnique(t: Tables, ws: Id, p: ResearchProposal, technique_id: Id, primary: number | undefined, who: Who): Id {
  const tech = must(t.technique[technique_id], 'Teknikken');
  if (tech.deleted_at) throw new CommandError('Teknikken er slettet');
  if (tech.updated_at !== p.base_version_id) {
    throw new CommandError('Teknikken er endret etter at forslaget ble laget. Be agenten om et nytt forslag.');
  }
  const x = p.payload as TechniquePayload;
  Object.assign(tech, {
    name: x.name, tags: x.tags, desired_result: x.desired_result, use_area: x.use_area, materials: x.materials,
    variants: variantsText(x.comparison, primary) ?? x.variants, risk_note: x.risk_note,
    evidence: p.evidence, uncertainty: p.uncertainty, updated_at: now(),
  });
  for (const st of Object.values(t.technique_step)) if (st.technique_id === technique_id) delete t.technique_step[st.id];
  x.steps.forEach((st, position) => {
    const sid = newId();
    t.technique_step[sid] = { id: sid, technique_id, position, title: st.title, instruction: st.instruction, basis: st.basis };
  });
  record(t, ws, 'technique', technique_id, 'update', who);
  // Only sources not already linked to the technique.
  const linked = new Set(Object.values(t.source_link)
    .filter((l) => !l.deleted_at && l.target_type === 'technique' && l.target_id === technique_id)
    .map((l) => t.source[l.source_id]?.url));
  linkMethodSources(t, ws, 'technique', technique_id, x.sources.filter((s) => !linked.has(s.url)), x.sources_read, who);
  return technique_id;
}

function approveTechnique(t: Tables, ws: Id, p: ResearchProposal, primary: number | undefined, who: Who): Id {
  const x = p.payload as TechniquePayload;
  // The compared variants, with the user's choice first, replace the agent's free text.
  const variants = variantsText(x.comparison, primary) ?? x.variants;
  const id = newId();
  const ts = now();
  const taken = new Set(Object.values(t.technique).filter((r) => !r.deleted_at).map((r) => r.name.toLowerCase()));
  t.technique[id] = {
    id, workspace_id: ws, name: taken.has(x.name.toLowerCase()) ? `${x.name} (ny)` : x.name, tags: x.tags, status: 'draft',
    desired_result: x.desired_result, use_area: x.use_area, materials: x.materials, variants, risk_note: x.risk_note,
    evidence: p.evidence, uncertainty: p.uncertainty, created_at: ts, updated_at: ts, deleted_at: null,
  };
  x.steps.forEach((st, position) => {
    const sid = newId();
    t.technique_step[sid] = { id: sid, technique_id: id, position, title: st.title, instruction: st.instruction, basis: st.basis };
  });
  record(t, ws, 'technique', id, 'create', who);
  linkMethodSources(t, ws, 'technique', id, x.sources, x.sources_read, who);
  return id;
}

function approveRecipe(t: Tables, ws: Id, p: ResearchProposal, choices: Record<string, Id | 'create'>, primary: number | undefined, who: Who): Id {
  const x = p.payload as RecipePayload;
  // A recipe has no variants field: the compared variants go into the note.
  const variants = variantsText(x.comparison, primary);
  const note = [x.note, variants ? `Varianter:\n${variants}` : null].filter(Boolean).join('\n\n') || null;
  const products = resolveProducts(t, ws, recipeProductRefs(x), choices, who);
  const id = newId();
  const ts = now();
  const taken = new Set(Object.values(t.recipe).filter((r) => !r.deleted_at).map((r) => r.name.toLowerCase()));
  t.recipe[id] = {
    id, workspace_id: ws, name: taken.has(x.name.toLowerCase()) ? `${x.name} (ny)` : x.name, tags: x.tags, status: 'draft',
    effect: x.effect, note, evidence: p.evidence, uncertainty: p.uncertainty, created_at: ts, updated_at: ts, deleted_at: null,
  };
  const paintIds = x.paints.map((pe, position) => {
    const pid = newId();
    t.recipe_paint[pid] = { id: pid, recipe_id: id, position, product_id: products[productKey(pe.product)]!, role: pe.role, note: pe.note };
    return pid;
  });
  x.steps.forEach((st, position) => {
    const sid = newId();
    const tech = st.technique_id ? t.technique[st.technique_id] : undefined;
    t.recipe_step[sid] = {
      id: sid, recipe_id: id, position, instruction: st.instruction,
      paint_ids: st.paints.map((i) => paintIds[i]).filter((v): v is Id => !!v),
      technique_id: tech && !tech.deleted_at ? tech.id : null,
    };
  });
  record(t, ws, 'recipe', id, 'create', who);
  linkMethodSources(t, ws, 'recipe', id, x.sources, x.sources_read, who);
  return id;
}

/** Every product must be an existing id, an unambiguous match, or created by the user here (skjema §8 step 3). */
function resolveProducts(t: Tables, ws: Id, refs: ProductRef[], choices: Record<string, Id | 'create'>, who: Who): Record<string, Id> {
  const out: Record<string, Id> = {};
  const missing: string[] = [];
  for (const ref of refs) {
    const key = productKey(ref);
    const choice = choices[key];
    if (choice === 'create') {
      const id = newId();
      t.paint_product[id] = {
        id, workspace_id: ws, manufacturer: ref.manufacturer, range_name: ref.range, name: ref.name,
        product_kind: 'other', coverage: null, finish: null, identity_status: 'unconfirmed', swatch_hex: ref.hex ?? null,
        created_at: now(), deleted_at: null,
      };
      record(t, ws, 'paint_product', id, 'create', { ...who, initiated_by: 'user' });
      out[key] = id;
    } else if (choice) {
      if (!t.paint_product[choice] || t.paint_product[choice]!.deleted_at) throw new CommandError(`Valgt produkt for «${ref.name}» finnes ikke`);
      out[key] = choice;
    } else {
      const m = matchProduct(t, ref);
      if (m) out[key] = m.id;
      else missing.push(ref.name);
    }
  }
  if (missing.length) throw new CommandError(`Velg eller opprett produkt for: ${missing.join(', ')}`);
  return out;
}
