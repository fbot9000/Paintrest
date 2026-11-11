/**
 * Starts the workspace's agent runs in the shared run registry, so they keep
 * going when the user switches tab or leaves the page.
 */
import type { useApp } from '../../app/context';
import { runs } from '../../app/runs';
import { buildAgentContext } from '../../domain/agent';
import type { Id, MiniatureSubject, SubjectFocus } from '../../domain/types';
import { subjectTask } from '../../domain/tasks';
import { runAgentTurn } from '../../data/agent-runner';
import { imageDataUrl } from '../../ui/imageData';
import { subjectReferences } from '../../domain/views';
import { getPasted } from './pasted';

/** Pictures the user already found (saved with a web address, or pasted): the agent starts from them. */
function userImages(app: App, s: MiniatureSubject) {
  const saved = subjectReferences(app.store.getTables(), s).flatMap((r) => (r.asset.locator && /^https?:/.test(r.asset.locator)
    ? [{ image_url: r.asset.locator, page_url: r.source.url ?? r.asset.locator, title: r.source.title }] : []));
  const pasted = getPasted(s.id).map((p) => ({ image_url: p.image_url, page_url: p.page_url, title: p.page_title }));
  const seen = new Set<string>();
  return [...pasted, ...saved].filter((i) => !seen.has(i.image_url) && !!seen.add(i.image_url)).slice(0, 12);
}

type App = ReturnType<typeof useApp>;

/**
 * The workspace's own open task for this miniature and kind of run, or a new one.
 * Never the agent panel's task, so a panel turn and a workspace run never share a conversation.
 */
export async function ensureTask(app: App, s: MiniatureSubject, kind: SubjectFocus['kind']): Promise<Id> {
  return subjectTask(app.store.getTables(), { subject_id: s.id, kind })?.id ?? app.research.startTask(s.project_id, { subject_id: s.id, kind });
}

function refOf(app: App, task: Id, subject_id: Id, fallback: string): string {
  return Object.entries(buildAgentContext(app.store.getTables(), task).subjectRefs).find(([, id]) => id === subject_id)?.[0] ?? fallback;
}

export function startImageHunt(app: App, s: MiniatureSubject, game: string, referenceFileId: Id | null) {
  runs.start(s.id, 'images', async (onEvent, signal) => {
    const task = await ensureTask(app, s, 'images');
    const ref = refOf(app, task, s.id, s.name);
    const reference = await imageDataUrl(app.store.getTables(), app.cmd, referenceFileId);
    const prompt = `Finn bilder av miniatyren «${s.name}» fra spillet «${game}». Finn først det beste offisielle bildet `
      + '(utgiverens side, Kickstarter eller Gamefound, BoardGameGeek), og let så bredt etter malte versjoner og malevideoer, på flere språk. '
      + 'Foreslå kandidater med begrunnelse; jeg vurderer bildene selv.';
    await runAgentTurn({ store: app.store, research: app.research, agent: app.agent, ai: app.ai }, task, prompt, onEvent, signal,
      { kind: 'images', subject_ref: ref, subject_name: s.name, game, reference_image: reference, user_images: userImages(app, s) });
  }, { label: `Bilder til ${s.name}`, href: `/p/${s.project_id}/m/${s.id}/bilder` });
}

/** paints: the user's active choice (brukerbeslutning 11.11.2026); the agent has no hidden preference. */
export function startPlan(app: App, s: MiniatureSubject, game: string, fileIds: (Id | null)[], paints: 'owned' | 'best') {
  runs.start(s.id, 'plan', async (onEvent, signal) => {
    const task = await ensureTask(app, s, 'plan');
    const ref = refOf(app, task, s.id, s.name);
    const reference_images = (await Promise.all(fileIds.map((f) => imageDataUrl(app.store.getTables(), app.cmd, f)))).filter((x): x is string => !!x);
    const prompt = `Lag en maleplan for «${s.name}» fra «${game}» som gjenskaper uttrykket i bildene jeg har valgt: arbeidsmåte, deler og steg med eksakte malinger, og en palett. `
      + (paints === 'owned' ? 'Bruk bare malinger jeg har.' : 'Velg de malingene som gir best resultat, uansett hva jeg har.');
    await runAgentTurn({ store: app.store, research: app.research, agent: app.agent, ai: app.ai }, task, prompt, onEvent, signal,
      { kind: 'plan', subject_ref: ref, subject_name: s.name, game, reference_images, revision: !!s.current_plan_version_id, paints });
  }, { label: `Maleplan for ${s.name}`, href: `/p/${s.project_id}/m/${s.id}/maleplan` });
}
