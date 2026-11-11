import { describe, expect, it } from 'vitest';
import { buildAgentContext, normaliseProposal } from '../domain/agent';
import type { AiGateway, ResearchEvent } from '../domain/ai';
import { runAgentTurn } from './agent-runner';
import { createLocalCommands } from './local-commands';
import { memoryPersistence } from './persistence';
import { checkScope, createAgentCommands, createResearchCommands } from './research-commands';
import { buildSampleData } from './seed';
import { Store } from './store';

async function setup() {
  const p = memoryPersistence();
  const store = new Store(await buildSampleData(p), p);
  return { store, research: createResearchCommands(store), agent: createAgentCommands(store), cmd: createLocalCommands(store) };
}

function fakeAi(proposals: (ctx: Record<string, unknown>) => unknown[], pages: { url: string; title: string }[] = []) {
  const seen: { focus: unknown; direct: unknown; context: Record<string, unknown> }[] = [];
  const ai = {
    async runAgent(input: { context: unknown; focus?: unknown; direct_apply?: boolean }, onEvent: (e: ResearchEvent) => void) {
      const context = input.context as Record<string, unknown>;
      seen.push({ focus: input.focus ?? null, direct: input.direct_apply, context });
      const e = {
        type: 'final' as const, message: 'Utkast klart', proposals: proposals(context), model: 'm', warnings: [], trace: [],
        pages: pages.map((x) => ({ ...x, site: 'example.com', author: null, language: 'en', image_count: 0 })),
      };
      onEvent(e);
      return e;
    },
  } as unknown as AiGateway;
  return { ai, seen };
}

const TECHNIQUE = {
  type: 'technique', evidence: 'documented',
  payload: {
    name: 'Kantlys', tags: ['høylys'], materials: ['Liten pensel'], desired_result: 'Skarpe kanter',
    steps: [{ title: 'Velg kanter', instruction: 'Bare de øverste', basis: 'documented' }, { title: 'Tynn ut', instruction: 'Melk', basis: 'synthesized' }],
    sources: [{ url: 'https://example.com/edge', title: 'Edge guide', opened: true }],
    sources_read: [{ url: 'https://example.com/edge', summary: 'Norsk sammendrag', original_excerpt: 'Edge it' }],
  },
};

