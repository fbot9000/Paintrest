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
  it('er skilt fra panelet, og kan bare foreslå bilder og miniatyrer som mangler', async () => {
    const { store, research, project } = await setup();
    const task = await research.startTask(project.id, 'game');
    const t = store.getTables();
    expect(t.task_scope[task]).toMatchObject({ game_focus: true, work_project_id: project.id });
    expect(t.task_result_type.filter((r) => r.task_id === task).map((r) => r.result_type)).toEqual(['reference_selection', 'catalog_subject']);
    expect(gameTask(t, project.id)?.id).toBe(task);
    expect(panelTask(t, project.id)?.id).not.toBe(task);
    await research.syncResultTypes(task);
    expect(store.getTables().task_result_type.filter((r) => r.task_id === task)).toHaveLength(2);
  });

  it('en kartlegging fra før får lov å foreslå miniatyrer, men ikke mer', async () => {
    const { store, research, project } = await setup();
    const task = await research.startTask(project.id, 'game');
    // As saved before this version: pictures only.
    store.getTables().task_result_type = store.getTables().task_result_type.filter((r) => !(r.task_id === task && r.result_type === 'catalog_subject'));
    await research.syncResultTypes(task);
    expect(store.getTables().task_result_type.filter((r) => r.task_id === task).map((r) => r.result_type).sort()).toEqual(['catalog_subject', 'reference_selection']);
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

describe('miniatyrer som mangler i listen', () => {
  it('blir forslag med kildene som viser dem; et duplikat avvises', async () => {
    const { store, research, agent, cmd, project, subject } = await setup();
    const task = await research.startTask(project.id, 'game');
    const refs = buildAgentContext(store.getTables(), task).subjectRefs;
    const mRef = Object.entries(refs).find(([, id]) => id === subject('Merlin').id)![0];
    const identity = { official_name: 'Morgana le Fay', aliases: ['Morgana'], edition: 'Avalon grunnspill', faction: 'Skurker', description: 'Heks i mørk kappe',
      images: [{ image_url: 'https://ks.example/morgana-art.jpg', page_url: 'https://ks.example/avalon', page_title: 'KS', site: 'ks.example', kind: 'concept_art' as const, thumbnail_url: null }],
      painter: null, confidence: 'high' as const, why: 'Komponentlisten', sources: [] };
    const ai = {
      async runAgent(_input: AgentTurnInput, onEvent: (e: ResearchEvent) => void) {
        const e: Extract<ResearchEvent, { type: 'final' }> = {
          type: 'final', message: 'Fant to', model: 'm', warnings: [], trace: [], pages: [],
          proposals: [
            { type: 'catalog_subject', evidence: 'documented', payload: { key: 'N1', name: 'Morgana le Fay', grouping: 'single', physical_count: 1,
              sources: [{ url: 'https://ks.example/avalon', title: 'Komponentliste' }], identity } },
            { type: 'catalog_subject', payload: { key: 'N2', name: 'merlin', grouping: 'single' } },
            { type: 'catalog_subject', payload: { key: 'N3', name: 'Mørkets tjenere', grouping: 'group', physical_count: 6, expansion_name: 'Finnes ikke' } },
          ],
          game_sources: [
            { url: 'https://forum.example/avalon', title: 'Avalon painted', role: 'painted', shows: [mRef, 'N1'], summary: null, read: true },
            { url: 'https://ks.example/avalon', title: 'Komponentliste', role: 'official', shows: ['N1', 'N3'], summary: null, read: true },
          ],
        };
        onEvent(e);
        return e;
      },
    } as unknown as AiGateway;
    await runAgentTurn({ store, research, agent, ai }, task, 'Kartlegg', () => {}, undefined, { kind: 'game', game: 'Avalon', miniatures: [] });
    let t = store.getTables();
    const pending = Object.values(t.research_proposal).filter((p) => p.task_id === task && p.decision === 'pending' && p.result_type === 'catalog_subject');
    expect(pending.map((p) => (p.payload as { name: string }).name).sort()).toEqual(['Morgana le Fay', 'Mørkets tjenere']);
    const morgana = pending.find((p) => (p.payload as { name: string }).name === 'Morgana le Fay')!;
    expect(morgana.payload).toMatchObject({ shown_on: ['https://forum.example/avalon', 'https://ks.example/avalon'], identity: { official_name: 'Morgana le Fay' } });
    const notes = Object.values(t.research_message).filter((m) => m.task_id === task && m.role === 'system').map((m) => m.body).join('\n');
    expect(notes).toContain('«merlin» finnes allerede i prosjektet (Merlin)');
    expect(notes).toContain('fant 2 miniatyrer som mangler i listen: Morgana le Fay, Mørkets tjenere');

    // The same figure again, from the panel or a new survey, waits already.
    const again = agent.writeProposal(task, { result_type: 'catalog_subject', update_of: null, evidence: 'synthesized', uncertainty: [],
      payload: { name: 'Morgana', grouping: 'single', physical_count: 1, expansion_name: null, category_label: null, count_basis: null, grouping_basis: null, note: null, sources: [], identity: { ...identity, official_name: 'MORGANA LE FAY' } } }, 'uib', 'm');
    expect(again).toMatchObject({ ok: false, reason: expect.stringContaining('venter allerede som forslag') });

    // «Legg til»: the miniature comes with who it is (to confirm) and the pages that probably show it.
    await research.approveProposal(morgana.id);
    t = store.getTables();
    const added = Object.values(t.miniature_subject).find((s) => s.project_id === project.id && s.name === 'Morgana le Fay' && !s.deleted_at)!;
    expect(added.identity).toMatchObject({ status: 'proposed', official_name: 'Morgana le Fay', found_by_task_id: task });
    expect(linkedSources(t, added.id, 'evidence').map((x) => x.url)).toEqual(['https://ks.example/avalon']);
    expect(suggestedSources(t, added.id).map((x) => x.url)).toEqual(['https://forum.example/avalon']);
    await cmd.updateSubject(added.id, { name: 'Morgana' });
    expect(agent.writeProposal(task, { result_type: 'catalog_subject', update_of: null, evidence: 'synthesized', uncertainty: [],
      payload: { name: 'Morgana le Fay', grouping: 'single', physical_count: 1, expansion_name: null, category_label: null, count_basis: null, grouping_basis: null, note: null, sources: [] } }, 'uib', 'm'))
      .toMatchObject({ ok: false, reason: expect.stringContaining('finnes allerede i prosjektet (Morgana)') });

    // An expansion outside the project is said plainly when the miniature is added.
    const dark = pending.find((p) => (p.payload as { name: string }).name === 'Mørkets tjenere')!;
    await research.approveProposal(dark.id);
    const group = Object.values(store.getTables().miniature_subject).find((s) => s.name === 'Mørkets tjenere')!;
    expect(group).toMatchObject({ grouping: 'group', physical_count: 6, expansion_id: null });
    expect(JSON.stringify(group.uncertainty)).toContain('Utvidelsen «Finnes ikke» er ikke med i prosjektet');
  });
});

describe('gjennomgang av det som venter', () => {
  it('tar med miniatyrene som har noe som venter, i listens rekkefølge, og slipper dem når de er gjennomgått', async () => {
    const { store, research, agent, cmd, project, subject } = await setup();
    const { reviewQueue } = await import('../domain/review');
    const task = await research.startTask(project.id, 'game');
    const refs = buildAgentContext(store.getTables(), task).subjectRefs;
    const ref = (name: string) => Object.entries(refs).find(([, id]) => id === subject(name).id)![0];
    const merlin = subject('Merlin');
    const druid = subject('Druid Mistwalker');
    expect(reviewQueue(store.getTables(), project.id)).toEqual([]);
    const w = agent.writeProposal(task, { result_type: 'reference_selection', update_of: null, evidence: 'documented', uncertainty: [], payload: { subject_id: merlin.id, note: null, images: [
      { image_url: 'https://x.example/low.jpg', page_url: 'https://x.example/', page_title: 'x', site: 'x.example', creator: null, caption: null, kind: 'painted', confidence: 'low' },
      { image_url: 'https://x.example/high.jpg', page_url: 'https://x.example/', page_title: 'x', site: 'x.example', creator: null, caption: null, kind: 'painted', confidence: 'high', thumbnail_url: 'https://t.example/high.jpg' },
    ] } }, 'uib', 'm');
    expect(w.ok).toBe(true);
    agent.recordIdentity(task, druid.id, { official_name: 'Mistwalker', aliases: [], edition: null, faction: null, description: 'Druide', images: [], painter: null, confidence: null, why: null, sources: [] });
    agent.recordGameSources(task, [{ url: 'https://forum.example/avalon', title: 'Avalon', role: 'painted', shows: [ref('Druid Mistwalker')], summary: null, read: true }], refs);

    const q = reviewQueue(store.getTables(), project.id);
    const { liveSubjects } = await import('../domain/views');
    const order = liveSubjects(store.getTables(), project.id).map((s) => s.id);
    expect(q.map((x) => x.subject_id).sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(q.map((x) => x.subject_id));
    expect(q.find((x) => x.subject_id === merlin.id)).toMatchObject({ images: 2, identity: false, likely: 0, preview: { image_url: 'https://x.example/high.jpg', thumbnail_url: 'https://t.example/high.jpg' } });
    expect(q.find((x) => x.subject_id === druid.id)).toMatchObject({ images: 0, identity: true, likely: 1 });

    // Gone through: the pictures chosen, the figure confirmed, the page confirmed.
    await research.rejectProposal(w.ok ? w.id : '');
    await cmd.confirmIdentity(druid.id);
    await cmd.tagSource(druid.id, { url: 'https://forum.example/avalon', title: 'Avalon' }, true);
    expect(reviewQueue(store.getTables(), project.id)).toEqual([]);
  });
});
