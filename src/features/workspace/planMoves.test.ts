import { describe, expect, it } from 'vitest';
import type { PaintPlanPayload } from '../../domain/agent';
import type { PaintProduct } from '../../domain/types';
import { addPaint, moveElement, moveStep, roleFromLabel } from './planMoves';

const plan = (): PaintPlanPayload => ({
  subject_id: 's', note: null,
  elements: [
    { kind: 'part', name: 'A', steps: [{ instruction: 'a1', materials: [], mix: null }, { instruction: 'a2', materials: [], mix: null }] },
    { kind: 'part', name: 'B', steps: [{ instruction: 'b1', materials: [], mix: null }] },
    { kind: 'part', name: 'C', steps: [] },
  ],
});
const names = (p: PaintPlanPayload) => p.elements.map((e) => `${e.name}:${e.steps.map((s) => s.instruction).join(',')}`);
const paint = { id: 'p1', name: 'Nuln Oil', manufacturer: 'Citadel', range_name: 'Shade', swatch_hex: '#222' } as PaintProduct;

describe('dra og slipp i maleplanen (O-19)', () => {
  it('flytter en del foran en annen, eller sist', () => {
    expect(names(moveElement(plan(), 2, 0))).toEqual(['C:', 'A:a1,a2', 'B:b1']);
    expect(names(moveElement(plan(), 0, 3))).toEqual(['B:b1', 'C:', 'A:a1,a2']);
    expect(moveElement(plan(), 1, 2).elements.map((e) => e.name)).toEqual(['A', 'B', 'C']);
  });

  it('flytter et steg i delen og til en annen del', () => {
    expect(names(moveStep(plan(), { e: 0, s: 1 }, { e: 0, s: 0 }))).toEqual(['A:a2,a1', 'B:b1', 'C:']);
    expect(names(moveStep(plan(), { e: 0, s: 0 }, { e: 0, s: 2 }))).toEqual(['A:a2,a1', 'B:b1', 'C:']);
    expect(names(moveStep(plan(), { e: 0, s: 0 }, { e: 2, s: 0 }))).toEqual(['A:a2', 'B:b1', 'C:a1']);
    expect(names(moveStep(plan(), { e: 1, s: 0 }, { e: 0, s: 1 }))).toEqual(['A:a1,b1,a2', 'B:', 'C:']);
  });

  it('legger en maling i et steg, én gang, med rollen fra paletten', () => {
    const once = addPaint(plan(), 1, 0, paint, 'kappe – skygge');
    expect(once.elements[1]!.steps[0]!.materials).toEqual([{ product: { manufacturer: 'Citadel', range: 'Shade', name: 'Nuln Oil', hex: '#222', product_id: 'p1' }, role: 'shade', role_label: null }]);
    expect(addPaint(once, 1, 0, paint, null)).toBe(once);
    expect(roleFromLabel('høylys på kanter')).toBe('highlight');
    expect(roleFromLabel(null)).toBe('other');
  });
});
