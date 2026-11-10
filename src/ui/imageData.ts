import type { Commands } from '../domain/commands';
import type { Id, Tables } from '../domain/types';

/**
 * A stored image scaled to at most `max` px as a JPEG data URL, for sending to
 * the model. Vector placeholders and missing files give null.
 */
export async function imageDataUrl(tables: Tables, cmd: Commands, file_id: Id | null, max = 512): Promise<string | null> {
  if (!file_id) return null;
  const f = tables.stored_file[file_id];
  if (!f || !/^image\/(jpeg|png|webp|gif)/.test(f.media_type)) return null;
  try {
    const url = await cmd.getFileUrl(file_id);
    if (!url) return null;
    const bmp = await createImageBitmap(await (await fetch(url)).blob());
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch {
    return null;
  }
}
