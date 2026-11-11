/**
 * Gjennomgang (brukerønske 11.11.2026): after a game survey or image hunts, the user goes through the
 * miniatures that have something waiting, one at a time, in the order of the miniature list.
 */
import type { ReferenceSelectionPayload } from './agent';
import type { Id, Tables } from './types';
import { liveSubjects, suggestedSources } from './views';

export interface ReviewItem {
  subject_id: Id;
  name: string;
  /** Pictures waiting in image proposals (from any open task in the project). */
  images: number;
  /** The first proposed picture, for a preview where the miniature has none. */
  preview: { image_url: string; thumbnail_url: string | null } | null;
  /** The agent's identification is waiting for «Riktig figur» or «Feil figur». */
  identity: boolean;
  /** Pages a survey suggested show it («Trolig figuren»); shown in the walkthrough, not a reason on their own. */
  likely: number;
}

/** What waits for the user, per miniature, in list order. Miniatures with nothing waiting are left out. */
export function reviewQueue(t: Tables, project_id: Id): ReviewItem[] {
  const open = new Set(Object.values(t.research_task).filter((x) => x.status === 'open' && t.task_scope[x.id]?.work_project_id === project_id).map((x) => x.id));
  const pending = Object.values(t.research_proposal)
    .filter((p) => p.decision === 'pending' && p.result_type === 'reference_selection' && open.has(p.task_id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return liveSubjects(t, project_id).flatMap((s) => {
    const mine = pending.filter((p) => (p.payload as ReferenceSelectionPayload).subject_id === s.id);
    const imgs = mine.flatMap((p) => (p.payload as ReferenceSelectionPayload).images);
    const images = new Set(imgs.map((i) => i.image_url)).size;
    const identity = s.identity?.status === 'proposed';
    const likely = suggestedSources(t, s.id).length;
    // Pages «Trolig figuren» are shown, but alone they do not keep a miniature in the walkthrough.
    if (!images && !identity) return [];
    const best = [...imgs].sort((a, b) => rank(a.confidence) - rank(b.confidence))[0];
    const official = s.identity?.images[0];
    const preview = best ? { image_url: best.image_url, thumbnail_url: best.thumbnail_url ?? null }
      : official ? { image_url: official.image_url, thumbnail_url: official.thumbnail_url } : null;
    return [{ subject_id: s.id, name: s.name, images, preview, identity, likely }];
  });
}

function rank(c: string | null | undefined): number {
  return c === 'high' ? 0 : c === 'medium' ? 1 : c === 'low' ? 2 : 3;
}
