import { CommandError } from '../domain/commands';
import { newId, now } from '../domain/ids';
import { matchProduct, planProductRefs, productKey } from '../domain/agent';
import type { CatalogSubjectPayload, NormalisedProposal, PaintPlanPayload, ProductRef, ProposalKind, ReferenceSelectionPayload, SourceRef } from '../domain/agent';
import type { AgentCommands, ApproveOptions, ProposalWrite, ResearchCommands } from '../domain/research';
import type { ChangeAction, Id, ResearchProposal, ResultType, Tables } from '../domain/types';
import { attachedExpansions } from '../domain/views';
import type { Store } from './store';

/** Result types implemented in this version. See docs/AVVIK.md. */
export const IMPLEMENTED_TYPES: ResultType[] = ['catalog_subject', 'paint_plan', 'reference_selection'];

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
  const project = scope.work_project_id ? t.project[scope.work_project_id] : undefined;
  if (!project || project.deleted_at) throw new CommandError('Arbeidsprosjektet finnes ikke lenger');

  if (p.result_type === 'catalog_subject') {
    if (!types.has('catalog_subject')) throw new CommandError('Oppgaven tillater ikke nye miniatyrer');
    return { result_type: 'catalog_subject', base_version_id: null };
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
  // An approved plan exists: only a revision of an opened target is allowed.
  const target = Object.values(t.task_revision_target).find(
    (r) => r.task_id === task_id && r.target_type === 'paint_plan' && r.target_id === subject.id,
  );
  if (!target || !types.has('plan_revision')) {
    throw new CommandError(`«${subject.name}» har en godkjent maleplan. Agenten kan bare foreslå en ny versjon når du åpner planen for revisjon.`);
  }
  return { result_type: 'plan_revision', base_version_id: target.base_version_id };
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
    async startTask(project_id) {
      return tx((t, ws) => {
        const p = must(t.project[project_id], 'Prosjektet');
        if (p.deleted_at) throw new CommandError('Prosjektet er slettet');
        const id = newId();
        t.research_task[id] = { id, workspace_id: ws, status: 'open', created_at: now() };
        // System sets scope and result types in the same transaction (skjema §7).
        t.task_scope[id] = { task_id: id, area_kind: 'new_project', work_project_id: project_id, allow_new_knowledge: false };
        for (const result_type of IMPLEMENTED_TYPES) t.task_result_type.push({ task_id: id, result_type });
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

/** Godkjenning (skjema §8). One proposal, one transaction. */
type Downloaded = Record<string, { file_id: Id; media_type: string; byte_size: number }>;

/**
 * Images are fetched before the transaction so that the transaction itself
 * stays synchronous and all-or-nothing. A failed download stops approval
 * and names the image, so the user can deselect it.
 */
async function downloadSelected(store: Store, deps: ResearchDeps, proposal_id: Id, opts: ApproveOptions): Promise<Downloaded> {
  const p = store.getTables().research_proposal[proposal_id];
  if (!p || p.result_type !== 'reference_selection') return {};
  if (!deps.fetchImage) throw new CommandError('Bildene kan ikke hentes uten Paintrest-serveren');
  const payload = p.payload as ReferenceSelectionPayload;
  const wanted = payload.images.filter((i) => !opts.image_urls || opts.image_urls.includes(i.image_url));
  if (!wanted.length) throw new CommandError('Velg minst ett bilde');
  const out: Downloaded = {};
  const failed: string[] = [];
  for (const img of wanted) {
    try {
      const blob = await deps.fetchImage(img.image_url);
      const file_id = newId();
      await store.persistence.putBlob(file_id, blob);
      out[img.image_url] = { file_id, media_type: blob.type, byte_size: blob.size };
    } catch (e) {
      failed.push(`${img.caption ?? img.image_url} (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  if (failed.length) {
    await Promise.all(Object.values(out).map((f) => store.persistence.deleteBlob(f.file_id)));
    throw new CommandError(`Kunne ikke hente ${failed.length} bilde(r): ${failed.join('; ')}. Fjern haken og prøv igjen.`);
  }
  return out;
}

/** Reuses a kept source with the same URL, otherwise creates one (retention kept on approval, skjema §8 step 6). */
function sourceFor(t: Tables, ws: Id, ref: { url: string; title: string; creator: string | null; kind: 'gallery' | 'article' }, who: Who): Id {
  const existing = Object.values(t.source).find((x) => !x.deleted_at && x.url === ref.url);
  if (existing) {
    existing.retention = 'kept';
    return existing.id;
  }
  const id = newId();
  t.source[id] = {
    id, workspace_id: ws, kind: ref.kind, title: ref.title, creator: ref.creator, url: ref.url, locator: null,
    analysis_state: 'stored', retention: 'kept', created_by_task_id: who.task_id ?? null, created_at: now(), deleted_at: null,
  };
  record(t, ws, 'source', id, 'create', who);
  return id;
}

function linkEvidence(t: Tables, ws: Id, sources: SourceRef[], subject_id: Id, who: Who) {
  for (const s of sources) {
    const source_id = sourceFor(t, ws, { url: s.url, title: s.title, creator: s.author, kind: 'article' }, who);
    const id = newId();
    t.source_link[id] = { id, source_id, target_type: 'subject', target_id: subject_id, use: 'evidence', layer_id: null, deleted_at: null };
    record(t, ws, 'source_link', id, 'attach', who);
  }
}

function approve(t: Tables, ws: Id, proposal_id: Id, opts: ApproveOptions, files: Downloaded = {}): void {
  const p = must(t.research_proposal[proposal_id], 'Forslaget');
  if (p.decision !== 'pending') throw new CommandError('Forslaget er allerede behandlet');
  const who: Who = { initiated_by: 'agent', task_id: p.task_id, proposal_id };
  const kind: ProposalKind = p.result_type === 'catalog_subject' || p.result_type === 'reference_selection' ? p.result_type : 'paint_plan';
  const scope = checkScope(t, p.task_id, { result_type: kind, payload: p.payload });
  const project_id = t.task_scope[p.task_id]!.work_project_id!;

  if (kind === 'catalog_subject') {
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
  } else if (kind === 'reference_selection') {
    const r = p.payload as ReferenceSelectionPayload;
    const s = t.miniature_subject[r.subject_id]!;
    const chosen = r.images.filter((i) => files[i.image_url]);
    const byPage = new Map<string, typeof chosen>();
    for (const img of chosen) byPage.set(img.page_url, [...(byPage.get(img.page_url) ?? []), img]);
    let firstAsset: Id | null = null;
    for (const [page_url, imgs] of byPage) {
      const first = imgs[0]!;
      const source_id = sourceFor(t, ws, { url: page_url, title: first.page_title, creator: first.creator ?? first.site, kind: 'gallery' }, who);
      const link_id = newId();
      t.source_link[link_id] = { id: link_id, source_id, target_type: 'subject', target_id: s.id, use: 'visual_reference', layer_id: null, deleted_at: null };
      const startPos = Object.values(t.source_asset).filter((a) => a.source_id === source_id).length;
      imgs.forEach((img, i) => {
        const f = files[img.image_url]!;
        t.stored_file[f.file_id] = {
          id: f.file_id, workspace_id: ws, purpose: 'source_asset', storage_key: f.file_id,
          media_type: f.media_type, byte_size: f.byte_size, created_at: now(), deleted_at: null,
        };
        const asset_id = newId();
        // locator keeps the original image address, so the picture can be traced back.
        t.source_asset[asset_id] = { id: asset_id, source_id, position: startPos + i, locator: img.image_url, caption: img.caption, file_id: f.file_id, deleted_at: null };
        t.source_link_asset.push({ link_id, source_asset_id: asset_id });
        firstAsset ??= asset_id;
      });
      record(t, ws, 'source_link', link_id, 'attach', who);
    }
    if (opts.set_cover && firstAsset && !s.official_asset_id) s.official_asset_id = firstAsset;
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
      supersedes_id: prev?.id ?? null, created_at: now(),
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
    record(t, ws, 'paint_plan', s.id, 'new_version', who, prev?.id ?? null, pv);
  }

  p.decision = 'approved';
  p.updated_at = now();
  p.last_error = null;
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
        product_kind: 'other', coverage: null, finish: null, identity_status: 'unconfirmed', swatch_hex: null,
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
