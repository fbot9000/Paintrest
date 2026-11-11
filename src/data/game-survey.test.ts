/**
 * Game survey (brukerønske 11.11.2026): one run for the whole game. Its sources are kept for the
 * game with role and which miniatures they show, so later runs build on them instead of searching again.
 */
import { describe, expect, it } from 'vitest';
import { buildAgentContext, knownSources } from '../domain/agent';
import type { AgentTurnInput, AiGateway, ResearchEvent } from '../domain/ai';
import { gameTask, panelTask } from '../domain/tasks';
import { linkedSources, suggestedSources } from '../domain/views';
import { runAgentTurn } from './agent-runner';
import { createLocalCommands } from './local-commands';
import { memoryPersistence } from './persistence';
import { createAgentCommands, createResearchCommands } from './research-commands';
import { buildSampleData } from './seed';
import { Store } from './store';

async function setup() {
  const p = memoryPersistence();
  const store = new Store(await buildSampleData(p), p);
  const t0 = store.getTables();
  const project = Object.values(t0.project).find((x) => t0.game[x.game_id]!.primary_name.startsWith('Avalon'))!;
  const research = createResearchCommands(store);
  const agent = createAgentCommands(store);
  const cmd = createLocalCommands(store);
  const subject = (name: string) => Object.values(store.getTables().miniature_subject).find((s) => s.project_id === project.id && s.name === name)!;
  return { store, research, agent, cmd, project, subject };
}

describe('kartleggingens egen oppgave', () => {
  it('er skilt fra panelet, og kan bare foreslå bilder', async () => {
    const { store, research, project } = await setup();
    const task = await research.startTask(project.id, 'game');
    const t = store.getTables();
    expect(t.task_scope[task]).toMatchObject({ game_focus: true, work_project_id: project.id });
    expect(t.task_result_type.filter((r) => r.task_id === task).map((r) => r.result_type)).toEqual(['reference_selection']);
    expect(gameTask(t, project.id)?.id).toBe(task);
    expect(panelTask(t, project.id)?.id).not.toBe(task);
    await research.syncResultTypes(task);
    expect(store.getTables().task_result_type.filter((r) => r.task_id === task)).toHaveLength(1);
  });
});

describe('kilder for spillet', () => {
  it('lagres med rolle og sammendrag, og blir forslag om hvilke miniatyrer de viser', async () => {
    const { store, research, agent, cmd, project, subject } = await setup();
    const task = await research.startTask(project.id, 'game');
    const refs = buildAgentContext(store.getTables(), task).subjectRefs;
    const ref = (name: string) => Object.entries(refs).find(([, id]) => id === subject(name).id)![0];
    const merlin = subject('Merlin');
    const r = agent.recordGameSources(task, [
      { url: 'https://www.reddit.com/r/avalon/painted', title: 'Painted Avalon', role: 'painted', shows: [ref('Merlin'), ref('Druid Mistwalker'), 'M99'], summary: 'Hele settet malt.', read: false },
      { url: 'https://blog.example/avalon-guide', title: 'Avalon painting guide', role: 'guide', shows: [], summary: null, read: true },
    ], refs);
    expect(r).toEqual({ sources: 2, links: 2 });
    let t = store.getTables();
    const reddit = Object.values(t.source).find((x) => x.url === 'https://www.reddit.com/r/avalon/painted')!;
    expect(reddit).toMatchObject({ retention: 'draft', role: 'painted', created_by_task_id: task });
    expect(Object.values(t.source).find((x) => x.url === 'https://blog.example/avalon-guide')).toMatchObject({ role: 'guide', kind: 'guide' });
    expect(Object.values(t.source_layer).some((l) => l.source_id === reddit.id && l.body === 'Hele settet malt.')).toBe(true);
    // A suggestion is not the user's tag.
    expect(suggestedSources(t, merlin.id).map((x) => x.url)).toEqual(['https://www.reddit.com/r/avalon/painted']);
    expect(linkedSources(t, merlin.id, 'evidence').map((x) => x.url)).not.toContain('https://www.reddit.com/r/avalon/painted');
    // Every agent sees what the page is and which miniatures it shows.
    const known = (buildAgentContext(t, task).data.known_sources as { url: string; role?: string; shows_suggested?: string[] }[]).find((k) => k.url === reddit.url)!;
    expect(known).toMatchObject({ role: 'painted', shows_suggested: [ref('Merlin'), ref('Druid Mistwalker')] });
    expect(knownSources(t, project.id).find((k) => k.source.id === reddit.id)!.shows_suggested).toContain(merlin.id);

    // The user confirms one suggestion and removes another; neither is suggested again.
    await cmd.tagSource(merlin.id, { url: reddit.url!, title: reddit.title }, true);
    await cmd.tagSource(subject('Druid Mistwalker').id, { url: reddit.url!, title: reddit.title }, false);
    t = store.getTables();
    expect(linkedSources(t, merlin.id, 'evidence').map((x) => x.url)).toContain(reddit.url);
    expect(suggestedSources(t, merlin.id)).toEqual([]);
    expect(t.source[reddit.id]!.retention).toBe('kept');
    expect(suggestedSources(t, subject('Druid Mistwalker').id)).toEqual([]);
    expect(agent.recordGameSources(task, [{ url: reddit.url!, title: 'x', role: 'painted', shows: [ref('Merlin'), ref('Druid Mistwalker')], summary: null, read: true }], refs).links).toBe(0);
  });

  it('en side et annet spill bruker, får lenke, men beholder rolle og innhold', async () => {
    const { store, research, agent, cmd, project, subject } = await setup();
    const other = await cmd.createProject({ name: 'Annet spill' });
    const knight = await cmd.createSubject(other.project_id, { name: 'Ridder' });
    await cmd.tagSource(knight, { url: 'https://shared.example/page', title: 'Felles side' }, true);
    const shared = Object.values(store.getTables().source).find((x) => x.url === 'https://shared.example/page')!;
    const task = await research.startTask(project.id, 'game');
    const refs = buildAgentContext(store.getTables(), task).subjectRefs;
    const mRef = Object.entries(refs).find(([, id]) => id === subject('Merlin').id)![0];
    agent.recordGameSources(task, [{ url: shared.url!, title: 'x', role: 'official', shows: [mRef], summary: 'Skal ikke havne på det andre spillets kilde.', read: true }], refs);
    const t = store.getTables();
    expect(t.source[shared.id]!.role ?? null).toBeNull();
    expect(Object.values(t.source_layer).some((l) => l.source_id === shared.id)).toBe(false);
    expect(suggestedSources(t, subject('Merlin').id).map((x) => x.url)).toEqual([shared.url]);
    // A miniature in another project is never linked from this survey.
    expect(agent.recordGameSources(task, [{ url: 'https://x.example/', title: 'x', role: 'painted', shows: ['M1'], summary: null, read: true }], { M1: knight }).links).toBe(0);
  });
});

