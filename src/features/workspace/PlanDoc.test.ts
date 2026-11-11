import { describe, expect, it } from 'vitest';
import { markChanges } from './PlanDoc';
import type { DocElement } from './PlanDoc';

const step = (instruction: string, paints: string[] = []) => ({
  instruction, change: null, mix: null,
  materials: paints.map((name) => ({ name, maker: null, hex: null, role: 'base' as const, role_label: null, status: 'owns' as const })),
});
const el = (name: string, steps: ReturnType<typeof step>[]): DocElement => ({ name, kind: 'part', change: null, steps });

describe('endringer mot gjeldende plan', () => {
  it('merker nye og endrede steg, og deler som er fjernet', () => {
    const current = [el('Kappe', [step('Base', ['Caliban Green']), step('Wash', ['Nuln Oil'])]), el('Base', [step('Sand')])];
    const next = [el('kappe', [step('Base', ['Caliban Green']), step('Wash', ['Agrax Earthshade']), step('Høylys')]), el('Øye', [step('Glød')])];
    const r = markChanges(next, current);
    expect(r.elements[0]!.steps.map((s) => s.change)).toEqual([null, 'changed', 'new']);
    expect(r.elements[1]!.change).toBe('new');
    expect(r).toMatchObject({ changed: 1, added: 2, removed: ['Base'] });
  });
});
