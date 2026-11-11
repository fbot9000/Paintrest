/**
 * Turns an uploaded file into text for the import. Text files (txt, csv, tsv,
 * md, json, html) are read as they are. An Excel workbook (.xlsx) becomes
 * tab-separated rows, one block per sheet with the sheet's name first, so the AI
 * sees the columns and which sheet a paint is on.
 *
 * The .xlsx reader is deliberately small: a zip directory walk and the browser's
 * own DecompressionStream('deflate-raw'), no library. It reads cell values only
 * (shared strings, inline strings, numbers, cached formula results).
 */

export const ACCEPT = '.txt,.csv,.tsv,.md,.json,.html,.htm,.xlsx,text/*,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export async function fileToText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.xlsx')) return xlsxToText(new Uint8Array(await file.arrayBuffer()));
  if (/\.(xls|numbers|ods|pdf|docx?|pages|zip)$/.test(name)) {
    throw new Error('Den filtypen kan ikke leses ennå. Lagre den som CSV eller .xlsx, eller kopier teksten og lim den inn.');
  }
  const text = await file.text();
  if (/\.html?$/.test(name) || /^\s*<(!doctype|html)/i.test(text)) return htmlToText(text);
  return text;
}

/** Visible text of an HTML page (for example a saved order confirmation), one block per line. */
export function htmlToText(html: string): string {
  return decode(html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<\/(p|div|li|tr|h\d|br)>|<br\s*\/?>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, ''))
    .split('\n').map((l) => l.replace(/[  ]+/g, ' ').trim()).filter(Boolean).join('\n');
}

// ---------- .xlsx ----------

interface ZipEntry { name: string; method: number; size: number; offset: number }

function u16(b: Uint8Array, i: number): number { return b[i]! | (b[i + 1]! << 8); }
function u32(b: Uint8Array, i: number): number { return (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0; }

function zipEntries(b: Uint8Array): ZipEntry[] {
  // End of central directory: the last 0x06054b50 within 64 KiB of the end.
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65_557); i--) {
    if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Filen er ikke en gyldig .xlsx-fil');
  const count = u16(b, eocd + 10);
  let p = u32(b, eocd + 16);
  const out: ZipEntry[] = [];
  const dec = new TextDecoder();
  for (let k = 0; k < count; k++) {
    if (u32(b, p) !== 0x02014b50) break;
    const method = u16(b, p + 10);
    const size = u32(b, p + 20);
    const nameLen = u16(b, p + 28);
    const extra = u16(b, p + 30);
    const comment = u16(b, p + 32);
    const offset = u32(b, p + 42);
    out.push({ name: dec.decode(b.subarray(p + 46, p + 46 + nameLen)), method, size, offset });
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

async function readEntry(b: Uint8Array, e: ZipEntry): Promise<string> {
  const start = e.offset + 30 + u16(b, e.offset + 26) + u16(b, e.offset + 28);
  const data = b.slice(start, start + e.size);
  if (e.method === 0) return new TextDecoder().decode(data);
  if (e.method !== 8) throw new Error('Filen bruker en komprimering Paintrest ikke kan lese');
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Response(stream).text();
}

function decode(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, e: string) => {
    const k = e.toLowerCase();
    if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
    if (k.startsWith('#')) return String.fromCodePoint(parseInt(k.slice(1), 10));
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[k]!;
  });
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return m ? decode(m[1]!) : null;
}

/** Text of <t> runs (a shared string may be split into formatted runs). */
function runs(xml: string): string {
  return [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1]!)).join('');
}

function column(ref: string | null, fallback: number): number {
  const letters = ref ? /^[A-Z]+/.exec(ref)?.[0] : null;
  if (!letters) return fallback;
  return [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}

export function sheetRows(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    let next = 0;
    for (const c of row[1]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const tag = c[1]!;
      const body = c[2] ?? '';
      const col = column(attr(tag, 'r'), next);
      next = col + 1;
      const type = attr(tag, 't');
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value = '';
      if (type === 's') value = shared[Number(v)] ?? '';
      else if (type === 'inlineStr') value = runs(body);
      else if (v !== undefined) value = decode(v);
      if (value.trim()) cells[col] = value.replace(/\s*\n\s*/g, ' ').trim();
    }
    if (cells.some((x) => x)) rows.push(Array.from(cells, (x) => x ?? ''));
  }
  return rows;
}

export async function xlsxToText(bytes: Uint8Array): Promise<string> {
  const entries = zipEntries(bytes);
  const get = async (name: string) => {
    const e = entries.find((x) => x.name === name);
    return e ? readEntry(bytes, e) : null;
  };
  const sharedXml = await get('xl/sharedStrings.xml');
  const shared = sharedXml ? [...sharedXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => runs(m[1]!)) : [];
  // Sheet names and order from the workbook; fall back to the sheet files in number order.
  const workbook = await get('xl/workbook.xml');
  const rels = await get('xl/_rels/workbook.xml.rels');
  const targets = new Map<string, string>();
  for (const m of (rels ?? '').matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    const id = attr(m[1]!, 'Id');
    const target = attr(m[1]!, 'Target');
    if (id && target) targets.set(id, target.replace(/^\/?(xl\/)?/, 'xl/'));
  }
  let sheets = [...(workbook ?? '').matchAll(/<sheet\b([^>]*)\/?>/g)].flatMap((m) => {
    const path = targets.get(attr(m[1]!, 'r:id') ?? '');
    return path ? [{ name: attr(m[1]!, 'name') ?? '', path }] : [];
  });
  if (!sheets.length) {
    sheets = entries.map((e) => e.name).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
      .sort((a, b) => Number(/(\d+)\.xml$/.exec(a)![1]) - Number(/(\d+)\.xml$/.exec(b)![1]))
      .map((path, i) => ({ name: `Ark ${i + 1}`, path }));
  }
  const blocks: string[] = [];
  for (const s of sheets) {
    const xml = await get(s.path);
    if (!xml) continue;
    const rows = sheetRows(xml, shared);
    if (!rows.length) continue;
    blocks.push([sheets.length > 1 ? `# Ark: ${s.name}` : '', ...rows.map((r) => r.join('\t'))].filter(Boolean).join('\n'));
  }
  if (!blocks.length) throw new Error('Fant ingen celler med innhold i regnearket');
  return blocks.join('\n\n');
}
