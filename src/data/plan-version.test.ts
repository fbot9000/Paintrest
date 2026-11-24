import { describe, expect, it } from 'vitest';
import type { NormalisedProposal, PaintPlanPayload } from '../domain/agent';
import { bakeDeviation, matchVersion, openDeviations, payloadFromVersion, versionElements } from '../domain/plan-versions';
import { paintingView } from '../domain/views';
import { createLocalCommands } from './local-commands';
import { memoryPersistence } from './persistence';
import { createAgentCommands, createResearchCommands } from './research-commands';
import { buildSampleData } from './seed';
import { Store } from './store';

async function setup() {
  const p = memoryPersistence();
  const store = new Store(await buildSampleData(p, { examplePaints: true }), p);
  const t0 = store.getTables();
  const project = Object.values(t0.project).find((x) => t0.game[x.game_id]!.primary_name.startsWith('Avalon'))!;
  const research = createResearchCommands(store);
  const agent = createAgentCommands(store);
  const cmd = createLocalCommands(store);
  const subject = (name: string) => Object.values(store.getTables().miniature_subject).find((s) => s.name === name)!;
  const product = (name: string) => Object.values(store.getTables().paint_product).find((x) => x.name === name)!;
  return { store, research, agent, cmd, project, subject, product };
}

/** Merlin with a tick on «Hud», a swap on the first step of «Kappe og fjær», and a note on «Stav». */
async function merlinWithWork() {
  const env = await setup();
  const { store, cmd, subject, product } = env;
  const merlin = subject('Merlin');
  const v1 = merlin.current_plan_version_id!;
  const els = versionElements(store.getTables(), v1);
  const el = (name: string) => els.find((e) => e.name === name)!;
  const firstStep = (id: string) => Object.values(store.getTables().plan_step).filter((s) => s.element_id === id).sort((a, b) => a.position - b.position)[0]!;
  const cloak = el('Kappe og fjær');
  const cloakStep = firstStep(cloak.id);
  const from = store.getTables().step_material[Object.keys(store.getTables().step_material).find((k) => store.getTables().step_material[k]!.step_id === cloakStep.id)!]!.product_id;
  const to = product('Nuln Oil').id;
  await cmd.setPartDone(merlin.id, el('Hud').id, true);
  const swap = await cmd.addDeviation(v1, { element_id: cloak.id, step_id: cloakStep.id, kind: 'swap_product', payload: { from_product_id: from, to_product_id: to } });
  const note = await cmd.addDeviation(v1, { element_id: el('Stav').id, step_id: null, kind: 'note', payload: { text: 'Tynnere lag' } });
  return { ...env, merlin, v1, swap, note, from, to, el };
}

