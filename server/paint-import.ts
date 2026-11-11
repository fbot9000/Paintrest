/**
 * AI-assisted import of the user's paint collection. One model call per request,
 * no web: the model reads part of a list (read) or answers the user in a dialog
 * about the draft list (discuss). Nothing is written here; the browser keeps the
 * draft and the user saves it.
 *
 * The answer is plain JSON text (like the research agent), because that works for
 * every model family behind UiB's endpoint. The server checks it: unknown types,
 * lines outside the request and malformed colours are dropped, and fields the user's
 * text does not contain are marked as the AI's guesses even when the model forgot to.
 */
import { UserError } from './credential-store.ts';
import type { ResponsesMessage, ResponsesProvider } from './provider.ts';

export const PAINT_KINDS = ['primer', 'base', 'layer', 'shade', 'contrast', 'technical', 'metallic', 'medium', 'other'] as const;
type Kind = typeof PAINT_KINDS[number];
const GUESS_FIELDS = ['maker', 'range', 'name', 'code', 'kind', 'finish', 'hex'] as const;
type GuessField = typeof GUESS_FIELDS[number];

export const MAX_READ_LINES = 120;
/** The browser breaks lines at 1500 characters; this only stops abuse. */
const MAX_LINE_CHARS = 4000;
const MAX_PAINTS = 400;
const MAX_QUESTIONS = 8;
const TIMEOUT_MS = 180_000;
export const UNREADABLE = 'Svaret fra AI-en kunne ikke leses';

export interface Line { n: number; text: string }

export interface PaintWire {
  id: string | null;
  lines: number[];
  maker: string | null;
  range: string | null;
  name: string;
  code: string | null;
  kind: Kind;
  finish: string | null;
  hex: string | null;
  own: 'owns' | 'not_owned';
  guessed: GuessField[];
  unsure: string | null;
}

export interface QuestionWire { text: string; refs: string[]; options: string[] }

export type ChangeWire =
  | { op: 'update'; ref: string; set: Partial<Record<GuessField | 'own', string | null>>; guessed: GuessField[]; unsure?: string | null; include?: boolean }
  | { op: 'add'; paint: PaintWire }
  | { op: 'remove'; ref: string; reason: string | null };

export type InterpretRequest =
  | { mode: 'read'; lines: Line[]; context: Line[]; note: string }
  | { mode: 'discuss'; table: string; unused_lines: Line[]; questions: { id: string; text: string }[];
      history: { role: 'user' | 'assistant'; text: string }[]; message: string; note: string };

export type InterpretResult =
  | { mode: 'read'; message: string; paints: PaintWire[]; skipped: { line: number; reason: string }[]; questions: QuestionWire[]; model: string }
  | { mode: 'discuss'; message: string; changes: ChangeWire[]; answered: string[]; questions: QuestionWire[]; model: string };

// ---------- Instrukser ----------

const FIELDS = `- "maker": produsenten (Citadel, Vallejo, The Army Painter, AK Interactive, Scale75, Pro Acryl, Two Thin Coats, Kimera Kolors, Monument Hobbies, P3, Reaper …)
- "range": serien (Base, Layer, Shade, Contrast, Dry, Technical, Model Color, Game Color, Model Air, Xpress Color, Warpaints Fanatic, Speedpaint, 3rd Gen …)
- "name": produktnavnet slik produsenten skriver det, med riktig stavemåte og store bokstaver
- "code": produktkode eller varenummer (70.950, 72.051, WP3001, AK11001), ellers null
- "kind": én av primer, base, layer, shade, contrast, technical, metallic, medium, other
- "finish": matt, satin, blank, metallisk … når teksten sier det eller det er kjent for produktet, ellers null
- "hex": omtrentlig farge i flasken som "#rrggbb" når du kjenner malingen, ellers null
- "own": "owns", eller "not_owned" når teksten sier at brukeren ikke har den (ønskeliste, tom, skal kjøpe)
- "guessed": feltene du har fylt inn fra egen kunnskap og ikke fra teksten, for eksempel ["maker", "range", "kind", "hex"]. "hex" er nesten alltid gjettet. Har du rettet en skrivefeil i navnet, er "name" gjettet.
- "unsure": kort norsk setning om hva du er usikker på, eller null`;

