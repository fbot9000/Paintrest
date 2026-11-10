/**
 * One research turn: the user's message is stored, the agent reads the
 * allowed context, the gateway calls the model, and the agent's reply and
 * drafts are written through the agent's own command set (skjema §7).
 */
import { buildAgentContext, normaliseProposal } from '../domain/agent';
import type { SourceRead } from '../domain/agent';
import type { AgentTurnInput, AiGateway, ResearchEvent } from '../domain/ai';
import type { AgentCommands, ResearchCommands } from '../domain/research';
import type { Id } from '../domain/types';
import type { Store } from './store';

export interface TurnSummary {
  created: string[];
  updated: string[];
  refused: string[];
  /** Open zone: the change set the agent applied directly in this turn, if any. */
  change_set_id: Id | null;
}

export async function runAgentTurn(deps: {
  store: Store;
  research: ResearchCommands;
  agent: AgentCommands;
  ai: AiGateway;
}, task_id: Id, text: string, onEvent: (e: ResearchEvent) => void = () => {}, signal?: AbortSignal, focus: AgentTurnInput['focus'] = null): Promise<TurnSummary> {
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
    r = await ai.runAgent({ context: ctx.data, messages, result_types: ctx.allowedTypes, focus, direct_apply: !focus }, onEvent, signal);
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    agent.addSystemMessage(task_id, aborted ? 'Du stoppet agenten.' : `Agenten svarte ikke: ${e instanceof Error ? e.message : String(e)}`);
    throw e;
  }

  agent.addAssistantMessage(task_id, r.message || 'Agenten ga et tomt svar.', r.model, r.trace);
  // Every page read becomes a draft source for the game, so it is not rediscovered later.
  const read = r.proposals.flatMap((p) => {
    const sr = (p as { payload?: { sources_read?: unknown } }).payload?.sources_read;
    return Array.isArray(sr) ? (sr as SourceRead[]) : [];
  });
  const newSources = agent.recordSources(task_id, r.pages ?? [], read);

  const summary: TurnSummary = { created: [], updated: [], refused: [], change_set_id: null };
  const written: Id[] = [];
  for (const raw of r.proposals) {
    const n = normaliseProposal(raw as Record<string, unknown>, ctx.subjectRefs);
    if (!n.ok) {
      summary.refused.push(n.reason);
      continue;
    }
    const w = agent.writeProposal(task_id, n.value, 'uib', r.model);
    if (!w.ok) summary.refused.push(w.reason);
    else {
      (w.updated ? summary.updated : summary.created).push(w.ref);
      written.push(w.id);
    }
  }

  // Panel turns (no focus): changes inside the project are applied directly and can be undone.
  // Focused turns (image hunt, paint plan) are reviewed by the user in their own view.
  const kept: string[] = [];
  if (!focus && written.length) {
    const applied = await research.applyAgentChanges(task_id, written);
    summary.change_set_id = applied.change_set_id;
    for (const k of applied.kept_as_proposal) kept.push(k.reason);
  }

  const notes = [
    ...r.warnings,
    ...summary.refused.map((x) => `Forslag avvist av omfangssjekken: ${x}`),
    ...kept.map((x) => `Venter på deg: ${x}`),
    // Nothing is stored out of sight: say which pages were kept as sources for the game.
    ...(newSources.length ? [`Lagret ${newSources.length} ${newSources.length === 1 ? 'side' : 'sider'} som kilder for spillet: ${newSources.slice(0, 5).join(' · ')}${newSources.length > 5 ? ' …' : ''}`] : []),
  ].filter(Boolean);
  if (notes.length) agent.addSystemMessage(task_id, notes.join('\n'));
  return summary;
}
