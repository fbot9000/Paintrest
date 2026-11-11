import { describe, expect, it } from 'vitest';
import { createLocalCommands } from './local-commands';
import { memoryPersistence } from './persistence';
import { buildSampleData } from './seed';
import { Store, emptyTables } from './store';
import type { ImportPaintInput } from '../domain/commands';
import type { PaintDiscussResult, PaintReadResult, PaintWire } from '../domain/ai';
import {
  addReadResult, applyDiscussResult, chunkRequest, editRow, findProduct, importInputs, newDraft, paintRows,
  breakLongLine, planChunks, plannedImport, productUsage, rowsWithoutAi, sampleProducts, splitCells, splitLines, tableForAi, uncoveredLines,
} from '../domain/paints';
import type { ImportDraft } from '../domain/paints';
import type { PaintProduct, Tables } from '../domain/types';
import { SCHEMA_VERSION } from '../domain/types';
import { ownershipOf, paintingView } from '../domain/views';

function emptyStore() {
  const p = memoryPersistence();
  const store = new Store({ schema_version: SCHEMA_VERSION, workspace_id: 'ws', tables: emptyTables() }, p);
  return { store, cmd: createLocalCommands(store) };
}

async function sampleStore(examplePaints: boolean) {
  const p = memoryPersistence();
  const store = new Store(await buildSampleData(p, { examplePaints }), p);
  return { store, cmd: createLocalCommands(store) };
}

const paint = (x: Partial<ImportPaintInput> & { name: string }): ImportPaintInput => ({
  manufacturer: null, range_name: null, product_code: null, product_kind: 'other', finish: null, swatch_hex: null,
  swatch_estimated: false, ownership: 'owns', confirmed: true, ...x,
});

const byName = (t: Tables, name: string) => Object.values(t.paint_product).filter((p) => p.name === name);

describe('eksempeldata uten malinger', () => {
  it('lager ingen malinger, planene har steg uten malinger, og det er ingen eksempeloppskrifter', async () => {
    const { store } = await sampleStore(false);
    const t = store.getTables();
    expect(Object.keys(t.paint_product)).toHaveLength(0);
    expect(t.inventory_entry).toHaveLength(0);
    expect(Object.keys(t.step_material)).toHaveLength(0);
    expect(Object.keys(t.recipe)).toHaveLength(0);
    expect(Object.keys(t.plan_step).length).toBeGreaterThan(5);
    expect(Object.keys(t.technique)).toHaveLength(1);
  });

  it('tilbakestilling beholder malingssamlingen, men ikke eksempelmalingene', async () => {
    const { store, cmd } = await sampleStore(true);
    const mine = await cmd.createProduct({ name: 'Black', manufacturer: 'Vallejo', range_name: 'Model Color', ownership: 'owns', confirmed: true });
    await cmd.resetToSampleData();
    const t = store.getTables();
    expect(Object.keys(t.paint_product)).toEqual([mine]);
    expect(t.paint_product[mine]!.workspace_id).toBe(store.snapshot.workspace_id);
    expect(t.inventory_entry).toEqual([expect.objectContaining({ product_id: mine, ownership: 'owns', workspace_id: store.snapshot.workspace_id })]);
    expect(sampleProducts(t)).toHaveLength(0);
  });
});

