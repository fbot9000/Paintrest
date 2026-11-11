/**
 * Starts library research turns in the shared run registry (src/app/runs.ts,
 * kind 'knowledge', id = research task id), so a turn keeps going and its
 * progress stays visible when the user moves between pages. Holds no state.
 */
import { runs } from '../../app/runs';
import { runAgentTurn } from '../../data/agent-runner';
import type { AiGateway } from '../../domain/ai';
import type { Commands } from '../../domain/commands';
import { imageDataUrl } from '../../ui/imageData';
import type { AgentCommands, ResearchCommands } from '../../domain/research';
import type { Id } from '../../domain/types';
import { knowledgeTaskView } from '../../domain/library';
import type { Store } from '../../data/store';

type Deps = { store: Store; research: ResearchCommands; agent: AgentCommands; ai: AiGateway; cmd?: Commands };

export function startRun(deps: Deps, task_id: Id, text: string): void {
  const msg = text.trim();
  if (!msg) return;
  // The task's title comes from its first message, which is not saved yet on the first turn.
  const view = knowledgeTaskView(deps.store.getTables(), task_id);
  const title = view?.revision_of || view?.messages.length ? view.title : msg.split('\n')[0]!.slice(0, 80);
  runs.start(task_id, 'knowledge', async (onEvent, signal) => {
    // «Fra bilde»: the pictures go with every turn, scaled down for the model.
    const ids = deps.store.getTables().task_scope[task_id]?.image_file_ids ?? [];
    const pictures = deps.cmd && ids.length
      ? (await Promise.all(ids.map((id) => imageDataUrl(deps.store.getTables(), deps.cmd!, id, 1024)))).filter((x): x is string => !!x)
      : [];
    await runAgentTurn(deps, task_id, msg, onEvent, signal,
      pictures.length ? { kind: 'knowledge', target: 'image', reference_images: pictures } : null);
  },
    { label: `Research: ${title}`, href: `/bibliotek/research/${task_id}` });
}

/** Bit 7.6: opens an improvement task for a technique and starts the first turn. Returns the task id. */
export async function startImprovement(deps: Deps, technique_id: Id, text: string): Promise<Id> {
  const task = await deps.research.startTechniqueRevision(technique_id);
  startRun(deps, task, text);
  return task;
}