const KIND_RULES = `Typer: wash og shade → shade; contrast, speedpaint, xpress → contrast; air → layer (metallic når den er metallisk); alle metalliske farger → metallic; primer og spray → primer; lakk, medium, thinner, glaze medium → medium; technical, effekt, tekstur, blod, rust → technical; ink, dry og alt annet → other.`;

export function readInstructions(): string {
  return `Du hjelper brukeren å legge inn malingssamlingen sin i Paintrest, et verktøy for å male miniatyrer.
Du får en del av en tekst brukeren har limt inn eller lastet opp: en liste, et regneark (CSV/TSV, kolonner skilt med |), en ordrebekreftelse, notater eller lignende. Hver linje har et nummer (L12: …).

Finn hver maling (malingsprodukt) i linjene under TEKST og beskriv den så presist du kan. For hver maling:
- "id": "p1", "p2" … unik i svaret
- "lines": linjenumrene malingen står på
${FIELDS}

Regler:
- Finn ikke på malinger. Hver maling må stå på en linje under TEKST.
- Én linje kan ha flere malinger (for eksempel en kommaliste), og én maling kan gå over flere linjer.
- Står samme maling flere ganger, eller med antall («x2»), lag én maling.
- Linjer som ikke er malinger (overskrifter, kolonnenavn, priser, frakt, pensler, verktøy), legger du i "skipped" med en kort norsk grunn.
- Linjene under KONTEKST er bare for å forstå sammenhengen (kolonnenavn, overskrifter som «Citadel:»). Lag ikke malinger av dem, og legg dem ikke i "skipped".
- Rett åpenbare skrivefeil og forkortelser i navn («caliban grn» → «Caliban Green»), og merk "name" som gjettet.
- Er du i tvil om hvilken maling som menes, ta den likevel med med ditt beste forslag, skriv tvilen i "unsure", og still et spørsmål.
- Still spørsmål bare når svaret endrer resultatet: ukjent produsent for et vanlig navn («Black»), flere mulige serier, eller uklart om noe er eid. Samle like spørsmål i ett («Er alle linjene uten produsent Vallejo Model Color?»). Høyst 5 spørsmål. Hvert spørsmål: {"text": "…", "paints": ["p3", "p7"], "options": ["kort svar", "kort svar"]}.
- ${KIND_RULES}
- Følg det brukeren har skrevet under NOTAT.

Svar med ÉN JSON og ingenting annet:
{"message": "kort norsk oppsummering av hva du fant og hva du er usikker på", "paints": [ … ], "skipped": [{"line": 3, "reason": "overskrift"}], "questions": [ … ]}`;
}

export function discussInstructions(): string {
  return `Du hjelper brukeren å rette en liste over malinger før den legges inn i malingssamlingen i Paintrest.
Listen står under LISTE, én maling per linje med kolonnene: ref | produsent | serie | navn | kode | type | finish | farge | eier | usikker | fra teksten. «fra teksten» er linjen i brukerens opprinnelige tekst. «(utelatt)» betyr at malingen ikke skal lagres nå.
LINJER UTEN MALING er linjer fra teksten som ikke ble til noen maling. ÅPNE SPØRSMÅL er spørsmålene du har stilt (S1, S2 …).

Brukeren svarer på spørsmålene eller gir en beskjed. Endre listen ut fra det. Endringer:
- {"op": "update", "ref": "R12", "set": {bare feltene som endres}, "guessed": [felt i "set" du fyller inn fra egen kunnskap], "unsure": null}
  Felt i "set": "maker", "range", "name", "code", "kind", "finish", "hex", "own" (som i listen). Ta med "unsure" bare når tvilen endres; null betyr at tvilen er løst.
  Felt brukeren selv oppgir, er ikke gjettet.
- {"op": "add", "paint": {"id": "n1", "lines": [linjenumre], "maker": …, "range": …, "name": …, "code": …, "kind": …, "finish": …, "hex": …, "own": "owns", "guessed": […], "unsure": null}}
- {"op": "remove", "ref": "R3", "reason": "kort norsk grunn"}
- {"op": "update", "ref": "R3", "set": {}, "include": true} tar en utelatt maling med igjen.

Regler:
- Endre bare det svaret eller beskjeden gjelder, men gjelder et svar mange malinger («alle Vallejo er Game Color»), endre alle.
- Still ikke samme spørsmål på nytt. Nye spørsmål bare når noe fortsatt er uklart, i samme form som før: {"text": "…", "refs": ["R12"], "options": ["…"]}.
- Sett "answered" til spørsmålene brukerens melding svarer på.
- ${KIND_RULES}
- Finn ikke på malinger brukeren ikke har nevnt.

Svar med ÉN JSON og ingenting annet:
{"message": "kort norsk svar til brukeren om hva du endret", "changes": [ … ], "answered": ["S1"], "questions": [ … ]}`;
}

