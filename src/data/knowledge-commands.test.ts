import { describe, expect, it } from 'vitest';
import { createLocalCommands } from './local-commands';
import { memoryPersistence } from './persistence';
import { buildSampleData } from './seed';
import { Store, diffTables, emptyTables, migrate } from './store';
import { SCHEMA_VERSION } from '../domain/types';
import {
  deletedRecipes, deletedTechniques, libraryRecipes, libraryTags, libraryTechniques, practicalExperience,
  recipeDetail, techniqueDetail,
} from '../domain/library';

function emptyStore() {
  const p = memoryPersistence();
  const store = new Store({ schema_version: SCHEMA_VERSION, workspace_id: 'ws', tables: emptyTables() }, p);
  return { store, cmd: createLocalCommands(store) };
}

async function withPaints() {
  const { store, cmd } = emptyStore();
  const a = await cmd.createProduct({ name: 'Rhinox Hide', owns: true });
  const b = await cmd.createProduct({ name: 'Ryza Rust' });
  const c = await cmd.createProduct({ name: 'Fire Dragon Bright' });
  return { store, cmd, a, b, c };
}

describe('teknikker (bit 7)', () => {
  it('oppretter med automatisk navn, som utkast uten vurdert kildegrunnlag', async () => {
    const { store, cmd } = emptyStore();
    const a = await cmd.createTechnique();
    const b = await cmd.createTechnique({ name: '  Pels med drybrush ', tags: ['tekstur', ' Tekstur ', '', 'pels'] });
    const t = store.getTables();
    expect(t.technique[a]!.name).toBe('Ny teknikk 1');
    expect(t.technique[a]!.status).toBe('draft');
    expect(t.technique[a]!.evidence).toBeNull();
    expect(t.technique[b]!.name).toBe('Pels med drybrush');
    expect(t.technique[b]!.tags).toEqual(['tekstur', 'pels']);
    expect(Object.values(t.change_record).filter((r) => r.target_type === 'technique' && r.action === 'create')).toHaveLength(2);
  });

  it('en godkjent teknikk kan fortsatt endres direkte', async () => {
    const { store, cmd } = emptyStore();
    const id = await cmd.createTechnique({ name: 'OSL' });
    await cmd.setTechniqueStatus(id, 'approved');
    await cmd.updateTechnique(id, { desired_result: 'Lys fra flammer', materials: [' Airbrush ', '', 'Pensel'] });
    const row = store.getTables().technique[id]!;
    expect(row.status).toBe('approved');
    expect(row.desired_result).toBe('Lys fra flammer');
    expect(row.materials).toEqual(['Airbrush', 'Pensel']);
  });

  it('tomt navn avvises, og ingenting endres', async () => {
    const { store, cmd } = emptyStore();
    const id = await cmd.createTechnique();
    const before = store.getTables();
    await expect(cmd.updateTechnique(id, { name: '   ' })).rejects.toThrow('Navnet');
    await expect(cmd.setTechniqueStatus(id, 'locked' as never)).rejects.toThrow();
    expect(store.getTables()).toBe(before);
  });

  it('stegene lagres i rekkefølge, beholder id og fjerner det som utelates', async () => {
    const { store, cmd } = emptyStore();
    const id = await cmd.createTechnique();
    await cmd.setTechniqueSteps(id, [{ title: 'Forbered' }, { title: 'Prøv svampen', basis: 'documented' }, { title: 'Bygg' }]);
    let steps = techniqueDetail(store.getTables(), id)!.steps;
    expect(steps.map((s) => s.title)).toEqual(['Forbered', 'Prøv svampen', 'Bygg']);
    const [first, second] = steps;
    await cmd.setTechniqueSteps(id, [{ id: second!.id, instruction: 'Lite maling' }, { id: first!.id }]);
    steps = techniqueDetail(store.getTables(), id)!.steps;
    expect(steps.map((s) => s.id)).toEqual([second!.id, first!.id]);
    expect(steps[0]).toMatchObject({ title: 'Prøv svampen', instruction: 'Lite maling', basis: 'documented', position: 0 });
    expect(Object.keys(store.getTables().technique_step)).toHaveLength(2);
  });

  it('steg fra en annen teknikk kan ikke flyttes inn', async () => {
    const { cmd, store } = emptyStore();
    const a = await cmd.createTechnique();
    const b = await cmd.createTechnique();
    await cmd.setTechniqueSteps(a, [{ title: 'x' }]);
    const stepId = techniqueDetail(store.getTables(), a)!.steps[0]!.id;
    await expect(cmd.setTechniqueSteps(b, [{ id: stepId }])).rejects.toThrow('hører ikke til');
    expect(techniqueDetail(store.getTables(), a)!.steps).toHaveLength(1);
  });

  it('praktisk erfaring regnes ut: uprøvd, prøvd, vellykket', async () => {
    const { store, cmd } = emptyStore();
    const id = await cmd.createTechnique();
    expect(practicalExperience(store.getTables(), id)).toBe('untried');
    const e1 = await cmd.recordExperience(id, { outcome: 'needs_adjustment', note: ' For grov struktur ' });
    expect(practicalExperience(store.getTables(), id)).toBe('tried');
    expect(store.getTables().technique_experience[e1]!.note).toBe('For grov struktur');
    const e2 = await cmd.recordExperience(id, { outcome: 'worked' });
    expect(practicalExperience(store.getTables(), id)).toBe('succeeded');
    await cmd.deleteExperience(e2);
    expect(practicalExperience(store.getTables(), id)).toBe('tried');
  });

  it('sletting skjuler, gjenoppretting viser igjen', async () => {
    const { store, cmd } = emptyStore();
    const id = await cmd.createTechnique({ name: 'Glasering' });
    await cmd.deleteTechnique(id);
    expect(libraryTechniques(store.getTables())).toHaveLength(0);
    expect(deletedTechniques(store.getTables()).map((x) => x.id)).toEqual([id]);
    await expect(cmd.updateTechnique(id, { name: 'X' })).rejects.toThrow('slettet');
    await cmd.restoreTechnique(id);
    expect(libraryTechniques(store.getTables()).map((c) => c.technique.id)).toEqual([id]);
  });
});

