import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useCommand } from '../../app/context';
import type { Commands } from '../../domain/commands';
import type { Evidence, KnowledgeStatus } from '../../domain/types';
import type { KnowledgeImageView, PracticalExperience } from '../../domain/library';
import { Badge, FileImage } from '../../ui/components';

// ---------- Lagring ----------

/** Runs a command and remembers whether the last save went through, for «● Lagret». */
export function useAutosave() {
  const { run, error, clearError, busy } = useCommand();
  const [saved, setSaved] = useState(false);
  const save = async (fn: (c: Commands) => Promise<unknown>): Promise<boolean> => {
    setSaved(false);
    const ok = await run(async (c) => { await fn(c); return true; });
    if (ok) setSaved(true);
    return !!ok;
  };
  return { save, run, error, clearError, busy, saved };
}

export function SaveState({ busy, saved }: { busy: boolean; saved: boolean }) {
  return <span className="save-state small" aria-live="polite">{busy ? 'Lagrer …' : saved ? '● Lagret' : ''}</span>;
}

/** ↑ ↓ × for one row in an ordered list. */
export function RowTools({ index, count, label, onMove, onRemove }:
  { index: number; count: number; label: string; onMove: (by: -1 | 1) => void; onRemove: () => void }) {
  return (
    <div className="row-tools">
      <button type="button" aria-label={`Flytt ${label} opp`} disabled={index === 0} onClick={() => onMove(-1)}>↑</button>
      <button type="button" aria-label={`Flytt ${label} ned`} disabled={index === count - 1} onClick={() => onMove(1)}>↓</button>
      <button type="button" aria-label={`Fjern ${label}`} onClick={onRemove}>×</button>
    </div>
  );
}

/** Returns a copy with item i moved by one place. */
export function moved<T>(list: T[], i: number, by: -1 | 1): T[] {
  const out = [...list];
  const [item] = out.splice(i, 1);
  out.splice(i + by, 0, item!);
  return out;
}

export function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={onClick}>{children}</button>;
}

export function SearchBox({ value, onChange, label, placeholder }:
  { value: string; onChange: (v: string) => void; label: string; placeholder: string }) {
  const id = useId();
  return (
    <div className="lib-search">
      <label htmlFor={id} className="sr-only">{label}</label>
      <span aria-hidden>⌕</span>
      <input id={id} type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

// ---------- De tre egenskapene (skisse 00: «Tre egenskaper, ikke én status») ----------

export function StatusBadge({ status }: { status: KnowledgeStatus }) {
  return status === 'approved'
    ? <Badge tone="moss">Godkjent til test</Badge>
    : <Badge tone="neutral">Utkast</Badge>;
}

export function ExperienceBadge({ experience }: { experience: PracticalExperience }) {
  if (experience === 'succeeded') return <Badge tone="dark">Fungerte</Badge>;
  if (experience === 'tried') return <Badge tone="dark">Prøvd</Badge>;
  return <Badge tone="neutral">Ikke prøvd</Badge>;
}

export function EvidenceBadge({ evidence }: { evidence: Evidence | null }) {
  if (evidence === 'documented') return <Badge tone="moss">Dokumentert</Badge>;
  if (evidence === 'synthesized') return <Badge tone="warn">AI-syntese</Badge>;
  if (evidence === 'unresolved') return <Badge tone="warn">Kilder uavklart</Badge>;
  return null;
}

// ---------- Redigering som lagres når feltet forlates ----------

/**
 * A text field that keeps its own draft while focused and saves on blur
 * (or Enter for single-line fields). Picks up outside changes when not focused.
 */
export function AutoField({ value, onSave, label, multiline, placeholder, className = '', hideLabel }:
  { value: string; onSave: (v: string) => unknown; label: string; multiline?: boolean; placeholder?: string; className?: string; hideLabel?: boolean }) {
  const id = useId();
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(value); }, [value]);
  const commit = () => {
    focused.current = false;
    if (draft !== value) onSave(draft);
  };
  const common = {
    id,
    value: draft,
    placeholder,
    onFocus: () => { focused.current = true; },
    onBlur: commit,
  };
  return (
    <div className={`auto-field ${className}`}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'eyebrow'}>{label}</label>
      {multiline ? (
        <textarea {...common} rows={Math.max(2, draft.split('\n').length)} onChange={(e) => setDraft(e.target.value)} />
      ) : (
        <input
          {...common}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') { setDraft(value); focused.current = false; (e.target as HTMLInputElement).blur(); }
          }}
        />
      )}
    </div>
  );
}

/**
 * Editable list of short texts shown as chips: tags or materials.
 * Enter or comma adds, × removes. Suggestions come from a datalist.
 */
export function ChipListEditor({ items, onSave, label, placeholder, suggestions = [] }:
  { items: string[]; onSave: (items: string[]) => unknown; label: string; placeholder: string; suggestions?: string[] }) {
  const id = useId();
  const [draft, setDraft] = useState('');
  const add = () => {
    const parts = draft.split(',').map((s) => s.trim()).filter(Boolean);
    setDraft('');
    if (parts.length) onSave([...items, ...parts]);
  };
  const lower = new Set(items.map((s) => s.toLocaleLowerCase('nb')));
  const offered = suggestions.filter((s) => !lower.has(s.toLocaleLowerCase('nb')));
  return (
    <div className="chip-list">
      <ul aria-label={label}>
        {items.map((item, i) => (
          <li key={`${item}-${i}`} className="chip-item">
            {item}
            <button type="button" aria-label={`Fjern ${item}`} onClick={() => onSave(items.filter((_, j) => j !== i))}>×</button>
          </li>
        ))}
        <li className="chip-add">
          <label htmlFor={id} className="sr-only">{label}</label>
          <input
            id={id}
            list={offered.length ? `${id}-s` : undefined}
            value={draft}
            placeholder={placeholder}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={add}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
              if (e.key === 'Backspace' && !draft && items.length) onSave(items.slice(0, -1));
            }}
          />
          {offered.length > 0 && <datalist id={`${id}-s`}>{offered.map((s) => <option key={s} value={s} />)}</datalist>}
        </li>
      </ul>
    </div>
  );
}

// ---------- Eksempelbilder ----------

/**
 * Example pictures of a technique or recipe: the first one large, the rest as
 * thumbnails. Each picture names its page, so it is clear where it comes from.
 */
export function KnowledgeGallery({ images }: { images: KnowledgeImageView[] }) {
  const [index, setIndex] = useState(0);
  if (!images.length) return null;
  const cur = images[Math.min(index, images.length - 1)]!;
  return (
    <figure className="kg">
      <FileImage fileId={cur.file_id} alt={cur.caption ?? cur.source.title} className="kg-main" />
      <figcaption className="small">
        {cur.caption && <span>{cur.caption} · </span>}
        {cur.source.url ? <a href={cur.source.url} target="_blank" rel="noreferrer">{cur.source.title} ↗</a> : cur.source.title}
      </figcaption>
      {images.length > 1 && (
        <div className="kg-thumbs" role="group" aria-label="Bilder">
          {images.map((im, i) => (
            <button key={im.asset_id} type="button" className={i === index ? 'on' : ''} aria-pressed={i === index}
              aria-label={`Vis bilde ${i + 1}`} onClick={() => setIndex(i)}>
              <FileImage fileId={im.file_id} alt="" className="kg-thumb" />
            </button>
          ))}
        </div>
      )}
    </figure>
  );
}
