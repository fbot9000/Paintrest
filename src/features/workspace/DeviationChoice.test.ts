import { describe, expect, it } from 'vitest';
import { payloadFromVersion } from '../../domain/plan-versions';
import { createLocalCommands } from '../../data/local-commands';
import { memoryPersistence } from '../../data/persistence';
import { buildSampleData } from '../../data/seed';
import { Store } from '../../data/store';
import { toggleBake } from './DeviationChoice';

describe('bak inn et avvik i utkastet', () => {
  it('skriver det inn, og tar det ut igjen når utkastet ikke er endret siden', async () => {
    const p = memoryPersistence();
    const store = new Store(await buildSampleData(p, { examplePaints: true }), p);
    const cmd = createLocalCommands(store);
    const merlin = Object.values(store.getTables().miniature_subject).find((s) => s.name === 'Merlin')!;
    const v1 = merlin.current_plan_version_id!;
    const stav = Object.values(store.getTables().plan_element).find((e) => e.plan_version_id === v1 && e.name === 'Stav')!;
    const id = await cmd.addDeviation(v1, { element_id: stav.id, step_id: null, kind: 'extra_step', payload: { text: 'Lakk krystallene' } });
    const t = store.getTables();
    const start = payloadFromVersion(t, v1);
    const r = toggleBake(t, v1, start, [], t.local_deviation[id]!);
    const steps = r.draft.elements.find((e) => e.name === 'Stav')!.steps;
    expect(steps[steps.length - 1]!.instruction).toBe('Lakk krystallene');
    expect(r.bakes).toHaveLength(1);
    const back = toggleBake(t, v1, r.draft, r.bakes, t.local_deviation[id]!);
    expect(back.draft).toEqual(start);
    expect(back.bakes).toHaveLength(0);
    // Edited after baking: the text stays, only the choice is taken back.
    const edited = structuredClone(r.draft);
    edited.summary = 'Endret';
    const kept = toggleBake(t, v1, edited, r.bakes, t.local_deviation[id]!);
    expect(kept.draft).toBe(edited);
    expect(kept.bakes).toHaveLength(0);
  });
});
