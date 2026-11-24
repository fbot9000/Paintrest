/**
 * «Venter på deg» in the agent column (O-17): what the agent's work in a project is waiting
 * for, counted for the whole project, with one action each. The results themselves live where
 * they belong (the board, the miniature list, the Maleplan tab); this only points there.
 */
import type { CatalogSubjectPayload, PaintPlanPayload } from './agent';
import { imagePool, reviewQueue } from './review';
import type { PoolImage, ReviewItem } from './review';
import { panelTask } from './tasks';
import type { Id, ResearchProposal, Tables } from './types';
import { attachedExpansions, liveSubjects } from './views';

export interface MissingMiniature {
  p: ResearchProposal;
  c: CatalogSubjectPayload;
  /** The expansion it belongs to is not in the project (it is added to the base game). */
  unknownExpansion: boolean;
}

export interface PlanWaiting {
  subject_id: Id;
  name: string;
  /** True for a new version of an approved plan. */
  revision: boolean;
}

export interface ProjectWaiting {
  /** Found pictures not yet on a miniature (the board, «Fordel bilder»), surest first. */
  pool: PoolImage[];
  /** Miniatures with something waiting (pictures, «Riktig figur»), in list order. */
  queue: ReviewItem[];
  /** Miniatures the game survey found missing from the list. */
  missing: MissingMiniature[];
  /** Plan proposals from the workspace (one per miniature). The panel's own proposals are shown with the conversation. */
  plans: PlanWaiting[];
}

/** Miniatures the game survey found missing from the list, waiting for «Legg til». */
export function missingMiniatures(t: Tables, project_id: Id): MissingMiniature[] {
  const surveys = new Set(Object.values(t.research_task).filter((x) => x.status === 'open' && t.task_scope[x.id]?.work_project_id === project_id && t.task_scope[x.id]?.game_focus).map((x) => x.id));
  const attached = new Set(attachedExpansions(t, project_id).map((e) => e.name.trim().toLowerCase()));
  return Object.values(t.research_proposal)
    .filter((p) => p.decision === 'pending' && p.result_type === 'catalog_subject' && surveys.has(p.task_id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((p) => {
      const c = p.payload as CatalogSubjectPayload;
      return { p, c, unknownExpansion: !!c.expansion_name && !attached.has(c.expansion_name.trim().toLowerCase()) };
    });
}

export function projectWaiting(t: Tables, project_id: Id): ProjectWaiting {
  const panel = panelTask(t, project_id)?.id ?? null;
  const subjects = liveSubjects(t, project_id);
  const open = new Set(Object.values(t.research_task).filter((x) => x.status === 'open' && x.id !== panel && t.task_scope[x.id]?.work_project_id === project_id).map((x) => x.id));
  const planFor = new Set(Object.values(t.research_proposal)
    .filter((p) => p.decision === 'pending' && (p.result_type === 'paint_plan' || p.result_type === 'plan_revision') && open.has(p.task_id))
    .map((p) => (p.payload as PaintPlanPayload).subject_id));
  return {
    pool: imagePool(t, project_id).filter((x) => !x.placed_on.length),
    queue: reviewQueue(t, project_id),
    missing: missingMiniatures(t, project_id),
    plans: subjects.filter((s) => planFor.has(s.id)).map((s) => ({ subject_id: s.id, name: s.name, revision: !!s.current_plan_version_id })),
  };
}

/** How many things wait in all, for the closed column's counter. */
export function waitingCount(w: ProjectWaiting): number {
  return (w.pool.length ? 1 : 0) + w.queue.filter((q) => q.identity).length + w.missing.length + w.plans.length;
}
