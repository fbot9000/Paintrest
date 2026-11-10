/**
 * «look»: shows candidate images to the model (Responses API input_image with
 * data URLs fetched by Paintrest) and returns its written assessment. A known
 * picture of the miniature can go first as the reference.
 *
 * Image input is part of the OpenAI Responses API; whether UiB passes it on
 * for a given model is not confirmed. A rejected request becomes
 * VisionUnsupportedError so the agent continues without looking.
 */
import { UserError } from './credential-store.ts';
import { VisionUnsupportedError } from './provider.ts';
import type { ResponsesMessage, ResponsesProvider } from './provider.ts';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export async function lookAtImages(
  provider: ResponsesProvider,
  getImage: (url: string) => Promise<{ type: string; body: Buffer }>,
  urls: string[],
  question: string,
  reference: string | null,
  model?: string,
): Promise<string> {
  const parts: Extract<ResponsesMessage, { content: unknown[] }>['content'] = [];
  const shown: string[] = [];
  const skipped: string[] = [];
  for (const url of urls) {
    try {
      const img = await getImage(url);
      if (img.body.length > MAX_IMAGE_BYTES) { skipped.push(`${url} (for stort)`); continue; }
      shown.push(url);
      parts.push({ type: 'input_image', image_url: `data:${img.type};base64,${img.body.toString('base64')}` });
    } catch (e) {
      skipped.push(`${url} (${e instanceof Error ? e.message : 'kunne ikke hentes'})`);
    }
  }
  if (!shown.length) throw new UserError(`Ingen av bildene kunne hentes: ${skipped.join('; ')}`, 502);

  const intro = `Du hjelper en miniatyrmaler å finne bilder av én bestemt figur. ${question}
${reference ? 'Det første bildet er en REFERANSE: et kjent bilde av figuren. Sammenlign de andre med det (form, positur, våpen, base, detaljer), ikke med fargene, siden malere velger egne farger.\n' : ''}Bildene etter referansen er nummerert 1–${shown.length} i denne rekkefølgen:
${shown.map((u, i) => `${i + 1}. ${u}`).join('\n')}
Svar på norsk, én linje per bilde: «nummer – ja/nei/usikker – hva bildet viser (malt, offisielt foto, konseptillustrasjon, annet) – kort begrunnelse». Avslutt med én linje som oppsummerer.`;
  const content = [
    { type: 'input_text' as const, text: intro },
    ...(reference ? [{ type: 'input_image' as const, image_url: reference }] : []),
    ...parts,
  ];
  try {
    const r = await provider.respond([{ role: 'user', content }], { model, timeoutMs: 120_000 });
    return `${r.text.trim()}${skipped.length ? `\n(Ikke vist: ${skipped.join('; ')})` : ''}`;
  } catch (e) {
    if (e instanceof UserError && /feil (400|415|422|501)/i.test(e.message)) {
      throw new VisionUnsupportedError(`Modellen godtok ikke bilder: ${e.message}`, 502);
    }
    throw e;
  }
}
