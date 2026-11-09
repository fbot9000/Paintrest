import { describe, expect, it } from 'vitest';
import { createLocalCommands } from './local-commands';
import { memoryPersistence } from './persistence';
import { buildSampleData } from './seed';
import { Store, emptyTables } from './store';
import { SCHEMA_VERSION } from '../domain/types';
import { paintingView, productList, projectList } from '../domain/views';

function emptyStore() {
  const p = memoryPersistence();
  const store = new Store({ schema_version: SCHEMA_VERSION, workspace_id: 'ws', tables: emptyTables() }, p);
  return { store, cmd: createLocalCommands(store) };
}

async function sampleStore() {
  const p = memoryPersistence();
  const store = new Store(await buildSampleData(p), p);
  return { store, cmd: createLocalCommands(store) };
}

describe('nytt prosjekt (skjema §1)', () => {
  it('oppretter spill og prosjekt med automatisk navn', async () => {
    const { store, cmd } = emptyStore();
    const a = await cmd.createProject();
    const b = await cmd.createProject();
    const t = store.getTables();
    expect(t.game[a.game_id]!.primary_name).toBe('Nytt spill 1');
    expect(t.game[b.game_id]!.primary_name).toBe('Nytt spill 2');
    expect(t.project[a.project_id]!.game_id).toBe(a.game_id);
    expect(Object.values(t.change_record).every((r) => r.initiated_by === 'user' && r.proposal_id === null)).toBe(true);
  });

  it('sletting skjuler, gjenoppretting viser igjen', async () => {
    const { store, cmd } = emptyStore();
    const { project_id } = await cmd.createProject({ name: 'Zombicide' });
    await cmd.deleteProject(project_id);
    expect(projectList(store.getTables()).live).toHaveLength(0);
    await cmd.restoreProject(project_id);
    expect(projectList(store.getTables()).live).toHaveLength(1);
  });

  it('en feilende kommando endrer ingenting', async () => {
    const { store, cmd } = emptyStore();
    const { game_id } = await cmd.createProject();
    const before = store.getTables();
    await expect(cmd.updateGame(game_id, { primary_name: '  ' })).rejects.toThrow();
    expect(store.getTables()).toBe(before);
  });
});

describe('BGG-kobling (skjema §10)', () => {
  const cand = { thing_id: 1, primary_name: 'Ekte navn', year_published: 2020, publishers: ['X'], expansions: [{ thing_id: 2, name: 'Utv', year_published: null }] };

  it('fyller bare tomme felt og automatiske navn', async () => {
    const { store, cmd } = emptyStore();
    const auto = await cmd.createProject();
    const named = await cmd.createProject({ name: 'Mitt navn' });
    await cmd.linkBgg(auto.game_id, cand);
    await cmd.updateGame(named.game_id, { year_published: 1999 });
    await cmd.linkBgg(named.game_id, { ...cand, thing_id: 5 });
    const t = store.getTables();
    expect(t.game[auto.game_id]!.primary_name).toBe('Ekte navn');
    expect(t.game[named.game_id]!.primary_name).toBe('Mitt navn');
    expect(t.game[named.game_id]!.year_published).toBe(1999);
  });

  it('samme thing-id på to spill blir meldt, ikke skrevet', async () => {
    const { store, cmd } = emptyStore();
    const a = await cmd.createProject();
    const b = await cmd.createProject();
    await cmd.linkBgg(a.game_id, cand);
    const r = await cmd.linkBgg(b.game_id, cand);
    expect(r.status).toBe('duplicate');
    expect(store.getTables().game[b.game_id]!.bgg_thing_id).toBeNull();
  });

  it('valgte utvidelser kobles til prosjektet', async () => {
    const { store, cmd } = emptyStore();
    const a = await cmd.createProject();
    await cmd.linkBgg(a.game_id, cand, { expansion_thing_ids: [2], project_id: a.project_id });
    expect(store.getTables().project_expansion).toHaveLength(1);
  });

  it('manuell utvidelse med samme navn kobles, ikke dupliseres', async () => {
    const { store, cmd } = emptyStore();
    const a = await cmd.createProject();
    await cmd.createExpansion(a.game_id, { name: 'utv', attach_to_project_id: a.project_id });
    await cmd.linkBgg(a.game_id, cand, { expansion_thing_ids: [2], project_id: a.project_id });
    const ex = Object.values(store.getTables().expansion);
    expect(ex).toHaveLength(1);
    expect(ex[0]!.bgg_thing_id).toBe(2);
    expect(store.getTables().project_expansion).toHaveLength(1);
  });
});

describe('miniatyrer', () => {
  it('enkeltfigur har alltid én fysisk figur', async () => {
    const { store, cmd } = emptyStore();
    const { project_id } = await cmd.createProject();
    const id = await cmd.createSubject(project_id, { grouping: 'single', physical_count: 4 });
    expect(store.getTables().miniature_subject[id]!.physical_count).toBe(1);
    expect(store.getTables().miniature_subject[id]!.name).toBe('Ny miniatyr 1');
  });
});

