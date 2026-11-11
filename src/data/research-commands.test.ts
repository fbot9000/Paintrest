import { describe, expect, it } from 'vitest';
import { buildAgentContext, knownSources, normaliseProposal, productKey } from '../domain/agent';
import type { NormalisedProposal, PaintPlanPayload } from '../domain/agent';
import { memoryPersistence } from './persistence';
import { createAgentCommands, createResearchCommands } from './research-commands';
import { createLocalCommands } from './local-commands';
import { buildSampleData } from './seed';
import { Store, migrate } from './store';
import { paintingView } from '../domain/views';
import { SCHEMA_VERSION } from '../domain/types';

async function setup() {
  const p = memoryPersistence();
  const store = new Store(await buildSampleData(p), p);
  const t0 = store.getTables();
  const project = Object.values(t0.project).find((x) => t0.game[x.game_id]!.primary_name.startsWith('Avalon'))!;
  const research = createResearchCommands(store, {
    fetchImage: async (url) => {
      if (url.includes('broken')) throw new Error('404');
      return new Blob(['img'], { type: 'image/jpeg' });
    },
  });
  const agent = createAgentCommands(store);
  const task = await research.startTask(project.id);
  const subject = (name: string) => Object.values(store.getTables().miniature_subject).find((s) => s.name === name)!;
  return { store, research, agent, task, project, subject, cmd: createLocalCommands(store) };
}

const plan = (subject_id: string, paint = 'Caliban Green'): NormalisedProposal => ({
  result_type: 'paint_plan', update_of: null, evidence: 'synthesized', uncertainty: [],
  payload: {
    subject_id, note: null,
    elements: [{ kind: 'part', name: 'Kropp', steps: [{ instruction: 'Base', materials: [{ product: { manufacturer: 'Citadel', range: null, name: paint }, role: 'base', role_label: null }], mix: null }] }],
  } satisfies PaintPlanPayload,
});

describe('normalisering av modellsvar', () => {
  it('tolker miniatyr og maleplan, og avviser ukjent miniatyr', () => {
    const c = normaliseProposal({ type: 'catalog_subject', payload: { name: 'Ulv', grouping: 'group', physical_count: '4' } }, {});
    expect(c.ok && c.value.payload).toMatchObject({ name: 'Ulv', physical_count: 4 });
    const bad = normaliseProposal({ type: 'paint_plan', payload: { subject: 'M9', elements: [{ name: 'x', steps: [] }] } }, { M1: 'a' });
    expect(bad.ok).toBe(false);
    const ok = normaliseProposal({ type: 'paint_plan', payload: { subject: 'M1', elements: [{ name: 'Hud', steps: [{ instruction: 'x', materials: [{ product: 'Nuln Oil', role: 'wash' }] }] }] } }, { M1: 'a' });
    expect(ok.ok).toBe(true);
  });
});

describe('agentens omfang (skjema §7)', () => {
  it('kan foreslå miniatyrer og plan for figur uten plan', async () => {
    const { agent, task, subject } = await setup();
    expect(agent.writeProposal(task, { result_type: 'catalog_subject', update_of: null, evidence: 'synthesized', uncertainty: [], payload: { name: 'Tåkeulv', grouping: 'group', physical_count: 4, expansion_name: 'Myths & Monsters', category_label: null, count_basis: null, grouping_basis: 'inferred', note: null, sources: [] } }, 'uib', 'm').ok).toBe(true);
    expect(agent.writeProposal(task, plan(subject('The Ancient One').id), 'uib', 'm').ok).toBe(true);
  });

  it('kan foreslå ny versjon av en godkjent plan i prosjektet uten åpnet mål', async () => {
    const { store, agent, task, subject } = await setup();
    const r = agent.writeProposal(task, plan(subject('Merlin').id), 'uib', 'm');
    if (!r.ok) throw new Error(r.reason);
    const p = store.getTables().research_proposal[r.id]!;
    expect(p.result_type).toBe('plan_revision');
    expect(p.base_version_id).toBe(subject('Merlin').current_plan_version_id);
  });

  it('kan ikke bruke en figur fra et annet prosjekt', async () => {
    const { agent, task, cmd } = await setup();
    const other = await cmd.createProject();
    const foreign = await cmd.createSubject(other.project_id);
    expect(agent.writeProposal(task, plan(foreign), 'uib', 'm').ok).toBe(false);
  });

  it('kan bare oppdatere egne ventende utkast', async () => {
    const { agent, research, task, subject } = await setup();
    const a = agent.writeProposal(task, plan(subject('The Ancient One').id), 'uib', 'm');
    expect(a.ok && a.ref).toBe('F1');
    const upd = agent.writeProposal(task, { ...plan(subject('The Ancient One').id, 'Nuln Oil'), update_of: 'F1' }, 'uib', 'm');
    expect(upd.ok && upd.updated).toBe(true);
    if (a.ok) await research.rejectProposal(a.id);
    expect(agent.writeProposal(task, { ...plan(subject('The Ancient One').id), update_of: 'F1' }, 'uib', 'm').ok).toBe(false);
  });
});

