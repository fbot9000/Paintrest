/**
 * The paint import in progress. The draft list is kept in this browser
 * (localStorage), so it survives a reload and moving between pages, but it is not
 * part of the data folder: nothing reaches the catalogue before the user saves.
 *
 * AI work runs in the shared run registry (kind 'paints'), so the top bar shows
 * it and it keeps going on other pages. Reading and a dialog turn never run at
 * the same time.
 */
import { useSyncExternalStore } from 'react';
import { runs } from '../../app/runs';
import type { AiGateway } from '../../domain/ai';
import { newId } from '../../domain/ids';
import {
  addReadResult, applyDiscussResult, chunkRequest, discussMessage, editRow, newDraft, splitChunk, tableForAi, unusedLinesForAi,
} from '../../domain/paints';
import type { ImportChunk, ImportDraft, ImportRow } from '../../domain/paints';

const KEY = 'paintrest.paint-import.v1';
const PARALLEL = 2;
const HREF = '/malinger/import';

export interface ImportState {
  draft: ImportDraft | null;
  /** Answers being typed for open questions (question id → text), and the free message. */
  answers: Record<string, string>;
  message: string;
}

function load(): ImportState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as ImportState;
      if (s.draft) {
        // A reload stopped any reading that was going on: those parts wait to be read again.
        s.draft = { ...s.draft, chunks: s.draft.chunks.map((c) => (c.status === 'running' ? { ...c, status: 'waiting' } : c)) };
      }
      return { draft: s.draft ?? null, answers: s.answers ?? {}, message: s.message ?? '' };
    }
  } catch { /* no storage here (private mode): the draft lives in memory only */ }
  return { draft: null, answers: {}, message: '' };
}

const sameChunk = (a: ImportChunk, b: ImportChunk) => a.from === b.from && a.to === b.to;

class ImportStore {
  private state: ImportState = typeof localStorage === 'undefined' ? { draft: null, answers: {}, message: '' } : load();
  private listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  get = (): ImportState => this.state;

