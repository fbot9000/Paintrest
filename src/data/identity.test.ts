/**
 * Image hunt in three phases (brukerønske 11.11.2026): the identification is kept on the
 * miniature, the user confirms or rejects it, and pages can be tagged «Viser figuren».
 */
import { describe, expect, it } from 'vitest';
import { buildAgentContext } from '../domain/agent';
import type { AgentTurnInput, AiGateway, ResearchEvent } from '../domain/ai';
import type { SubjectIdentity } from '../domain/types';
import { linkedSources } from '../domain/views';
import { runAgentTurn } from './agent-runner';
import { createLocalCommands } from './local-commands';
import { memoryPersistence } from './persistence';
import { createAgentCommands, createResearchCommands } from './research-commands';
import { buildSampleData } from './seed';
import { Store } from './store';

async function setup() {
  const p = memoryPersistence();
  const store = new Store(await buildSampleData(p), p);
  const t0 = store.getTables();
  const project = Object.values(t0.project).find((x) => t0.game[x.game_id]!.primary_name.startsWith('Avalon'))!;
  const research = createResearchCommands(store);
  const agent = createAgentCommands(store);
  const cmd = createLocalCommands(store);
  const subject = Object.values(t0.miniature_subject).find((s) => s.project_id === project.id && s.name === 'Merlin')!;
  const task = await research.startTask(project.id, { subject_id: subject.id, kind: 'images' });
  const ref = Object.entries(buildAgentContext(store.getTables(), task).subjectRefs).find(([, id]) => id === subject.id)![0];
  return { store, research, agent, cmd, project, subject, task, ref };
}

const IDENTITY: SubjectIdentity = {
  official_name: 'Merlin, the Archmage', aliases: ['Merlin'], edition: 'Avalon grunnspill', faction: 'Druider',
  description: 'Gammel trollmann med stav og lang kappe', painter: 'Studio Nine', confidence: 'high', why: 'Utgiverens side',
  images: [{ image_url: 'https://pub.example/merlin-art.jpg', page_url: 'https://pub.example/merlin', page_title: 'Merlin', site: 'pub.example', kind: 'concept_art', thumbnail_url: null }],
  sources: [{ url: 'https://pub.example/merlin', title: 'Merlin' }],
};

/** A gateway whose hunt finds the given identity; it records what the run was given. */
function huntAi(identity: unknown) {
  const seen: AgentTurnInput[] = [];
  const ai = {
    async runAgent(input: AgentTurnInput, onEvent: (e: ResearchEvent) => void) {
      seen.push(input);
      const e = { type: 'final' as const, message: 'Ferdig', proposals: [], model: 'm', warnings: [], trace: [], pages: [], identity: identity as SubjectIdentity };
      onEvent(e);
      return e;
    },
  } as unknown as AiGateway;
  return { ai, seen };
}