describe('research til biblioteket (bit 7.4)', () => {
  it('lager en oppgave uten prosjekt, med bare én resultattype', async () => {
    const { store, research } = await setup();
    const task = await research.startKnowledgeTask('technique');
    const t = store.getTables();
    expect(t.task_scope[task]).toMatchObject({ area_kind: 'new_knowledge', work_project_id: null, allow_new_knowledge: true });
    expect(t.task_result_type.filter((r) => r.task_id === task).map((r) => r.result_type)).toEqual(['technique']);
  });

  it('omfangssjekken avviser prosjektendringer og andre typer i en biblioteksoppgave', async () => {
    const { store, research } = await setup();
    const task = await research.startKnowledgeTask('technique');
    const t = store.getTables();
    expect(() => checkScope(t, task, { result_type: 'catalog_subject', payload: {} })).toThrow('biblioteket');
    expect(() => checkScope(t, task, { result_type: 'recipe', payload: {} })).toThrow('oppskrifter');
    expect(checkScope(t, task, { result_type: 'technique', payload: {} }).result_type).toBe('technique');
    // And a project task may not draft for the library.
    const project = Object.values(t.project)[0]!;
    const ptask = await research.startTask(project.id);
    expect(() => checkScope(store.getTables(), ptask, { result_type: 'technique', payload: {} })).toThrow('teknikker');
  });

  it('agenten får biblioteket og katalogen, ikke prosjektene, og endrer ingenting selv', async () => {
    const { store, research, agent } = await setup();
    const task = await research.startKnowledgeTask('technique');
    const { ai, seen } = fakeAi(() => [TECHNIQUE], [{ url: 'https://example.com/edge', title: 'Edge guide' }]);
    const before = Object.keys(store.getTables().technique).length;
    const r = await runAgentTurn({ store, research, agent, ai }, task, 'Hvordan gjør man kantlys?');
    expect(seen[0]!.focus).toEqual({ kind: 'knowledge', target: 'technique' });
    expect(seen[0]!.direct).toBe(false);
    expect(seen[0]!.context).toHaveProperty('library');
    expect(seen[0]!.context).not.toHaveProperty('miniatures');
    expect(r.created).toEqual(['F1']);
    expect(r.change_set_id).toBeNull();
    expect(Object.keys(store.getTables().technique).length).toBe(before);
    const msgs = Object.values(store.getTables().research_message).filter((m) => m.task_id === task && m.role === 'system');
    expect(msgs.map((m) => m.body).join('\n')).toContain('ikke lagret i biblioteket før du godkjenner');
    // The page read is kept as a draft source for the library.
    expect(Object.values(store.getTables().source).some((s) => s.url === 'https://example.com/edge' && s.created_by_task_id === task)).toBe(true);
  });

  it('godkjenning lager teknikken som utkast, med steg, kilde og sammendrag', async () => {
    const { store, research, agent } = await setup();
    const task = await research.startKnowledgeTask('technique');
    const { ai } = fakeAi(() => [TECHNIQUE], [{ url: 'https://example.com/edge', title: 'Edge guide' }]);
    await runAgentTurn({ store, research, agent, ai }, task, 'Kantlys');
    const prop = Object.values(store.getTables().research_proposal).find((p) => p.task_id === task)!;
    await research.approveProposal(prop.id);
    const t = store.getTables();
    const p = t.research_proposal[prop.id]!;
    expect(p.decision).toBe('approved');
    const tech = t.technique[p.applied_target_id!]!;
    expect(tech).toMatchObject({ name: 'Kantlys', status: 'draft', evidence: 'documented', tags: ['høylys'] });
    const steps = Object.values(t.technique_step).filter((s) => s.technique_id === tech.id).sort((a, b) => a.position - b.position);
    expect(steps.map((s) => [s.title, s.basis])).toEqual([['Velg kanter', 'documented'], ['Tynn ut', 'synthesized']]);
    const link = Object.values(t.source_link).find((l) => l.target_type === 'technique' && l.target_id === tech.id)!;
    expect(link.use).toBe('method');
    expect(t.source[link.source_id]!.retention).toBe('kept');
    expect(Object.values(t.source_layer).some((l) => l.source_id === link.source_id && l.body === 'Norsk sammendrag')).toBe(true);
    expect(Object.values(t.change_record).some((r) => r.target_type === 'technique' && r.target_id === tech.id && r.proposal_id === prop.id)).toBe(true);
  });

  it('en oppskrift med ukjent maling krever valg, og «opprett» lager en ubekreftet maling', async () => {
    const { store, research, agent } = await setup();
    const task = await research.startKnowledgeTask('recipe');
    const { ai } = fakeAi((ctx) => {
      const lib = ctx.library as { techniques: { ref: string; name: string }[] };
      const ref = lib.techniques.find((x) => x.name.startsWith('Tekstur'))!.ref;
      return [{
        type: 'recipe', evidence: 'synthesized',
        payload: {
          name: 'Rust', effect: 'Varm rust',
          paints: [{ product: { manufacturer: 'Citadel', name: 'Rhinox Hide' }, role: 'base' }, { product: { manufacturer: 'Citadel', name: 'Ryza Rust' }, role: 'layer' }],
          steps: [{ instruction: 'Base', paints: [1] }, { instruction: 'Dupp rust', paints: [2, 9], technique: ref }],
        },
      }];
    });
    await runAgentTurn({ store, research, agent, ai }, task, 'Rust på metall');
    const prop = Object.values(store.getTables().research_proposal).find((p) => p.task_id === task)!;
    await expect(research.approveProposal(prop.id)).rejects.toThrow('Ryza Rust');
    expect(store.getTables().research_proposal[prop.id]!.decision).toBe('pending');
    await research.approveProposal(prop.id, { product_choices: { 'citadel|ryza rust': 'create' } });
    const t = store.getTables();
    const recipe = t.recipe[t.research_proposal[prop.id]!.applied_target_id!]!;
    const paints = Object.values(t.recipe_paint).filter((p) => p.recipe_id === recipe.id).sort((a, b) => a.position - b.position);
    expect(paints.map((p) => t.paint_product[p.product_id]!.name)).toEqual(['Rhinox Hide', 'Ryza Rust']);
    expect(t.paint_product[paints[1]!.product_id]!.identity_status).toBe('unconfirmed');
    const steps = Object.values(t.recipe_step).filter((s) => s.recipe_id === recipe.id).sort((a, b) => a.position - b.position);
    expect(steps[1]!.paint_ids).toEqual([paints[1]!.id]);
    expect(t.technique[steps[1]!.technique_id!]!.name).toMatch(/^Tekstur/);
  });

  it('legger ikke agentens sammendrag på kilder som hører til et spill', async () => {
    const { store, research, agent } = await setup();
    // A page found while working on a game.
    const project = Object.values(store.getTables().project)[0]!;
    const ptask = await research.startTask(project.id);
    const url = 'https://example.com/avalon-gallery';
    agent.recordSources(ptask, [{ url, title: 'Avalon', site: 'example.com', author: null, language: 'en', image_count: 0 }], []);
    const gameSource = Object.values(store.getTables().source).find((s) => s.url === url)!;
    const task = await research.startKnowledgeTask('technique');
    agent.recordSources(task, [], [{ url, title: 'x', site: 'x', language: 'en', summary: 'Skal ikke legges på', original_excerpt: null }]);
    expect(Object.values(store.getTables().source_layer).filter((l) => l.source_id === gameSource.id)).toHaveLength(0);
    // Its own pages do get the summary.
    const own = 'https://example.com/own';
    agent.recordSources(task, [{ url: own, title: 'Own', site: 'example.com', author: null, language: 'en', image_count: 0 }],
      [{ url: own, title: 'Own', site: 'example.com', language: 'en', summary: 'Eget sammendrag', original_excerpt: null }]);
    const ownSource = Object.values(store.getTables().source).find((s) => s.url === own)!;
    expect(Object.values(store.getTables().source_layer).some((l) => l.source_id === ownSource.id && l.body === 'Eget sammendrag')).toBe(true);
  });

  it('tolker oppskriftssteg: malingsnummer fra 1, ukjente teknikker blir null', () => {
    const n = normaliseProposal({ type: 'recipe', payload: { name: 'X', paints: ['A', 'B'], steps: [{ instruction: 'i', paints: [2, 0, 5], technique: 'T9' }] } }, {}, { T1: 'id1' });
    expect(n.ok).toBe(true);
    if (n.ok) expect((n.value.payload as { steps: unknown[] }).steps).toEqual([{ instruction: 'i', paints: [1], technique_id: null }]);
    const bad = normaliseProposal({ type: 'recipe', payload: { name: 'Tom', paints: [] } }, {});
    expect(bad.ok).toBe(false);
  });

  it('konteksten viser bibliotekets teknikker med ref', async () => {
    const { store, research } = await setup();
    const task = await research.startKnowledgeTask('recipe');
    const ctx = buildAgentContext(store.getTables(), task);
    expect(Object.keys(ctx.techniqueRefs ?? {})).toEqual(['T1']);
    expect(ctx.allowedTypes).toEqual(['recipe']);
  });
});
