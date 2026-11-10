import { describe, expect, it } from 'vitest';
import { buildAgentContext } from '../domain/agent';
import type { AiGateway, ResearchEvent } from '../domain/ai';
import { runAgentTurn } from './agent-runner';
import { createLocalCommands } from './local-commands';
import { memoryPersistence } from './persistence';
import { createAgentCommands, createResearchCommands } from './research-commands';
import { buildSampleData } from './seed';
import { Store, diffTables, emptyTables, revertPatches } from './store';

async function setup() {
  const p = memoryPersistence();
  const store = new Store(await buildSampleData(p), p);
  const t0 = store.getTables();
  const project = Object.values(t0.project).find((x) => t0.game[x.game_id]!.primary_name.startsWith('Avalon'))!;
  const research = createResearchCommands(store);
  const agent = createAgentCommands(store);
  const cmd = createLocalCommands(store);
  const task = await research.startTask(project.id);
  const subject = (name: string) => Object.values(store.getTables().miniature_subject).find((s) => s.name === name && !s.deleted_at)!;
  return { store, research, agent, cmd, task, project, subject };
}

/** A fake gateway whose model returns the given proposals once. */
function fakeAi(build: (refs: Record<string, string>) => unknown[]): AiGateway & { focusSeen: unknown[]; directSeen: unknown[] } {
  const g = {
    focusSeen: [] as unknown[], directSeen: [] as unknown[],
    async runAgent(input: { context: unknown; focus?: unknown; direct_apply?: boolean }, onEvent: (e: ResearchEvent) => void) {
      g.focusSeen.push(input.focus ?? null);
      g.directSeen.push(input.direct_apply);
      const ctx = input.context as { miniatures: { ref: string; name: string }[] };
      const refs = Object.fromEntries(ctx.miniatures.map((m) => [m.name, m.ref]));
      const e = { type: 'final' as const, message: 'Gjort', proposals: build(refs), model: 'm', warnings: [], trace: [], pages: [] };
      onEvent(e);
      return e;
    },
  };
  return g as unknown as AiGateway & { focusSeen: unknown[]; directSeen: unknown[] };
}

describe('diff og tilbakeføring', () => {
  it('finner radendringer og tilbakefører dem, også i listetabeller', () => {
    const a = emptyTables();
    a.miniature_subject.x = { id: 'x', name: 'A' } as never;
    a.palette_entry_subject.push({ palette_entry_id: 'p', subject_id: 'x' });
    const b = structuredClone(a);
    b.miniature_subject.x = { id: 'x', name: 'B' } as never;
    b.miniature_subject.y = { id: 'y', name: 'Ny' } as never;
    b.palette_entry_subject = [{ palette_entry_id: 'q', subject_id: 'x' }];
    const patches = diffTables(a, b);
    expect(patches).toHaveLength(4);
    const c = structuredClone(b);
    expect(revertPatches(c, patches).conflicts).toEqual([]);
    expect(c.miniature_subject).toEqual(a.miniature_subject);
    expect(c.palette_entry_subject).toEqual(a.palette_entry_subject);
  });

  it('nekter å tilbakeføre når raden er endret etterpå', () => {
    const a = emptyTables();
    const b = structuredClone(a);
    b.miniature_subject.y = { id: 'y', name: 'Ny' } as never;
    const patches = diffTables(a, b);
    const c = structuredClone(b);
    c.miniature_subject.y = { id: 'y', name: 'Endret av brukeren' } as never;
    expect(revertPatches(c, patches).conflicts).toHaveLength(1);
    expect(c.miniature_subject.y).toEqual({ id: 'y', name: 'Endret av brukeren' });
  });
});