  private set(next: Partial<ImportState>) {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((l) => l());
    // Writing the whole draft on every keystroke is wasteful; once things settle is enough.
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        if (this.state.draft) localStorage.setItem(KEY, JSON.stringify(this.state));
        else localStorage.removeItem(KEY);
      } catch { /* storage full or blocked: the draft stays in memory */ }
    }, 300);
  }

  private setDraft(fn: (d: ImportDraft) => ImportDraft) {
    if (this.state.draft) this.set({ draft: fn(this.state.draft) });
  }

  busy(): boolean {
    const d = this.state.draft;
    return !!d && runs.get(d.id, 'paints')?.status === 'running';
  }

  /** Starts a new import. With AI the parts are read right away; without, the rows are there at once. */
  begin(text: string, source: string, note: string, withAi: boolean, ai: AiGateway) {
    const d = newDraft(text, source, note, withAi, newId(), new Date().toISOString());
    runs.dismiss(this.state.draft?.id ?? '', 'paints');
    this.set({ draft: d, answers: {}, message: '' });
    if (withAi) this.read(ai);
  }

  /** Reads every part that is waiting or failed, two at a time. */
  read(ai: AiGateway) {
    const d = this.state.draft;
    if (!d || this.busy()) return;
    this.setDraft((x) => ({ ...x, chunks: x.chunks.map((c) => (c.status === 'error' ? { ...c, status: 'waiting', error: null } : c)) }));
    runs.dismiss(d.id, 'paints');
    runs.start(d.id, 'paints', async (onEvent, signal) => {
      const worker = async () => {
        for (;;) {
          if (signal.aborted) return;
          const cur = this.state.draft;
          if (!cur || cur.id !== d.id) return;
          const c = cur.chunks.find((x) => x.status === 'waiting');
          if (!c) return;
          this.patchChunk(c, { status: 'running' });
          onEvent({ type: 'status', text: `Leser linje ${c.from}–${c.to}` });
          try {
            const res = await ai.readPaints({ mode: 'read', ...chunkRequest(cur, c), note: cur.note }, signal);
            this.setDraft((x) => addReadResult({ ...x, chunks: x.chunks.map((y) => (sameChunk(y, c) ? { ...y, status: 'done' } : y)) }, c, res));
          } catch (e) {
            if (signal.aborted) { this.patchChunk(c, { status: 'waiting' }); return; }
            const msg = e instanceof Error ? e.message : String(e);
            const parts = /kunne ikke leses/.test(msg) ? splitChunk(cur.lines, c) : [c];
            if (parts.length > 1) {
              // Probably too long for one answer: read it as two halves.
              this.setDraft((x) => ({ ...x, chunks: x.chunks.flatMap((y) => (sameChunk(y, c) ? parts : [y])) }));
            } else {
              this.patchChunk(c, { status: 'error', error: msg });
            }
          }
        }
      };
      await Promise.all(Array.from({ length: PARALLEL }, worker));
      if (signal.aborted) throw Object.assign(new Error('Stoppet'), { name: 'AbortError' });
      const failed = this.state.draft?.chunks.filter((c) => c.status === 'error').length ?? 0;
      if (failed) throw Object.assign(new Error(`${failed} ${failed === 1 ? 'del' : 'deler'} kunne ikke leses. Se under.`), { reported: true });
    }, { label: 'Leser malingslisten', href: HREF });
  }

  /**
   * Reads the given lines again (lines the AI did not account for). Only runs of
   * those lines become new parts, so lines already turned into paints are not read twice.
   */
  reread(lines: number[], ai: AiGateway) {
    if (!lines.length) return;
    this.setDraft((d) => {
      const fresh: ImportChunk[] = [];
      for (const n of [...new Set(lines)].sort((a, b) => a - b)) {
        const last = fresh.at(-1);
        const onlyBlankBetween = !!last && d.lines.slice(last.to, n - 1).every((l) => !l.trim());
        if (last && onlyBlankBetween && n - last.from < 40) last.to = n;
        else fresh.push({ from: n, to: n, status: 'waiting', error: null });
      }
      return { ...d, chunks: [...d.chunks, ...fresh] };
    });
    this.read(ai);
  }

  stop() {
    const d = this.state.draft;
    if (d) runs.stop(d.id, 'paints');
  }

  private patchChunk(c: ImportChunk, patch: Partial<ImportChunk>) {
    this.setDraft((d) => ({ ...d, chunks: d.chunks.map((x) => (sameChunk(x, c) ? { ...x, ...patch } : x)) }));
  }

  setAnswer(id: string, text: string) {
    this.set({ answers: { ...this.state.answers, [id]: text } });
  }

  setMessage(text: string) {
    this.set({ message: text });
  }

  /** One dialog turn: the answers and the message go to the AI, and its changes are applied to the list. */
  discuss(ai: AiGateway) {
    const d = this.state.draft;
    if (!d || this.busy()) return;
    const text = discussMessage(d, this.state.answers, this.state.message);
    if (!text) return;
    runs.dismiss(d.id, 'paints');
    runs.start(d.id, 'paints', async (onEvent, signal) => {
      onEvent({ type: 'status', text: 'AI-en oppdaterer listen' });
      const res = await ai.discussPaints({
        mode: 'discuss', table: tableForAi(d), unused_lines: unusedLinesForAi(d),
        questions: d.questions.map((q) => ({ id: q.id, text: q.text })),
        history: d.log.slice(-10).map((l) => ({ role: l.role, text: l.text })),
        message: text, note: d.note,
      }, signal);
      this.setDraft((x) => applyDiscussResult(x, res, text));
      // Sent and answered: what the user typed is in the log now.
      this.set({ answers: {}, message: '' });
    }, { label: 'AI-en oppdaterer malingslisten', href: HREF });
  }

  edit(key: string, patch: Partial<Omit<ImportRow, 'key' | 'lines' | 'guessed'>>) {
    this.setDraft((d) => editRow(d, key, patch));
  }

  setAll(include: boolean, keys: string[]) {
    const set = new Set(keys);
    this.setDraft((d) => ({ ...d, rows: d.rows.map((r) => (set.has(r.key) ? { ...r, include, removed: include ? null : r.removed } : r)) }));
  }

  addRow() {
    this.setDraft((d) => ({
      ...d,
      rows: [...d.rows, {
        key: `R${d.next_row}`, manufacturer: null, range_name: null, name: '', product_code: null, product_kind: 'other', finish: null,
        swatch_hex: null, ownership: 'owns', lines: [], guessed: [], unsure: null, include: true, removed: null,
      }],
      next_row: d.next_row + 1,
    }));
  }

  dismissQuestion(id: string) {
    this.setDraft((d) => ({ ...d, questions: d.questions.filter((q) => q.id !== id) }));
    const { [id]: _, ...rest } = this.state.answers;
    void _;
    this.set({ answers: rest });
  }

  discard() {
    const d = this.state.draft;
    if (d) {
      runs.stop(d.id, 'paints');
      runs.dismiss(d.id, 'paints');
    }
    this.set({ draft: null, answers: {}, message: '' });
  }
}

export const importStore = new ImportStore();

export function useImport(): ImportState {
  return useSyncExternalStore(importStore.subscribe, importStore.get);
}
