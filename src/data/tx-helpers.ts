/** Helpers shared by the local command implementations. */
import { CommandError } from '../domain/commands';
import { newId, now } from '../domain/ids';
import type { ChangeAction, Id, Tables } from '../domain/types';

export type Rec = {
  target_type: string;
  target_id: Id;
  action: ChangeAction;
  from_version_id?: Id | null;
  to_version_id?: Id | null;
};

/** Writes one change_record with initiated_by = user. */
export function record(t: Tables, ws: Id, r: Rec): void {
  const id = newId();
  t.change_record[id] = {
    id,
    workspace_id: ws,
    target_type: r.target_type,
    target_id: r.target_id,
    from_version_id: r.from_version_id ?? null,
    to_version_id: r.to_version_id ?? null,
    action: r.action,
    initiated_by: 'user',
    task_id: null,
    proposal_id: null,
    created_at: now(),
  };
}

export function must<T>(row: T | undefined, what: string): T {
  if (!row) throw new CommandError(`${what} finnes ikke`);
  return row;
}
