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
  /** Set when the page is a YouTube video: what YouTube says about it. */
  video?: VideoInfo;
}

/** A YouTube video, as YouTube's oEmbed endpoint describes it. Paintrest cannot watch it. */
export interface VideoInfo {
  url: string;
  video_id: string;
  title: string;
  channel: string | null;
  channel_url: string | null;
  thumbnail_url: string | null;
}

export interface FetchOptions {
  allowLocal?: boolean;
  fetchImpl?: typeof fetch;
  /** Override for tests; defaults to YouTube's own oEmbed endpoint. */
  oembedBase?: string;
}

const OEMBED = 'https://www.youtube.com/oembed';

/** The video id in a YouTube address (watch, youtu.be, shorts, embed, live), or null. */
export function youtubeId(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const host = u.hostname.replace(/^(www\.|m\.|music\.)/, '');
  const ok = (id: string | null | undefined) => (id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null);
  if (host === 'youtu.be') return ok(u.pathname.split('/')[1]);
  if (host !== 'youtube.com' && host !== 'youtube-nocookie.com') return null;
  if (u.pathname === '/watch') return ok(u.searchParams.get('v'));
  const [kind, id] = u.pathname.split('/').filter(Boolean);
  return kind && ['shorts', 'embed', 'live', 'v'].includes(kind) ? ok(id) : null;
}

/** Title, channel and thumbnail of a YouTube video through oEmbed. Throws if YouTube does not know it. */
export async function fetchVideo(rawUrl: string, opts: FetchOptions = {}): Promise<VideoInfo> {
  const id = youtubeId(rawUrl);
  if (!id) throw new UserError('Ikke en YouTube-video', 400);
  const url = `https://www.youtube.com/watch?v=${id}`;
  const res = await guardedGet(`${opts.oembedBase ?? OEMBED}?url=${encodeURIComponent(url)}&format=json`, {
    maxBytes: 64 * 1024, timeoutMs: 15_000, accept: 'application/json', allowLocal: opts.allowLocal, fetchImpl: opts.fetchImpl,
  });
  if (res.status >= 400) throw new UserError(`YouTube kjenner ikke videoen (${res.status})`, 502);
  let o: Record<string, unknown>;
  try { o = JSON.parse(res.body.toString('utf8')); } catch { throw new UserError('Uventet svar fra YouTube', 502); }
  const s = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const title = s(o.title);
  if (!title) throw new UserError('YouTube oppga ingen tittel', 502);
  return { url, video_id: id, title, channel: s(o.author_name), channel_url: s(o.author_url), thumbnail_url: s(o.thumbnail_url) };
}

const MAX_TEXT = 7000;
const MAX_IMAGES = 40;
const VIDEO_HOSTS = /(^|\.)(bilibili\.com|b23\.tv|nicovideo\.jp|vimeo\.com|dailymotion\.com|tiktok\.com|douyin\.com|youku\.com|ixigua\.com|twitch\.tv)$/i;
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

