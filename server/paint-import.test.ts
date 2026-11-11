import { describe, expect, it } from 'vitest';
import { discussPrompt, interpretPaints, kindOf, parseInterpretRequest, parseJsonObject, readPrompt } from './paint-import.ts';
import type { InterpretRequest } from './paint-import.ts';
import type { ResponsesProvider } from './provider.ts';

function fakeProvider(replies: string[]) {
  const calls: { input: unknown; instructions?: string }[] = [];
  let i = 0;
  const provider = {
    respond: async (input: unknown, opts: { instructions?: string }) => {
      calls.push({ input, instructions: opts.instructions });
      return { text: replies[i++] ?? '', model: 'test-model', usage: null, citations: [], searches: [], search_sources: [], hosted_opened: [] };
    },
  } as unknown as ResponsesProvider;
  return { provider, calls };
}

const READ: InterpretRequest = {
  mode: 'read',
  lines: [{ n: 2, text: '- caliban grn x2' }, { n: 3, text: 'Nuln Oil (wash)' }, { n: 4, text: 'Pensel str 1' }],
  context: [{ n: 1, text: 'Citadel:' }],
  note: 'Alt er mitt',
};

describe('lese en malingsliste', () => {
  it('lager instruks og tekst med nummererte linjer og kontekst', () => {
    const prompt = readPrompt(READ as Extract<InterpretRequest, { mode: 'read' }>);
    expect(prompt).toContain('NOTAT fra brukeren:\nAlt er mitt');
    expect(prompt).toContain('KONTEKST (bare for sammenhengen):\nL1: Citadel:');
    expect(prompt).toContain('TEKST:\nL2: - caliban grn x2\nL3: Nuln Oil (wash)');
  });

  it('godtar bare linjer fra forespørselen og merker det som ikke står i teksten som gjettet', async () => {
    const { provider, calls } = fakeProvider([
      'Her er listen:\n```json\n' + JSON.stringify({
        message: 'Fant to malinger.',
        paints: [
          { id: 'p1', lines: [2, 77], maker: 'Citadel', range: 'Base', name: 'Caliban Green', kind: 'base', hex: '1F4A32', guessed: [] },
          { id: 'p2', line: 3, maker: 'Citadel', range: 'Shade', name: 'Nuln Oil', kind: 'Wash', hex: 'grønn', guessed: ['nonsense'], own: false },
          { id: 'p3', lines: [9], name: '' },
        ],
        skipped: [{ line: 4, reason: 'pensel' }, { line: 1, reason: 'overskrift' }],
        questions: [{ text: 'Er det to bokser?', paints: ['p1'], options: ['Ja', 'Nei', 7] }, { text: '' }],
      }) + '\n```',
    ]);
    const r = await interpretPaints(provider, READ);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.instructions).toMatch(/Finn ikke på malinger/);
    if (r.mode !== 'read') throw new Error('feil modus');
    expect(r.model).toBe('test-model');
    expect(r.paints).toHaveLength(2);
    expect(r.paints[0]).toMatchObject({ lines: [2], maker: 'Citadel', hex: '#1f4a32', kind: 'base', own: 'owns' });
    // «Citadel» is in the context, «Base» and the corrected name are not.
    expect(r.paints[0]!.guessed).toEqual(['range', 'name', 'kind', 'hex']);
    expect(r.paints[1]).toMatchObject({ lines: [3], kind: 'shade', hex: null, own: 'not_owned' });
    expect(r.paints[1]!.guessed).toEqual(['range']);
    expect(r.skipped).toEqual([{ line: 4, reason: 'pensel' }]);
    expect(r.questions).toEqual([{ text: 'Er det to bokser?', refs: ['p1'], options: ['Ja', 'Nei'] }]);
  });

  it('spør én gang til når svaret ikke er JSON, og gir en tydelig feil etter det', async () => {
    const ok = fakeProvider(['Beklager, her kommer det: {"paints": [', '{"message":"ok","paints":[]}']);
    const r = await interpretPaints(ok.provider, READ);
    expect(ok.calls).toHaveLength(2);
    expect(JSON.stringify(ok.calls[1]!.input)).toMatch(/ikke gyldig JSON/);
    expect(r).toMatchObject({ mode: 'read', message: 'ok', paints: [] });
    const bad = fakeProvider(['ikke json', 'fortsatt ikke']);
    await expect(interpretPaints(bad.provider, READ)).rejects.toThrow(/kunne ikke leses/);
  });

  it('typer fra fritekst', () => {
    expect(['Contrast', 'speedpaint', 'Metallic', 'Spray primer', 'Lakk', 'Technical', 'Ink', 'layer'].map(kindOf))
      .toEqual(['contrast', 'contrast', 'metallic', 'primer', 'medium', 'technical', 'other', 'layer']);
    expect(parseJsonObject('tekst {"a":1} mer')).toEqual({ a: 1 });
  });
});

