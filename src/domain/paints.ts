/**
 * Malingssamlingen: the paint catalogue (paint_product) and what the user owns
 * (inventory_entry), plus the pure parts of the import. An import is a draft list
 * the AI fills in from a text or a file and the user checks; nothing is saved
 * before the user presses «Legg inn i samlingen».
 */
import type { PaintChangeWire, PaintQuestionWire, PaintReadResult, PaintDiscussResult, PaintWire } from './ai';
import type { ImportPaintInput } from './commands';
import type { Id, Ownership, PaintProduct, ProductKind, Tables } from './types';
import { ownershipOf } from './views';

export const PRODUCT_KINDS: ProductKind[] = ['primer', 'base', 'layer', 'shade', 'contrast', 'technical', 'metallic', 'medium', 'other'];

export const KIND_LABEL: Record<ProductKind, string> = {
  primer: 'Grunning', base: 'Base', layer: 'Layer', shade: 'Shade / wash', contrast: 'Contrast / speedpaint',
  technical: 'Teknisk / effekt', metallic: 'Metallisk', medium: 'Medium / lakk', other: 'Annet',
};

export const OWNERSHIP_LABEL: Record<Ownership, string> = { owns: 'Har', not_owned: 'Har ikke', unknown: 'Ukjent' };

/** Common makers, offered as suggestions when the catalogue does not have them yet. */
export const COMMON_MAKERS = [
  'Citadel', 'Vallejo', 'The Army Painter', 'AK Interactive', 'Scale75', 'Pro Acryl', 'Two Thin Coats',
  'Kimera Kolors', 'Monument Hobbies', 'P3', 'Reaper', 'Green Stuff World', 'Golden', 'Liquitex',
];

// ---------- Identitet ----------

