/**
 * One research turn: the user's message is stored, the agent reads the
 * allowed context, the gateway calls the model, and the agent's reply and
 * drafts are written through the agent's own command set (skjema §7).
 */
import { buildAgentContext, normaliseProposal } from '../domain/agent';
import type { AiGateway, ResearchEvent } from '../domain/ai';
import type { AgentCommands, ResearchCommands } from '../domain/research';
import type { Id } from '../domain/types';
import type { Store } from './store';

export interface TurnSummary {
  created: string[];
  updated: string[];
  refused: string[];
}

export async function runAgentTurn(deps: {
  store: Store;
  research: ResearchCommands;
  agent: AgentCommands;
  ai: AiGateway;
}, task_id: Id, text: string, onEvent: (e: ResearchEvent) => void = () => {}, signal?: AbortSignal): Promise<TurnSummary> {
  const { store, research, agent, ai } = deps;
  await research.syncResultTypes(task_id);
  await research.addUserMessage(task_id, text);

  const t = store.getTables();
  const ctx = buildAgentContext(t, task_id);
  const scope = t.task_scope[task_id]!;
  const project = scope.work_project_id ? t.project[scope.work_project_id] : undefined;
  agent.recordContext(task_id, [
    ...(project ? [{ target_type: 'project' as const, target_id: project.id, revision: String(project.content_revision) }] : []),
    ...Object.values(ctx.subjectRefs).flatMap((sid) => {
      const v = t.miniature_subject[sid]?.current_plan_version_id;
      return v ? [{ target_type: 'paint_plan' as const, target_id: sid, revision: v }] : [];
    }),
  ]);

  const messages = Object.values(store.getTables().research_message)
    .filter((m) => m.task_id === task_id && (m.role === 'user' || m.role === 'assistant'))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.body }));

  let r;
  try {
    r = await ai.runAgent({ context: ctx.data, messages, result_types: ctx.allowedTypes }, onEvent, signal);
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    agent.addSystemMessage(task_id, aborted ? 'Du stoppet agenten.' : `Agenten svarte ikke: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }

  agent.addAssistantMessage(task_id, r.message || 'Agenten ga et tomt svar.', r.model, r.trace);

  const summary: TurnSummary = { created: [], updated: [], refused: [] };
  for (const raw of r.proposals) {
    const n = normaliseProposal(raw as Record<string, unknown>, ctx.subjectRefs);
    if (!n.ok) {
      summary.refused.push(n.reason);
      continue;
    }
    const w = agent.writeProposal(task_id, n.value, 'uib', r.model);
    if (!w.ok) summary.refused.push(w.reason);
    else (w.updated ? summary.updated : summary.created).push(w.ref);
  }

  const notes = [
    ...r.warnings,
    ...summary.refused.map((x) => `Forslag avvist av omfangssjekken: ${x}`),
  ].filter(Boolean);
  if (notes.length) agent.addSystemMessage(task_id, notes.join('\n'));
  return summary;
}
