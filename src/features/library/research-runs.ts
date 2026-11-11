/**
 * Starts library research turns in the shared run registry (src/app/runs.ts,
 * kind 'knowledge', id = research task id), so a turn keeps going and its
 * progress stays visible when the user moves between pages. Holds no state.
 */
import { runs } from '../../app/runs';
import { runAgentTurn } from '../../data/agent-runner';
import type { AiGateway } from '../../domain/ai';
import type { AgentCommands, ResearchCommands } from '../../domain/research';
import type { Id } from '../../domain/types';
import type { Store } from '../../data/store';

type Deps = { store: Store; research: ResearchCommands; agent: AgentCommands; ai: AiGateway };

export function startRun(deps: Deps, task_id: Id, text: string): void {
  const msg = text.trim();
  if (!msg) return;
  runs.start(task_id, 'knowledge', (onEvent, signal) => runAgentTurn(deps, task_id, msg, onEvent, signal).then(() => {}));
}

/** Bit 7.6: opens an improvement task for a technique and starts the first turn. Returns the task id. */
export async function startImprovement(deps: Deps, technique_id: Id, text: string): Promise<Id> {
  const task = await deps.research.startTechniqueRevision(technique_id);
  startRun(deps, task, text);
  return task;
}
