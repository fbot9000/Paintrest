/**
 * Reads one web page for the agent: title, author hints, readable text and
 * the images on the page with their alt text. The image list is what lets
 * the server check later that a proposed image really came from that page.
 */
import { parse } from 'node-html-parser';
import type { HTMLElement } from 'node-html-parser';
import { UserError } from './credential-store.ts';
import { guardedGet } from './net-guard.ts';

export interface PageImage {
  url: string;
  alt: string;
  caption: string | null;
}

export interface PageResult {
  url: string;
  title: string;
  site: string;
  author: string | null;
  text: string;
  images: PageImage[];
}

const MAX_TEXT = 7000;
const MAX_IMAGES = 30;
const SKIP_IMG = /(logo|icon|sprite|avatar|badge|emoji|pixel|spacer|tracking|ads?[-_/]|banner|favicon|gravatar|placeholder)/i;

export async function fetchPage(rawUrl: string, opts: { allowLocal?: boolean; fetchImpl?: typeof fetch } = {}): Promise<PageResult> {
  const res = await guardedGet(rawUrl, {
    maxBytes: 3 * 1024 * 1024, timeoutMs: 20_000,
    accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
    allowLocal: opts.allowLocal, fetchImpl: opts.fetchImpl,
  });
  if (res.status >= 400) throw new UserError(`Siden svarte med ${res.status}`, 502);
  if (!/html|xml/i.test(res.contentType)) throw new UserError(`Ikke en nettside (${res.contentType || 'ukjent type'})`, 502);
  return extract(res.url, res.body.toString('utf8'));
}

export function extract(pageUrl: string, html: string): PageResult {
  const root = parse(html, { blockTextElements: { script: false, style: false, noscript: false, pre: true } });
  const meta = (sel: string) => root.querySelector(sel)?.getAttribute('content')?.trim() || null;
  const title = meta('meta[property="og:title"]') ?? root.querySelector('title')?.text.trim() ?? pageUrl;
  const author = meta('meta[name="author"]') ?? meta('meta[property="article:author"]') ?? meta('meta[property="og:site_name"]');

  const images: PageImage[] = [];
  const seen = new Set<string>();
  const add = (src: string | null | undefined, alt: string, caption: string | null) => {
    if (!src || src.startsWith('data:')) return;
    let abs: string;
    try { abs = new URL(src.trim(), pageUrl).toString(); } catch { return; }
    if (!/^https?:/.test(abs) || SKIP_IMG.test(abs) || /\.svg(\?|$)/i.test(abs) || seen.has(abs)) return;
    seen.add(abs);
    images.push({ url: abs, alt: alt.trim().slice(0, 160), caption: caption?.trim().slice(0, 200) || null });
  };
  add(meta('meta[property="og:image"]'), title, null);
  for (const img of root.querySelectorAll('img')) {
    const w = Number(img.getAttribute('width'));
    if (w && w < 120) continue;
    const src = img.getAttribute('data-src') ?? img.getAttribute('data-lazy-src') ?? largestFromSrcset(img.getAttribute('srcset')) ?? img.getAttribute('src');
    const fig = closest(img, 'figure');
    add(src, img.getAttribute('alt') ?? '', fig?.querySelector('figcaption')?.text ?? null);
    if (images.length >= MAX_IMAGES) break;
  }

  for (const el of root.querySelectorAll('script, style, noscript, nav, footer, header, form, svg, iframe')) el.remove();
  const body = root.querySelector('article') ?? root.querySelector('main') ?? root.querySelector('body') ?? root;
  const text = body.structuredText.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim().slice(0, MAX_TEXT);

  return { url: pageUrl, title, site: new URL(pageUrl).hostname.replace(/^www\./, ''), author, text, images };
}

function largestFromSrcset(srcset: string | undefined): string | null {
  if (!srcset) return null;
  const parts = srcset.split(',').map((p) => p.trim().split(/\s+/)).filter((p) => p[0]);
  parts.sort((a, b) => (parseFloat(b[1] ?? '0') || 0) - (parseFloat(a[1] ?? '0') || 0));
  return parts[0]?.[0] ?? null;
}

function closest(el: HTMLElement, tag: string): HTMLElement | null {
  let cur: HTMLElement | null = el.parentNode;
  for (let i = 0; cur && i < 4; i++, cur = cur.parentNode) {
    if (cur.rawTagName?.toLowerCase() === tag) return cur;
  }
  return null;
}

/** Fetches an image for the client: images only, at most 8 MB. */
export async function fetchImage(rawUrl: string, opts: { allowLocal?: boolean; fetchImpl?: typeof fetch } = {}) {
  const res = await guardedGet(rawUrl, {
    maxBytes: 8 * 1024 * 1024, timeoutMs: 20_000, accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif;q=0.9',
    allowLocal: opts.allowLocal, fetchImpl: opts.fetchImpl,
  });
  if (res.status >= 400) throw new UserError(`Bildet svarte med ${res.status}`, 502);
  const type = res.contentType.split(';')[0]!.trim().toLowerCase();
  if (!/^image\/(jpeg|png|webp|gif|avif)$/.test(type)) throw new UserError(`Ikke et støttet bilde (${type || 'ukjent type'})`, 502);
  return { type, body: res.body };
}