describe('identifisering av figuren', () => {
  it('lagres på miniatyren som forslag, med beskjed, og run_id går videre til serveren', async () => {
    const { store, research, agent, subject, task, ref } = await setup();
    const { ai, seen } = huntAi(IDENTITY);
    await runAgentTurn({ store, research, agent, ai }, task, 'Finn bilder', () => {}, undefined,
      { kind: 'images', subject_ref: ref, subject_name: 'Merlin', game: 'Avalon' }, 'run-12345678');
    expect(seen[0]!.run_id).toBe('run-12345678');
    const s = store.getTables().miniature_subject[subject.id]!;
    expect(s.identity).toMatchObject({ status: 'proposed', official_name: 'Merlin, the Archmage', found_by_task_id: task, images: [{ kind: 'concept_art' }] });
    const t = store.getTables();
    expect(Object.values(t.research_message).some((m) => m.task_id === task && m.role === 'system' && m.body.includes('identifiserte figuren som «Merlin, the Archmage»'))).toBe(true);
    expect(Object.values(t.change_record).some((r) => r.target_id === subject.id && r.initiated_by === 'agent' && r.task_id === task)).toBe(true);
  });

  it('brukeren bekrefter; en bekreftet figur overskrives ikke av neste jakt', async () => {
    const { store, research, agent, cmd, subject, task, ref } = await setup();
    await runAgentTurn({ store, research, agent, ai: huntAi(IDENTITY).ai }, task, 'Finn', () => {}, undefined,
      { kind: 'images', subject_ref: ref, subject_name: 'Merlin', game: 'Avalon' });
    await cmd.confirmIdentity(subject.id);
    expect(store.getTables().miniature_subject[subject.id]!.identity!.status).toBe('confirmed');
    await runAgentTurn({ store, research, agent, ai: huntAi({ ...IDENTITY, official_name: 'Noe annet' }).ai }, task, 'Finn flere', () => {}, undefined,
      { kind: 'images', subject_ref: ref, subject_name: 'Merlin', game: 'Avalon' });
    expect(store.getTables().miniature_subject[subject.id]!.identity).toMatchObject({ status: 'confirmed', official_name: 'Merlin, the Archmage' });
    // The panel agent and the paint plan can read it.
    const m = (buildAgentContext(store.getTables(), task).data.miniatures as { ref: string; identity?: unknown }[]).find((x) => x.ref === ref)!;
    expect(m.identity).toMatchObject({ status: 'confirmed', official_name: 'Merlin, the Archmage', aliases: ['Merlin'] });
  });

  it('«Feil figur» fjerner den, og agenten får ikke lagre den samme igjen', async () => {
    const { store, research, agent, cmd, subject, task, ref } = await setup();
    await runAgentTurn({ store, research, agent, ai: huntAi(IDENTITY).ai }, task, 'Finn', () => {}, undefined,
      { kind: 'images', subject_ref: ref, subject_name: 'Merlin', game: 'Avalon' });
    await cmd.rejectIdentity(subject.id);
    const s = store.getTables().miniature_subject[subject.id]!;
    expect(s.identity).toBeNull();
    expect(s.identity_rejected).toEqual([{ official_name: 'Merlin, the Archmage', image_urls: ['https://pub.example/merlin-art.jpg'] }]);
    expect(agent.recordIdentity(task, subject.id, { ...IDENTITY, official_name: 'merlin, the archmage ' })).toBeNull();
    expect(agent.recordIdentity(task, subject.id, { ...IDENTITY, official_name: 'Annen' })).toBeNull();
    expect(agent.recordIdentity(task, subject.id, { ...IDENTITY, official_name: 'Merlin the Druid', images: [] })).toBe('Merlin the Druid');
  });

  it('agenten kan ikke identifisere en miniatyr i et annet prosjekt', async () => {
    const { store, agent, cmd, task } = await setup();
    const other = await cmd.createProject({ name: 'Annet spill' });
    const foreign = await cmd.createSubject(other.project_id, { name: 'Ridder' });
    expect(agent.recordIdentity(task, foreign, IDENTITY)).toBeNull();
    expect(store.getTables().miniature_subject[foreign]!.identity ?? null).toBeNull();
  });
});

describe('«Viser figuren» og maleguider', () => {
  it('merking lagrer siden som kilde med en lenke til miniatyren, og kan fjernes', async () => {
    const { store, agent, cmd, subject, task } = await setup();
    // A page the agent found earlier is a draft; tagging keeps it.
    agent.recordSources(task, [{ url: 'https://blog.example/merlin', title: 'Merlin painted', site: 'blog.example', author: null, language: 'en', image_count: 4 }], []);
    await cmd.tagSource(subject.id, { url: 'https://blog.example/merlin', title: 'Merlin painted' }, true);
    await cmd.tagSource(subject.id, { url: 'https://blog.example/merlin', title: 'Merlin painted' }, true);
    let t = store.getTables();
    const src = Object.values(t.source).filter((x) => x.url === 'https://blog.example/merlin');
    expect(src).toHaveLength(1);
    expect(src[0]!.retention).toBe('kept');
    expect(linkedSources(t, subject.id, 'evidence').map((x) => x.url)).toContain('https://blog.example/merlin');
    expect(Object.values(t.source_link).filter((l) => !l.deleted_at && l.source_id === src[0]!.id && l.use === 'evidence')).toHaveLength(1);
    await cmd.tagSource(subject.id, { url: 'https://blog.example/merlin', title: 'Merlin painted' }, false);
    t = store.getTables();
    expect(linkedSources(t, subject.id, 'evidence').map((x) => x.url)).not.toContain('https://blog.example/merlin');
    await expect(cmd.tagSource(subject.id, { url: 'javascript:alert(1)', title: 'x' }, true)).rejects.toThrow();
  });

  it('en maleguide lagres som metodekilde for miniatyren, én gang', async () => {
    const { store, cmd, subject } = await setup();
    await cmd.saveGuideSource(subject.id, { url: 'https://blog.example/how-to-paint-merlin', title: 'How to paint Merlin', site: 'blog.example' });
    await cmd.saveGuideSource(subject.id, { url: 'https://blog.example/how-to-paint-merlin', title: 'How to paint Merlin', site: 'blog.example' });
    const t = store.getTables();
    const guides = linkedSources(t, subject.id, 'method');
    expect(guides.map((x) => [x.url, x.kind])).toEqual([['https://blog.example/how-to-paint-merlin', 'guide']]);
    expect(Object.values(t.source_link).filter((l) => !l.deleted_at && l.source_id === guides[0]!.id && l.use === 'method')).toHaveLength(1);
  });
});