describe('godkjenning (skjema §8)', () => {
  it('ny maleplan skriver versjon 1 og change_record fra agenten', async () => {
    const { store, agent, research, task, subject } = await setup();
    const w = agent.writeProposal(task, plan(subject('The Ancient One').id), 'uib', 'm');
    if (!w.ok) throw new Error(w.reason);
    await research.approveProposal(w.id);
    const t = store.getTables();
    const s = subject('The Ancient One');
    expect(s.plan_state).toBe('approved');
    expect(t.paint_plan_version[s.current_plan_version_id!]!.origin).toBe('proposal');
    expect(Object.values(t.change_record).some((r) => r.initiated_by === 'agent' && r.proposal_id === w.id)).toBe(true);
    expect(t.research_proposal[w.id]!.decision).toBe('approved');
  });

  it('ukjent maling stopper godkjenningen til brukeren velger', async () => {
    const { store, agent, research, task, subject } = await setup();
    const w = agent.writeProposal(task, plan(subject('The Ancient One').id, 'Finnes Ikke Grønn'), 'uib', 'm');
    if (!w.ok) throw new Error(w.reason);
    await expect(research.approveProposal(w.id)).rejects.toThrow(/Finnes Ikke Grønn/);
    expect(store.getTables().research_proposal[w.id]!.last_error).toMatch(/Finnes Ikke Grønn/);
    const key = productKey({ manufacturer: 'Citadel', range: null, name: 'Finnes Ikke Grønn' });
    await research.approveProposal(w.id, { product_choices: { [key]: 'create' } });
    const created = Object.values(store.getTables().paint_product).find((p) => p.name === 'Finnes Ikke Grønn')!;
    expect(created.identity_status).toBe('unconfirmed');
  });

  it('revisjon krever åpnet mål og stopper hvis grunnlaget er utdatert', async () => {
    const { store, agent, research, task, subject } = await setup();
    const merlin = subject('Merlin');
    const v1 = merlin.current_plan_version_id!;
    await research.openRevisionTarget(task, merlin.id);
    const a = agent.writeProposal(task, plan(merlin.id), 'uib', 'm');
    const b = agent.writeProposal(task, plan(merlin.id, 'Nuln Oil'), 'uib', 'm');
    if (!a.ok || !b.ok) throw new Error('forslag feilet');
    expect(store.getTables().research_proposal[a.id]!.result_type).toBe('plan_revision');
    await research.approveProposal(a.id);
    expect(store.getTables().paint_plan_version[v1]!.state).toBe('superseded');
    expect(subject('Merlin').current_plan_version_id).not.toBe(v1);
    await expect(research.approveProposal(b.id)).rejects.toThrow(/nyere versjon/);
  });
});

