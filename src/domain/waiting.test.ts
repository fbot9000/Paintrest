import { describe, expect, it } from 'vitest';
import type { NormalisedProposal } from './agent';
import { createAgentCommands, createResearchCommands } from '../data/research-commands';
import { memoryPersistence } from '../data/persistence';
import { buildSampleData } from '../data/seed';
import { Store } from '../data/store';
import { projectWaiting, waitingCount } from './waiting';

async function setup() {
  const p = memoryPersistence();
  const store = new Store(await buildSampleData(p, { examplePaints: true }), p);
  const t0 = store.getTables();
  const project = Object.values(t0.project).find((x) => t0.game[x.game_id]!.primary_name.startsWith('Avalon'))!;
  const research = createResearchCommands(store, { fetchImage: async () => new Blob(['img'], { type: 'image/jpeg' }) });
  const agent = createAgentCommands(store);
  const subject = (name: string) => Object.values(store.getTables().miniature_subject).find((s) => s.name === name)!;
  return { store, research, agent, project, subject };
}

describe('«Venter på deg» i agentkolonnen (O-17)', () => {
  it('samler bildefunn, manglende miniatyrer og planforslag for hele prosjektet', async () => {
    const { store, research, agent, project, subject } = await setup();
    expect(waitingCount(projectWaiting(store.getTables(), project.id))).toBe(0);

    // The game survey: a picture for a miniature, and a miniature missing from the list.
    const survey = await research.startTask(project.id, 'game');
    const sel: NormalisedProposal = { result_type: 'reference_selection', update_of: null, evidence: 'documented', uncertainty: [],
      payload: { subject_id: subject('Druid Mistwalker').id, note: null, images: [
        { image_url: 'https://gallery.example/a.jpg', page_url: 'https://gallery.example/druids', page_title: 'Druids', site: 'gallery.example', creator: null, caption: null },
      ] } };
    const missing: NormalisedProposal = { result_type: 'catalog_subject', update_of: null, evidence: 'documented', uncertainty: [],
      payload: { name: 'Tåkeulv', grouping: 'group', physical_count: 4, expansion_name: null, category_label: null, count_basis: null, grouping_basis: null, note: null, sources: [] } };
    for (const x of [sel, missing]) { const w = agent.writeProposal(survey, x, 'uib', 'm'); if (!w.ok) throw new Error(w.reason); }

    // A plan from the workspace.
    const planTask = await research.startTask(project.id, { subject_id: subject('The Ancient One').id, kind: 'plan' });
    const w = agent.writeProposal(planTask, { result_type: 'paint_plan', update_of: null, evidence: 'synthesized', uncertainty: [],
      payload: { subject_id: subject('The Ancient One').id, note: null, elements: [{ kind: 'part', name: 'Kropp', steps: [{ instruction: 'Base', materials: [], mix: null }] }] } }, 'uib', 'm');
    if (!w.ok) throw new Error(w.reason);

    const waiting = projectWaiting(store.getTables(), project.id);
    expect(waiting.pool.map((x) => x.image.image_url)).toEqual(['https://gallery.example/a.jpg']);
    expect(waiting.queue.map((q) => q.name)).toContain('Druid Mistwalker');
    expect(waiting.missing.map((m) => m.c.name)).toEqual(['Tåkeulv']);
    expect(waiting.plans).toEqual([{ subject_id: subject('The Ancient One').id, name: 'The Ancient One', revision: false }]);
    expect(waitingCount(waiting)).toBe(3);

    // «Legg til» on the missing miniature, and the picture placed on its miniature: they no longer wait.
    await research.approveProposal(waiting.missing[0]!.p.id);
    await research.placeImages(subject('Druid Mistwalker').id, [waiting.pool[0]!.image]);
    const after = projectWaiting(store.getTables(), project.id);
    expect(after.missing).toHaveLength(0);
    expect(after.pool).toHaveLength(0);
    expect(subject('Tåkeulv')).toBeTruthy();
  });

  it('planforslag fra samtalen vises i samtalen, ikke to steder', async () => {
    const { store, research, agent, project, subject } = await setup();
    const panel = await research.startTask(project.id);
    const w = agent.writeProposal(panel, { result_type: 'paint_plan', update_of: null, evidence: 'synthesized', uncertainty: [],
      payload: { subject_id: subject('The Ancient One').id, note: null, elements: [{ kind: 'part', name: 'Kropp', steps: [{ instruction: 'Base', materials: [], mix: null }] }] } }, 'uib', 'm');
    if (!w.ok) throw new Error(w.reason);
    expect(projectWaiting(store.getTables(), project.id).plans).toHaveLength(0);
  });
});