describe('rediger en godkjent maleplan (O-1)', () => {
  it('lager en ny versjon, og den forrige blir superseded uten å endres', async () => {
    const { store, cmd, merlin, v1 } = await merlinWithWork();
    const before = structuredClone(payloadFromVersion(store.getTables(), v1));
    const payload = payloadFromVersion(store.getTables(), v1);
    payload.elements[1]!.steps[0]!.instruction = 'Ny instruks';
    const v2 = await cmd.savePlanVersion(merlin.id, { base_version_id: v1, payload, baked_deviation_ids: [] });
    const t = store.getTables();
    expect(t.paint_plan_version[v1]!.state).toBe('superseded');
    expect(t.paint_plan_version[v2]).toMatchObject({ state: 'approved', origin: 'user', version_number: 2, supersedes_id: v1 });
    expect(t.miniature_subject[merlin.id]!.current_plan_version_id).toBe(v2);
    expect(payloadFromVersion(t, v1)).toEqual(before);
    expect(Object.values(t.change_record).some((r) => r.action === 'new_version' && r.to_version_id === v2 && r.initiated_by === 'user')).toBe(true);
  });

  it('tar med åpne avvik og avkrysninger, og baker inn de du velger', async () => {
    const { store, cmd, merlin, v1, swap, note, to } = await merlinWithWork();
    const t0 = store.getTables();
    let payload = payloadFromVersion(t0, v1);
    const baked = bakeDeviation(t0, v1, payload, t0.local_deviation[swap]!);
    expect(baked.applied).toBe(true);
    payload = baked.payload;
    const v2 = await cmd.savePlanVersion(merlin.id, { base_version_id: v1, payload, baked_deviation_ids: [swap] });
    const t = store.getTables();
    // The swap is now part of the plan, and closed on v1.
    expect(t.local_deviation[swap]).toMatchObject({ closed_as: 'baked', closed_in_version_id: v2, plan_version_id: v1 });
    const cloak = paintingView(t, merlin.id)!.elements.find((e) => e.element.name === 'Kappe og fjær')!;
    expect(cloak.steps[0]!.materials.some((m) => m.product.id === to)).toBe(true);
    // The note follows to the same part in v2.
    const view = paintingView(t, merlin.id)!;
    expect(view.open_deviations).toHaveLength(1);
    expect(view.open_deviations[0]).toMatchObject({ carried_from_id: note, kind: 'note' });
    expect(view.elements.find((e) => e.element.name === 'Stav')!.deviations).toHaveLength(1);
    expect(t.local_deviation[note]).toMatchObject({ closed_as: 'carried', plan_version_id: v1 });
    // The tick follows.
    expect(view.elements.find((e) => e.element.name === 'Hud')!.done).toBe(true);
  });

  it('kjenner igjen en omdøpt del når den er redigert fra den gamle', async () => {
    const { store, cmd, merlin, v1 } = await merlinWithWork();
    const payload = payloadFromVersion(store.getTables(), v1);
    const hud = payload.elements.find((e) => e.name === 'Hud')!;
    hud.name = 'Ansikt og hender';
    await cmd.savePlanVersion(merlin.id, { base_version_id: v1, payload, baked_deviation_ids: [] });
    const view = paintingView(store.getTables(), merlin.id)!;
    expect(view.elements.find((e) => e.element.name === 'Ansikt og hender')!.done).toBe(true);
  });

  it('et avvik på en del som er fjernet, følger med for hele planen', async () => {
    const { store, cmd, merlin, v1 } = await merlinWithWork();
    const payload = payloadFromVersion(store.getTables(), v1);
    payload.elements = payload.elements.filter((e) => e.name !== 'Stav');
    await cmd.savePlanVersion(merlin.id, { base_version_id: v1, payload, baked_deviation_ids: [] });
    const view = paintingView(store.getTables(), merlin.id)!;
    const notes = view.open_deviations.filter((d) => d.kind === 'note');
    expect(notes).toHaveLength(1);
    expect(notes[0]!.element_id).toBeNull();
  });

  it('stopper når en nyere versjon er godkjent i mellomtiden', async () => {
    const { store, cmd, merlin, v1 } = await merlinWithWork();
    const payload = payloadFromVersion(store.getTables(), v1);
    await cmd.savePlanVersion(merlin.id, { base_version_id: v1, payload, baked_deviation_ids: [] });
    await expect(cmd.savePlanVersion(merlin.id, { base_version_id: v1, payload, baked_deviation_ids: [] })).rejects.toThrow(/ny versjon/);
  });

  it('forseglede avvik og ferdigstillinger er urørt', async () => {
    const { store, cmd, subject, product } = await setup();
    const druids = Object.values(store.getTables().miniature_subject).find((s) => s.grouping === 'group' && s.current_plan_version_id)!;
    const v1 = druids.current_plan_version_id!;
    const el = versionElements(store.getTables(), v1)[0]!;
    await cmd.setGroupProgress(druids.id, el.id, 2);
    await cmd.addDeviation(v1, { element_id: el.id, step_id: null, kind: 'note', payload: { text: 'Forseglet' } });
    const completion = await cmd.markFinished(druids.id, 1);
    const sealedBefore = structuredClone(Object.values(store.getTables().local_deviation).filter((d) => d.sealed_at));
    const completionBefore = structuredClone(store.getTables().paint_completion[completion]);
    await cmd.savePlanVersion(druids.id, { base_version_id: v1, payload: payloadFromVersion(store.getTables(), v1), baked_deviation_ids: [] });
    const t = store.getTables();
    expect(Object.values(t.local_deviation).filter((d) => d.sealed_at)).toEqual(sealedBefore);
    expect(t.paint_completion[completion]).toEqual(completionBefore);
    // The group count follows; the sealed note does not.
    const view = paintingView(t, druids.id)!;
    expect(view.elements[0]!.group_count).toBe(2);
    expect(view.open_deviations).toHaveLength(0);
    void subject; void product;
  });

  it('du kan skrive den første planen selv', async () => {
    const { store, cmd, subject, product } = await setup();
    const s = subject('The Ancient One');
    expect(s.current_plan_version_id).toBeNull();
    const p = product('Nuln Oil');
    const payload: PaintPlanPayload = { subject_id: s.id, note: null, elements: [
      { kind: 'part', name: 'Kropp', steps: [{ instruction: 'Wash', materials: [{ product: { manufacturer: p.manufacturer, range: p.range_name, name: p.name, product_id: p.id }, role: 'wash', role_label: null }], mix: null }] },
      { kind: 'part', name: 'Tom', steps: [{ instruction: '  ', materials: [], mix: null }] },
    ] };
    const v1 = await cmd.savePlanVersion(s.id, { base_version_id: null, payload, baked_deviation_ids: [] });
    const t = store.getTables();
    expect(t.paint_plan_version[v1]).toMatchObject({ version_number: 1, origin: 'user', state: 'approved' });
    expect(versionElements(t, v1).map((e) => e.name)).toEqual(['Kropp']);
  });
});