export async function fetchPage(rawUrl: string, opts: FetchOptions = {}): Promise<PageResult> {
  // YouTube pages are scripts; oEmbed gives what can be known without watching.
  if (youtubeId(rawUrl)) {
    const v = await fetchVideo(rawUrl, opts);
    return {
      url: v.url, title: v.title, site: 'youtube.com', author: v.channel, language: null, video: v,
      text: `YouTube-video «${v.title}»${v.channel ? ` fra kanalen ${v.channel}` : ''}. Paintrest kan ikke se eller høre videoen; bare tittel, kanal og miniatyrbilde er kjent.`,
      images: v.thumbnail_url ? [{ url: v.thumbnail_url, alt: v.title, caption: 'Miniatyrbilde fra videoen', context: null }] : [],
    };
  }
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

async function fetchOnce(rawUrl: string, opts: FetchOptions) {
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
  // One entry per picture: shops and blogs list the same image in several sizes.
  const byVariant = new Map<string, number>();
  const add = (src: string | null | undefined, alt: string, caption: string | null, context: string | null) => {
    if (!src || src.startsWith('data:')) return;
    // Lazy-loading themes (Shopify among them) write the size as a template: …_{width}x.jpg
    const filled = src.trim().replace(/\{width\}|%7Bwidth%7D/gi, '1200').replace(/\{height\}|%7Bheight%7D/gi, '');
    if (/[{}]|%7B|%7D/i.test(filled)) return;
    let abs: string;
    try { abs = new URL(filled, pageUrl).toString(); } catch { return; }
    if (!/^https?:/.test(abs) || SKIP_IMG.test(abs) || /\.svg(\?|$)/i.test(abs)) return;
    const key = variantKey(abs);
    const at = byVariant.get(key);
    if (at !== undefined) {
      if (sizeHint(abs) > sizeHint(images[at]!.url)) images[at]!.url = abs;
      return;
    }
    byVariant.set(key, images.length);
    images.push({ url: abs, alt: alt.trim().slice(0, 160), caption: caption?.trim().slice(0, 200) || null, context });
  };
  add(meta('meta[property="og:image"]'), title, null, null);
  // On video sites the other pictures are thumbnails of other videos; only the video's own picture belongs.
  const videoSite = VIDEO_HOSTS.test(new URL(pageUrl).hostname);
  // Pictures from the content itself, not from menus, sidebars and recommendations, when the page marks its content.
  const scope = [root.querySelector('article'), root.querySelector('main'), root.querySelector('[role="main"]')]
    .find((el) => el && el.querySelectorAll('img').length > 0) ?? root;
  for (const img of videoSite ? [] : scope.querySelectorAll('img')) {
    const w = Number(img.getAttribute('width'));
    if (w && w < 120) continue;
    const src = largestFromSrcset(img.getAttribute('data-srcset')) ?? img.getAttribute('data-src') ?? img.getAttribute('data-lazy-src')
      ?? largestFromSrcset(img.getAttribute('srcset')) ?? img.getAttribute('src');
    const fig = closest(img, 'figure');
    const block = fig ?? blockOf(img);
    const caption = fig?.querySelector('figcaption')?.text ?? block?.querySelector('.se-caption, .caption, .wp-caption-text')?.text ?? null;
    add(src, img.getAttribute('alt') ?? '', caption, block ? nearbyText(block) : null);
    if (images.length >= MAX_IMAGES) break;
  }
  // Campaign pages (Kickstarter, Gamefound) and shops built with scripts often keep their pictures
  // in embedded data rather than in <img>. Take image addresses from the page source as a fallback.
  if (images.length < 4 && !videoSite && scope === root) {
    for (const src of imageUrlsInSource(html)) {
      add(src, '', null, 'Funnet i sidens data, ikke som synlig bilde');
      if (images.length >= MAX_IMAGES) break;
    }
  }
  const language = root.querySelector('html')?.getAttribute('lang')?.trim().slice(0, 12) || null;

  for (const el of root.querySelectorAll('script, style, noscript, nav, footer, header, form, svg, iframe')) el.remove();
  const body = root.querySelector('article') ?? root.querySelector('main') ?? root.querySelector('body') ?? root;
  const text = body.structuredText.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+/g, ' ').trim().slice(0, MAX_TEXT);

  return { url: pageUrl, title, site: new URL(pageUrl).hostname.replace(/^www\./, ''), author, text, images, language: language ?? guessLanguage(text) };
}

/** The same picture in another size has the same key (size suffixes and query removed). */
export function variantKey(u: string): string {
  try {
    const x = new URL(u);
    x.hash = '';
    for (const k of [...x.searchParams.keys()]) {
      if (/^(width|w|height|h|type|v|crop|quality|q|format|fm|fit|resize|size|auto|dpr)$/i.test(k)) x.searchParams.delete(k);
    }
    return x.toString()
      .replace(/(_(\d+x\d*|x\d+)|_(pico|icon|thumb|small|compact|medium|large|grande|original|master)|@\dx|-\d+x\d+|-scaled)(?=\.[a-z0-9]+$)/i, '')
      .toLowerCase();
  } catch {
    return u;
  }
}

/** Rough width a variant asks for; no size marker usually means the original, which is largest. */
function sizeHint(u: string): number {
  const m = /[_-](\d+)x\d*(?=\.[a-z0-9]+(\?|$))/i.exec(u) ?? /[?&](?:width|w)=(\d+)/i.exec(u);
  return m ? Number(m[1]) : 100_000;
}

/** Image addresses written anywhere in the page source, also JSON-escaped ones. */
export function imageUrlsInSource(html: string): string[] {
  const text = html.replace(/\\u002[fF]/g, '/').replace(/\\\//g, '/');
  const out: string[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s"'<>()\\]+?\.(?:jpe?g|png|webp)(?:\?[^\s"'<>()\\]*)?(?=[\s"'<>()\\]|$)/gi)) {
    const u = m[0].replace(/&amp;/g, '&');
    if (!out.includes(u)) out.push(u);
    if (out.length >= MAX_IMAGES * 2) break;
  }
  return out;
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
