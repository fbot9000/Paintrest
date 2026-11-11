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
import { linkedSources, subjectReferences } from '../../domain/views';
import { knownSources } from '../../domain/agent';
import type { RunHint } from '../../domain/ai';
import { newId } from '../../domain/ids';
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

/** Pages linked to the miniature for this use, with the agent's Norwegian summary when there is one. */
function pagesFor(app: App, s: MiniatureSubject, use: 'evidence' | 'method') {
  const t = app.store.getTables();
  const summaries = new Map(knownSources(t, s.project_id).map((k) => [k.source.id, k.summary]));
  return linkedSources(t, s.id, use).slice(0, 12).map((x) => ({ url: x.url!, title: x.title, ...(summaries.get(x.id) ? { summary: summaries.get(x.id)!.slice(0, 300) } : {}) }));
}

/** The running image hunt for each miniature, so what the user tags reaches the agent while it works. */
const huntChannels = new Map<Id, string>();

/**
 * Tells a running image hunt for this miniature what the user just did (for example tagged a source).
 * Nothing happens when no hunt is running: the next hunt reads the tag from the data.
 */
export async function hintHunt(app: App, subject_id: Id, hint: RunHint): Promise<void> {
  const run_id = huntChannels.get(subject_id);
  if (!run_id) return;
  try { await app.ai.sendHint(run_id, hint); } catch { /* the tag is saved; the next hunt gets it */ }
}

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
    const known = s.identity?.status === 'confirmed';
    const prompt = `Finn bilder av miniatyren «${s.name}» fra spillet «${game}». `
      + (known ? `Figuren er allerede identifisert som «${s.identity!.official_name ?? s.name}»; bygg på det. `
        : 'Finn først ut nøyaktig hvilken figur det er: offisielt navn, andre navn, beskrivelse og offisiell konseptkunst eller tilsvarende. ')
      + 'Let så bredt etter bilder fra andre som har malt den, på flere språk, og til slutt etter maleguider og malevideoer. '
      + 'Foreslå kandidater med begrunnelse; jeg vurderer bildene selv.';
    const run_id = newId();
    huntChannels.set(s.id, run_id);
    try {
      await runAgentTurn({ store: app.store, research: app.research, agent: app.agent, ai: app.ai }, task, prompt, onEvent, signal,
        { kind: 'images', subject_ref: ref, subject_name: s.name, game, reference_image: reference, user_images: userImages(app, s),
          identity: s.identity ?? null, rejected: s.identity_rejected ?? [], tagged_sources: pagesFor(app, s, 'evidence') }, run_id);
    } finally {
      if (huntChannels.get(s.id) === run_id) huntChannels.delete(s.id);
    }
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
      { kind: 'plan', subject_ref: ref, subject_name: s.name, game, reference_images, revision: !!s.current_plan_version_id, paints,
        identity: s.identity?.status === 'confirmed' ? s.identity : null, guides: pagesFor(app, s, 'method'), tagged_sources: pagesFor(app, s, 'evidence') });
  }, { label: `Maleplan for ${s.name}`, href: `/p/${s.project_id}/m/${s.id}/maleplan` });
}

/** «Viser figuren»: saves the tag on the miniature, and tells a running hunt for it at once. */
export async function tagPage(app: App, subject_id: Id, page: { url: string; title: string }, on: boolean): Promise<void> {
  await app.cmd.tagSource(subject_id, page, on);
  await hintHunt(app, subject_id, { kind: on ? 'tagged_source' : 'untagged_source', url: page.url, title: page.title });
}
