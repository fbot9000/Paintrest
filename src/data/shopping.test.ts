import { describe, expect, it } from 'vitest';
import { createLocalCommands } from './local-commands';
import { memoryPersistence } from './persistence';
import { buildSampleData } from './seed';
import { Store } from './store';
import { shoppingList, shoppingProjects } from '../domain/shopping';
import type { Tables } from '../domain/types';
import { ownershipOf } from '../domain/views';

async function sampleStore() {
  const p = memoryPersistence();
  const store = new Store(await buildSampleData(p, { examplePaints: true }), p);
  return { store, cmd: createLocalCommands(store) };
}
const byName = (t: Tables, name: string) => Object.values(t.paint_product).find((p) => p.name === name)!;
const names = (t: Tables, f?: { project_id?: string | null }) => shoppingList(t, f).map((r) => [r.product.name, r.priority, r.manual]);

describe('handlelisten', () => {
  it('malinger du ikke har, og som godkjente planer bruker, står som nødvendig', async () => {
    const { store } = await sampleStore();
    const t = store.getTables();
    const rows = shoppingList(t);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.ownership).not.toBe('owns');
      expect(r.priority).toBe('necessary');
      expect(r.plans.length).toBeGreaterThan(0);
      expect(r.manual).toBe(false);
    }
    // One row per paint.
    expect(new Set(rows.map((r) => r.product.id)).size).toBe(rows.length);
    expect(rows.map((r) => r.product.name)).toContain('Moot Green');
  });

  it('du kan legge til selv, endre prioriteten og fjerne det du la til', async () => {
    const { store, cmd } = await sampleStore();
    const project = Object.values(store.getTables().project)[0]!;
    const rhinox = byName(store.getTables(), 'Rhinox Hide');
    const glaze = byName(store.getTables(), 'Grønn glasur fra hylla');
    await cmd.setOwnership(rhinox.id, 'not_owned');
    await cmd.addToShoppingList(glaze.id, { priority: 'wishlist', project_ids: [project.id] });
    let t = store.getTables();
    expect(names(t)).toContainEqual(['Grønn glasur fra hylla', 'wishlist', true]);
    // The list is sorted by priority.
    expect(shoppingList(t).at(-1)!.product.name).toBe('Grønn glasur fra hylla');

    const moot = byName(t, 'Moot Green');
    await cmd.setShoppingPriority(moot.id, 'recommended');
    t = store.getTables();
    expect(names(t)).toContainEqual(['Moot Green', 'recommended', false]);
    expect(Object.values(t.shopping_need).find((n) => n.product_id === moot.id)!.origin).toBe('plan');

    // Removing what you added; a paint the plans need stays as «nødvendig».
    await cmd.addToShoppingList(moot.id);
    await cmd.removeFromShoppingList(moot.id);
    await cmd.removeFromShoppingList(glaze.id);
    t = store.getTables();
    expect(names(t)).toContainEqual(['Moot Green', 'necessary', false]);
    expect(names(t).map((r) => r[0])).not.toContain('Grønn glasur fra hylla');
    expect(t.shopping_need_project).toHaveLength(0);
    await expect(cmd.setShoppingPriority(glaze.id, 'wishlist')).rejects.toThrow(/står ikke/);
  });

  it('«Kjøpt» setter malingen som eid og tar den av listen', async () => {
    const { store, cmd } = await sampleStore();
    const moot = byName(store.getTables(), 'Moot Green');
    const glaze = byName(store.getTables(), 'Grønn glasur fra hylla');
    await cmd.setShoppingPriority(moot.id, 'wishlist');
    await cmd.addToShoppingList(glaze.id);
    await cmd.markPurchased([moot.id, glaze.id]);
    const t = store.getTables();
    expect(ownershipOf(t, moot.id)).toBe('owns');
    expect(t.inventory_entry.find((e) => e.product_id === moot.id)!.ownership_source).toBe('purchase');
    expect(names(t).map((r) => r[0])).not.toContain('Moot Green');
    expect(names(t).map((r) => r[0])).not.toContain('Grønn glasur fra hylla');
    expect(t.shopping_need).toEqual({});
  });

  it('kan filtreres per prosjekt, og ferdigmalte eller slettede miniatyrer teller ikke', async () => {
    const { store, cmd } = await sampleStore();
    const project = Object.values(store.getTables().project)[0]!;
    const { project_id: other } = await cmd.createProject({ name: 'Annet spill' });
    let t = store.getTables();
    const all = shoppingList(t);
    expect(shoppingProjects(all).map((p) => p.id)).toContain(project.id);
    expect(shoppingList(t, { project_id: project.id })).toHaveLength(all.length);
    expect(shoppingList(t, { project_id: other })).toHaveLength(0);

    const moot = all.find((r) => r.product.name === 'Moot Green')!;
    for (const p of moot.plans) await cmd.deleteSubject(p.subject_id);
    t = store.getTables();
    expect(names(t).map((r) => r[0])).not.toContain('Moot Green');
  });

  it('fra «Finn fram malingene»: en maling planen ikke setter på listen, kan legges til for prosjektet (O-18)', async () => {
    const { store, cmd } = await sampleStore();
    const t0 = store.getTables();
    const moot = shoppingList(t0).find((r) => r.product.name === 'Moot Green')!;
    for (const p of moot.plans) {
      const s = store.getTables().miniature_subject[p.subject_id]!;
      await cmd.markFinished(p.subject_id, s.physical_count - s.finished_count);
    }
    expect(names(store.getTables()).map((r) => r[0])).not.toContain('Moot Green');
    const project = moot.plans[0]!.project_id;
    await cmd.addToShoppingList(moot.product.id, { priority: 'necessary', project_ids: [project] });
    const row = shoppingList(store.getTables(), { project_id: project }).find((r) => r.product.id === moot.product.id)!;
    expect(row).toMatchObject({ manual: true, priority: 'necessary', plans: [] });
    expect(row.projects.map((p) => p.id)).toEqual([project]);
  });
});
