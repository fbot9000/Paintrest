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
  /** Text just before and after the image (often the only clue on poorly tagged blogs). */
  context: string | null;
}

export interface PageResult {
  url: string;
  title: string;
  site: string;
  author: string | null;
  text: string;
  images: PageImage[];
  /** html lang, or guessed from the script (ko, ja, zh) when missing. */
  language: string | null;
}

const MAX_TEXT = 7000;
const MAX_IMAGES = 40;
const SKIP_IMG = /(logo|icon|sprite|avatar|badge|emoji|pixel|spacer|tracking|ads?[-_/]|banner|favicon|gravatar|placeholder)/i;

/**
 * Naver blogs put the post in an iframe; the mobile address serves the post
 * itself. Rewrites blog.naver.com/{id}/{logNo} and PostView links.
 */
export function rewriteForReading(raw: string): string {
  try {
    const u = new URL(raw);
    if (u.hostname === 'blog.naver.com' || u.hostname === 'www.blog.naver.com') {
      const blogId = u.searchParams.get('blogId');
      const logNo = u.searchParams.get('logNo');
      if (blogId && logNo) return `https://m.blog.naver.com/${blogId}/${logNo}`;
      const [id, no] = u.pathname.split('/').filter(Boolean);
      if (id && no && /^\d+$/.test(no)) return `https://m.blog.naver.com/${id}/${no}`;
    }
  } catch { /* not a URL; guardedGet reports it */ }
  return raw;
}

export async function fetchPage(rawUrl: string, opts: { allowLocal?: boolean; fetchImpl?: typeof fetch } = {}): Promise<PageResult> {
  const page = await fetchOnce(rewriteForReading(rawUrl), opts);
  // Some blogs (older Naver layouts) still wrap the post in a frame: follow it once.
  if (page.frameSrc && page.result.images.length < 2) {
    try {
      const inner = await fetchOnce(rewriteForReading(new URL(page.frameSrc, page.result.url).toString()), opts);
      return { ...inner.result, url: page.result.url, title: inner.result.title || page.result.title };
    } catch { /* keep the outer page */ }
  }
  return page.result;
}

async function fetchOnce(rawUrl: string, opts: { allowLocal?: boolean; fetchImpl?: typeof fetch }) {
  const res = await guardedGet(rawUrl, {
    maxBytes: 3 * 1024 * 1024, timeoutMs: 20_000,
    accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
    allowLocal: opts.allowLocal, fetchImpl: opts.fetchImpl,
  });
  if (res.status >= 400) throw new UserError(`Siden svarte med ${res.status}`, 502);
  if (!/html|xml/i.test(res.contentType)) throw new UserError(`Ikke en nettside (${res.contentType || 'ukjent type'})`, 502);
  const html = res.body.toString('utf8');
  const frame = /<iframe[^>]+id=["']mainFrame["'][^>]*src=["']([^"']+)["']/i.exec(html)?.[1] ?? null;
  return { result: extract(res.url, html), frameSrc: frame };
}

export function extract(pageUrl: string, html: string): PageResult {
  const root = parse(html, { blockTextElements: { script: false, style: false, noscript: false, pre: true } });
  const meta = (sel: string) => root.querySelector(sel)?.getAttribute('content')?.trim() || null;
  const title = meta('meta[property="og:title"]') ?? root.querySelector('title')?.text.trim() ?? pageUrl;
  const author = meta('meta[name="author"]') ?? meta('meta[property="article:author"]') ?? meta('meta[property="og:site_name"]');

  const images: PageImage[] = [];
  const seen = new Set<string>();
  const add = (src: string | null | undefined, alt: string, caption: string | null, context: string | null) => {
    if (!src || src.startsWith('data:')) return;
    let abs: string;
    try { abs = new URL(src.trim(), pageUrl).toString(); } catch { return; }
    if (!/^https?:/.test(abs) || SKIP_IMG.test(abs) || /\.svg(\?|$)/i.test(abs) || seen.has(abs)) return;
    seen.add(abs);
    images.push({ url: abs, alt: alt.trim().slice(0, 160), caption: caption?.trim().slice(0, 200) || null, context });
  };
  add(meta('meta[property="og:image"]'), title, null, null);
  for (const img of root.querySelectorAll('img')) {
    const w = Number(img.getAttribute('width'));
    if (w && w < 120) continue;
    const src = img.getAttribute('data-src') ?? img.getAttribute('data-lazy-src') ?? largestFromSrcset(img.getAttribute('srcset')) ?? img.getAttribute('src');
    const fig = closest(img, 'figure');
    const block = fig ?? blockOf(img);
    const caption = fig?.querySelector('figcaption')?.text ?? block?.querySelector('.se-caption, .caption, .wp-caption-text')?.text ?? null;
    add(src, img.getAttribute('alt') ?? '', caption, block ? nearbyText(block) : null);
    if (images.length >= MAX_IMAGES) break;
  }
  const language = root.querySelector('html')?.getAttribute('lang')?.trim().slice(0, 12) || null;

  for (const el of root.querySelectorAll('script, style, noscript, nav, footer, header, form, svg, iframe')) el.remove();
  const body = root.querySelector('article') ?? root.querySelector('main') ?? root.querySelector('body') ?? root;
  const text = body.structuredText.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim().slice(0, MAX_TEXT);

  return { url: pageUrl, title, site: new URL(pageUrl).hostname.replace(/^www\./, ''), author, text, images, language: language ?? guessLanguage(text) };
}

/** The nearest block-level ancestor of an image (a paragraph, list item or content block). */
function blockOf(el: HTMLElement): HTMLElement | null {
  let cur: HTMLElement | null = el.parentNode;
  for (let i = 0; cur && i < 5; i++, cur = cur.parentNode) {
    const tag = cur.rawTagName?.toLowerCase();
    if (tag === 'p' || tag === 'li' || tag === 'figure' || tag === 'section' || (tag === 'div' && /se-component|se-module|imageblock|post-image|entry-content/i.test(cur.getAttribute('class') ?? ''))) return cur;
    if (tag === 'div' && cur.parentNode && (cur.parentNode.childNodes.length > 2)) return cur;
  }
  return null;
}

/** Text of the blocks right before and after, plus the block's own text, capped. */
function nearbyText(block: HTMLElement): string | null {
  const clean = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
  const before = clean(block.previousElementSibling?.text).slice(-200);
  const own = clean(block.text).slice(0, 160);
  const after = clean(block.nextElementSibling?.text).slice(0, 200);
  const joined = [before, own, after].filter(Boolean).join(' … ');
  return joined ? joined.slice(0, 480) : null;
}

export function guessLanguage(text: string): string | null {
  const sample = text.slice(0, 3000);
  const count = (re: RegExp) => (sample.match(re) ?? []).length;
  const hangul = count(/[\uac00-\ud7af]/g);
  const kana = count(/[\u3040-\u30ff]/g);
  const han = count(/[\u4e00-\u9fff]/g);
  if (hangul > 20) return 'ko';
  if (kana > 20) return 'ja';
  if (han > 20) return 'zh';
  return null;
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
