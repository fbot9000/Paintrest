/**
 * One research turn: the user's message is stored, the agent reads the
 * allowed context, the gateway calls the model, and the agent's reply and
 * drafts are written through the agent's own command set (skjema §7).
 */
import { buildAgentContext, normaliseIdentity, normaliseProposal } from '../domain/agent';
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

/** An error the turn already wrote into the conversation as a system message. */
export function markReported(e: unknown): Error & { reported: true } {
  const err = e instanceof Error ? e : new Error(String(e));
  return Object.assign(err, { reported: true as const });
}

export async function runAgentTurn(deps: {
  store: Store;
  research: ResearchCommands;
  agent: AgentCommands;
  ai: AiGateway;
}, task_id: Id, text: string, onEvent: (e: ResearchEvent) => void = () => {}, signal?: AbortSignal, focus: AgentTurnInput['focus'] = null,
/** Lets the view pass the user's actions (tagged sources) to this run while it works. */
run_id: string | null = null): Promise<TurnSummary> {
  const { store, research, agent, ai } = deps;
  await research.syncResultTypes(task_id);
  await research.addUserMessage(task_id, text);

  const t = store.getTables();
  const ctx = buildAgentContext(t, task_id);
  const scope = t.task_scope[task_id]!;
  // Library tasks get their own assignment; the agent only drafts (global zone).
  const library = scope.area_kind === 'new_knowledge';
  if (library) {
    const rev = Object.values(t.task_revision_target).find((r) => r.task_id === task_id && r.target_type === 'technique');
    const tech = rev ? t.technique[rev.target_id] : undefined;
    focus = {
      kind: 'knowledge', target: ctx.allowedTypes.includes('recipe') ? 'recipe' : 'technique',
      revision: tech && !tech.deleted_at ? { name: tech.name } : null,
      paints: scope.paint_choice ?? null,
    };
  }
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
    r = await ai.runAgent({ context: ctx.data, messages, result_types: ctx.allowedTypes, focus, direct_apply: !focus, ...(run_id ? { run_id } : {}) }, onEvent, signal);
  } catch (e) {
    const aborted = e instanceof Error && e.name === 'AbortError';
    agent.addSystemMessage(task_id, aborted ? 'Du stoppet agenten.' : `Agenten svarte ikke: ${e instanceof Error ? e.message : String(e)}`);
    // The conversation now says what happened; views need not show it a second time.
    throw markReported(e);
  }

  agent.addAssistantMessage(task_id, r.message || 'Agenten ga et tomt svar.', r.model, r.trace);
  // Every page read becomes a draft source for the game, so it is not rediscovered later.
  const read = r.proposals.flatMap((p) => {
    const sr = (p as { payload?: { sources_read?: unknown } }).payload?.sources_read;
    return Array.isArray(sr) ? (sr as SourceRead[]) : [];
  });
  const newSources = agent.recordSources(task_id, r.pages ?? [], read);
  // Image hunt: who the figure is, kept on the miniature as «proposed» until the user confirms it.
  const identity = focus?.kind === 'images' ? normaliseIdentity(r.identity) : null;
  const subject_id = focus?.kind === 'images' ? ctx.subjectRefs[focus.subject_ref] : undefined;
  const identified = identity && subject_id ? agent.recordIdentity(task_id, subject_id, identity) : null;
  // Game survey: who each miniature is, and the sources for the whole game with what they show.
  const surveyed = focus?.kind === 'game' ? (r.identities ?? []).flatMap((x) => {
    const id = normaliseIdentity(x.identity);
    const sid = ctx.subjectRefs[x.subject_ref];
    const name = id && sid ? agent.recordIdentity(task_id, sid, id) : null;
    return name ? [name] : [];
  }) : [];
  const gameSources = focus?.kind === 'game' ? agent.recordGameSources(task_id, (r.game_sources ?? []).flatMap((g) => {
    if (!g || typeof g.url !== 'string') return [];
    const role = (['official', 'painted', 'guide', 'other'] as const).find((x) => x === g.role) ?? 'other';
    return [{ url: g.url, title: String(g.title ?? g.url).slice(0, 200), role, shows: Array.isArray(g.shows) ? g.shows.filter((x) => typeof x === 'string') : [],
      summary: typeof g.summary === 'string' ? g.summary.slice(0, 600) : null, read: g.read === true }];
  }), ctx.subjectRefs) : null;

  const summary: TurnSummary = { created: [], updated: [], refused: [], change_set_id: null };
  const written: Id[] = [];
  // Game survey: a missing miniature carries the pages that show it (its key, N1 …, in the sources' «shows»).
  const shownOn = (raw: unknown) => {
    const key = (raw as { payload?: { key?: unknown } })?.payload?.key;
    return typeof key === 'string' ? (r.game_sources ?? []).filter((g) => Array.isArray(g.shows) && g.shows.includes(key)).map((g) => g.url) : [];
  };
  const newMiniatures: string[] = [];
  for (const raw of r.proposals) {
    const withPages = focus?.kind === 'game' && (raw as { type?: unknown })?.type === 'catalog_subject'
      ? { ...(raw as Record<string, unknown>), payload: { ...((raw as { payload?: Record<string, unknown> }).payload ?? {}), shown_on: shownOn(raw) } }
      : raw;
    const n = normaliseProposal(withPages as Record<string, unknown>, ctx.subjectRefs, ctx.techniqueRefs);
    if (!n.ok) {
      summary.refused.push(n.reason);
      continue;
    }
    const w = agent.writeProposal(task_id, n.value, 'uib', r.model);
    if (!w.ok) summary.refused.push(w.reason);
    else {
      (w.updated ? summary.updated : summary.created).push(w.ref);
      written.push(w.id);
      if (n.value.result_type === 'catalog_subject') newMiniatures.push((n.value.payload as { name: string }).name);
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
    ...(library && (summary.created.length || summary.updated.length)
      ? [focus?.kind === 'knowledge' && focus.revision ? 'Endringen er ikke tatt i bruk før du godtar den.' : 'Utkastet er ikke lagret i biblioteket før du godkjenner det.']
      : []),
    ...(identified ? [`Agenten identifiserte figuren som «${identified}». Si om det stemmer i Bilder-fanen («Riktig figur» eller «Feil figur»).`] : []),
    ...(surveyed.length ? [`Agenten identifiserte ${surveyed.length} ${surveyed.length === 1 ? 'miniatyr' : 'miniatyrer'}: ${surveyed.slice(0, 6).join(', ')}${surveyed.length > 6 ? ' …' : ''}. Si om det stemmer i hver miniatyrs Bilder-fane.`] : []),
    ...(focus?.kind === 'game' && newMiniatures.length ? [`Kartleggingen fant ${newMiniatures.length} ${newMiniatures.length === 1 ? 'miniatyr' : 'miniatyrer'} som mangler i listen: ${newMiniatures.slice(0, 8).join(', ')}${newMiniatures.length > 8 ? ' …' : ''}. Legg dem til fra miniatyrlisten.`] : []),
    ...(gameSources && (gameSources.sources || gameSources.links) ? [`Kartleggingen lagret ${gameSources.sources} nye kilder for spillet, og koblet sider til miniatyrer ${gameSources.links} ganger («Trolig figuren», ikke bekreftet).`] : []),
    // Nothing is stored out of sight: say which pages were kept as sources for the game.
    ...(newSources.length ? [`Lagret ${newSources.length} ${newSources.length === 1 ? 'side' : 'sider'} som kilder for ${library ? 'biblioteket' : 'spillet'}: ${newSources.slice(0, 5).join(' · ')}${newSources.length > 5 ? ' …' : ''}`] : []),
  ].filter(Boolean);
  if (notes.length) agent.addSystemMessage(task_id, notes.join('\n'));
  return summary;
}