const numbered = (lines: Line[]) => lines.map((l) => `L${l.n}: ${l.text}`).join('\n');

export function readPrompt(req: Extract<InterpretRequest, { mode: 'read' }>): string {
  return [
    req.note ? `NOTAT fra brukeren:\n${req.note}` : '',
    req.context.length ? `KONTEKST (bare for sammenhengen):\n${numbered(req.context)}` : '',
    `TEKST:\n${numbered(req.lines)}`,
  ].filter(Boolean).join('\n\n');
}

export function discussPrompt(req: Extract<InterpretRequest, { mode: 'discuss' }>): string {
  return [
    req.note ? `NOTAT fra brukeren (da listen ble lest):\n${req.note}` : '',
    `LISTE:\n${req.table}`,
    req.unused_lines.length ? `LINJER UTEN MALING:\n${numbered(req.unused_lines)}` : '',
    req.questions.length ? `ÅPNE SPØRSMÅL:\n${req.questions.map((q) => `${q.id}: ${q.text}`).join('\n')}` : '',
    req.history.length ? `SAMTALEN SÅ LANGT:\n${req.history.map((h) => `${h.role === 'user' ? 'Brukeren' : 'Du'}: ${h.text}`).join('\n')}` : '',
    `BRUKERENS NYE MELDING:\n${req.message}`,
  ].filter(Boolean).join('\n\n');
}

// ---------- Lese og sjekke svaret ----------

/** Finds the JSON object in a reply, also inside a code fence or surrounding prose. */
export function parseJsonObject(text: string): Record<string, unknown> | null {
  const candidates: string[] = [];
  for (const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) if (m[1]) candidates.push(m[1]);
  candidates.push(text);
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const c of candidates) {
    try {
      const v = JSON.parse(c.trim());
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    } catch { /* next candidate */ }
  }
  return null;
}

const str = (v: unknown, max = 160): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

