/**
 * Dragging found pictures onto a miniature (O-17): from «Fordel bilder», from «Venter på deg» in
 * the agent column, onto a miniature card or the workspace. The pictures are saved through
 * placeImages, so the proposals keep their other pictures, and the drop can be undone.
 */
import { useState } from 'react';
import type { DragEvent } from 'react';
import type { useApp } from '../../app/context';
import { imagePool } from '../../domain/review';
import type { Id } from '../../domain/types';

export const DRAG_TYPE = 'application/x-paintrest-images';

type App = ReturnType<typeof useApp>;

export function dragImages(e: DragEvent, urls: string[]) {
  e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(urls));
  e.dataTransfer.effectAllowed = 'copy';
}

export function droppedImages(e: DragEvent): string[] {
  try { return JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as string[]; } catch { return []; }
}

/** Puts found pictures (by address) on a miniature. Returns how many, and how to undo it. */
export async function placeFound(app: App, project_id: Id, subject_id: Id, urls: string[]): Promise<{ count: number; undo: () => Promise<void> }> {
  const pool = new Map(imagePool(app.store.getTables(), project_id).map((x) => [x.image.image_url, x]));
  const images = urls.map((u) => pool.get(u)?.image).filter((x): x is NonNullable<typeof x> => !!x);
  if (!images.length) return { count: 0, undo: async () => {} };
  const assets = await app.research.placeImages(subject_id, images, { auto_cover: true });
  return {
    count: images.length,
    undo: async () => {
      for (const asset of Object.values(assets)) await app.cmd.detachSubjectImage(subject_id, asset);
      await app.research.restoreImages(project_id, images.map((x) => x.image_url));
    },
  };
}

/** Drop targets for found pictures: highlight while dragging over, place on drop, and an undo note. */
export function useImageDrop(app: App, project_id: Id, nameOf: (id: Id) => string) {
  const [over, setOver] = useState<Id | null>(null);
  const [note, setNote] = useState<{ text: string; undo: () => Promise<void> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dropOn = (id: Id) => ({
    onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(id); } },
    onDragLeave: () => setOver((cur) => (cur === id ? null : cur)),
    onDrop: (e: DragEvent) => {
      const urls = droppedImages(e);
      if (!urls.length) return;
      e.preventDefault();
      setOver(null);
      setError(null);
      placeFound(app, project_id, id, urls)
        .then((r) => r.count && setNote({ text: `La ${r.count} ${r.count === 1 ? 'bilde' : 'bilder'} på ${nameOf(id)}`, undo: r.undo }))
        .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
    },
  });
  return { over, dropOn, note, clearNote: () => setNote(null), error, clearError: () => setError(null) };
}