describe('bildeutvalg fra nettet', () => {
  const sel = (subject_id: string, extra: { image_url: string }[] = []): NormalisedProposal => ({
    result_type: 'reference_selection', update_of: null, evidence: 'documented', uncertainty: [],
    payload: { subject_id, note: null, images: [
      { image_url: 'https://gallery.example/a.jpg', page_url: 'https://gallery.example/druids', page_title: 'Druids painted', site: 'gallery.example', creator: 'Painter Pete', caption: 'Forfra' },
      { image_url: 'https://gallery.example/b.jpg', page_url: 'https://gallery.example/druids', page_title: 'Druids painted', site: 'gallery.example', creator: 'Painter Pete', caption: 'Bakfra' },
      ...extra.map((e) => ({ ...e, page_url: 'https://other.example/p', page_title: 'Other', site: 'other.example', creator: null, caption: null })),
    ] },
  });

  it('lagrer kilde, bilder og lenke til miniatyren, og kan sette miniatyrbilde', async () => {
    const { store, agent, research, task, subject } = await setup();
    const id = (await import('./research-commands')).IMPLEMENTED_TYPES;
    expect(id).toContain('reference_selection');
    const w = agent.writeProposal(task, sel(subject('Druid Mistwalker').id), 'uib', 'm');
    if (!w.ok) throw new Error(w.reason);
    await research.approveProposal(w.id, { image_urls: ['https://gallery.example/a.jpg'], set_cover: false });
    const t = store.getTables();
    const src = Object.values(t.source).find((x) => x.url === 'https://gallery.example/druids')!;
    expect(src).toMatchObject({ retention: 'kept', creator: 'Painter Pete', title: 'Druids painted' });
    const assets = Object.values(t.source_asset).filter((a) => a.source_id === src.id);
    expect(assets).toHaveLength(1);
    expect(assets[0]!.locator).toBe('https://gallery.example/a.jpg');
    expect(Object.values(t.source_link).some((l) => l.source_id === src.id && l.target_id === subject('Druid Mistwalker').id && l.use === 'visual_reference')).toBe(true);
  });

  it('feilet nedlasting stopper godkjenningen og lagrer ingenting', async () => {
    const { store, agent, research, task, subject, cmd, project } = await setup();
    await cmd.createSubject(project.id, { name: 'Tåkeulv' });
    const w = agent.writeProposal(task, sel(subject('Tåkeulv').id, [{ image_url: 'https://other.example/broken.jpg' }]), 'uib', 'm');
    if (!w.ok) throw new Error(w.reason);
    const before = Object.keys(store.getTables().source).length;
    await expect(research.approveProposal(w.id)).rejects.toThrow(/Kunne ikke hente 1 bilde/);
    expect(Object.keys(store.getTables().source).length).toBe(before);
    await research.approveProposal(w.id, { image_urls: ['https://gallery.example/a.jpg', 'https://gallery.example/b.jpg'], set_cover: true });
    const s = subject('Tåkeulv');
    expect(store.getTables().source_asset[s.official_asset_id!]!.locator).toBe('https://gallery.example/a.jpg');
  });
});

describe('bildejakt: kildetekst og oversettelse', () => {
  it('lagrer originaltekst og norsk sammendrag som kildelag for sider med valgte bilder', async () => {
    const { store, agent, research, task, subject } = await setup();
    const w = agent.writeProposal(task, {
      result_type: 'reference_selection', update_of: null, evidence: 'documented', uncertainty: [],
      payload: {
        subject_id: subject('Merlin').id, note: null,
        images: [{ image_url: 'https://blog.example/balor.jpg', page_url: 'https://blog.example/post', page_title: '발로르 도색', site: 'blog.example', creator: null, caption: 'Balor', confidence: 'high', reason: 'Teksten nevner Balor', original_text: '발로르', page_language: 'ko' }],
        sources_read: [
          { url: 'https://blog.example/post', title: '발로르 도색', site: 'blog.example', language: 'ko', summary: 'Maleren viser ferdig malt Balor.', original_excerpt: '발로르 도색 완료' },
          { url: 'https://other.example/x', title: 'Annet', site: 'other.example', language: 'en', summary: 'Ikke brukt.', original_excerpt: null },
        ],
      },
    }, 'uib', 'm');
    if (!w.ok) throw new Error(w.reason);
    await research.approveProposal(w.id);
    const t = store.getTables();
    const src = Object.values(t.source).find((x) => x.url === 'https://blog.example/post')!;
    const layers = Object.values(t.source_layer).filter((l) => l.source_id === src.id);
    expect(layers.map((l) => [l.layer, l.language, l.body]).sort()).toEqual([
      ['original', 'ko', '발로르 도색 완료'], ['translation', 'nb', 'Maleren viser ferdig malt Balor.'],
    ]);
    expect(Object.values(t.source).some((x) => x.url === 'https://other.example/x')).toBe(false);
  });
});

