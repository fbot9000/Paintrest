import { useEffect, useId, useRef, useState } from 'react';
import type { Evidence, KnowledgeStatus } from '../../domain/types';
import type { PracticalExperience } from '../../domain/library';
import { Badge } from '../../ui/components';

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
