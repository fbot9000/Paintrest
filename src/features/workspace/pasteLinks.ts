/**
 * What the user pastes from Google Images and similar: links to images,
 * Google's own result links (imgres, with the image and its page), links to
 * pages, and pictures copied as data. Each line or link is read on its own.
 */
export type Pasted =
  | { kind: 'image'; image_url: string; page_url: string | null }
  | { kind: 'page'; url: string }
  | { kind: 'data'; data_url: string };

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i;
// Hosts that serve image files without an extension in the address.
const IMAGE_HOSTS = /(^|\.)(i\.redd\.it|preview\.redd\.it|scontent[\w.-]*\.fbcdn\.net|fbcdn\.net|cdninstagram\.com|i\.pinimg\.com|cf\.geekdo-images\.com|encrypted-tbn\d\.gstatic\.com|imgs\.search\.brave\.com|pbs\.twimg\.com|i\.imgur\.com|images\.squarespace-cdn\.com|lh\d\.googleusercontent\.com)$/i;

export function parsePasted(text: string): Pasted[] {
  const out: Pasted[] = [];
  const seen = new Set<string>();
  const push = (p: Pasted) => {
    const key = p.kind === 'image' ? p.image_url : p.kind === 'page' ? p.url : p.data_url.slice(0, 200);
    if (!seen.has(key)) { seen.add(key); out.push(p); }
  };
  for (const m of text.matchAll(/data:image\/[a-z+]+;base64,[A-Za-z0-9+/=]+/g)) push({ kind: 'data', data_url: m[0] });
  for (const m of text.replace(/data:image\/[^\s"']+/g, ' ').matchAll(/https?:\/\/[^\s"'<>]+/g)) {
    const p = readLink(m[0].replace(/[),.;]+$/, ''));
    if (p) push(p);
  }
  return out;
}

function readLink(raw: string): Pasted | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.replace(/^www\./, '');
  // Google Images result: imgurl is the picture, imgrefurl the page it is on.
  if (/^google\.[a-z.]+$/.test(host) && u.pathname === '/imgres') {
    const img = u.searchParams.get('imgurl');
    const page = u.searchParams.get('imgrefurl');
    if (img && /^https?:\/\//.test(img)) return { kind: 'image', image_url: img, page_url: page && /^https?:\/\//.test(page) ? page : null };
    return page ? { kind: 'page', url: page } : null;
  }
  // Google redirect links: /url?q=… or /url?url=…
  if (/^google\.[a-z.]+$/.test(host) && u.pathname === '/url') {
    const target = u.searchParams.get('url') ?? u.searchParams.get('q');
    return target && /^https?:\/\//.test(target) ? readLink(target) : null;
  }
  if (IMAGE_EXT.test(u.pathname) || IMAGE_HOSTS.test(u.hostname)) return { kind: 'image', image_url: u.toString(), page_url: null };
  return { kind: 'page', url: u.toString() };
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob();
}