describe('dialog om listen', () => {
  const body = {
    mode: 'discuss', table: 'ref | produsent\nR1 | ', unused_lines: [{ n: 9, text: 'Black x3' }],
    questions: [{ id: 'S1', text: 'Hvilken Black?' }], history: [{ role: 'assistant', text: 'Fant 1' }, { role: 'system', text: 'x' }],
    message: 'Svar på S1: Vallejo Model Color 70.950', note: '',
  };

  it('sjekker forespørselen', () => {
    const req = parseInterpretRequest(body);
    expect(req.mode === 'discuss' && req.history).toEqual([{ role: 'assistant', text: 'Fant 1' }]);
    expect(() => parseInterpretRequest({ ...body, message: ' ' })).toThrow(/Skriv/);
    expect(() => parseInterpretRequest({ mode: 'read', lines: [] })).toThrow(/Ingen linjer/);
    expect(() => parseInterpretRequest({ mode: 'x' })).toThrow(/Ukjent/);
    const prompt = discussPrompt(req as Extract<InterpretRequest, { mode: 'discuss' }>);
    expect(prompt).toContain('LINJER UTEN MALING:\nL9: Black x3');
    expect(prompt).toContain('ÅPNE SPØRSMÅL:\nS1: Hvilken Black?');
    expect(prompt.endsWith('BRUKERENS NYE MELDING:\nSvar på S1: Vallejo Model Color 70.950')).toBe(true);
  });

  it('leser endringer, og en farge brukeren ikke ga er et anslag', async () => {
    const { provider } = fakeProvider([JSON.stringify({
      message: 'Endret R1.',
      changes: [
        { op: 'update', ref: 'R1', set: { maker: 'Vallejo', range: 'Model Color', code: '70.950', hex: '#000000', kind: 'Layer', bogus: 'x' }, guessed: ['range', 'kind'], unsure: null },
        { op: 'remove', ref: 'R2', reason: 'dobbel' },
        { op: 'add', paint: { lines: [9], maker: 'Vallejo', name: 'Black', kind: 'layer' } },
        { op: 'update', ref: 'R3', set: {}, include: true },
        { op: 'rename', ref: 'R4' },
      ],
      answered: ['S1', 5],
    })]);
    const r = await interpretPaints(provider, parseInterpretRequest(body));
    if (r.mode !== 'discuss') throw new Error('feil modus');
    expect(r.answered).toEqual(['S1']);
    expect(r.changes).toHaveLength(4);
    expect(r.changes[0]).toEqual({ op: 'update', ref: 'R1', set: { maker: 'Vallejo', range: 'Model Color', code: '70.950', kind: 'layer', hex: '#000000' }, guessed: ['range', 'kind', 'hex'], unsure: null });
    expect(r.changes[2]).toMatchObject({ op: 'add', paint: { lines: [9], name: 'Black' } });
    expect(r.changes[3]).toEqual({ op: 'update', ref: 'R3', set: {}, guessed: [], include: true });
  });
});