describe('fjerne eksempelmalingene', () => {
  it('finner de 14 eksempelmalingene, men ikke malinger brukeren har lagt inn eller endret', async () => {
    const { store, cmd } = await sampleStore(true);
    expect(sampleProducts(store.getTables())).toHaveLength(14);
    await cmd.createProduct({ name: 'Black', manufacturer: 'Vallejo' });
    const nuln = byName(store.getTables(), 'Nuln Oil')[0]!;
    await cmd.setOwnership(nuln.id, 'owns');
    const left = sampleProducts(store.getTables()).map((p) => p.name);
    expect(left).toHaveLength(13);
    expect(left).not.toContain('Nuln Oil');
  });

  it('skjuler dem og fjerner eierstatusen; planene beholder malingene', async () => {
    const { store, cmd } = await sampleStore(true);
    const t0 = store.getTables();
    const merlin = Object.values(t0.miniature_subject).find((s) => s.name === 'Merlin')!;
    expect(productUsage(t0, sampleProducts(t0).map((p) => p.id))).toEqual({ plans: 2, recipes: 2, palettes: 0 });
    expect(await cmd.removeSampleProducts()).toBe(14);
    const t = store.getTables();
    expect(paintRows(t)).toHaveLength(0);
    expect(t.inventory_entry).toHaveLength(0);
    const materials = paintingView(t, merlin.id)!.elements.flatMap((e) => e.steps.flatMap((s) => s.materials));
    expect(materials.length).toBeGreaterThan(0);
    expect(materials.every((m) => m.ownership === 'unknown' && !!m.product.deleted_at)).toBe(true);
    expect(await cmd.removeSampleProducts()).toBe(0);
  });

  it('en import av samme maling tar den skjulte raden i bruk igjen, så planen peker på din maling', async () => {
    const { store, cmd } = await sampleStore(true);
    await cmd.removeSampleProducts();
    const sum = await cmd.importProducts([
      paint({ manufacturer: 'Citadel', range_name: 'Base', name: 'Caliban Green', product_kind: 'base', product_code: '21-12' }),
    ]);
    expect(sum).toEqual({ created: 0, updated: 0, restored: 1, duplicates: 0 });
    const t = store.getTables();
    const caliban = byName(t, 'Caliban Green');
    expect(caliban).toHaveLength(1);
    expect(caliban[0]!.deleted_at).toBeNull();
    expect(caliban[0]!.product_code).toBe('21-12');
    expect(ownershipOf(t, caliban[0]!.id)).toBe('owns');
    const merlin = Object.values(t.miniature_subject).find((s) => s.name === 'Merlin')!;
    const used = paintingView(t, merlin.id)!.elements.flatMap((e) => e.steps.flatMap((s) => s.materials)).find((m) => m.product.name === 'Caliban Green')!;
    expect(used.ownership).toBe('owns');
    expect(sampleProducts(t).map((p) => p.name)).not.toContain('Caliban Green');
  });
});

describe('importere malinger', () => {
  it('lager nye, fyller inn på eksisterende og hopper over doble i samme liste', async () => {
    const { store, cmd } = emptyStore();
    const known = await cmd.createProduct({ name: 'Abaddon Black', manufacturer: 'Citadel', ownership: 'not_owned' });
    const sum = await cmd.importProducts([
      paint({ manufacturer: 'Citadel', range_name: 'Base', name: 'Abaddon Black', product_kind: 'base', swatch_hex: '#111111', swatch_estimated: true }),
      paint({ manufacturer: 'Vallejo', range_name: 'Model Color', name: 'Black', product_code: '70.950', product_kind: 'layer' }),
      paint({ manufacturer: 'Acrylicos Vallejo', range_name: 'Model Color', name: 'Black', product_code: '70950' }),
      paint({ manufacturer: 'Vallejo', range_name: 'Game Color', name: 'Black', product_code: '72.051' }),
      paint({ manufacturer: 'The Army Painter', name: 'Wolf Grey', ownership: 'not_owned', confirmed: false }),
      paint({ name: '   ' }),
    ]);
    expect(sum).toEqual({ created: 3, updated: 1, restored: 0, duplicates: 1 });
    const t = store.getTables();
    const abaddon = t.paint_product[known]!;
    expect(abaddon).toMatchObject({ range_name: 'Base', product_kind: 'base', swatch_hex: '#111111', swatch_estimated: true, identity_status: 'confirmed' });
    expect(ownershipOf(t, known)).toBe('owns');
    expect(byName(t, 'Black')).toHaveLength(2);
    const wolf = byName(t, 'Wolf Grey')[0]!;
    expect(wolf.identity_status).toBe('unconfirmed');
    expect(ownershipOf(t, wolf.id)).toBe('not_owned');
    expect(t.inventory_entry.find((e) => e.product_id === wolf.id)!.ownership_source).toBe('import');
  });

  it('en ønskeliste gjør ikke en maling du har til «har ikke», og overskriver ikke det som står', async () => {
    const { store, cmd } = emptyStore();
    const id = await cmd.createProduct({ name: 'Nuln Oil', manufacturer: 'Citadel', range_name: 'Shade', swatch_hex: '#202323', ownership: 'owns' });
    await cmd.importProducts([paint({ manufacturer: 'Citadel', range_name: 'Shade', name: 'nuln oil', ownership: 'not_owned', swatch_hex: '#999999' })]);
    const t = store.getTables();
    expect(ownershipOf(t, id)).toBe('owns');
    expect(t.paint_product[id]!.swatch_hex).toBe('#202323');
    expect(t.paint_product[id]!.name).toBe('Nuln Oil');
  });
});