describe('agenten endrer direkte i prosjektet', () => {
  it('panelrunder tas i bruk med en gang og kan angres samlet', async () => {
    const { store, research, agent, cmd, task, project, subject } = await setup();
    await cmd.createSubject(project.id, { name: 'Agenter', grouping: 'group', physical_count: 12 });
    const ai = fakeAi((refs) => [
      { type: 'catalog_change', payload: { operations: [{ op: 'split', subject: refs['Agenter'], into: ['Rød', 'Blå'].map((c) => ({ name: `Agenter – ${c}`, physical_count: 6 })) }] } },
      { type: 'catalog_subject', payload: { name: 'Tåkeulv', grouping: 'group', physical_count: 4 } },
    ]);
    const r = await runAgentTurn({ store, research, agent, ai }, task, 'Del agentene i to og legg til ulvene');
    expect(ai.directSeen).toEqual([true]);
    expect(r.change_set_id).toBeTruthy();
    const names = () => Object.values(store.getTables().miniature_subject).filter((s) => !s.deleted_at).map((s) => s.name);
    expect(names()).toEqual(expect.arrayContaining(['Agenter – Rød', 'Agenter – Blå', 'Tåkeulv']));
    expect(names()).not.toContain('Agenter');
    const cs = store.getTables().agent_change_set[r.change_set_id!]!;
    expect(cs.summary).toHaveLength(2);

    await research.undoChangeSet(cs.id);
    expect(names()).toContain('Agenter');
    expect(names()).not.toContain('Tåkeulv');
    expect(names()).not.toContain('Agenter – Rød');
    expect(store.getTables().agent_change_set[cs.id]!.undone_at).toBeTruthy();
    expect(Object.values(store.getTables().change_record).some((c) => c.action === 'undo')).toBe(true);
    void subject;
  });

  it('angre nektes hvis brukeren har endret noe agenten laget', async () => {
    const { store, research, agent, cmd, task } = await setup();
    const ai = fakeAi(() => [{ type: 'catalog_subject', payload: { name: 'Tåkeulv', grouping: 'group', physical_count: 4 } }]);
    const r = await runAgentTurn({ store, research, agent, ai }, task, 'Legg til ulvene');
    const wolf = Object.values(store.getTables().miniature_subject).find((s) => s.name === 'Tåkeulv')!;
    await cmd.updateSubject(wolf.id, { name: 'Tåkeulver' });
    await expect(research.undoChangeSet(r.change_set_id!)).rejects.toThrow(/miniatyrer er endret/);
    expect(Object.values(store.getTables().miniature_subject).find((s) => s.id === wolf.id)!.name).toBe('Tåkeulver');
  });

  it('bildeutvalg og planer med ukjente malinger venter på brukeren', async () => {
    const { store, research, agent, task } = await setup();
    const ai = fakeAi((refs) => [
      { type: 'paint_plan', payload: { subject: refs['The Ancient One'], elements: [{ name: 'Hud', steps: [{ instruction: 'x', materials: [{ product: { manufacturer: 'X', name: 'Finnes ikke' }, role: 'base' }] }] }] } },
      { type: 'reference_selection', payload: { subject: refs['Merlin'], images: [{ image_url: 'https://a.example/1.jpg', page_url: 'https://a.example/' }] } },
      { type: 'paint_plan', payload: { subject: refs['Druid Mistwalker'], elements: [{ name: 'Kappe', steps: [{ instruction: 'Base', materials: [{ product: { manufacturer: 'Citadel', name: 'Caliban Green' }, role: 'base' }] }] }] } },
    ]);
    const r = await runAgentTurn({ store, research, agent, ai }, task, 'Lag planer og finn bilder');
    const props = Object.values(store.getTables().research_proposal).filter((p) => p.task_id === task);
    expect(props.filter((p) => p.decision === 'pending').map((p) => p.result_type).sort()).toEqual(['paint_plan', 'reference_selection']);
    expect(props.filter((p) => p.decision === 'approved')).toHaveLength(1);
    expect(store.getTables().agent_change_set[r.change_set_id!]!.summary).toEqual(['Maleplan for Druid Mistwalker']);
    expect(Object.values(store.getTables().research_message).some((m) => m.role === 'system' && /Venter på deg/.test(m.body))).toBe(true);
  });

  it('fokuserte runder (maleplan, bildejakt) tas ikke i bruk automatisk', async () => {
    const { store, research, agent, task } = await setup();
    const ref = Object.entries(buildAgentContext(store.getTables(), task).subjectRefs).find(([, id]) => store.getTables().miniature_subject[id]!.name === 'Druid Mistwalker')![0];
    const ai = fakeAi(() => [{ type: 'paint_plan', payload: { subject: ref, elements: [{ name: 'Kappe', steps: [{ instruction: 'Base', materials: [{ product: { manufacturer: 'Citadel', name: 'Caliban Green' }, role: 'base' }] }] }] } }]);
    const r = await runAgentTurn({ store, research, agent, ai }, task, 'Lag maleplan', () => {}, undefined,
      { kind: 'plan', subject_ref: ref, subject_name: 'Druid Mistwalker', game: 'Avalon', reference_images: [], revision: false });
    expect(r.change_set_id).toBeNull();
    expect(Object.values(store.getTables().research_proposal).filter((p) => p.task_id === task && p.decision === 'pending')).toHaveLength(1);
  });
});
