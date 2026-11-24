/**
 * Product pictures (O-15, brukerbeslutning 24.11.2026): the agent finds pictures of a paint at
 * the maker or a shop, and the user picks one. The run lives in the shared registry; nothing is
 * stored before the user presses «Bruk bildet» (applyProductImage).
 */
import type { useApp } from '../../app/context';
import { runs } from '../../app/runs';
import type { Run } from '../../app/runs';
import type { PaintImage } from '../../domain/ai';
import { paintLabel } from '../../domain/paints';
import type { PaintProduct } from '../../domain/types';

type App = ReturnType<typeof useApp>;

export function startProductImageSearch(app: App, p: PaintProduct) {
  runs.start(p.id, 'paintimage', async (onEvent, signal) => {
    const prompt = `Finn et produktbilde av malingen «${paintLabel(p)}»${p.product_code ? ` (${p.product_code})` : ''}, `
      + 'hos produsenten eller en nettbutikk. Jeg velger selv hvilket bilde som lagres.';
    await app.ai.runAgent({
      context: {},
      messages: [{ role: 'user', content: prompt }],
      result_types: [],
      focus: { kind: 'paint_image', maker: p.manufacturer, range: p.range_name, name: p.name, code: p.product_code ?? null, paint_kind: p.product_kind },
    }, onEvent, signal);
  }, { label: `Produktbilde av ${p.name}`, href: '/malinger' });
}

/** The checked answer of a finished search, if it gave one. */
export function productImageResult(run: Run | null): { message: string; images: PaintImage[]; uncertainty: string | null; warnings: string[]; model: string } | null {
  const final = run ? [...run.events].reverse().find((e) => e.type === 'final') : undefined;
  if (!final || final.type !== 'final') return null;
  return { message: final.message, images: final.paint_images?.images ?? [], uncertainty: final.paint_images?.uncertainty ?? null, warnings: final.warnings, model: final.model };
}

/** Fetches the chosen picture through the server (the search's small copy if the site refuses) and stores it with its source. */
export async function applyProductImage(app: App, p: PaintProduct, img: PaintImage): Promise<void> {
  let blob: Blob;
  try {
    blob = await app.ai.fetchImage(img.image_url).catch((err) => {
      if (img.thumbnail_url) return app.ai.fetchImage(img.thumbnail_url);
      throw err;
    });
  } catch (e) {
    throw new Error(`Bildet kunne ikke hentes (${e instanceof Error ? e.message : String(e)}). Velg et annet bilde, eller last det opp selv.`);
  }
  if (!blob.type.startsWith('image/')) throw new Error('Adressen ga ikke et bilde. Velg et annet bilde.');
  await app.cmd.setProductImage(p.id, blob, { image_url: img.image_url, page_url: img.page_url, page_title: img.page_title });
}
