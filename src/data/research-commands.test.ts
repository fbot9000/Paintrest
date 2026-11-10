import { describe, expect, it } from 'vitest';
import { buildAgentContext, normaliseProposal, productKey } from '../domain/agent';
import type { NormalisedProposal, PaintPlanPayload } from '../domain/agent';
import { memoryPersistence } from './persistence';
import { createAgentCommands, createResearchCommands } from './research-commands';
import { createLocalCommands } from './local-commands';
import { buildSampleData } from './seed';
import { Store, migrate } from './store';

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

  it('kan ikke skrive over en godkjent plan uten revisjonsmål', async () => {
    const { agent, task, subject } = await setup();
    const r = agent.writeProposal(task, plan(subject('Merlin').id), 'uib', 'm');
    expect(r.ok).toBe(false);
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
    expect(ctx.allowedTypes).toEqual(['catalog_subject', 'paint_plan', 'reference_selection']);
  });

  it('migrerer v1-data uten å miste prosjekter', async () => {
    const p = memoryPersistence();
    const s = await buildSampleData(p);
    const v1 = { ...s, schema_version: 1, tables: { ...s.tables } } as typeof s;
    delete (v1.tables as Partial<typeof s.tables>).research_task;
    const m = migrate(v1)!;
    expect(m.schema_version).toBe(3);
    expect(m.tables.source_layer).toEqual({});
    expect(Object.keys(m.tables.project).length).toBe(Object.keys(s.tables.project).length);
    expect(m.tables.research_task).toEqual({});
  });
});
