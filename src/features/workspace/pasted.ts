/**
 * Image links the user pasted, per miniature, until they are saved or
 * removed. Kept outside the tab so switching tabs does not lose them.
 */
import { useSyncExternalStore } from 'react';
import type { ReferenceImage } from '../../domain/agent';
import type { Id } from '../../domain/types';

const bySubject = new Map<Id, ReferenceImage[]>();
const listeners = new Set<() => void>();
const EMPTY: ReferenceImage[] = [];
const notify = () => listeners.forEach((l) => l());

export function getPasted(subject_id: Id): ReferenceImage[] {
  return bySubject.get(subject_id) ?? EMPTY;
}

export function addPasted(subject_id: Id, images: ReferenceImage[]) {
  const cur = getPasted(subject_id);
  const fresh = images.filter((i) => !cur.some((c) => c.image_url === i.image_url));
  if (!fresh.length) return;
  bySubject.set(subject_id, [...cur, ...fresh]);
  notify();
}

export function removePasted(subject_id: Id, urls?: string[]) {
  const cur = getPasted(subject_id);
  const next = urls ? cur.filter((c) => !urls.includes(c.image_url)) : [];
  if (next.length === cur.length) return;
  if (next.length) bySubject.set(subject_id, next); else bySubject.delete(subject_id);
  notify();
}

export function usePasted(subject_id: Id): ReferenceImage[] {
  return useSyncExternalStore((fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => getPasted(subject_id));
}