function norm(s: string | null | undefined): string {
  return (s ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’`´]/g, '').replace(/[^\p{L}\p{N}#]+/gu, ' ').trim();
}

const KIND_WORDS: Record<Kind, RegExp> = {
  primer: /primer|spray|grunn/, base: /\bbase\b|foundation/, layer: /layer|\bair\b/, shade: /shade|wash/,
  contrast: /contrast|speedpaint|xpress|speed paint/, technical: /technical|teknisk|effect|effekt|texture|tekstur/,
  metallic: /metal|metall/, medium: /medium|varnish|lakk|thinner/, other: /$^/,
};

export function kindOf(v: unknown): Kind {
  if (PAINT_KINDS.includes(v as Kind)) return v as Kind;
  const k = norm(typeof v === 'string' ? v : '');
  return (Object.keys(KIND_WORDS) as Kind[]).find((x) => x !== 'other' && KIND_WORDS[x].test(k)) ?? 'other';
}

function hexOf(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  if (/^[0-9a-f]{6}$/i.test(s)) return `#${s.toLowerCase()}`;
  return null;
}

function guessedOf(v: unknown): GuessField[] {
  return Array.isArray(v) ? [...new Set(v.filter((x): x is GuessField => GUESS_FIELDS.includes(x as GuessField)))] : [];
}

/**
 * Marks fields the text does not contain as guessed, whatever the model said.
 * `hay` is the user's own text (lines, context, note) in normalised form.
 */
export function markGuesses(p: PaintWire, hay: string): GuessField[] {
  const has = (v: string | null) => !!v && ` ${hay} `.includes(` ${norm(v)} `);
  const code = (v: string | null) => !!v && hay.replace(/[^a-z0-9]/g, '').includes(v.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const out = new Set(p.guessed);
  if (p.maker && !has(p.maker)) out.add('maker');
  if (p.range && !has(p.range)) out.add('range');
  if (!has(p.name)) out.add('name');
  if (p.code && !code(p.code)) out.add('code');
  if (p.kind !== 'other' && !KIND_WORDS[p.kind].test(hay)) out.add('kind');
  if (p.finish && !has(p.finish)) out.add('finish');
  if (p.hex && !hay.includes(p.hex.slice(1))) out.add('hex');
  return GUESS_FIELDS.filter((f) => out.has(f));
}

export function paintOf(v: unknown, lineOk: (n: number) => boolean, hay: string): PaintWire | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const name = str(o.name);
  if (!name) return null;
  const rawLines = Array.isArray(o.lines) ? o.lines : [o.line];
  const lines = [...new Set(rawLines.filter((n): n is number => typeof n === 'number' && Number.isInteger(n) && lineOk(n)))].sort((a, b) => a - b);
  const p: PaintWire = {
    id: str(o.id, 20), lines,
    maker: str(o.maker ?? o.manufacturer), range: str(o.range ?? o.range_name), name, code: str(o.code ?? o.product_code, 40),
    kind: kindOf(o.kind), finish: str(o.finish, 40), hex: hexOf(o.hex),
    own: o.own === 'not_owned' || o.own === false ? 'not_owned' : 'owns',
    guessed: guessedOf(o.guessed), unsure: str(o.unsure, 300),
  };
  p.guessed = markGuesses(p, hay);
  return p;
}

function questionsOf(v: unknown): QuestionWire[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((q): QuestionWire[] => {
    if (!q || typeof q !== 'object') return [];
    const o = q as Record<string, unknown>;
    const text = str(o.text, 400);
    if (!text) return [];
    const refs = (Array.isArray(o.refs) ? o.refs : Array.isArray(o.paints) ? o.paints : Array.isArray(o.rows) ? o.rows : [])
      .flatMap((r) => (str(r, 20) ? [str(r, 20)!] : []));
    const options = (Array.isArray(o.options) ? o.options : []).flatMap((x) => (str(x, 120) ? [str(x, 120)!] : [])).slice(0, 6);
    return [{ text, refs, options }];
  }).slice(0, MAX_QUESTIONS);
}

export function readResult(o: Record<string, unknown>, req: Extract<InterpretRequest, { mode: 'read' }>, model: string): InterpretResult {
  const own = new Set(req.lines.map((l) => l.n));
  const hay = norm([...req.lines, ...req.context].map((l) => l.text).join(' ') + ' ' + req.note);
  const paints = (Array.isArray(o.paints) ? o.paints : []).flatMap((p) => {
    const w = paintOf(p, (n) => own.has(n), hay);
    return w ? [w] : [];
  }).slice(0, MAX_PAINTS);
  const skipped = (Array.isArray(o.skipped) ? o.skipped : []).flatMap((s) => {
    const x = s && typeof s === 'object' ? s as Record<string, unknown> : {};
    return typeof x.line === 'number' && own.has(x.line) ? [{ line: x.line, reason: str(x.reason, 120) ?? 'ikke en maling' }] : [];
  });
  return { mode: 'read', message: str(o.message, 1200) ?? '', paints, skipped, questions: questionsOf(o.questions), model };
}

export function discussResult(o: Record<string, unknown>, req: Extract<InterpretRequest, { mode: 'discuss' }>, model: string): InterpretResult {
  const hay = norm(`${req.message} ${req.unused_lines.map((l) => l.text).join(' ')} ${req.note}`);
  const changes = (Array.isArray(o.changes) ? o.changes : []).flatMap((c): ChangeWire[] => {
    if (!c || typeof c !== 'object') return [];
    const x = c as Record<string, unknown>;
    if (x.op === 'add') {
      const p = paintOf(x.paint, (n) => n >= 1, hay);
      return p ? [{ op: 'add', paint: p }] : [];
    }
    const ref = str(x.ref, 20);
    if (!ref) return [];
    if (x.op === 'remove') return [{ op: 'remove', ref, reason: str(x.reason, 200) }];
    if (x.op !== 'update') return [];
    const raw = x.set && typeof x.set === 'object' ? x.set as Record<string, unknown> : {};
    const set: Partial<Record<GuessField | 'own', string | null>> = {};
    for (const f of GUESS_FIELDS) {
      if (!(f in raw)) continue;
      set[f] = f === 'kind' ? kindOf(raw[f]) : f === 'hex' ? hexOf(raw[f]) : str(raw[f], f === 'code' || f === 'finish' ? 40 : 160);
    }
    if (raw.own === 'owns' || raw.own === 'not_owned') set.own = raw.own;
    // A colour the user did not give is an estimate.
    const guessed = new Set(guessedOf(x.guessed).filter((f) => f in set));
    if (set.hex && !hay.includes(set.hex.slice(1))) guessed.add('hex');
    const out: ChangeWire = { op: 'update', ref, set, guessed: [...guessed] };
    if ('unsure' in x) out.unsure = str(x.unsure, 300);
    if (x.include === true) out.include = true;
    return [out];
  }).slice(0, MAX_PAINTS * 2);
  const answered = (Array.isArray(o.answered) ? o.answered : []).flatMap((a) => (str(a, 20) ? [str(a, 20)!] : []));
  return { mode: 'discuss', message: str(o.message, 1500) ?? '', changes, answered, questions: questionsOf(o.questions), model };
}

// ---------- Forespørselen ----------

function lines(v: unknown, max: number): Line[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((l) => {
    const o = l && typeof l === 'object' ? l as Record<string, unknown> : {};
    return typeof o.n === 'number' && Number.isInteger(o.n) && o.n > 0 && typeof o.text === 'string' && o.text.trim()
      ? [{ n: o.n, text: o.text.slice(0, MAX_LINE_CHARS) }] : [];
  }).slice(0, max);
}

/** Checks the browser's request; refuses what the AI should not get (too much, or nothing). */
export function parseInterpretRequest(body: Record<string, unknown>): InterpretRequest {
  const note = typeof body.note === 'string' ? body.note.slice(0, 2000) : '';
  if (body.mode === 'read') {
    const l = lines(body.lines, MAX_READ_LINES);
    if (!l.length) throw new UserError('Ingen linjer å lese');
    return { mode: 'read', lines: l, context: lines(body.context, 20), note };
  }
  if (body.mode === 'discuss') {
    const message = typeof body.message === 'string' ? body.message.trim().slice(0, 6000) : '';
    if (!message) throw new UserError('Skriv et svar eller en beskjed');
    const history = (Array.isArray(body.history) ? body.history : []).flatMap((h): { role: 'user' | 'assistant'; text: string }[] => {
      const o = h && typeof h === 'object' ? h as Record<string, unknown> : {};
      return (o.role === 'user' || o.role === 'assistant') && typeof o.text === 'string' ? [{ role: o.role, text: o.text.slice(0, 1500) }] : [];
    }).slice(-12);
    const questions = (Array.isArray(body.questions) ? body.questions : []).flatMap((q) => {
      const o = q && typeof q === 'object' ? q as Record<string, unknown> : {};
      return typeof o.id === 'string' && typeof o.text === 'string' ? [{ id: o.id.slice(0, 20), text: o.text.slice(0, 400) }] : [];
    }).slice(0, 40);
    return {
      mode: 'discuss', table: typeof body.table === 'string' ? body.table.slice(0, 400_000) : '', unused_lines: lines(body.unused_lines, 300),
      questions, history, message, note,
    };
  }
  throw new UserError('Ukjent forespørsel');
}

/** One model call; one retry when the answer is not JSON. */
export async function interpretPaints(provider: ResponsesProvider, req: InterpretRequest, model?: string): Promise<InterpretResult> {
  const instructions = req.mode === 'read' ? readInstructions() : discussInstructions();
  const prompt = req.mode === 'read' ? readPrompt(req) : discussPrompt(req);
  const first = await provider.respond(prompt, { instructions, model, timeoutMs: TIMEOUT_MS });
  let parsed = parseJsonObject(first.text);
  let used = first.model;
  if (!parsed) {
    const retry: ResponsesMessage[] = [
      { role: 'user', content: prompt },
      { role: 'assistant', content: first.text.slice(0, 6000) },
      { role: 'user', content: 'Svaret var ikke gyldig JSON, eller det ble kuttet. Svar på nytt med bare JSON-objektet. Er listen lang, skriv kortere tekster.' },
    ];
    const second = await provider.respond(retry, { instructions, model, timeoutMs: TIMEOUT_MS });
    parsed = parseJsonObject(second.text);
    used = second.model;
  }
  if (!parsed) throw new UserError(`${UNREADABLE}. Prøv igjen, eller del teksten i mindre biter.`, 502);
  return req.mode === 'read' ? readResult(parsed, req, used) : discussResult(parsed, req, used);
}