describe('enkeltmalinger', () => {
  it('bekreftet bare med produsent og navn; en farge du velger er ikke lenger et anslag', async () => {
    const { store, cmd } = emptyStore();
    const a = await cmd.createProduct({ name: 'Grønn glasur fra hylla', confirmed: true, ownership: 'owns' });
    const b = await cmd.createProduct({ name: 'Caliban Green', manufacturer: 'Citadel', confirmed: true, product_code: ' 21-12 ' });
    let t = store.getTables();
    expect(t.paint_product[a]!.identity_status).toBe('unconfirmed');
    expect(t.paint_product[b]!).toMatchObject({ identity_status: 'confirmed', product_code: '21-12' });
    await cmd.importProducts([paint({ manufacturer: 'Citadel', name: 'Caliban Green', swatch_hex: '#1f4a32', swatch_estimated: true })]);
    expect(store.getTables().paint_product[b]!.swatch_estimated).toBe(true);
    await cmd.updateProduct(b, { swatch_hex: '#204a30', range_name: 'Base' });
    t = store.getTables();
    expect(t.paint_product[b]!).toMatchObject({ swatch_hex: '#204a30', swatch_estimated: false, range_name: 'Base' });
    await expect(cmd.updateProduct(b, { name: ' ' })).rejects.toThrow(/tomt/);
    await cmd.deleteProduct(b);
    expect(paintRows(store.getTables()).map((r) => r.product.name)).toEqual(['Grønn glasur fra hylla']);
    await cmd.restoreProduct(b);
    expect(paintRows(store.getTables())).toHaveLength(2);
  });
});

describe('identitet', () => {
  const P = (x: Partial<PaintProduct> & { id: string; name: string }): PaintProduct => ({
    workspace_id: 'ws', manufacturer: null, range_name: null, product_kind: 'other', coverage: null, finish: null,
    identity_status: 'confirmed', swatch_hex: null, created_at: '2026-01-01', deleted_at: null, ...x,
  });
  const products = Object.fromEntries([
    P({ id: 'a', manufacturer: 'Citadel', range_name: 'Base', name: 'Leadbelcher' }),
    P({ id: 'b', manufacturer: 'Citadel', range_name: 'Spray', name: 'Leadbelcher' }),
    P({ id: 'c', manufacturer: 'Vallejo', range_name: 'Model Color', name: 'Black', product_code: '70.950' }),
    P({ id: 'd', manufacturer: 'The Army Painter', range_name: 'Warpaints', name: "Wizard's Orb" }),
    P({ id: 'e', manufacturer: 'Citadel', name: "Bugman's Glow", deleted_at: '2026-02-02' }),
  ].map((p) => [p.id, p]));

  it('skiller serier, bruker koder og forstår skrivemåter', () => {
    expect(findProduct(products, { manufacturer: 'Citadel', range_name: 'Base', name: 'leadbelcher' })?.id).toBe('a');
    expect(findProduct(products, { manufacturer: 'Citadel', range_name: null, name: 'Leadbelcher' })).toBeNull();
    expect(findProduct(products, { manufacturer: 'Acrylicos Vallejo', range_name: null, name: 'Schwarz', product_code: '70950' })?.id).toBe('c');
    expect(findProduct(products, { manufacturer: 'Vallejo', range_name: null, name: 'Black', product_code: '72.051' })).toBeNull();
    expect(findProduct(products, { manufacturer: 'Army Painter', range_name: null, name: 'Wizards Orb' })?.id).toBe('d');
    expect(findProduct(products, { manufacturer: 'Citadel', range_name: 'Base', name: 'Bugmans Glow' })?.id).toBe('e');
    expect(findProduct(products, { manufacturer: 'Vallejo', range_name: null, name: 'Leadbelcher' })).toBeNull();
  });
});