describe('kartlegging fra start til slutt', () => {
  it('lagrer hvem som er hvem, bildeforslag per miniatyr og kildene for spillet', async () => {
    const { store, research, agent, project, subject } = await setup();
    const task = await research.startTask(project.id, 'game');
    const refs = buildAgentContext(store.getTables(), task).subjectRefs;
    const ref = (name: string) => Object.entries(refs).find(([, id]) => id === subject(name).id)![0];
    const seen: AgentTurnInput[] = [];
    const ai = {
      async runAgent(input: AgentTurnInput, onEvent: (e: ResearchEvent) => void) {
        seen.push(input);
        const e: Extract<ResearchEvent, { type: 'final' }> = {
          type: 'final', message: 'Kartlagt', model: 'm', warnings: [], trace: [], pages: [],
          proposals: [
            { type: 'reference_selection', payload: { subject: ref('Merlin'), images: [{ image_url: 'https://forum.example/merlin.jpg', page_url: 'https://forum.example/avalon' }] } },
            { type: 'reference_selection', payload: { subject: ref('Druid Mistwalker'), images: [{ image_url: 'https://forum.example/druid.jpg', page_url: 'https://forum.example/avalon' }] } },
          ],
          identities: [{ subject_ref: ref('Merlin'), identity: { official_name: 'Merlin the Archmage', aliases: [], edition: null, faction: null, description: 'Trollmann', images: [], painter: null, confidence: 'high', why: null, sources: [] } }],
          game_sources: [{ url: 'https://forum.example/avalon', title: 'Avalon painted', role: 'painted', shows: [ref('Merlin'), ref('Druid Mistwalker')], summary: 'Hele settet.', read: true }],
        };
        onEvent(e);
        return e;
      },
    } as unknown as AiGateway;
    await runAgentTurn({ store, research, agent, ai }, task, 'Kartlegg', () => {}, undefined, {
      kind: 'game', game: 'Avalon', miniatures: [{ ref: ref('Merlin'), name: 'Merlin', images: 0 }],
    });
    expect(seen[0]!.direct_apply).toBe(false);
    const t = store.getTables();
    expect(t.miniature_subject[subject('Merlin').id]!.identity).toMatchObject({ status: 'proposed', official_name: 'Merlin the Archmage' });
    const pending = Object.values(t.research_proposal).filter((p) => p.task_id === task && p.decision === 'pending');
    expect(pending.map((p) => (p.payload as { subject_id: string }).subject_id).sort()).toEqual([subject('Merlin').id, subject('Druid Mistwalker').id].sort());
    expect(suggestedSources(t, subject('Druid Mistwalker').id).map((x) => x.url)).toEqual(['https://forum.example/avalon']);
    const note = Object.values(t.research_message).filter((m) => m.task_id === task && m.role === 'system').map((m) => m.body).join('\n');
    expect(note).toContain('identifiserte 1 miniatyr: Merlin the Archmage');
    expect(note).toContain('koblet sider til miniatyrer 2 ganger');
  });
});
