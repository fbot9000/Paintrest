/**
 * Shared writes for web images on a miniature, used both when the user
 * approves an agent proposal and when the user picks images from a known
 * source directly. A page becomes one `source`; each image one
 * `source_asset` (locator = original image address); the miniature gets one
 * `visual_reference` link per source, limited to the chosen assets.
 * Sources, assets and links that already exist are reused, not duplicated.
 */
import { CommandError } from '../domain/commands';
import { newId, now } from '../domain/ids';
import type { ImageKind, ReferenceImage, SourceRead } from '../domain/agent';
import type { Id, Tables } from '../domain/types';
import type { Store } from './store';

export type Downloaded = Record<string, { file_id: Id; media_type: string; byte_size: number }>;
type Log = (target_type: string, target_id: Id, action: 'create' | 'attach') => void;

/** An image already stored from the same address (any source, not deleted). */
export function storedAsset(t: Tables, image_url: string) {
  return Object.values(t.source_asset).find((a) => !a.deleted_at && a.locator === image_url && a.file_id && !t.stored_file[a.file_id]?.deleted_at);
}

/**
 * Downloads images that are not stored yet. Runs before the transaction so the
 * transaction stays synchronous. A failed download stops everything and names
 * the image, so the user can deselect it.
 */
export async function downloadImages(store: Store, fetchImage: ((url: string) => Promise<Blob>) | undefined, images: { image_url: string; caption: string | null; thumbnail_url?: string | null }[]): Promise<Downloaded> {
  const t = store.getTables();
  const todo = images.filter((i) => !storedAsset(t, i.image_url));
  if (todo.length && !fetchImage) throw new CommandError('Bildene kan ikke hentes uten Paintrest-serveren');
  const out: Downloaded = {};
  const failed: string[] = [];
  for (const img of todo) {
    try {
      // The original site may refuse; the image search's small copy is better than nothing.
      const blob = await fetchImage!(img.image_url).catch((err) => {
        if (img.thumbnail_url) return fetchImage!(img.thumbnail_url);
        throw err;
      });
      const file_id = newId();
      await store.persistence.putBlob(file_id, blob);
      out[img.image_url] = { file_id, media_type: blob.type, byte_size: blob.size };
    } catch (e) {
      failed.push(`${img.caption ?? img.image_url} (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  if (failed.length) {
    await Promise.all(Object.values(out).map((f) => store.persistence.deleteBlob(f.file_id)));
    throw new CommandError(`Kunne ikke hente ${failed.length} bilde(r): ${failed.join('; ')}. Fjern haken og prøv igjen.`);
  }
  return out;
}

/** Reuses a source with the same URL (and keeps it), otherwise creates one with retention kept. */
export function sourceFor(t: Tables, ws: Id, ref: { url: string; title: string; creator: string | null; kind: 'gallery' | 'article' | 'video' }, task_id: Id | null, log: Log): Id {
  const existing = Object.values(t.source).find((x) => !x.deleted_at && x.url === ref.url);
  if (existing) {
    existing.retention = 'kept';
    return existing.id;
  }
  const id = newId();
  t.source[id] = {
    id, workspace_id: ws, kind: ref.kind, title: ref.title, creator: ref.creator, url: ref.url, locator: null,
    analysis_state: 'stored', retention: 'kept', created_by_task_id: task_id, created_at: now(), deleted_at: null,
  };
  log('source', id, 'create');
  return id;
}

/** Attaches the images to the miniature. Returns the asset id for each image address. */
export function attachImages(t: Tables, ws: Id, subject_id: Id, images: ReferenceImage[], files: Downloaded, task_id: Id | null, log: Log): Record<string, Id> {
  const s = t.miniature_subject[subject_id];
  if (!s || s.deleted_at) throw new CommandError('Miniatyren finnes ikke');
  return attachImagesTo(t, ws, { type: 'subject', id: subject_id }, images, files, task_id, log);
}

/**
 * The same for any target: a miniature, or a technique or recipe in the library (bit 7).
 * One visual_reference link per page, limited to the chosen images.
 */
export function attachImagesTo(t: Tables, ws: Id, target: { type: 'subject' | 'technique' | 'recipe'; id: Id }, images: ReferenceImage[], files: Downloaded, task_id: Id | null, log: Log): Record<string, Id> {
  const subject_id = target.id;
  const byPage = new Map<string, ReferenceImage[]>();
  for (const img of images) byPage.set(img.page_url, [...(byPage.get(img.page_url) ?? []), img]);
  const assetByUrl: Record<string, Id> = {};

  for (const [page_url, imgs] of byPage) {
    const first = imgs[0]!;
    const source_id = sourceFor(t, ws, { url: page_url, title: first.page_title, creator: first.creator ?? first.site, kind: 'gallery' }, task_id, log);
    let link = Object.values(t.source_link).find(
      (l) => !l.deleted_at && l.source_id === source_id && l.target_type === target.type && l.target_id === subject_id && l.use === 'visual_reference',
    );
    if (!link) {
      const id = newId();
      link = { id, source_id, target_type: target.type, target_id: subject_id, use: 'visual_reference', layer_id: null, deleted_at: null };
      t.source_link[id] = link;
      log('source_link', id, 'attach');
    }
    let pos = Object.values(t.source_asset).filter((a) => a.source_id === source_id).length;
    for (const img of imgs) {
      let asset = Object.values(t.source_asset).find((a) => !a.deleted_at && a.source_id === source_id && a.locator === img.image_url);
      if (!asset) {
        const reuse = storedAsset(t, img.image_url);
        const f = files[img.image_url];
        let file_id = reuse?.file_id ?? null;
        if (!file_id && f) {
          t.stored_file[f.file_id] = {
            id: f.file_id, workspace_id: ws, purpose: 'source_asset', storage_key: f.file_id,
            media_type: f.media_type, byte_size: f.byte_size, created_at: now(), deleted_at: null,
          };
          file_id = f.file_id;
        }
        if (!file_id) throw new CommandError(`Bildet ${img.image_url} er ikke hentet`);
        const id = newId();
        asset = { id, source_id, position: pos++, locator: img.image_url, caption: img.caption, file_id, deleted_at: null, image_kind: img.kind ?? null };
        t.source_asset[id] = asset;
      }
      if (!t.source_link_asset.some((x) => x.link_id === link!.id && x.source_asset_id === asset!.id)) {
        t.source_link_asset.push({ link_id: link.id, source_asset_id: asset.id });
      }
      assetByUrl[img.image_url] = asset.id;
    }
  }
  return assetByUrl;
}

export const IMAGE_KIND_LABEL: Record<ImageKind, string> = {
  concept_art: 'Konseptillustrasjon',
  official: 'Offisielt bilde',
  painted: 'Malt eksempel',
  other: 'Annet',
};

/**
 * Makes an image the miniature's illustration. The previous illustration stays
 * on the miniature as a reference image, so choosing a new one never hides an
 * image the user had.
 */
export function setCover(t: Tables, subject_id: Id, asset_id: Id | null, log: Log): void {
  const s = t.miniature_subject[subject_id];
  if (!s) throw new CommandError('Miniatyren finnes ikke');
  const prev = s.official_asset_id;
  if (prev && prev !== asset_id && t.source_asset[prev] && !t.source_asset[prev]!.deleted_at) {
    const source_id = t.source_asset[prev]!.source_id;
    let link = Object.values(t.source_link).find(
      (l) => !l.deleted_at && l.source_id === source_id && l.target_type === 'subject' && l.target_id === subject_id && l.use === 'visual_reference',
    );
    if (!link) {
      const id = newId();
      link = { id, source_id, target_type: 'subject', target_id: subject_id, use: 'visual_reference', layer_id: null, deleted_at: null };
      t.source_link[id] = link;
      log('source_link', id, 'attach');
    }
    if (!t.source_link_asset.some((x) => x.link_id === link!.id && x.source_asset_id === prev)) {
      t.source_link_asset.push({ link_id: link.id, source_asset_id: prev });
    }
  }
  s.official_asset_id = asset_id;
}

/**
 * Stores what the agent read on a kept page: the original excerpt and the
 * Norwegian summary as source layers (datamodell v3 §11 SourceLayer).
 * Only for sources that exist; a layer with the same text is not added twice.
 */
export function addSourceLayers(t: Tables, read: SourceRead[], project_id?: Id): void {
  for (const r of read) {
    const source = Object.values(t.source).find((x) => !x.deleted_at && x.url === r.url);
    if (!source) continue;
    // Never write to a source that belongs to another game (see sourceBelongsTo).
    if (project_id && !sourceBelongsTo(t, source.id, project_id)) continue;
    const add = (layer: 'original' | 'translation', language: string | null, body: string | null) => {
      if (!body?.trim()) return;
      if (Object.values(t.source_layer).some((l) => l.source_id === source.id && l.layer === layer && l.body === body)) return;
      const id = newId();
      t.source_layer[id] = { id, source_id: source.id, layer, language, body, deleted_at: null };
    };
    add('original', r.language, r.original_excerpt);
    add('translation', 'nb', r.summary);
  }
}

/**
 * True when the source was found in this project's tasks or is linked to this
 * project or its miniatures. Sources of unrelated games are left untouched.
 */
export function sourceBelongsTo(t: Tables, source_id: Id, project_id: Id): boolean {
  const s = t.source[source_id];
  if (!s) return false;
  if (s.created_by_task_id && t.task_scope[s.created_by_task_id]?.work_project_id === project_id) return true;
  return Object.values(t.source_link).some((l) => !l.deleted_at && l.source_id === source_id && (
    (l.target_type === 'project' && l.target_id === project_id)
    || (l.target_type === 'subject' && t.miniature_subject[l.target_id]?.project_id === project_id)));
}
