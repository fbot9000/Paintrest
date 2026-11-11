/**
 * Which research task a run in a work project belongs to. The project's agent
 * panel has one conversation; the workspace has its own task per miniature and
 * kind of run (image hunt, paint plan), so runs that may go at the same time
 * never share a conversation.
 */
import type { Id, ResearchTask, SubjectFocus, Tables } from './types';

function newestOpen(t: Tables, keep: (task: ResearchTask) => boolean): ResearchTask | undefined {
  return Object.values(t.research_task)
    .filter((x) => x.status === 'open' && keep(x))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
}

/** The project's agent panel task: open, in the project, not a workspace task. */
export function panelTask(t: Tables, project_id: Id): ResearchTask | undefined {
  return newestOpen(t, (x) => {
    const scope = t.task_scope[x.id];
    return scope?.work_project_id === project_id && !scope.subject_focus;
  });
}

/** The workspace's own task for one miniature and kind of run, if one is open. */
export function subjectTask(t: Tables, focus: SubjectFocus): ResearchTask | undefined {
  return newestOpen(t, (x) => {
    const f = t.task_scope[x.id]?.subject_focus;
    return !!f && f.subject_id === focus.subject_id && f.kind === focus.kind;
  });
}