describe('agentens nye versjon (O-1)', () => {
  const revision = (subject_id: string, names: string[], paint = 'Nuln Oil'): NormalisedProposal => ({
    result_type: 'paint_plan', update_of: null, evidence: 'synthesized', uncertainty: [],
    payload: {
      subject_id, note: null,
      elements: names.map((name) => ({ kind: 'part' as const, name, steps: [{ instruction: `Mal ${name}`, materials: [{ product: { manufacturer: 'Citadel', range: null, name: paint }, role: 'base' as const, role_label: null }], mix: null }] })),
    } satisfies PaintPlanPayload,
  });

  it('blir et forslag når planen har åpne avvik, og tar med fremdrift og avvik ved godkjenning', async () => {
    const { store, agent, research, project, merlin, v1, swap, note } = await merlinWithWork();
    const task = await research.startTask(project.id);
    const w = agent.writeProposal(task, revision(merlin.id, ['hud', 'Stav', 'Kappe og fjær']), 'uib', 'm');
    if (!w.ok) throw new Error(w.reason);
    const r = await research.applyAgentChanges(task, [w.id]);
    expect(r.applied).toHaveLength(0);
    expect(r.kept_as_proposal[0]!.reason).toMatch(/2 åpne avvik/);
    expect(store.getTables().miniature_subject[merlin.id]!.current_plan_version_id).toBe(v1);

    await research.approveProposal(w.id, { baked_deviation_ids: [note] });
    const t = store.getTables();
    const view = paintingView(t, merlin.id)!;
    expect(view.plan!.origin).toBe('proposal');
    // «hud» is the same part as «Hud» (case ignored), so the tick follows.
    expect(view.elements.find((e) => e.element.name === 'hud')!.done).toBe(true);
    // The swap's step was rewritten, so it follows on the part, not the step.
    expect(view.open_deviations).toHaveLength(1);
    expect(view.open_deviations[0]).toMatchObject({ carried_from_id: swap, step_id: null });
    expect(view.elements.find((e) => e.element.name === 'Kappe og fjær')!.deviations).toHaveLength(1);
    expect(t.local_deviation[note]!.closed_as).toBe('baked');
  });

  it('uten åpne avvik brukes den direkte, og fremdriften følger med', async () => {
    const { store, agent, research, project, cmd, subject } = await setup();
    const merlin = subject('Merlin');
    const hud = versionElements(store.getTables(), merlin.current_plan_version_id!).find((e) => e.name === 'Hud')!;
    await cmd.setPartDone(merlin.id, hud.id, true);
    const task = await research.startTask(project.id);
    const w = agent.writeProposal(task, revision(merlin.id, ['Hud']), 'uib', 'm');
    if (!w.ok) throw new Error(w.reason);
    const r = await research.applyAgentChanges(task, [w.id]);
    expect(r.applied).toEqual([w.id]);
    expect(paintingView(store.getTables(), merlin.id)!.elements[0]!.done).toBe(true);
  });
});

