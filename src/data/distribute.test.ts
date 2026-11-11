/**
 * Fordel bildene (brukerønske 11.11.2026): all found pictures in one pool, put on miniatures picture by
 * picture. Proposals keep their other pictures, close by themselves when nothing is left, and everything
 * can be undone.
 */
import { describe, expect, it } from 'vitest';
import type { ReferenceImage } from '../domain/agent';
import { imagePool, reviewQueue } from '../domain/review';
import { createLocalCommands } from './local-commands';
import { memoryPersistence } from './persistence';
import { createAgentCommands, createResearchCommands } from './research-commands';
import { buildSampleData } from './seed';
import { Store } from './store';

const img = (n: string, confidence: 'high' | 'medium' | 'low' | null = null): ReferenceImage => ({
  image_url: `https://forum.example/${n}.jpg`, page_url: 'https://forum.example/avalon', page_title: 'Avalon painted', site: 'forum.example',
  creator: null, caption: n, kind: 'painted', confidence,
});

async function setup() {
  const p = memoryPersistence();
  const store = new Store(await buildSampleData(p), p);
  const t0 = store.getTables();
  const project = Object.values(t0.project).find((x) => t0.game[x.game_id]!.primary_name.startsWith('Avalon'))!;
  const fetchImage = async () => new Blob(['img'], { type: 'image/jpeg' });
  const research = createResearchCommands(store, { fetchImage });
  const agent = createAgentCommands(store);
  const cmd = createLocalCommands(store, { fetchImage });
  const subject = (name: string) => Object.values(store.getTables().miniature_subject).find((s) => s.project_id === project.id && s.name === name)!;
  const task = await research.startTask(project.id, 'game');
  const propose = (subject_id: string, images: ReferenceImage[], extra: Record<string, unknown> = {}) => {
    const w = agent.writeProposal(task, { result_type: 'reference_selection', update_of: null, evidence: 'documented', uncertainty: [],
      payload: { subject_id, note: null, images, ...extra } }, 'uib', 'm');
    if (!w.ok) throw new Error(w.reason);
    return w.id;
  };
  return { store, research, agent, cmd, project, subject, task, propose };
}

describe('funnene på ett sted', () => {
  it('viser hvert bilde én gang, med agentens gjetninger, det sikreste først', async () => {
    const { store, project, subject, propose } = await setup();
    const merlin = subject('Merlin');
    const druid = subject('Druid Mistwalker');
    propose(merlin.id, [img('group', 'medium'), img('merlin', 'high'), img('blurry', 'low')]);
    propose(druid.id, [img('group', 'high'), img('druid', 'medium')]);
    const pool = imagePool(store.getTables(), project.id);
    expect(pool.map((x) => x.image.caption)).toEqual(['group', 'merlin', 'druid', 'blurry']);
    const group = pool[0]!;
    expect(group.confidence).toBe('high');
    expect(group.guesses.map((g) => [g.name, g.confidence])).toEqual([['Druid Mistwalker', 'high'], ['Merlin', 'medium']]);
    expect(group.proposal_ids).toHaveLength(2);
  });
});

