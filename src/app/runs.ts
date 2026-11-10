/**
 * Agent runs that outlive the view that started them. The miniature workspace
 * starts a run here; switching tab or going back to the gallery does not stop
 * it, and every view can show its progress (nothing happens out of sight).
 */
import { useSyncExternalStore } from 'react';
import type { ResearchEvent } from '../domain/ai';
import type { Id } from '../domain/types';

export type RunKind = 'images' | 'plan';

export interface LivePage {
  url: string;
  title: string;
  site: string;
  author: string | null;
  language: string | null;
  images: { url: string; alt: string; caption: string | null; context: string | null;
    /** Image search: each picture has its own page. */
    page_url?: string; page_title?: string; site?: string; thumbnail_url?: string | null }[];
  /** True for an image search rather than a page. */
  search?: boolean;
}

export interface Run {
  key: string;
  subject_id: Id;
  kind: RunKind;
  status: 'running' | 'done' | 'stopped' | 'error';
  events: ResearchEvent[];
  /** Pages read in this run, with their images, as they arrive. */
  pages: LivePage[];
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

class RunRegistry {
  private runs = new Map<string, Run>();
  private controllers = new Map<string, AbortController>();
  private listeners = new Set<() => void>();
  private version = 0;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getVersion = () => this.version;

  get(subject_id: Id, kind: RunKind): Run | null {
    return this.runs.get(`${subject_id}:${kind}`) ?? null;
  }

  /** All runs still working, for markers on the gallery. */
  active(): Run[] {
    return [...this.runs.values()].filter((r) => r.status === 'running');
  }

  private set(run: Run) {
    this.runs.set(run.key, run);
    this.version++;
    this.listeners.forEach((l) => l());
  }

  /** Starts a run; a run of the same kind for the same miniature must finish or be stopped first. */
  start(subject_id: Id, kind: RunKind, work: (onEvent: (e: ResearchEvent) => void, signal: AbortSignal) => Promise<void>): void {
    const key = `${subject_id}:${kind}`;
    if (this.runs.get(key)?.status === 'running') return;
    const ac = new AbortController();
    this.controllers.set(key, ac);
    this.set({ key, subject_id, kind, status: 'running', events: [], pages: [], error: null, started_at: new Date().toISOString(), finished_at: null });
    const onEvent = (e: ResearchEvent) => {
      const cur = this.runs.get(key)!;
      const pages = e.type === 'open_done'
        ? [...cur.pages.filter((p) => p.url !== e.url), {
            url: e.url, title: e.title, site: e.site ?? hostOf(e.url), author: e.author ?? null, language: e.language ?? null, images: e.images ?? [],
          }]
        : e.type === 'image_search_done'
          ? [...cur.pages.filter((p) => p.url !== `bildesok:${e.query}`), {
              url: `bildesok:${e.query}`, title: `Bildesøk: ${e.query}`, site: '', author: null, language: null, search: true,
              images: e.images.map((h) => ({ url: h.image_url, alt: h.title, caption: h.title || null, context: null,
                page_url: h.page_url, page_title: h.title || h.site, site: h.site, thumbnail_url: h.thumbnail_url })),
            }]
          : cur.pages;
      this.set({ ...cur, events: [...cur.events, e], pages });
    };
    work(onEvent, ac.signal)
      .then(() => this.finish(key, 'done', null))
      .catch((err: unknown) => {
        const aborted = err instanceof Error && err.name === 'AbortError';
        this.finish(key, aborted ? 'stopped' : 'error', aborted ? null : err instanceof Error ? err.message : String(err));
      });
  }

  stop(subject_id: Id, kind: RunKind) {
    this.controllers.get(`${subject_id}:${kind}`)?.abort();
  }

  private finish(key: string, status: Run['status'], error: string | null) {
    const cur = this.runs.get(key);
    if (!cur) return;
    this.controllers.delete(key);
    this.set({ ...cur, status, error, finished_at: new Date().toISOString() });
  }
}

function hostOf(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; }
}

export const runs = new RunRegistry();

/** Re-renders when any run changes. */
export function useRuns<T>(select: (r: RunRegistry) => T): T {
  useSyncExternalStore(runs.subscribe, runs.getVersion);
  return select(runs);
}
