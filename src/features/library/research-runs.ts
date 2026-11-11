/**
 * Running library research turns, kept outside the components so a turn keeps
 * going (and its progress stays visible) when the user moves between pages.
 */
import { useSyncExternalStore } from 'react';
import { runAgentTurn } from '../../data/agent-runner';
import type { ResearchEvent, AiGateway } from '../../domain/ai';
import type { AgentCommands, ResearchCommands } from '../../domain/research';
import type { Id } from '../../domain/types';
import type { Store } from '../../data/store';

export interface Run {
  running: boolean;
  events: ResearchEvent[];
  error: string | null;
}

const IDLE: Run = { running: false, events: [], error: null };
const runs = new Map<Id, Run>();
const aborts = new Map<Id, AbortController>();
const listeners = new Set<() => void>();

function set(task_id: Id, run: Run) {
  runs.set(task_id, run);
  listeners.forEach((l) => l());
}

export function startRun(deps: { store: Store; research: ResearchCommands; agent: AgentCommands; ai: AiGateway }, task_id: Id, text: string): void {
  if (runs.get(task_id)?.running || !text.trim()) return;
  const ac = new AbortController();
  aborts.set(task_id, ac);
  set(task_id, { running: true, events: [], error: null });
  runAgentTurn(deps, task_id, text.trim(), (e) => {
    const cur = runs.get(task_id) ?? IDLE;
    set(task_id, { ...cur, events: [...cur.events, e] });
  }, ac.signal)
    .then(() => set(task_id, IDLE))
    .catch((e) => {
      const aborted = e instanceof Error && e.name === 'AbortError';
      set(task_id, { running: false, events: [], error: aborted ? null : e instanceof Error ? e.message : String(e) });
    })
    .finally(() => aborts.delete(task_id));
}

export function stopRun(task_id: Id): void {
  aborts.get(task_id)?.abort();
}

export function clearRunError(task_id: Id): void {
  const cur = runs.get(task_id);
  if (cur?.error) set(task_id, { ...cur, error: null });
}

export function useRun(task_id: Id): Run {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => runs.get(task_id) ?? IDLE,
  );
}

/** Bit 7.6: opens an improvement task for a technique and starts the first turn. Returns the task id. */
export async function startImprovement(deps: { store: Store; research: ResearchCommands; agent: AgentCommands; ai: AiGateway }, technique_id: Id, text: string): Promise<Id> {
  const task = await deps.research.startTechniqueRevision(technique_id);
  startRun(deps, task, text);
  return task;
}
