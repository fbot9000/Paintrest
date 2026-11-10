/**
 * Starts the workspace's agent runs in the shared run registry, so they keep
 * going when the user switches tab or leaves the page.
 */
import type { useApp } from '../../app/context';
import { runs } from '../../app/runs';
import { buildAgentContext } from '../../domain/agent';
import type { Id, MiniatureSubject } from '../../domain/types';
import { runAgentTurn } from '../../data/agent-runner';
import { imageDataUrl } from '../../ui/imageData';

type App = ReturnType<typeof useApp>;

/** The project's open research task, or a new one. */
export async function ensureTask(app: App, project_id: Id): Promise<Id> {
  const t = app.store.getTables();
  const open = Object.values(t.research_task)
    .filter((x) => x.status === 'open' && t.task_scope[x.id]?.work_project_id === project_id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  return open?.id ?? app.research.startTask(project_id);
}

function refOf(app: App, task: Id, subject_id: Id, fallback: string): string {
  return Object.entries(buildAgentContext(app.store.getTables(), task).subjectRefs).find(([, id]) => id === subject_id)?.[0] ?? fallback;
}

export function startImageHunt(app: App, s: MiniatureSubject, game: string, referenceFileId: Id | null) {
  runs.start(s.id, 'images', async (onEvent, signal) => {
    const task = await ensureTask(app, s.project_id);
    const ref = refOf(app, task, s.id, s.name);
    const reference = await imageDataUrl(app.store.getTables(), app.cmd, referenceFileId);
    const prompt = `Finn konseptillustrasjon og bilder av miniatyren «${s.name}» fra spillet «${game}». `
      + 'Gjør grundig research på flere språk og foreslå kandidater med begrunnelse; jeg vurderer bildene selv.';
    await runAgentTurn({ store: app.store, research: app.research, agent: app.agent, ai: app.ai }, task, prompt, onEvent, signal,
      { kind: 'images', subject_ref: ref, subject_name: s.name, game, reference_image: reference });
  });
}

export function startPlan(app: App, s: MiniatureSubject, game: string, fileIds: (Id | null)[]) {
  runs.start(s.id, 'plan', async (onEvent, signal) => {
    const task = await ensureTask(app, s.project_id);
    const ref = refOf(app, task, s.id, s.name);
    const reference_images = (await Promise.all(fileIds.map((f) => imageDataUrl(app.store.getTables(), app.cmd, f)))).filter((x): x is string => !!x);
    const prompt = `Lag en maleplan for «${s.name}» fra «${game}» som gjenskaper uttrykket i bildene jeg har valgt: arbeidsmåte, deler og steg med eksakte malinger, og en palett.`;
    await runAgentTurn({ store: app.store, research: app.research, agent: app.agent, ai: app.ai }, task, prompt, onEvent, signal,
      { kind: 'plan', subject_ref: ref, subject_name: s.name, game, reference_images, revision: !!s.current_plan_version_id });
  });
}