// ---------- Utkastet ----------

const wire = (x: Partial<PaintWire> & { name: string; lines: number[] }): PaintWire => ({
  id: null, maker: null, range: null, code: null, kind: 'other', finish: null, hex: null, own: 'owns', guessed: [], unsure: null, ...x,
});

const read = (x: Partial<PaintReadResult>): PaintReadResult => ({ mode: 'read', message: '', paints: [], skipped: [], questions: [], model: 'm', ...x });
const discuss = (x: Partial<PaintDiscussResult>): PaintDiscussResult => ({ mode: 'discuss', message: '', changes: [], answered: [], questions: [], model: 'm', ...x });

const TEXT = 'Citadel:\n- caliban grn x2\n- nuln\n\nVallejo\n70.950 black\nBlack\nPensel str 1';

function draft(): ImportDraft {
  return newDraft(TEXT, 'Innlimt tekst', 'Alt er mitt', true, 'd1', '2026-11-11T10:00:00Z');
}

describe('importutkast', () => {
  it('deler teksten i deler og gir tidligere linjer som kontekst', () => {
    const lines = Array.from({ length: 100 }, (_, i) => (i % 10 === 9 ? '' : `Maling ${i + 1}`));
    const chunks = planChunks(lines, 40, 10_000);
    expect(chunks.map((c) => [c.from, c.to])).toEqual([[1, 44], [45, 88], [89, 99]]);
    const d = { ...newDraft(lines.join('\n'), 'x', '', true, 'd', 'now'), chunks };
    const req = chunkRequest(d, chunks[1]!);
    expect(req.lines[0]).toEqual({ n: 45, text: 'Maling 45' });
    expect(req.context.map((c) => c.n)).toEqual([1, 2, 3, 32, 33, 34, 35, 36, 37, 38, 39, 41, 42, 43, 44]);
    expect(splitLines('a\r\nb\r\n\r\n')).toEqual(['a', 'b']);
    // A whole collection on one line is broken after commas, and nothing is lost.
    const long = Array.from({ length: 300 }, (_, i) => `Maling nummer ${i + 1}`).join(', ');
    const parts = splitLines(`Citadel: ${long}\nslutt`);
    expect(parts.length).toBeGreaterThan(4);
    expect(parts.every((p) => p.length <= 1500)).toBe(true);
    expect(parts.slice(0, -1).join(' ')).toBe(`Citadel: ${long}`);
    expect(parts.at(-1)).toBe('slutt');
    expect(breakLongLine('x'.repeat(3100), 1500).map((p) => p.length)).toEqual([1500, 1500, 100]);
  });

  it('godtar bare linjer fra delen, og kobler spørsmål til radene', () => {
    let d = draft();
    expect(d.chunks).toHaveLength(1);
    d = addReadResult(d, d.chunks[0]!, read({
      message: 'Fant fire malinger.',
      paints: [
        wire({ id: 'p1', lines: [2], maker: 'Citadel', range: 'Base', name: 'Caliban Green', kind: 'base', hex: '#1F4A32', guessed: ['range', 'kind', 'hex', 'name'] }),
        wire({ id: 'p2', lines: [3, 99], maker: 'Citadel', name: 'Nuln Oil', kind: 'shade', guessed: ['name'] }),
        wire({ id: 'p3', lines: [6], maker: 'Vallejo', range: 'Model Color', name: 'Black', code: '70.950', kind: 'nonsense' }),
        wire({ id: 'p4', lines: [7], name: 'Black', unsure: 'Ukjent produsent' }),
        wire({ id: 'p5', lines: [1], name: '' }),
      ],
      skipped: [{ line: 1, reason: 'overskrift' }, { line: 50, reason: 'finnes ikke' }],
      questions: [{ text: 'Hvilken Black er linje 7?', refs: ['p4', 'p9'], options: ['Vallejo Model Color', 'Citadel Abaddon Black'] }],
    }));
    expect(d.rows.map((r) => [r.key, r.name, r.lines])).toEqual([['R1', 'Caliban Green', [2]], ['R2', 'Nuln Oil', [3]], ['R3', 'Black', [6]], ['R4', 'Black', [7]]]);
    expect(d.rows[0]).toMatchObject({ swatch_hex: '#1f4a32', guessed: ['range_name', 'product_kind', 'swatch_hex', 'name'] });
    expect(d.rows[2]!.product_kind).toBe('other');
    expect(d.skipped).toEqual([{ line: 1, reason: 'overskrift' }]);
    expect(d.questions).toEqual([{ id: 'S1', text: 'Hvilken Black er linje 7?', rows: ['R4'], options: ['Vallejo Model Color', 'Citadel Abaddon Black'] }]);
    expect(d.log.map((l) => l.text)).toEqual(['Fant fire malinger.']);
    // Line 5 («Vallejo») and 8 (the brush) are not accounted for until the chunk is done.
    expect(uncoveredLines(d)).toEqual([]);
    d = { ...d, chunks: d.chunks.map((c) => ({ ...c, status: 'done' as const })) };
    expect(uncoveredLines(d)).toEqual([5, 8]);
    expect(tableForAi(d).split('\n')[1]).toBe('R1 | Citadel | Base | Caliban Green |  | base |  | #1f4a32 | owns |  | L2: - caliban grn x2');
  });

  it('bruker svar fra dialogen: endrer, legger til, tar ut og lukker spørsmål', () => {
    let d = draft();
    d = addReadResult(d, d.chunks[0]!, read({
      paints: [wire({ lines: [6], maker: 'Vallejo', name: 'Black' }), wire({ lines: [7], name: 'Black', unsure: 'Ukjent produsent', guessed: ['kind'] })],
      questions: [{ text: 'Hvilken?', refs: [], options: [] }],
    }));
    d = applyDiscussResult(d, discuss({
      message: 'Endret R2 og la til penselen? Nei, tok den ut.',
      changes: [
        { op: 'update', ref: 'R2', set: { maker: 'Vallejo', range: 'Game Color', code: '72.051', kind: 'layer' }, guessed: ['range', 'kind'], unsure: null },
        { op: 'remove', ref: 'R1', reason: 'Dobbel' },
        { op: 'add', paint: wire({ lines: [8, 500], name: 'Pensel' }) },
        { op: 'update', ref: 'R99', set: { name: 'x' }, guessed: [] },
      ],
      answered: ['S1'],
      questions: [{ text: 'Er R3 en maling?', refs: ['R3'], options: ['Ja', 'Nei'] }],
    }), 'Svar på S1: Game Color');
    const [r1, r2, r3] = d.rows;
    expect(r1).toMatchObject({ include: false, removed: 'Dobbel' });
    expect(r2).toMatchObject({ manufacturer: 'Vallejo', range_name: 'Game Color', product_code: '72.051', product_kind: 'layer', unsure: null });
    expect(r2!.guessed.sort()).toEqual(['product_kind', 'range_name']);
    expect(r3).toMatchObject({ key: 'R3', name: 'Pensel', lines: [8] });
    expect(d.questions).toEqual([{ id: 'S2', text: 'Er R3 en maling?', rows: ['R3'], options: ['Ja', 'Nei'] }]);
    expect(d.touched.sort()).toEqual(['R1', 'R2', 'R3']);
    expect(d.log.map((l) => l.role)).toEqual(['user', 'assistant']);
    d = editRow(d, 'R2', { range_name: 'Game Color', include: true });
    expect(d.rows[1]!.guessed).toEqual(['product_kind']);
    expect(d.touched).not.toContain('R2');
    d = editRow(d, 'R1', { include: true });
    expect(d.rows[0]).toMatchObject({ include: true, removed: null });
  });

  it('viser hva lagringen vil gjøre, med samme matching som kommandoen', async () => {
    const { store, cmd } = emptyStore();
    await cmd.createProduct({ name: 'Nuln Oil', manufacturer: 'Citadel', ownership: 'owns' });
    const gone = await cmd.createProduct({ name: 'Leadbelcher', manufacturer: 'Citadel' });
    await cmd.deleteProduct(gone);
    let d = draft();
    d = addReadResult(d, d.chunks[0]!, read({ paints: [
      wire({ lines: [3], maker: 'Citadel', name: 'Nuln Oil' }),
      wire({ lines: [2], maker: 'Citadel', name: 'Leadbelcher' }),
      wire({ lines: [6], maker: 'Vallejo', name: 'Black', code: '70.950', hex: '#000000', guessed: ['hex'] }),
      wire({ lines: [7], maker: 'Vallejo', name: 'Black', code: '70950', unsure: 'dobbel?' }),
    ] }));
    const plan = plannedImport(store.getTables(), d.rows);
    expect(plan.map((p) => [p.row.key, p.status, p.duplicate_of])).toEqual([
      ['R1', 'existing', null], ['R2', 'restore', null], ['R3', 'new', null], ['R4', 'duplicate', 'R3'],
    ]);
    const inputs = importInputs(d.rows);
    expect(inputs[2]).toMatchObject({ swatch_estimated: true, confirmed: true });
    expect(inputs[3]).toMatchObject({ confirmed: false });
    expect(await cmd.importProducts(inputs)).toEqual({ created: 1, updated: 1, restored: 1, duplicates: 1 });
  });

  it('en rad uten produsent blir den doble, ikke raden som navngir malingen nøyaktig', () => {
    let d = draft();
    d = addReadResult(d, d.chunks[0]!, read({ paints: [
      wire({ lines: [7], name: 'Black', unsure: 'Ukjent produsent' }),
      wire({ lines: [6], maker: 'Vallejo', range: 'Model Color', name: 'Black', code: '70.950' }),
    ] }));
    const plan = plannedImport({ ...emptyTables() }, d.rows);
    expect(plan.map((p) => [p.row.key, p.status, p.duplicate_of])).toEqual([['R1', 'duplicate', 'R2'], ['R2', 'new', null]]);
  });
});