describe('endringer i katalogen (autonomi i prosjektet)', () => {
  const change = (operations: unknown[]): NormalisedProposal => ({
    result_type: 'catalog_change', update_of: null, evidence: 'synthesized', uncertainty: [], payload: { operations, note: null },
  } as NormalisedProposal);

  it('deler en godkjent miniatyr i fire fraksjoner, og originalen kan gjenopprettes', async () => {
    const { store, agent, research, task, project, cmd } = await setup();
    const agents = await cmd.createSubject(project.id, { name: 'Agenter', grouping: 'group', physical_count: 12 });
    const ctx = buildAgentContext(store.getTables(), task);
    const ref = Object.entries(ctx.subjectRefs).find(([, id]) => id === agents)![0];
    const raw = { type: 'catalog_change', payload: { operations: [{ op: 'split', subject: ref, into: ['rød', 'blå', 'grønn', 'gul'].map((c) => ({ name: `Agenter – ${c}`, physical_count: 3, category_label: `${c} fraksjon` })) }] } };
    const n = normaliseProposal(raw, ctx.subjectRefs);
    if (!n.ok) throw new Error(n.reason);
    const w = agent.writeProposal(task, n.value, 'uib', 'm');
    if (!w.ok) throw new Error(w.reason);
    await research.approveProposal(w.id);
    const live = Object.values(store.getTables().miniature_subject).filter((s) => !s.deleted_at && s.name.startsWith('Agenter'));
    expect(live.map((s) => [s.name, s.grouping, s.physical_count]).sort()).toEqual([
      ['Agenter – blå', 'group', 3], ['Agenter – grønn', 'group', 3], ['Agenter – gul', 'group', 3], ['Agenter – rød', 'group', 3],
    ]);
    expect(store.getTables().miniature_subject[agents]!.deleted_at).not.toBeNull();
    expect(Object.values(store.getTables().change_record).filter((r) => r.proposal_id === w.id && r.initiated_by === 'agent').length).toBe(5);
    await cmd.restoreSubject(agents);
    expect(store.getTables().miniature_subject[agents]!.deleted_at).toBeNull();
  });

  it('endrer, slår sammen og sletter i én transaksjon', async () => {
    const { store, agent, research, task, subject } = await setup();
    const w = agent.writeProposal(task, change([
      { op: 'update', subject_id: subject('Merlin').id, set: { name: 'Merlin den gamle' } },
      { op: 'merge', subject_ids: [subject('The Ancient One').id, subject('Druid Mistwalker').id], into: { name: 'Store figurer', grouping: 'group', physical_count: 2 } },
    ]), 'uib', 'm');
    if (!w.ok) throw new Error(w.reason);
    await research.approveProposal(w.id);
    const live = Object.values(store.getTables().miniature_subject).filter((s) => !s.deleted_at).map((s) => s.name).sort();
    expect(live).toContain('Merlin den gamle');
    expect(live).toContain('Store figurer');
    expect(live).not.toContain('The Ancient One');
  });

  it('kan ikke røre miniatyrer i et annet prosjekt', async () => {
    const { agent, task, cmd } = await setup();
    const other = await cmd.createProject();
    const foreign = await cmd.createSubject(other.project_id);
    expect(agent.writeProposal(task, change([{ op: 'delete', subject_id: foreign }]), 'uib', 'm').ok).toBe(false);
  });

  it('avviser ukjente referanser fra modellen', () => {
    const r = normaliseProposal({ type: 'catalog_change', payload: { operations: [{ op: 'delete', subject: 'M99' }] } }, { M1: 'a' });
    expect(r.ok).toBe(false);
  });
});