describe('kobling mellom versjoner', () => {
  it('kobler ikke steg på plass alene', async () => {
    const { store, subject } = await setup();
    const v1 = subject('Merlin').current_plan_version_id!;
    const t = store.getTables();
    const payload = payloadFromVersion(t, v1);
    for (const e of payload.elements) for (const s of e.steps) { s.from_step_id = null; s.instruction += ' (endret)'; }
    for (const e of payload.elements) e.from_element_id = null;
    const m = matchVersion(t, v1, payload);
    expect(m.elements.every(Boolean)).toBe(true);
    expect(m.steps.flat().every((x) => x === null)).toBe(true);
    expect(openDeviations(t, v1)).toHaveLength(0);
  });
});

describe('«Planen virker ikke» (O-13)', () => {
  it('forslaget er en ny versjon av akkurat denne planen, og gjeldende versjon står til du godkjenner', async () => {
    const { store, cmd, agent, research, project, subject, product } = await setup();
    const merlin = subject('Merlin');
    const v1 = merlin.current_plan_version_id!;
    const completion = await cmd.markFinished(merlin.id, 1);
    // As startPlan does with a problem: the miniature's own plan task, with the plan opened as revision target.
    const task = await research.startTask(project.id, { subject_id: merlin.id, kind: 'plan' });
    await research.openRevisionTarget(task, merlin.id);
    const p = product('Nuln Oil');
    const w = agent.writeProposal(task, { result_type: 'paint_plan', update_of: null, evidence: 'synthesized', uncertainty: [], payload: {
      subject_id: merlin.id, note: null, summary: 'Tynnere wash på kappen',
      elements: [{ kind: 'part', name: 'Kappe og fjær', steps: [{ instruction: 'Tynn wash', materials: [{ product: { manufacturer: p.manufacturer, range: null, name: p.name }, role: 'wash', role_label: null }], mix: null }] }],
    } satisfies PaintPlanPayload }, 'uib', 'm');
    if (!w.ok) throw new Error(w.reason);
    // Only this miniature's plan: a plan for another miniature in the same task is refused.
    const other = agent.writeProposal(task, { result_type: 'paint_plan', update_of: null, evidence: 'synthesized', uncertainty: [],
      payload: { subject_id: subject('Druid Champions').id, note: null, elements: [{ kind: 'part', name: 'X', steps: [{ instruction: 'Y', materials: [], mix: null }] }] } satisfies PaintPlanPayload }, 'uib', 'm');
    expect(!other.ok && other.reason).toMatch(/bare maleplanen for «Merlin»/);
    const t0 = store.getTables();
    expect(t0.research_proposal[w.id]).toMatchObject({ result_type: 'plan_revision', base_version_id: v1, decision: 'pending' });
    expect(t0.miniature_subject[merlin.id]!.current_plan_version_id).toBe(v1);
    const before = structuredClone(t0.paint_completion[completion]);
    await research.approveProposal(w.id);
    const t = store.getTables();
    expect(t.paint_plan_version[v1]!.state).toBe('superseded');
    expect(t.paint_completion[completion]).toEqual(before);
  });
});