describe('import uten AI', () => {
  it('leser regneark med kolonnenavn', () => {
    const rows = rowsWithoutAi(splitLines('Produsent;Serie;Navn;Kode;Type;Har\nVallejo;Model Color;"Black; matt";70.950;Wash;ja\nCitadel;Base;Abaddon Black;;base;nei\n;;;;;'));
    expect(rows.map((r) => [r.manufacturer, r.range_name, r.name, r.product_code, r.product_kind, r.ownership, r.lines])).toEqual([
      ['Vallejo', 'Model Color', 'Black; matt', '70.950', 'shade', 'owns', [2]],
      ['Citadel', 'Base', 'Abaddon Black', null, 'base', 'not_owned', [3]],
    ]);
  });

  it('leser én maling per linje og fjerner punkttegn', () => {
    const rows = rowsWithoutAi(splitLines('- Abaddon Black\n\n2. Nuln Oil\n• Leadbelcher'));
    expect(rows.map((r) => [r.name, r.lines, r.guessed])).toEqual([['Abaddon Black', [1], []], ['Nuln Oil', [3], []], ['Leadbelcher', [4], []]]);
    expect(splitCells('a,"b, c",""', ',')).toEqual(['a', 'b, c', '']);
    const d = newDraft('Abaddon Black\nNuln Oil', 'f.txt', '', false, 'x', 'now');
    expect(d.rows.map((r) => r.key)).toEqual(['R1', 'R2']);
    expect(d.next_row).toBe(3);
    expect(d.chunks).toEqual([]);
  });
});