describe('legg på, forkast og angre', () => {
  it('legger bilder på en miniatyr uten å lukke forslaget, og lukker det når alt er brukt', async () => {
    const { store, research, cmd, project, subject, propose } = await setup();
    const druid = subject('Druid Mistwalker');
    const merlin = subject('Merlin');
    // A miniature without an illustration gets the first picture as one.
    await cmd.setSubjectCover(druid.id, null);
    const pid = propose(druid.id, [img('druid', 'high'), img('druid2', 'medium')]);
    const other = propose(merlin.id, [img('merlin', 'high')]);

    const assets = await research.placeImages(druid.id, [img('druid', 'high')], { auto_cover: true });
    let t = store.getTables();
    expect(t.miniature_subject[druid.id]!.official_asset_id).toBe(assets['https://forum.example/druid.jpg']);
    expect(t.research_proposal[pid]!.decision).toBe('pending');
    expect(imagePool(t, project.id).find((x) => x.image.caption === 'druid')!.placed_on).toEqual([druid.id]);
    expect(reviewQueue(t, project.id).find((q) => q.subject_id === druid.id)?.images).toBe(1);

    await research.placeImages(druid.id, [img('druid2')]);
    await research.placeImages(merlin.id, [img('merlin')]);
    t = store.getTables();
    expect(t.research_proposal[pid]).toMatchObject({ decision: 'approved', closed_by: 'images' });
    expect(t.research_proposal[other]).toMatchObject({ decision: 'approved', closed_by: 'images' });
    expect(imagePool(t, project.id).every((x) => x.placed_on.length > 0)).toBe(true);

    // Undo: the picture comes off, and its proposal opens again with it.
    const a = Object.values(t.source_asset).find((x) => x.locator === 'https://forum.example/merlin.jpg')!;
    await cmd.detachSubjectImage(merlin.id, a.id);
    await research.restoreImages(project.id, ['https://forum.example/merlin.jpg']);
    t = store.getTables();
    expect(t.research_proposal[other]).toMatchObject({ decision: 'pending', closed_by: null });
    expect(imagePool(t, project.id).filter((x) => !x.placed_on.length).map((x) => x.image.caption)).toEqual(['merlin']);
  });

  it('et gruppebilde regnes som brukt når det er lagt på én, og kan legges på flere', async () => {
    const { store, research, project, subject, propose } = await setup();
    const druid = subject('Druid Mistwalker');
    const merlin = subject('Merlin');
    const a = propose(druid.id, [img('group', 'high')]);
    const b = propose(merlin.id, [img('group', 'medium')]);
    await research.placeImages(druid.id, [img('group')]);
    let t = store.getTables();
    expect([t.research_proposal[a]!.decision, t.research_proposal[b]!.decision]).toEqual(['approved', 'approved']);
    // Used, but still on the board, with the other miniature the agent guessed.
    const group = imagePool(t, project.id);
    expect(group.map((x) => [x.image.caption, x.placed_on, x.guesses.map((g) => g.name)])).toEqual([['group', [druid.id], ['Druid Mistwalker', 'Merlin']]]);
    await research.placeImages(merlin.id, [img('group')]);
    t = store.getTables();
    expect(Object.values(t.source_link).filter((l) => !l.deleted_at && l.use === 'visual_reference' && [druid.id, merlin.id].includes(l.target_id)
      && t.source[l.source_id]!.url === 'https://forum.example/avalon').map((l) => l.target_id).sort()).toEqual([druid.id, merlin.id].sort());
  });

  it('forkaster enkeltbilder, lukker forslaget når alt er forkastet, og angrer', async () => {
    const { store, research, project, subject, propose } = await setup();
    const merlin = subject('Merlin');
    const pid = propose(merlin.id, [img('a', 'high'), img('b', 'low')]);
    const keep = propose(merlin.id, [img('c')], { videos: [{ url: 'https://www.youtube.com/watch?v=abcdefghijk', video_id: 'abcdefghijk', title: 'V', channel: null, thumbnail_url: null, why: null }] });

    await research.dismissImages(project.id, ['https://forum.example/a.jpg']);
    let t = store.getTables();
    expect(imagePool(t, project.id).map((x) => x.image.caption).sort()).toEqual(['b', 'c']);
    expect(t.research_proposal[pid]!.decision).toBe('pending');

    await research.dismissImages(project.id, ['https://forum.example/b.jpg', 'https://forum.example/c.jpg']);
    t = store.getTables();
    expect(t.research_proposal[pid]).toMatchObject({ decision: 'rejected', closed_by: 'images' });
    // A proposal with a video waits for it, even with no pictures left.
    expect(t.research_proposal[keep]!.decision).toBe('pending');
    expect(imagePool(t, project.id)).toEqual([]);
    expect(reviewQueue(t, project.id).some((q) => q.subject_id === merlin.id && q.images > 0)).toBe(false);

    await research.restoreImages(project.id, ['https://forum.example/b.jpg']);
    t = store.getTables();
    expect(t.research_proposal[pid]).toMatchObject({ decision: 'pending', closed_by: null });
    expect(imagePool(t, project.id).map((x) => x.image.caption)).toEqual(['b']);
  });

  it('et forslag brukeren selv har forkastet, åpnes ikke igjen', async () => {
    const { store, research, project, subject, propose } = await setup();
    const pid = propose(subject('Merlin').id, [img('a')]);
    await research.rejectProposal(pid);
    await research.restoreImages(project.id, ['https://forum.example/a.jpg']);
    expect(store.getTables().research_proposal[pid]!.decision).toBe('rejected');
  });
});
