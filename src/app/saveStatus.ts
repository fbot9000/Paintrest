/**
 * Where the data is saved and whether the last change made it there. Shown in
 * the top bar, so a failed or conflicting save is never silent.
 */
import { useSyncExternalStore } from 'react';

export interface SaveStatus {
  where: 'server' | 'browser' | 'memory';
  state: 'saved' | 'saving' | 'error' | 'conflict';
  data_dir: string | null;
  saved_at: string | null;
  message: string | null;
}

let status: SaveStatus = { where: 'browser', state: 'saved', data_dir: null, saved_at: null, message: null };
const listeners = new Set<() => void>();

export function setSaveStatus(patch: Partial<SaveStatus>) {
  status = { ...status, ...patch };
  listeners.forEach((l) => l());
}

export function getSaveStatus(): SaveStatus {
  return status;
}

export function useSaveStatus(): SaveStatus {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, () => status);
}
