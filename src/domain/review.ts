/**
 * Gjennomgang (brukerønske 11.11.2026): after a game survey or image hunts, the user goes through the
 * miniatures that have something waiting, one at a time, in the order of the miniature list.
 */
import type { ReferenceImage, ReferenceSelectionPayload } from './agent';
import type { Id, ResearchProposal, Tables } from './types';
import { liveSubjects, subjectReferences, suggestedSources } from './views';

/** Web addresses of the pictures saved on the project's miniatures. */
export function savedImageUrls(t: Tables, project_id: Id): Map<string, Id[]> {
  const out = new Map<string, Id[]>();
  for (const s of liveSubjects(t, project_id)) {
    for (const r of subjectReferences(t, s)) {
      if (r.asset.locator) out.set(r.asset.locator, [...(out.get(r.asset.locator) ?? []), s.id]);
    }
  }
  return out;
}

/** Image proposals still waiting, in the project's open tasks (image hunts, surveys and the panel). */
export function pendingImageProposals(t: Tables, project_id: Id): ResearchProposal[] {
  const open = new Set(Object.values(t.research_task).filter((x) => x.status === 'open' && t.task_scope[x.id]?.work_project_id === project_id).map((x) => x.id));
  return Object.values(t.research_proposal)
    .filter((p) => p.decision === 'pending' && p.result_type === 'reference_selection' && open.has(p.task_id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

/** A proposal's pictures that are neither saved on a miniature nor set aside by the user. */
export function openImages(p: ResearchProposal, saved: Map<string, Id[]>): ReferenceImage[] {
  const pl = p.payload as ReferenceSelectionPayload;
  const gone = new Set(pl.dismissed ?? []);
  return pl.images.filter((i) => !gone.has(i.image_url) && !saved.has(i.image_url));
}

/** One picture in the pool: what the agent thinks it shows, and how sure it is. */
export interface PoolImage {
  image: ReferenceImage;
  /** The miniatures the agent proposed it for, surest first. */
  guesses: { subject_id: Id; name: string; confidence: 'high' | 'medium' | 'low' | null }[];
  confidence: 'high' | 'medium' | 'low' | null;
  /** Miniatures it is already saved on (a group picture can go on several). */
  placed_on: Id[];
  proposal_ids: Id[];
}

/**
 * «Funn»: every picture the agent found for the project, once, from the image proposals still waiting.
 * Set-aside pictures are left out; saved ones are kept (marked), since a group picture may belong to several.
 * Order: what the agent is surest of first, then by the miniature it guessed, in list order.
 */
export function imagePool(t: Tables, project_id: Id): PoolImage[] {
  const saved = savedImageUrls(t, project_id);
  const subjects = liveSubjects(t, project_id);
  const order = new Map(subjects.map((s, i) => [s.id, i]));
  const names = new Map(subjects.map((s) => [s.id, s.name]));
  const pool = new Map<string, PoolImage>();
  // Proposals that closed because their pictures were used stay in the pool as «Brukt»: a group picture
  // can still go on the other miniatures the agent guessed.
  const open = new Set(Object.values(t.research_task).filter((x) => x.status === 'open' && t.task_scope[x.id]?.work_project_id === project_id).map((x) => x.id));
  const used = Object.values(t.research_proposal).filter((p) => p.result_type === 'reference_selection' && p.closed_by === 'images' && p.decision === 'approved' && open.has(p.task_id));
  for (const p of [...pendingImageProposals(t, project_id), ...used]) {
    const pl = p.payload as ReferenceSelectionPayload;
    if (!order.has(pl.subject_id)) continue;
    const gone = new Set(pl.dismissed ?? []);
    for (const i of pl.images) {
      if (gone.has(i.image_url) || (p.decision !== 'pending' && !saved.has(i.image_url))) continue;
      const cur = pool.get(i.image_url) ?? { image: i, guesses: [], confidence: null, placed_on: saved.get(i.image_url) ?? [], proposal_ids: [] };
      if (!cur.guesses.some((g) => g.subject_id === pl.subject_id)) cur.guesses.push({ subject_id: pl.subject_id, name: names.get(pl.subject_id)!, confidence: i.confidence ?? null });
      if (!cur.proposal_ids.includes(p.id)) cur.proposal_ids.push(p.id);
      if (rank(i.confidence) < rank(cur.confidence)) { cur.confidence = i.confidence ?? null; cur.image = { ...cur.image, reason: i.reason ?? cur.image.reason, caption: i.caption ?? cur.image.caption }; }
      if (!cur.image.thumbnail_url && i.thumbnail_url) cur.image = { ...cur.image, thumbnail_url: i.thumbnail_url };
      pool.set(i.image_url, cur);
    }
  }
  for (const x of pool.values()) x.guesses.sort((a, b) => rank(a.confidence) - rank(b.confidence) || order.get(a.subject_id)! - order.get(b.subject_id)!);
  return [...pool.values()].sort((a, b) => rank(a.confidence) - rank(b.confidence)
    || (order.get(a.guesses[0]?.subject_id ?? '') ?? 999) - (order.get(b.guesses[0]?.subject_id ?? '') ?? 999));
}

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
  const pending = pendingImageProposals(t, project_id);
  const saved = savedImageUrls(t, project_id);
  return liveSubjects(t, project_id).flatMap((s) => {
    const mine = pending.filter((p) => (p.payload as ReferenceSelectionPayload).subject_id === s.id);
    // Only what is still open: not saved on a miniature, not set aside.
    const imgs = mine.flatMap((p) => openImages(p, saved));
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