describe('oppskrifter (bit 7)', () => {
  it('en ren fargerekke har malinger og ingen steg', async () => {
    const { store, cmd, a, b, c } = await withPaints();
    const id = await cmd.createRecipe({ name: 'Rust', tags: ['metall'] });
    await cmd.setRecipePaints(id, [{ product_id: a, role: 'base' }, { product_id: b }, { product_id: c, role: 'highlight' }]);
    const d = recipeDetail(store.getTables(), id)!;
    expect(d.paints.map((p) => p.product.name)).toEqual(['Rhinox Hide', 'Ryza Rust', 'Fire Dragon Bright']);
    expect(d.paints[0]!.ownership).toBe('owns');
    expect(d.steps).toHaveLength(0);
    expect(libraryRecipes(store.getTables())[0]!.has_method).toBe(false);
  });

  it('med fremgangsmåte: steg bruker malinger fra fargerekken og kan peke på en teknikk', async () => {
    const { store, cmd, a, b } = await withPaints();
    const tech = await cmd.createTechnique({ name: 'Svamp' });
    const id = await cmd.createRecipe({ name: 'Varm rust', effect: 'Rust over mørkt metall' });
    await cmd.setRecipePaints(id, [{ product_id: a }, { product_id: b }]);
    const [pa, pb] = recipeDetail(store.getTables(), id)!.paints;
    await cmd.setRecipeSteps(id, [
      { instruction: 'Grunnfarge', paint_ids: [pa!.row.id] },
      { instruction: 'Duppe på rust', paint_ids: [pb!.row.id, pb!.row.id], technique_id: tech },
    ]);
    const d = recipeDetail(store.getTables(), id)!;
    expect(d.steps[1]!.paints.map((p) => p.product.name)).toEqual(['Ryza Rust']);
    expect(d.steps[1]!.technique!.name).toBe('Svamp');
    expect(libraryRecipes(store.getTables())[0]!.has_method).toBe(true);
    expect(techniqueDetail(store.getTables(), tech)!.recipes.map((r) => r.id)).toEqual([id]);
    expect(libraryTechniques(store.getTables())[0]!.recipe_count).toBe(1);
  });

  it('fjernes en maling fra fargerekken, fjernes den også fra stegene', async () => {
    const { store, cmd, a, b } = await withPaints();
    const id = await cmd.createRecipe();
    await cmd.setRecipePaints(id, [{ product_id: a }, { product_id: b }]);
    const [pa, pb] = recipeDetail(store.getTables(), id)!.paints;
    await cmd.setRecipeSteps(id, [{ instruction: 'Begge', paint_ids: [pa!.row.id, pb!.row.id] }]);
    await cmd.setRecipePaints(id, [{ id: pa!.row.id, product_id: a }]);
    expect(store.getTables().recipe_step[recipeDetail(store.getTables(), id)!.steps[0]!.row.id]!.paint_ids).toEqual([pa!.row.id]);
  });

  it('avviser malinger som ikke finnes, og steg med malinger utenfor fargerekken', async () => {
    const { store, cmd, a } = await withPaints();
    const r1 = await cmd.createRecipe();
    const r2 = await cmd.createRecipe();
    await cmd.setRecipePaints(r1, [{ product_id: a }]);
    const foreign = recipeDetail(store.getTables(), r1)!.paints[0]!.row.id;
    const before = store.getTables();
    await expect(cmd.setRecipePaints(r2, [{ product_id: 'finnes-ikke' }])).rejects.toThrow('finnes ikke');
    await expect(cmd.setRecipeSteps(r2, [{ paint_ids: [foreign] }])).rejects.toThrow('fargerekken');
    await expect(cmd.setRecipeSteps(r2, [{ technique_id: 'finnes-ikke' }])).rejects.toThrow('Teknikken');
    expect(store.getTables()).toBe(before);
  });

  it('godkjent er et merke, ikke en lås', async () => {
    const { store, cmd, a } = await withPaints();
    const id = await cmd.createRecipe();
    await cmd.setRecipeStatus(id, 'approved');
    await cmd.setRecipePaints(id, [{ product_id: a }]);
    await cmd.updateRecipe(id, { note: 'Tynn ut med vann' });
    expect(store.getTables().recipe[id]).toMatchObject({ status: 'approved', note: 'Tynn ut med vann' });
  });

  it('sletting og gjenoppretting', async () => {
    const { store, cmd } = emptyStore();
    const id = await cmd.createRecipe();
    await cmd.deleteRecipe(id);
    expect(libraryRecipes(store.getTables())).toHaveLength(0);
    expect(deletedRecipes(store.getTables())).toHaveLength(1);
    await cmd.restoreRecipe(id);
    expect(libraryRecipes(store.getTables())).toHaveLength(1);
  });
});