describe('maleplan med palett', () => {
  it('godkjenning gir planversjon med sammendrag, palett for miniatyren, farge på nye malinger og metodekilde', async () => {
    const { store, agent, research, task, subject, project } = await setup();
    const s = subject('The Ancient One');
    const w = agent.writeProposal(task, {
      result_type: 'paint_plan', update_of: null, evidence: 'synthesized', uncertainty: [],
      payload: {
        subject_id: s.id, note: null, summary: 'Svart grunning, slapchop og grønne glasurer.',
        elements: [{ kind: 'part', name: 'Hud', steps: [
          { instruction: 'Base', materials: [{ product: { manufacturer: 'Citadel', range: null, name: 'Caliban Green' }, role: 'base', role_label: null }], mix: null },
          { instruction: 'Glasur', materials: [{ product: { manufacturer: 'Vallejo', range: 'Xpress', name: 'Lizard Green', hex: '#4a7a2a' }, role: 'glaze', role_label: null }], mix: null },
        ] }],
        palette: [
          { product: { manufacturer: 'Citadel', range: null, name: 'Caliban Green' }, role_label: 'hud – base', part: 'Hud' },
          { product: { manufacturer: 'Vallejo', range: 'Xpress', name: 'Lizard Green', hex: '#4a7a2a' }, role_label: 'hud – glasur', part: 'Hud' },
        ],
        sources: [{ url: 'https://guide.example/x', title: 'Guide', author: null, opened: true }],
        sources_read: [{ url: 'https://guide.example/x', title: 'Guide', site: 'guide.example', language: 'ja', summary: 'Guiden bruker grønne glasurer.', original_excerpt: '緑のグレーズ' }],
      },
    }, 'uib', 'm');
    if (!w.ok) throw new Error(w.reason);
    const key = productKey({ manufacturer: 'Vallejo', range: 'Xpress', name: 'Lizard Green' });
    await research.approveProposal(w.id, { product_choices: { [key]: 'create' } });
    const t = store.getTables();
    const pv = t.paint_plan_version[subject('The Ancient One').current_plan_version_id!]!;
    expect(pv.summary).toBe('Svart grunning, slapchop og grønne glasurer.');
    const pal = paintingView(t, s.id)!.palette;
    expect(pal.filter((x) => !x.project_wide).map((x) => [x.product.name, x.entry.role_label])).toEqual([['Caliban Green', 'hud – base'], ['Lizard Green', 'hud – glasur']]);
    expect(Object.values(t.paint_product).find((x) => x.name === 'Lizard Green')!.swatch_hex).toBe('#4a7a2a');
    expect(Object.values(t.source_link).some((l) => l.use === 'method' && l.target_id === s.id)).toBe(true);
    expect(Object.values(t.source_layer).some((l) => l.layer === 'translation' && l.body === 'Guiden bruker grønne glasurer.')).toBe(true);
    expect(t.project[project.id]!.content_revision).toBe(1);
  });

  it('brukeren kan redigere planforslaget før godkjenning', async () => {
    const { store, agent, research, task, subject } = await setup();
    const w = agent.writeProposal(task, plan(subject('The Ancient One').id), 'uib', 'm');
    if (!w.ok) throw new Error(w.reason);
    const p = store.getTables().research_proposal[w.id]!.payload as PaintPlanPayload;
    await research.editPlanProposal(w.id, { ...p, elements: [{ ...p.elements[0]!, name: 'Kropp og hud', steps: [{ ...p.elements[0]!.steps[0]!, instruction: 'Tynn base i to strøk' }, { instruction: '', materials: [], mix: null }] }] });
    const after = store.getTables().research_proposal[w.id]!.payload as PaintPlanPayload;
    expect(after.elements[0]!.name).toBe('Kropp og hud');
    expect(after.elements[0]!.steps).toHaveLength(1);
    await expect(research.editPlanProposal(w.id, { ...after, subject_id: subject('Merlin').id })).rejects.toThrow(/byttes/);
  });
});

