import { describe, expect, it } from 'vitest';
import { buildInstructions, parseReply } from './agent.ts';

describe('parseReply', () => {
  it('leser rent JSON', () => {
    const r = parseReply('{"message":"Hei","proposals":[{"type":"catalog_subject"}]}');
    expect(r).toMatchObject({ message: 'Hei', warning: null });
    expect(r.proposals).toHaveLength(1);
  });

  it('leser JSON i kodeblokk med tekst rundt', () => {
    const r = parseReply('Her er forslaget:\n```json\n{"message":"OK","proposals":[]}\n```\nLykke til!');
    expect(r).toMatchObject({ message: 'OK', proposals: [], warning: null });
  });

  it('faller tilbake til teksten når formatet er feil', () => {
    const r = parseReply('Jeg vet ikke.');
    expect(r.message).toBe('Jeg vet ikke.');
    expect(r.proposals).toEqual([]);
    expect(r.warning).toBeTruthy();
  });
});

describe('buildInstructions', () => {
  it('tar med tillatte typer og kontekst', () => {
    const s = buildInstructions({ project: { game: 'Avalon' } }, ['catalog_subject', 'paint_plan']);
    expect(s).toContain('catalog_subject, paint_plan');
    expect(s).toContain('"game":"Avalon"');
  });
});