describe('søk og merkelapper (bit 7)', () => {
  it('søker i navn, merkelapper, materialer og steg, uten å bry seg om store bokstaver og aksenter', async () => {
    const { store, cmd } = emptyStore();
    const svamp = await cmd.createTechnique({ name: 'Tekstur med svamp', tags: ['Tekstur'], materials: ['Oljemaling'] });
    const osl = await cmd.createTechnique({ name: 'OSL', tags: ['lys og effekter'] });
    await cmd.setTechniqueSteps(osl, [{ instruction: 'Glasér lyset utover' }]);
    const t = store.getTables();
    expect(libraryTechniques(t, { query: 'OLJE' }).map((c) => c.technique.id)).toEqual([svamp]);
    expect(libraryTechniques(t, { query: 'glaser' }).map((c) => c.technique.id)).toEqual([osl]);
    expect(libraryTechniques(t, { tag: 'tekstur' }).map((c) => c.technique.id)).toEqual([svamp]);
    expect(libraryTechniques(t, { query: 'svamp osl' })).toHaveLength(0);
  });

  it('søker i malingene i en oppskrift', async () => {
    const { store, cmd, b } = await withPaints();
    const id = await cmd.createRecipe({ name: 'Rust' });
    await cmd.setRecipePaints(id, [{ product_id: b }]);
    await cmd.createRecipe({ name: 'Hud' });
    expect(libraryRecipes(store.getTables(), { query: 'ryza' }).map((c) => c.recipe.id)).toEqual([id]);
  });

  it('teller merkelapper på tvers av skrivemåter', async () => {
    const { store, cmd } = emptyStore();
    await cmd.createTechnique({ tags: ['Tekstur', 'pels'] });
    await cmd.createTechnique({ tags: ['tekstur'] });
    const gone = await cmd.createTechnique({ tags: ['slettet'] });
    await cmd.deleteTechnique(gone);
    expect(libraryTags(store.getTables(), 'technique')).toEqual([{ tag: 'Tekstur', count: 2 }, { tag: 'pels', count: 1 }]);
  });
});

describe('migrering til v5', () => {
  it('legger til tomme bibliotektabeller og beholder alt annet', async () => {
    const p = memoryPersistence();
    const s = await buildSampleData(p);
    const tables = { ...s.tables } as Partial<typeof s.tables>;
    for (const k of ['technique', 'technique_step', 'technique_experience', 'recipe', 'recipe_paint', 'recipe_step'] as const) delete tables[k];
    const m = migrate({ ...s, schema_version: 4, tables: tables as typeof s.tables })!;
    expect(m.schema_version).toBe(5);
    expect(m.tables.technique).toEqual({});
    expect(m.tables.recipe_paint).toEqual({});
    expect(m.tables.project).toEqual(s.tables.project);
  });

  it('bibliotekendringer kan angres som andre endringer (diffTables)', async () => {
    const { store, cmd } = emptyStore();
    const before = store.getTables();
    const id = await cmd.createTechnique();
    const patches = diffTables(before, store.getTables());
    expect(patches.some((p) => p.table === 'technique' && p.key === id)).toBe(true);
  });
});