describe('malevisning', () => {
  it('ferdigstilling forsegler åpne avvik og lagrer kopien', async () => {
    const { store, cmd } = await sampleStore();
    const t = store.getTables();
    const merlin = Object.values(t.miniature_subject).find((s) => s.name === 'Merlin')!;
    const view = paintingView(t, merlin.id)!;
    const step = view.elements[1]!.steps[3]!;
    const from = step.materials[0]!.product.id;
    const to = Object.values(t.paint_product).find((p) => p.name === 'Warpstone Glow')!.id;
    await cmd.addDeviation(view.plan!.id, { element_id: view.elements[1]!.element.id, step_id: step.step.id, kind: 'swap_product', payload: { from_product_id: from, to_product_id: to } });

    const swapped = paintingView(store.getTables(), merlin.id)!;
    expect(swapped.elements[1]!.steps[3]!.materials[0]!.swapped_to?.product.id).toBe(to);
    expect(productList(swapped).some((r) => r.product.name === 'Moot Green' && r.element_names.includes('Kappe og fjær'))).toBe(false);

    const cid = await cmd.markFinished(merlin.id, 1);
    const after = store.getTables();
    expect(after.paint_completion[cid]!.deviation_snapshot).toHaveLength(1);
    expect(after.miniature_subject[merlin.id]!.finished_count).toBe(1);
    expect(paintingView(after, merlin.id)!.open_deviations).toHaveLength(0);
    await expect(cmd.markFinished(merlin.id, 1)).rejects.toThrow();
  });

  it('gruppetall kan ikke overstige fysisk antall', async () => {
    const { store, cmd } = await sampleStore();
    const g = Object.values(store.getTables().miniature_subject).find((s) => s.grouping === 'group')!;
    const el = paintingView(store.getTables(), g.id)!.elements[0]!.element.id;
    await cmd.setGroupProgress(g.id, el, 10);
    expect(paintingView(store.getTables(), g.id)!.elements[0]!.group_count).toBe(3);
  });
});

describe('bilder på miniatyren (brukerens egne valg)', () => {
  const img = (n: string, page = 'https://site.example/gallery') => ({
    image_url: `https://site.example/${n}.jpg`, page_url: page, page_title: 'Galleri', site: 'site.example', creator: 'Pete', caption: n, kind: 'painted' as const,
  });

  async function setup() {
    const p = memoryPersistence();
    const store = new Store({ schema_version: SCHEMA_VERSION, workspace_id: 'ws', tables: emptyTables() }, p);
    let downloads = 0;
    const cmd = createLocalCommands(store, { fetchImage: async () => { downloads++; return new Blob(['x'], { type: 'image/jpeg' }); } });
    const { project_id } = await cmd.createProject();
    const a = await cmd.createSubject(project_id, { name: 'A' });
    const b = await cmd.createSubject(project_id, { name: 'B' });
    return { store, cmd, a, b, downloads: () => downloads };
  }

  it('lagrer valgte bilder, setter illustrasjon og gjenbruker kilde og fil', async () => {
    const { store, cmd, a, b, downloads } = await setup();
    await cmd.attachWebImages(a, [img('front'), img('back')], 'https://site.example/back.jpg');
    let t = store.getTables();
    expect(Object.values(t.source)).toHaveLength(1);
    expect(t.source_asset[t.miniature_subject[a]!.official_asset_id!]!.locator).toBe('https://site.example/back.jpg');
    expect(downloads()).toBe(2);
    // Same page and image for another miniature: no new source, no new download.
    await cmd.attachWebImages(b, [img('front')]);
    t = store.getTables();
    expect(Object.values(t.source)).toHaveLength(1);
    expect(Object.values(t.source_asset)).toHaveLength(2);
    expect(downloads()).toBe(2);
    expect(paintingView(t, b)!.references.map((r) => r.asset.locator)).toEqual(['https://site.example/front.jpg']);
  });

  it('ny illustrasjon beholder den gamle som referansebilde', async () => {
    const { store, cmd, a } = await setup();
    await cmd.setSubjectImage(a, new Blob(['eget'], { type: 'image/png' }), 'eget.png');
    const own = store.getTables().miniature_subject[a]!.official_asset_id!;
    await cmd.attachWebImages(a, [img('front')], 'https://site.example/front.jpg');
    const t = store.getTables();
    expect(t.source_asset[t.miniature_subject[a]!.official_asset_id!]!.locator).toBe('https://site.example/front.jpg');
    expect(paintingView(t, a)!.references.map((r) => r.asset.id)).toContain(own);
  });

  it('fjerner et bilde fra miniatyren uten å slette kilden', async () => {
    const { store, cmd, a } = await setup();
    await cmd.attachWebImages(a, [img('front')], 'https://site.example/front.jpg');
    const asset = store.getTables().miniature_subject[a]!.official_asset_id!;
    await cmd.detachSubjectImage(a, asset);
    const t = store.getTables();
    expect(t.miniature_subject[a]!.official_asset_id).toBeNull();
    expect(Object.values(t.source_link).every((l) => l.deleted_at)).toBe(true);
    expect(t.source_asset[asset]!.deleted_at).toBeNull();
  });
});
