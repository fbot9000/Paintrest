import { describe, expect, it } from 'vitest';
import { buildAgentContext, normaliseProposal, variantsText } from '../domain/agent';
import { knowledgeImages } from '../domain/library';
import type { AiGateway, ResearchEvent } from '../domain/ai';
import { runAgentTurn } from './agent-runner';
import { createLocalCommands } from './local-commands';
import { memoryPersistence } from './persistence';
import { checkScope, createAgentCommands, createResearchCommands } from './research-commands';
import { buildSampleData } from './seed';
import { Store } from './store';

async function setup() {
  const p = memoryPersistence();
  const store = new Store(await buildSampleData(p, { examplePaints: true }), p);
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

  it('en feil fra modellen skrives i samtalen én gang og merkes som vist; en feil før modellen merkes ikke', async () => {
    const { store, research, agent } = await setup();
    const task = await research.startKnowledgeTask('technique');
    const failing = { async runAgent() { throw new Error('UiB svarte ikke'); } } as unknown as Parameters<typeof runAgentTurn>[0]['ai'];
    const err = await runAgentTurn({ store, research, agent, ai: failing }, task, 'Kantlys').catch((e: unknown) => e);
    expect(err).toMatchObject({ message: 'UiB svarte ikke', reported: true });
    const system = Object.values(store.getTables().research_message).filter((m) => m.task_id === task && m.role === 'system');
    expect(system.map((m) => m.body)).toEqual(['Agenten svarte ikke: UiB svarte ikke']);
    // Before the model is called (closed task): nothing in the conversation, so the view must show it.
    await research.closeTask(task);
    const early = await runAgentTurn({ store, research, agent, ai: failing }, task, 'Mer').catch((e: unknown) => e);
    expect(early).toMatchObject({ message: 'Oppgaven er lukket' });
    expect((early as { reported?: boolean }).reported).toBeUndefined();
  });

  it('agenten får biblioteket og katalogen, ikke prosjektene, og endrer ingenting selv', async () => {
    const { store, research, agent } = await setup();
    const task = await research.startKnowledgeTask('technique');
    const { ai, seen } = fakeAi(() => [TECHNIQUE], [{ url: 'https://example.com/edge', title: 'Edge guide' }]);
    const before = Object.keys(store.getTables().technique).length;
    const r = await runAgentTurn({ store, research, agent, ai }, task, 'Hvordan gjør man kantlys?');
    expect(seen[0]!.focus).toEqual({ kind: 'knowledge', target: 'technique', revision: null, paints: null });
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

  it('sammenligningen: varianter peker bare på kilder i utkastet, og nøyaktig én er utgangspunkt', () => {
    const n = normaliseProposal({ type: 'technique', payload: {
      name: 'Svamp', sources: [{ url: 'https://a.example/guide', title: 'A' }, { url: 'https://b.example/x', title: 'B' }],
      comparison: { common: 'Lite maling', variants: [
        { label: 'Tekstur', description: 'Uregelmessige pass', sources: ['https://www.a.example/guide/', 'https://ukjent.example'], primary: true },
        { label: 'Overganger', description: 'Gradvis', sources: ['https://b.example/x'], primary: true },
      ] },
    } }, {});
    expect(n.ok).toBe(true);
    if (!n.ok) return;
    const c = (n.value.payload as { comparison: { variants: { sources: string[]; primary: boolean }[] } }).comparison;
    expect(c.variants.map((v) => v.sources)).toEqual([['https://a.example/guide'], ['https://b.example/x']]);
    expect(c.variants.map((v) => v.primary)).toEqual([true, false]);
  });

  it('variantene lagres som tekst, med brukerens valg av utgangspunkt først', async () => {
    const { store, research, agent } = await setup();
    const task = await research.startKnowledgeTask('technique');
    const { ai } = fakeAi(() => [{ ...TECHNIQUE, payload: { ...TECHNIQUE.payload, variants: 'agentens fritekst', comparison: {
      common: 'Tynn maling', variants: [
        { label: 'Lys kant', description: 'Bare øverste kant', sources: ['https://example.com/edge'], primary: true },
        { label: 'Dobbel kant', description: 'To toner', sources: [] },
      ] } } }], [{ url: 'https://example.com/edge', title: 'Edge guide' }]);
    await runAgentTurn({ store, research, agent, ai }, task, 'Kantlys');
    const prop = Object.values(store.getTables().research_proposal).find((p) => p.task_id === task)!;
    await research.approveProposal(prop.id, { primary_variant: 1 });
    const t = store.getTables();
    expect(t.technique[t.research_proposal[prop.id]!.applied_target_id!]!.variants)
      .toBe('A · Dobbel kant (utgangspunkt): To toner\nB · Lys kant: Bare øverste kant');
  });

  it('uten sammenligning beholdes agentens fritekst', () => {
    expect(variantsText(null)).toBeNull();
    expect(variantsText({ common: 'x', variants: [] })).toBeNull();
  });

  it('forbedring: agenten får teknikken og erfaringene, og godkjenning skriver endringen inn', async () => {
    const { store, research, agent, cmd } = await setup();
    const tech = Object.values(store.getTables().technique).find((x) => x.name.startsWith('Tekstur'))!;
    await cmd.setTechniqueStatus(tech.id, 'approved');
    await cmd.recordExperience(tech.id, { outcome: 'needs_adjustment', note: 'For grov struktur' });
    const task = await research.startTechniqueRevision(tech.id);
    const { ai, seen } = fakeAi((ctx) => {
      const cur = ctx.technique_to_improve as { name: string; steps: { title: string }[] };
      return [{ type: 'technique', evidence: 'synthesized', payload: {
        name: cur.name, materials: ['Finere svamp'], note: 'Byttet til finere svamp',
        steps: [...cur.steps.map((st) => ({ title: st.title, instruction: 'x' })), { title: 'Ny', instruction: 'Tørk mellom pass' }],
        sources: [{ url: 'https://example.com/fine', title: 'Fine sponge' }],
      } }];
    });
    await runAgentTurn({ store, research, agent, ai }, task, 'Strukturen ble for grov');
    const ctx = seen[0]!.context as { technique_to_improve: { experiences: { note: string }[] } };
    expect(ctx.technique_to_improve.experiences.map((e) => e.note)).toEqual(['For grov struktur']);
    expect((seen[0]!.focus as { revision: { name: string } }).revision.name).toBe(tech.name);

    const before = Object.keys(store.getTables().technique).length;
    const prop = Object.values(store.getTables().research_proposal).find((p) => p.task_id === task)!;
    await research.approveProposal(prop.id);
    const t = store.getTables();
    expect(Object.keys(t.technique).length).toBe(before);
    expect(t.research_proposal[prop.id]!.applied_target_id).toBe(tech.id);
    const after = t.technique[tech.id]!;
    expect(after.materials).toEqual(['Finere svamp']);
    expect(after.status).toBe('approved');
    expect(Object.values(t.technique_step).filter((x) => x.technique_id === tech.id)).toHaveLength(5);
    expect(Object.values(t.technique_experience).filter((e) => e.technique_id === tech.id)).toHaveLength(1);
  });

  it('forbedring stopper hvis teknikken er endret etter forslaget, og endrer ingenting', async () => {
    const { store, research, agent, cmd } = await setup();
    const tech = Object.values(store.getTables().technique)[0]!;
    const task = await research.startTechniqueRevision(tech.id);
    const { ai } = fakeAi(() => [{ type: 'technique', payload: { name: tech.name, materials: ['Annet'] } }]);
    await runAgentTurn({ store, research, agent, ai }, task, 'Forbedre');
    await new Promise((r) => setTimeout(r, 5));
    await cmd.updateTechnique(tech.id, { use_area: 'Endret av meg' });
    const prop = Object.values(store.getTables().research_proposal).find((p) => p.task_id === task)!;
    await expect(research.approveProposal(prop.id)).rejects.toThrow('endret etter');
    const t = store.getTables();
    expect(t.technique[tech.id]!.use_area).toBe('Endret av meg');
    expect(t.technique[tech.id]!.materials).not.toEqual(['Annet']);
    expect(t.research_proposal[prop.id]!.decision).toBe('pending');
  });

  it('kan ikke forbedre en slettet teknikk', async () => {
    const { store, research, cmd } = await setup();
    const tech = Object.values(store.getTables().technique)[0]!;
    await cmd.deleteTechnique(tech.id);
    await expect(research.startTechniqueRevision(tech.id)).rejects.toThrow('slettet');
  });

  it('malingsvalget for oppskrifter er synlig og kan endres, og sendes til agenten', async () => {
    const { store, research, agent } = await setup();
    const task = await research.startKnowledgeTask('recipe');
    expect(store.getTables().task_scope[task]!.paint_choice).toBe('both');
    await research.setPaintChoice(task, 'owned');
    const { ai, seen } = fakeAi(() => [{ type: 'recipe', payload: { name: 'Ild', paint_choice: 'owned', paints: ['Rhinox Hide'] } }]);
    await runAgentTurn({ store, research, agent, ai }, task, 'Flammer');
    expect((seen[0]!.focus as { paints: string }).paints).toBe('owned');
    expect(seen[0]!.context.paint_choice).toBe('owned');
    const prop = Object.values(store.getTables().research_proposal).find((p) => p.task_id === task)!;
    expect((prop.payload as { paint_choice: string }).paint_choice).toBe('owned');
    await expect(research.setPaintChoice(task, 'alt' as never)).rejects.toThrow('Ukjent');
    // A technique has no paints to choose.
    const tt = await research.startKnowledgeTask('technique');
    expect(store.getTables().task_scope[tt]!.paint_choice).toBeUndefined();
  });

  it('eksempelbilder: de valgte hentes og lagres på teknikken, med siden som kilde', async () => {
    const p = memoryPersistence();
    const store = new Store(await buildSampleData(p, { examplePaints: true }), p);
    const fetched: string[] = [];
    const research = createResearchCommands(store, { fetchImage: async (url) => { fetched.push(url); return new Blob(['x'], { type: 'image/jpeg' }); } });
    const agent = createAgentCommands(store);
    const task = await research.startKnowledgeTask('technique');
    const img = (n: number) => ({ image_url: `https://blog.example/fire${n}.jpg`, page_url: 'https://blog.example/fire', page_title: 'Fire guide', site: 'blog.example', caption: `Bilde ${n}` });
    const { ai } = fakeAi(() => [{ type: 'technique', payload: { name: 'Ild', images: [img(1), img(2), img(3)] } }]);
    await runAgentTurn({ store, research, agent, ai }, task, 'Flammer');
    const prop = Object.values(store.getTables().research_proposal).find((x) => x.task_id === task)!;
    await research.approveProposal(prop.id, { image_urls: [img(1).image_url, img(3).image_url] });
    expect(fetched).toEqual([img(1).image_url, img(3).image_url]);
    const t = store.getTables();
    const id = t.research_proposal[prop.id]!.applied_target_id!;
    const imgs = knowledgeImages(t, 'technique', id);
    expect(imgs.map((x) => x.caption)).toEqual(['Bilde 1', 'Bilde 3']);
    expect(imgs[0]!.source.url).toBe('https://blog.example/fire');
    expect(Object.values(t.source_link).find((l) => l.target_id === id && l.use === 'visual_reference')).toBeTruthy();
  });
});