/** Lower case, no accents or punctuation, single spaces: «Bugman's Glow» = «bugmans glow». */
export function normText(s: string | null | undefined): string {
  return (s ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/['’`´]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Product codes compare without dots, spaces and dashes: 70.950 = 70950. */
export function normCode(s: string | null | undefined): string {
  return (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** The same maker written in different ways. */
const MAKER_ALIASES: Record<string, string> = {
  'the army painter': 'army painter',
  'games workshop': 'citadel',
  'gw': 'citadel',
  'citadel colour': 'citadel',
  'citadel colors': 'citadel',
  'acrylicos vallejo': 'vallejo',
  'ak': 'ak interactive',
  'ak 3rd gen': 'ak interactive',
  'scale 75': 'scale75',
  'monument': 'monument hobbies',
  'privateer press': 'p3',
  'kimera': 'kimera kolors',
  '2 thin coats': 'two thin coats',
};

export function makerKey(m: string | null | undefined): string {
  const k = normText(m);
  return MAKER_ALIASES[k] ?? k;
}

export interface PaintIdentity {
  manufacturer: string | null;
  range_name: string | null;
  name: string;
  product_code?: string | null;
}

/**
 * Finds the catalogue row for a paint, also among hidden rows, so a paint that was
 * removed comes back with its history (plans and recipes keep pointing to it).
 * A product code (with a matching maker) is the strongest identity; otherwise the
 * name must match, and maker, range and code must not contradict each other.
 * Live rows win over hidden ones. Ambiguous live matches give null.
 */
export function findProduct(products: Record<Id, PaintProduct>, x: PaintIdentity): PaintProduct | null {
  const name = normText(x.name);
  if (!name) return null;
  const maker = makerKey(x.manufacturer);
  const code = normCode(x.product_code);
  const range = normText(x.range_name);
  const all = Object.values(products);
  const makerOk = (p: PaintProduct) => !maker || !makerKey(p.manufacturer) || makerKey(p.manufacturer) === maker;
  if (code) {
    const byCode = pick(all.filter((p) => normCode(p.product_code) === code && makerOk(p)), x);
    if (byCode) return byCode;
  }
  const byName = all.filter((p) => normText(p.name) === name && makerOk(p)
    && (!code || !normCode(p.product_code) || normCode(p.product_code) === code)
    && (!range || !normText(p.range_name) || normText(p.range_name) === range));
  return pick(byName, x);
}

function pick(list: PaintProduct[], x: PaintIdentity): PaintProduct | null {
  if (!list.length) return null;
  const live = list.filter((p) => !p.deleted_at);
  const pool = live.length ? live : list;
  if (pool.length === 1) return pool[0]!;
  const exact = pool.filter((p) => normText(p.range_name) === normText(x.range_name) && makerKey(p.manufacturer) === makerKey(x.manufacturer));
  if (exact.length === 1) return exact[0]!;
  // Several hidden copies of the same paint: take the newest.
  if (!live.length) return [...pool].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]!;
  return null;
}

/** «Citadel · Base · Caliban Green» */
export function paintLabel(p: PaintIdentity): string {
  return [p.manufacturer, p.range_name, p.name].filter(Boolean).join(' · ');
}

// ---------- Samlingen ----------

export interface PaintRow {
  product: PaintProduct;
  ownership: Ownership;
}

export type OwnershipFilter = Ownership | 'all';

export interface PaintFilter {
  query?: string;
  ownership?: OwnershipFilter;
  /** makerKey of the maker, or '' for paints without one. */
  maker?: string | null;
}

export function liveProducts(t: Tables): PaintProduct[] {
  return Object.values(t.paint_product).filter((p) => !p.deleted_at);
}

function byMakerRangeName(a: PaintProduct, b: PaintProduct): number {
  return (a.manufacturer ?? '￿').localeCompare(b.manufacturer ?? '￿', 'nb')
    || (a.range_name ?? '').localeCompare(b.range_name ?? '', 'nb')
    || a.name.localeCompare(b.name, 'nb');
}

/** The paint list, sorted by maker, range and name. The query matches every word against name, maker, range and code. */
export function paintRows(t: Tables, f: PaintFilter = {}): PaintRow[] {
  const words = normText(f.query).split(' ').filter(Boolean);
  return liveProducts(t)
    .map((product) => ({ product, ownership: ownershipOf(t, product.id) }))
    .filter((r) => !f.ownership || f.ownership === 'all' || r.ownership === f.ownership)
    .filter((r) => f.maker == null || makerKey(r.product.manufacturer) === f.maker)
    .filter((r) => {
      if (!words.length) return true;
      const p = r.product;
      const hay = `${normText([p.name, p.manufacturer, p.range_name, KIND_LABEL[p.product_kind]].join(' '))} ${normCode(p.product_code).toLowerCase()}`;
      return words.every((w) => hay.includes(w));
    })
    .sort((a, b) => byMakerRangeName(a.product, b.product));
}

export function paintCounts(t: Tables): Record<OwnershipFilter, number> {
  const c: Record<OwnershipFilter, number> = { all: 0, owns: 0, not_owned: 0, unknown: 0 };
  for (const p of liveProducts(t)) {
    c.all++;
    c[ownershipOf(t, p.id)]++;
  }
  return c;
}

/** Makers in the catalogue, with the spelling used most often. '' = no maker. */
export function makersIn(t: Tables): { key: string; name: string; count: number }[] {
  const m = new Map<string, { names: Map<string, number>; count: number }>();
  for (const p of liveProducts(t)) {
    const key = makerKey(p.manufacturer);
    const e = m.get(key) ?? { names: new Map(), count: 0 };
    e.count++;
    const shown = p.manufacturer?.trim() || 'Uten produsent';
    e.names.set(shown, (e.names.get(shown) ?? 0) + 1);
    m.set(key, e);
  }
  return [...m.entries()]
    .map(([key, e]) => ({ key, name: [...e.names.entries()].sort((a, b) => b[1] - a[1])[0]![0], count: e.count }))
    .sort((a, b) => (a.key === '' ? 1 : b.key === '' ? -1 : a.name.localeCompare(b.name, 'nb')));
}

/** Ranges already used for a maker (for suggestions in the form). */
export function rangesFor(t: Tables, maker: string | null): string[] {
  const k = makerKey(maker);
  const out = new Map<string, string>();
  for (const p of liveProducts(t)) {
    if (!p.range_name || (k && makerKey(p.manufacturer) !== k)) continue;
    out.set(normText(p.range_name), p.range_name);
  }
  return [...out.values()].sort((a, b) => a.localeCompare(b, 'nb'));
}

export function hiddenProducts(t: Tables): PaintProduct[] {
  return Object.values(t.paint_product).filter((p) => !!p.deleted_at).sort(byMakerRangeName);
}

/**
 * Paints from the old sample data. src/data/seed.ts created them in the same
 * instant as the workspace, without a change record; nothing the user adds can
 * have that timestamp. A sample paint the user has changed (edited, imported,
 * ownership set) has a change record and counts as the user's own.
 */
export function sampleProducts(t: Tables): PaintProduct[] {
  const touched = new Set(Object.values(t.change_record).map((r) => r.target_id));
  return liveProducts(t)
    .filter((p) => t.workspace[p.workspace_id]?.created_at === p.created_at && !touched.has(p.id))
    .sort(byMakerRangeName);
}

export interface ProductUsage {
  /** Miniatures whose current plan uses one of the paints. */
  plans: number;
  recipes: number;
  palettes: number;
}

/** Where the given paints are used: current plans (materials, mixes), recipes and palettes. */
export function productUsage(t: Tables, ids: Iterable<Id>): ProductUsage {
  const set = new Set(ids);
  const steps = new Set<Id>();
  for (const m of Object.values(t.step_material)) if (set.has(m.product_id)) steps.add(m.step_id);
  for (const c of t.mix_component) {
    if (!set.has(c.product_id)) continue;
    const g = t.mix_group[c.mix_group_id];
    if (g) steps.add(g.step_id);
  }
  const versions = new Set<Id>();
  for (const s of steps) {
    const el = t.plan_step[s] ? t.plan_element[t.plan_step[s]!.element_id] : undefined;
    if (el) versions.add(el.plan_version_id);
  }
  const plans = Object.values(t.miniature_subject)
    .filter((s) => !s.deleted_at && s.current_plan_version_id && versions.has(s.current_plan_version_id)).length;
  const recipes = new Set(Object.values(t.recipe_paint)
    .filter((r) => set.has(r.product_id) && t.recipe[r.recipe_id] && !t.recipe[r.recipe_id]!.deleted_at)
    .map((r) => r.recipe_id)).size;
  const palettes = Object.values(t.palette_entry).filter((e) => !e.deleted_at && set.has(e.product_id)).length;
  return { plans, recipes, palettes };
}

export interface UsageDetail {
  /** Miniatures with a plan (any version) that uses the paints: «Merlin (Avalon)». */
  plans: string[];
  recipes: string[];
  /** Miniatures whose palette has the paints. */
  palettes: string[];
}

/**
 * Everything that refers to the paints, by name, for the «slett for godt» question.
 * Unlike productUsage, old plan versions and hidden objects count too: a permanent
 * delete changes them as well.
 */
export function usageDetail(t: Tables, ids: Iterable<Id>): UsageDetail {
  const set = new Set(ids);
  const versions = new Set<Id>();
  const addStep = (step_id: Id) => {
    const st = t.plan_step[step_id];
    const el = st ? t.plan_element[st.element_id] : undefined;
    if (el) versions.add(el.plan_version_id);
  };
  for (const m of Object.values(t.step_material)) if (set.has(m.product_id)) addStep(m.step_id);
  for (const c of t.mix_component) if (set.has(c.product_id)) { const g = t.mix_group[c.mix_group_id]; if (g) addStep(g.step_id); }
  for (const d of Object.values(t.local_deviation)) {
    if (d.step_id && (set.has(d.payload.from_product_id ?? '') || set.has(d.payload.to_product_id ?? ''))) addStep(d.step_id);
  }
  const subjectName = (subject_id: Id) => {
    const s = t.miniature_subject[subject_id];
    if (!s) return null;
    const game = t.project[s.project_id] ? t.game[t.project[s.project_id]!.game_id] : undefined;
    return `${s.name}${game ? ` (${game.primary_name})` : ''}${s.deleted_at ? ', slettet' : ''}`;
  };
  const uniq = (xs: (string | null)[]) => [...new Set(xs.filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'nb'));
  const plans = uniq([...versions].map((v) => { const pv = t.paint_plan_version[v]; return pv ? subjectName(pv.subject_id) : null; }));
  const recipes = uniq(Object.values(t.recipe_paint).filter((r) => set.has(r.product_id)).map((r) => {
    const x = t.recipe[r.recipe_id];
    return x ? `${x.name}${x.deleted_at ? ' (slettet)' : ''}` : null;
  }));
  const palettes = uniq(Object.values(t.palette_entry).filter((e) => set.has(e.product_id)).flatMap((e) => (
    e.scope_kind === 'subjects'
      ? t.palette_entry_subject.filter((x) => x.palette_entry_id === e.id).map((x) => subjectName(x.subject_id))
      : [t.project[e.project_id] ? t.game[t.project[e.project_id]!.game_id]?.primary_name ?? null : null]
  )));
  return { plans, recipes, palettes };
}

export function usageText(u: ProductUsage): string | null {
  const parts = [
    u.plans ? `${u.plans} ${u.plans === 1 ? 'maleplan' : 'maleplaner'}` : '',
    u.recipes ? `${u.recipes} ${u.recipes === 1 ? 'oppskrift' : 'oppskrifter'}` : '',
    u.palettes ? `${u.palettes} ${u.palettes === 1 ? 'palettrad' : 'palettrader'}` : '',
  ].filter(Boolean);
  if (!parts.length) return null;
  return parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(', ')} og ${parts.at(-1)}`;
}

// ---------- Import: utkastet ----------

export type ImportField = 'manufacturer' | 'range_name' | 'name' | 'product_code' | 'product_kind' | 'finish' | 'swatch_hex';

export const FIELD_LABEL: Record<ImportField, string> = {
  manufacturer: 'produsent', range_name: 'serie', name: 'navn', product_code: 'kode',
  product_kind: 'type', finish: 'finish', swatch_hex: 'farge',
};

/** One paint in the import draft. */
export interface ImportRow {
  /** R1, R2 … stable within the draft; the AI refers to rows by it. */
  key: string;
  manufacturer: string | null;
  range_name: string | null;
  name: string;
  product_code: string | null;
  product_kind: ProductKind;
  finish: string | null;
  swatch_hex: string | null;
  ownership: 'owns' | 'not_owned';
  /** The input lines (1-based) the paint came from. */
  lines: number[];
  /** Fields the AI filled in from its own knowledge, not from the user's text. */
  guessed: ImportField[];
  /** What the AI is unsure about; null when nothing. */
  unsure: string | null;
  /** The user's tick: only included rows are saved. */
  include: boolean;
  /** Why the AI took the row out (it stays visible, unticked). */
  removed: string | null;
}

export interface ImportQuestion {
  /** S1, S2 … */
  id: string;
  text: string;
  /** Row keys the question is about. */
  rows: string[];
  options: string[];
}

export interface ImportChunk {
  /** 1-based, inclusive. */
  from: number;
  to: number;
  status: 'waiting' | 'running' | 'done' | 'error';
  error: string | null;
}

export interface ImportLogEntry {
  role: 'user' | 'assistant';
  text: string;
  at: string;
}

export interface ImportDraft {
  id: string;
  created_at: string;
  /** «Innlimt tekst» or the file name. */
  source: string;
  /** What the user told the AI up front («alt er Vallejo Model Color»). */
  note: string;
  lines: string[];
  /** False when the list was read without AI. */
  with_ai: boolean;
  chunks: ImportChunk[];
  rows: ImportRow[];
  skipped: { line: number; reason: string }[];
  questions: ImportQuestion[];
  log: ImportLogEntry[];
  /** Rows the AI changed in its last answer (highlighted). */
  touched: string[];
  next_row: number;
  next_question: number;
}

export const MAX_LINE = 1500;

/**
 * Splits a text into lines, keeping empty ones so line numbers match the original.
 * A very long line (a whole collection as one comma list) is broken after commas or
 * semicolons, so no part of it is cut off on the way to the AI.
 */
export function splitLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+$/, '')).flatMap((l) => breakLongLine(l));
  while (lines.length && !lines.at(-1)!.trim()) lines.pop();
  return lines;
}

export function breakLongLine(line: string, max = MAX_LINE): string[] {
  if (line.length <= max) return [line];
  const out: string[] = [];
  let cur = '';
  for (const part of line.split(/(?<=[,;])/)) {
    if (cur && cur.length + part.length > max) { out.push(cur.trimEnd()); cur = ''; }
    cur += cur ? part : part.trimStart();
    while (cur.length > max) { out.push(cur.slice(0, max)); cur = cur.slice(max); }
  }
  if (cur.trim()) out.push(cur.trimEnd());
  return out;
}

export const CHUNK_LINES = 40;
export const CHUNK_CHARS = 4000;

/** Groups the non-empty lines into parts small enough for one AI answer. */
export function planChunks(lines: string[], maxLines = CHUNK_LINES, maxChars = CHUNK_CHARS): ImportChunk[] {
  const out: ImportChunk[] = [];
  let from = 0;
  let to = 0;
  let count = 0;
  let chars = 0;
  lines.forEach((line, i) => {
    if (!line.trim()) return;
    const n = i + 1;
    if (from && (count >= maxLines || chars + line.length > maxChars)) {
      out.push({ from, to, status: 'waiting', error: null });
      from = 0; count = 0; chars = 0;
    }
    if (!from) from = n;
    to = n;
    count++;
    chars += line.length;
  });
  if (from) out.push({ from, to, status: 'waiting', error: null });
  return out;
}

/** Splits a chunk in two (when an answer for it could not be read, it was probably too long). */
export function splitChunk(lines: string[], c: ImportChunk): ImportChunk[] {
  const filled: number[] = [];
  for (let n = c.from; n <= c.to; n++) if (lines[n - 1]?.trim()) filled.push(n);
  if (filled.length < 2) return [c];
  const mid = Math.ceil(filled.length / 2);
  return [
    { from: filled[0]!, to: filled[mid - 1]!, status: 'waiting', error: null },
    { from: filled[mid]!, to: filled.at(-1)!, status: 'waiting', error: null },
  ];
}

export function newDraft(text: string, source: string, note: string, withAi: boolean, id: string, at: string): ImportDraft {
  const lines = splitLines(text);
  const draft: ImportDraft = {
    id, created_at: at, source, note: note.trim(), lines, with_ai: withAi,
    chunks: withAi ? planChunks(lines) : [], rows: [], skipped: [], questions: [], log: [], touched: [],
    next_row: 1, next_question: 1,
  };
  if (withAi) return draft;
  const rows = rowsWithoutAi(lines).map((r, i) => ({ ...r, key: `R${i + 1}` }));
  return { ...draft, rows, next_row: rows.length + 1 };
}

const tabs = (s: string) => s.replace(/\t/g, ' | ');

/** What one AI call reads: the chunk's lines, plus earlier lines for context (headings, column names). */
export function chunkRequest(d: ImportDraft, c: ImportChunk): { lines: { n: number; text: string }[]; context: { n: number; text: string }[] } {
  const filled = (from: number, to: number) => {
    const out: { n: number; text: string }[] = [];
    for (let n = from; n <= to; n++) {
      const text = d.lines[n - 1];
      if (text?.trim()) out.push({ n, text: tabs(text) });
    }
    return out;
  };
  const before = filled(1, c.from - 1);
  const context = before.length > 15 ? [...before.slice(0, 3), ...before.slice(-12)] : before;
  return { lines: filled(c.from, c.to), context };
}

const WIRE_FIELD: Record<string, ImportField> = {
  maker: 'manufacturer', range: 'range_name', name: 'name', code: 'product_code', kind: 'product_kind', finish: 'finish', hex: 'swatch_hex',
};

function kindOf(v: unknown): ProductKind {
  return PRODUCT_KINDS.includes(v as ProductKind) ? (v as ProductKind) : 'other';
}

function hexOf(v: unknown): string | null {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim().toLowerCase() : null;
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function rowFromWire(p: PaintWire, key: string, lines: number[]): ImportRow {
  return {
    key,
    manufacturer: text(p.maker), range_name: text(p.range), name: text(p.name) ?? '', product_code: text(p.code),
    product_kind: kindOf(p.kind), finish: text(p.finish), swatch_hex: hexOf(p.hex),
    ownership: p.own === 'not_owned' ? 'not_owned' : 'owns',
    lines, guessed: guessedFields(p.guessed), unsure: text(p.unsure), include: true, removed: null,
  };
}

function guessedFields(v: unknown): ImportField[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.flatMap((x) => (typeof x === 'string' && WIRE_FIELD[x] ? [WIRE_FIELD[x]!] : [])))];
}

function isLineIn(d: ImportDraft, n: unknown, from: number, to: number): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= from && n <= to && !!d.lines[n - 1]?.trim();
}

function questionsFrom(d: ImportDraft, qs: PaintQuestionWire[], refs: Record<string, string>): { list: ImportQuestion[]; next: number } {
  let next = d.next_question;
  const list = qs.flatMap((q) => {
    if (!text(q.text)) return [];
    const rows = [...new Set((q.refs ?? []).flatMap((r) => (refs[r] ? [refs[r]!] : [])))];
    const options = (q.options ?? []).flatMap((o) => (text(o) ? [text(o)!] : [])).slice(0, 6);
    return [{ id: `S${next++}`, text: text(q.text)!, rows, options }];
  });
  return { list, next };
}

/** Adds what the AI found in one chunk. Lines outside the chunk are ignored, so the AI cannot invent lines. */
export function addReadResult(d: ImportDraft, c: ImportChunk, res: PaintReadResult): ImportDraft {
  let next = d.next_row;
  const refs: Record<string, string> = {};
  const rows: ImportRow[] = [];
  for (const p of res.paints) {
    if (!text(p.name)) continue;
    const key = `R${next++}`;
    if (p.id) refs[p.id] = key;
    rows.push(rowFromWire(p, key, [...new Set(p.lines.filter((n) => isLineIn(d, n, c.from, c.to)))].sort((a, b) => a - b)));
  }
  const known = new Set(d.skipped.map((s) => s.line));
  const skipped = res.skipped.filter((s) => isLineIn(d, s.line, c.from, c.to) && !known.has(s.line))
    .map((s) => ({ line: s.line, reason: text(s.reason) ?? 'ikke en maling' }));
  const q = questionsFrom({ ...d, next_row: next }, res.questions, refs);
  const message = text(res.message);
  return {
    ...d,
    rows: [...d.rows, ...rows],
    skipped: [...d.skipped, ...skipped],
    questions: [...d.questions, ...q.list],
    log: message ? [...d.log, { role: 'assistant', text: d.chunks.length > 1 ? `Linje ${c.from}–${c.to}: ${message}` : message, at: new Date().toISOString() }] : d.log,
    next_row: next,
    next_question: q.next,
  };
}

/** Non-empty lines in finished parts that no paint and no skip note accounts for. Nothing disappears unseen. */
export function uncoveredLines(d: ImportDraft): number[] {
  const used = new Set<number>([...d.rows.flatMap((r) => r.lines), ...d.skipped.map((s) => s.line)]);
  const out = new Set<number>();
  for (const c of d.chunks) {
    if (c.status !== 'done') continue;
    for (let n = c.from; n <= c.to; n++) if (d.lines[n - 1]?.trim() && !used.has(n)) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

const COLUMNS = 'ref | produsent | serie | navn | kode | type | finish | farge | eier | usikker | fra teksten';

/** The draft as a compact table for the AI, one paint per line, with the original text it came from. */
export function tableForAi(d: ImportDraft): string {
  const cell = (v: string | null) => (v ?? '').replace(/\|/g, '/');
  const source = (r: ImportRow) => r.lines.map((n) => `L${n}: ${tabs(d.lines[n - 1] ?? '').replace(/\|/g, '/')}`).join(' / ').slice(0, 160);
  const rows = d.rows.map((r) => [
    r.key + (r.include ? '' : ' (utelatt)'), cell(r.manufacturer), cell(r.range_name), cell(r.name),
    cell(r.product_code), r.product_kind, cell(r.finish), cell(r.swatch_hex), r.ownership, cell(r.unsure), source(r),
  ].join(' | '));
  return [COLUMNS, ...rows].join('\n');
}

/** The message for a dialog turn: the user's answers to open questions, then the free text. */
export function discussMessage(d: ImportDraft, answers: Record<string, string>, message: string): string {
  const parts = d.questions.flatMap((q) => {
    const a = answers[q.id]?.trim();
    return a ? [`Svar på ${q.id} («${q.text}»): ${a}`] : [];
  });
  if (message.trim()) parts.push(message.trim());
  return parts.join('\n');
}

/** Lines without a paint (skipped or not used), so the AI can add what it missed when the user asks. */
export function unusedLinesForAi(d: ImportDraft, max = 300): { n: number; text: string }[] {
  const used = new Set(d.rows.flatMap((r) => r.lines));
  const out: { n: number; text: string }[] = [];
  d.lines.forEach((l, i) => { if (l.trim() && !used.has(i + 1) && out.length < max) out.push({ n: i + 1, text: tabs(l) }); });
  return out;
}

/** Applies the AI's answer in a dialog turn. Unknown rows are ignored; removed rows stay visible, unticked. */
export function applyDiscussResult(d: ImportDraft, res: PaintDiscussResult, userText: string): ImportDraft {
  const at = new Date().toISOString();
  const rows = d.rows.map((r) => ({ ...r }));
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const touched = new Set<string>();
  let next = d.next_row;
  const refs: Record<string, string> = Object.fromEntries(rows.map((r) => [r.key, r.key]));
  for (const ch of res.changes) applyChange(ch);
  function applyChange(ch: PaintChangeWire) {
    if (ch.op === 'add') {
      if (!text(ch.paint.name)) return;
      const key = `R${next++}`;
      refs[key] = key;
      if (ch.paint.id) refs[ch.paint.id] = key;
      const r = rowFromWire(ch.paint, key, [...new Set(ch.paint.lines.filter((n) => isLineIn(d, n, 1, d.lines.length)))]);
      rows.push(r);
      byKey.set(key, r);
      touched.add(key);
      return;
    }
    const r = byKey.get(ch.ref);
    if (!r) return;
    touched.add(r.key);
    if (ch.op === 'remove') {
      r.include = false;
      r.removed = text(ch.reason) ?? 'Tatt ut av AI-en';
      return;
    }
    const set = ch.set;
    const changed: ImportField[] = [];
    const put = <K extends ImportField>(f: K, v: ImportRow[K] | undefined) => {
      if (v === undefined) return;
      (r as Record<ImportField, unknown>)[f] = v;
      changed.push(f);
    };
    if ('maker' in set) put('manufacturer', text(set.maker));
    if ('range' in set) put('range_name', text(set.range));
    if ('name' in set && text(set.name)) put('name', text(set.name)!);
    if ('code' in set) put('product_code', text(set.code));
    if ('kind' in set) put('product_kind', kindOf(set.kind));
    if ('finish' in set) put('finish', text(set.finish));
    if ('hex' in set) put('swatch_hex', hexOf(set.hex));
    if (set.own === 'owns' || set.own === 'not_owned') r.ownership = set.own;
    const guessedNow = guessedFields(ch.guessed);
    r.guessed = [...new Set([...r.guessed.filter((f) => !changed.includes(f)), ...guessedNow.filter((f) => changed.includes(f))])];
    if (ch.unsure !== undefined) r.unsure = text(ch.unsure);
    if (ch.include === true) { r.include = true; r.removed = null; }
  }
  const answered = new Set(res.answered);
  const q = questionsFrom({ ...d, next_row: next }, res.questions, refs);
  const reply = text(res.message);
  return {
    ...d,
    rows,
    questions: [...d.questions.filter((x) => !answered.has(x.id)), ...q.list],
    log: [
      ...d.log,
      ...(userText.trim() ? [{ role: 'user' as const, text: userText.trim(), at }] : []),
      ...(reply ? [{ role: 'assistant' as const, text: reply, at }] : []),
    ],
    touched: [...touched],
    next_row: next,
    next_question: q.next,
  };
}

/** A manual edit by the user: the fields they set are no longer the AI's guesses. */
export function editRow(d: ImportDraft, key: string, patch: Partial<Omit<ImportRow, 'key' | 'lines' | 'guessed'>>): ImportDraft {
  return {
    ...d,
    rows: d.rows.map((r) => {
      if (r.key !== key) return r;
      const fields = Object.keys(patch).filter((k): k is ImportField => k in FIELD_LABEL);
      const next = { ...r, ...patch, guessed: r.guessed.filter((f) => !fields.includes(f)) };
      if (patch.include) next.removed = null;
      return next;
    }),
    touched: d.touched.filter((k) => k !== key),
  };
}

export type PlannedStatus = 'new' | 'existing' | 'restore' | 'duplicate';

export interface PlannedRow {
  row: ImportRow;
  status: PlannedStatus;
  /** The catalogue row it matches (existing or hidden). */
  match: PaintProduct | null;
  /** The earlier row in the draft with the same paint. */
  duplicate_of: string | null;
}

/**
 * What saving would do with each included row, using the same matching as the
 * command: an existing paint is updated, a hidden one is taken into use again,
 * and the second copy of the same paint in the list is skipped.
 */
export function plannedImport(t: Tables, rows: ImportRow[]): PlannedRow[] {
  const products: Record<Id, PaintProduct> = { ...t.paint_product };
  const firstRowOf = new Map<Id, string>();
  const order = new Map(rows.map((r, i) => [r.key, i]));
  return bySpecificity(rows.filter((r) => r.include && r.name.trim())).map((row) => {
    const match = findProduct(products, row);
    if (match && firstRowOf.has(match.id)) return { row, status: 'duplicate' as const, match, duplicate_of: firstRowOf.get(match.id)! };
    if (match) {
      firstRowOf.set(match.id, row.key);
      return { row, status: match.deleted_at ? 'restore' as const : 'existing' as const, match, duplicate_of: null };
    }
    const id = `draft:${row.key}`;
    products[id] = {
      id, workspace_id: '', manufacturer: row.manufacturer, range_name: row.range_name, name: row.name,
      product_kind: row.product_kind, coverage: null, finish: row.finish, identity_status: 'unconfirmed', swatch_hex: row.swatch_hex,
      product_code: row.product_code, created_at: '', deleted_at: null,
    };
    firstRowOf.set(id, row.key);
    return { row, status: 'new' as const, match: null, duplicate_of: null };
  }).sort((a, b) => order.get(a.row.key)! - order.get(b.row.key)!);
}

/**
 * Rows with a maker and a code are matched first, so a vague row («Black») never
 * claims a paint before the row that names it exactly; the vague one becomes the duplicate.
 */
export function bySpecificity<T extends { manufacturer: string | null; product_code: string | null }>(rows: T[]): T[] {
  const score = (r: T) => (r.manufacturer?.trim() ? 2 : 0) + (r.product_code?.trim() ? 1 : 0);
  return rows.map((r, i) => ({ r, i })).sort((a, b) => score(b.r) - score(a.r) || a.i - b.i).map((x) => x.r);
}

/** The rows as command input. A paint counts as confirmed when it has a maker and the AI has no doubt left. */
export function importInputs(rows: ImportRow[]): ImportPaintInput[] {
  return rows.filter((r) => r.include && r.name.trim()).map((r) => ({
    manufacturer: r.manufacturer, range_name: r.range_name, name: r.name.trim(), product_code: r.product_code,
    product_kind: r.product_kind, finish: r.finish, swatch_hex: r.swatch_hex, swatch_estimated: !!r.swatch_hex && r.guessed.includes('swatch_hex'),
    ownership: r.ownership, confirmed: !!r.manufacturer && !r.unsure,
  }));
}

// ---------- Import uten AI ----------

const HEADERS: Record<string, ImportField | 'own'> = {
  produsent: 'manufacturer', merke: 'manufacturer', manufacturer: 'manufacturer', brand: 'manufacturer', maker: 'manufacturer', make: 'manufacturer',
  serie: 'range_name', range: 'range_name', series: 'range_name', line: 'range_name', produktlinje: 'range_name', product_line: 'range_name',
  navn: 'name', name: 'name', paint: 'name', maling: 'name', colour: 'name', color: 'name', farge: 'name', paint_name: 'name',
  kode: 'product_code', code: 'product_code', sku: 'product_code', varenummer: 'product_code', artikkelnummer: 'product_code', item: 'product_code', ref: 'product_code',
  type: 'product_kind', kind: 'product_kind', kategori: 'product_kind', category: 'product_kind',
  finish: 'finish', hex: 'swatch_hex',
  eier: 'own', har: 'own', owned: 'own', own: 'own',
};

/** Splits one CSV/TSV line; quotes may hold the separator. */
export function splitCells(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; } else quoted = !quoted;
    } else if (ch === sep && !quoted) {
      out.push(cur.trim()); cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function guessKind(s: string): ProductKind {
  const k = normText(s);
  if (PRODUCT_KINDS.includes(k as ProductKind)) return k as ProductKind;
  if (/wash|shade/.test(k)) return 'shade';
  if (/contrast|speedpaint|xpress/.test(k)) return 'contrast';
  if (/metal/.test(k)) return 'metallic';
  if (/primer|spray|grunn/.test(k)) return 'primer';
  if (/technical|teknisk|effect|effekt|texture/.test(k)) return 'technical';
  if (/medium|varnish|lakk|thinner/.test(k)) return 'medium';
  return 'other';
}

/**
 * Reads a list without AI: a spreadsheet (CSV/TSV with column names the app
 * recognises), or one paint name per line. Nothing is guessed.
 */
export function rowsWithoutAi(lines: string[]): Omit<ImportRow, 'key'>[] {
  const filled = lines.map((l, i) => ({ n: i + 1, l })).filter((x) => x.l.trim());
  if (!filled.length) return [];
  const head = filled[0]!;
  const sep = ['\t', ';', ','].find((s) => splitCells(head.l, s).length >= 2) ?? null;
  const cols = sep ? splitCells(head.l, sep).map((c) => HEADERS[normText(c).replace(/ /g, '_')] ?? null) : [];
  const empty = (n: number[]): Omit<ImportRow, 'key'> => ({
    manufacturer: null, range_name: null, name: '', product_code: null, product_kind: 'other', finish: null, swatch_hex: null,
    ownership: 'owns', lines: n, guessed: [], unsure: null, include: true, removed: null,
  });
  if (sep && cols.includes('name')) {
    return filled.slice(1).flatMap(({ n, l }) => {
      const cells = splitCells(l, sep);
      const r = empty([n]);
      cols.forEach((c, i) => {
        const v = cells[i]?.trim() || null;
        if (!c || !v) return;
        if (c === 'own') r.ownership = /^(nei|no|false|0|ønske|wish)/i.test(v) ? 'not_owned' : 'owns';
        else if (c === 'product_kind') r.product_kind = guessKind(v);
        else if (c === 'swatch_hex') r.swatch_hex = hexOf(v.startsWith('#') ? v : `#${v}`);
        else (r as Record<string, unknown>)[c] = v;
      });
      return r.name ? [r] : [];
    });
  }
  return filled.map(({ n, l }) => ({ ...empty([n]), name: l.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, '').trim() })).filter((r) => r.name);
}