describe('kilder agenten har lest', () => {
  it('lagres som utkast for spillet, med sammendrag, og blir kjente kilder', async () => {
    const { store, agent, task, project } = await setup();
    agent.recordSources(task,
      [{ url: 'https://blog.example/a', title: 'A', site: 'blog.example', author: null, language: 'ko', image_count: 5 }],
      [{ url: 'https://blog.example/a', title: 'A', site: 'blog.example', language: 'ko', summary: 'Viser fomorianerne.', original_excerpt: '포모리안' }]);
    agent.recordSources(task, [{ url: 'https://blog.example/a', title: 'A', site: 'blog.example', author: null, language: 'ko', image_count: 5 }], []);
    const t = store.getTables();
    const drafts = Object.values(t.source).filter((x) => x.url === 'https://blog.example/a');
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ retention: 'draft', created_by_task_id: task, language: 'ko' });
    const known = knownSources(t, project.id).find((k) => k.source.url === 'https://blog.example/a')!;
    expect(known).toMatchObject({ status: 'found', summary: 'Viser fomorianerne.' });
    expect(JSON.stringify(buildAgentContext(t, task).data)).toContain('"status":"found"');
  });
});

describe('eldre oppgaver', () => {
  it('får nye resultattyper når brukeren starter en runde', async () => {
    const { store, research, agent, task, subject } = await setup();
    store.transaction((t) => { t.task_result_type = t.task_result_type.filter((r) => !(r.task_id === task && r.result_type === 'reference_selection')); });
    const sel: NormalisedProposal = { result_type: 'reference_selection', update_of: null, evidence: 'documented', uncertainty: [],
      payload: { subject_id: subject('Merlin').id, note: null, images: [{ image_url: 'https://a.example/1.jpg', page_url: 'https://a.example/', page_title: 'A', site: 'a.example', creator: null, caption: null }] } };
    expect(agent.writeProposal(task, sel, 'uib', 'm').ok).toBe(false);
    await research.syncResultTypes(task);
    expect(agent.writeProposal(task, sel, 'uib', 'm').ok).toBe(true);
  });
});

describe('kontekst og migrering', () => {
  it('konteksten viser figurer med korte referanser og eide malinger', async () => {
    const { store, task } = await setup();
    const ctx = buildAgentContext(store.getTables(), task);
    expect(Object.keys(ctx.subjectRefs)).toContain('M1');
    expect(JSON.stringify(ctx.data)).toContain('Caliban Green');
    expect(ctx.allowedTypes).toEqual(['catalog_subject', 'paint_plan', 'reference_selection', 'catalog_change', 'plan_revision']);
  });

  it('migrerer v1-data uten å miste prosjekter', async () => {
    const p = memoryPersistence();
    const s = await buildSampleData(p);
    const v1 = { ...s, schema_version: 1, tables: { ...s.tables } } as typeof s;
    delete (v1.tables as Partial<typeof s.tables>).research_task;
    delete (v1.tables as Partial<typeof s.tables>).technique;
    delete (v1.tables as Partial<typeof s.tables>).recipe_step;
    const m = migrate(v1)!;
    expect(m.schema_version).toBe(SCHEMA_VERSION);
    expect(m.tables.agent_change_set).toEqual({});
    expect(m.tables.technique).toEqual({});
    expect(m.tables.recipe_step).toEqual({});
    expect(m.tables.source_layer).toEqual({});
    expect(Object.keys(m.tables.project).length).toBe(Object.keys(s.tables.project).length);
    expect(m.tables.research_task).toEqual({});
  });
});
