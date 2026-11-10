/**
 * Reading view of a paint plan: the same layout for an agent's proposal and
 * for the approved plan. Steps are short text with paints as small chips;
 * ownership is shown only when something is missing.
 */
import type { ReactNode } from 'react';
import { matchProduct } from '../../domain/agent';
import type { PaintPlanPayload } from '../../domain/agent';
import type { ElementKind, MaterialRole, Tables } from '../../domain/types';
import type { PaintingView } from '../../domain/views';
import { ownershipOf } from '../../domain/views';
import { Swatch } from '../../ui/components';

export const ROLE_LABEL: Record<MaterialRole, string> = {
  base: 'Base', shade: 'Shade', layer: 'Lag', highlight: 'Høylys', wash: 'Wash', glaze: 'Glasur', mix: 'Blanding', other: 'Annet',
};

export type PaintStatus = 'owns' | 'not_owned' | 'unknown' | 'missing';

export interface DocMaterial {
  name: string;
  maker: string | null;
  hex: string | null;
  role: MaterialRole;
  role_label: string | null;
  status: PaintStatus;
}

export type Change = 'new' | 'changed' | null;

export interface DocStep {
  instruction: string;
  materials: DocMaterial[];
  mix: string | null;
  change: Change;
}

export interface DocElement {
  name: string;
  kind: ElementKind;
  steps: DocStep[];
  change: Change;
}

export function docFromPayload(t: Tables, p: PaintPlanPayload): DocElement[] {
  return p.elements.map((el) => ({
    name: el.name, kind: el.kind, change: null,
    steps: el.steps.map((st) => ({
      instruction: st.instruction, change: null,
      mix: st.mix ? st.mix.components.map((c) => `${c.parts} ${c.product.name}`).join(' + ') : null,
      materials: st.materials.map((m) => {
        const match = matchProduct(t, m.product);
        return {
          name: m.product.name, maker: [m.product.manufacturer, m.product.range].filter(Boolean).join(' · ') || null,
          hex: match?.swatch_hex ?? m.product.hex ?? null, role: m.role, role_label: m.role_label,
          status: match ? ownershipOf(t, match.id) : 'missing',
        };
      }),
    })),
  }));
}

export function docFromView(v: PaintingView): DocElement[] {
  return v.elements.map((ev) => ({
    name: ev.element.name, kind: ev.element.kind, change: null,
    steps: ev.steps.map((sv) => ({
      instruction: sv.step.instruction, change: null, mix: null,
      materials: sv.materials.map((m) => ({
        name: m.product.name, maker: [m.product.manufacturer, m.product.range_name].filter(Boolean).join(' · ') || null,
        hex: m.product.swatch_hex, role: m.material.role, role_label: m.material.role_label ?? null, status: m.ownership,
      })),
    })),
  }));
}

const sig = (s: DocStep) => `${s.instruction.trim()}|${s.materials.map((m) => `${m.name}:${m.role}`).sort().join(',')}`;

/** Marks new and changed steps compared with the current version (matched by part name and position). */
export function markChanges(next: DocElement[], current: DocElement[]): { elements: DocElement[]; changed: number; added: number; removed: string[] } {
  const byName = new Map(current.map((e) => [e.name.trim().toLowerCase(), e]));
  let changed = 0;
  let added = 0;
  const elements = next.map((el) => {
    const old = byName.get(el.name.trim().toLowerCase());
    if (!old) {
      added += el.steps.length;
      return { ...el, change: 'new' as const, steps: el.steps.map((s) => ({ ...s, change: 'new' as const })) };
    }
    return {
      ...el,
      steps: el.steps.map((s, i) => {
        const before = old.steps[i];
        if (!before) { added++; return { ...s, change: 'new' as const }; }
        if (sig(before) !== sig(s)) { changed++; return { ...s, change: 'changed' as const }; }
        return s;
      }),
    };
  });
  const names = new Set(next.map((e) => e.name.trim().toLowerCase()));
  const removed = current.filter((e) => !names.has(e.name.trim().toLowerCase())).map((e) => e.name);
  return { elements, changed, added, removed };
}

const STATUS_LABEL: Record<Exclude<PaintStatus, 'owns'>, string> = { missing: 'ikke i katalogen', not_owned: 'eier ikke', unknown: 'ukjent om du eier' };

export function PaintChip({ m }: { m: DocMaterial }) {
  return (
    <span className={`pd-paint ${m.status === 'missing' || m.status === 'not_owned' ? 'warn' : ''}`} title={[m.maker, m.status !== 'owns' ? STATUS_LABEL[m.status] : 'eier'].filter(Boolean).join(' · ')}>
      <Swatch hex={m.hex} size={14} />
      <strong>{m.name}</strong>
      <span className="pd-role">{m.role_label ?? ROLE_LABEL[m.role]}</span>
      {(m.status === 'missing' || m.status === 'not_owned') && <span className="pd-flag">{STATUS_LABEL[m.status]}</span>}
    </span>
  );
}

export function elementId(i: number) {
  return `plan-del-${i}`;
}

/** One line with the parts of the plan and their step counts; each jumps to its part. */
export function Outline({ elements }: { elements: DocElement[] }) {
  return (
    <nav className="pd-outline" aria-label="Delene i planen">
      {elements.map((el, i) => (
        <button key={i} type="button" className={el.change ? 'changed' : ''}
          onClick={() => document.getElementById(elementId(i))?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
          {el.name} <span>{el.steps.length}</span>
        </button>
      ))}
    </nav>
  );
}

export function PaletteStrip({ items, note, onOpen }: { items: { name: string; hex: string | null }[]; note: string; onOpen?: () => void }) {
  if (!items.length) return null;
  return (
    <div className="pd-palette">
      <span className="eyebrow">Palett · {items.length} malinger</span>
      <span className="pd-swatches">
        {items.map((p, i) => <span key={i} title={p.name}><Swatch hex={p.hex} size={18} /></span>)}
      </span>
      <span className="small muted">{note}{onOpen && <> <button type="button" className="link small" onClick={onOpen}>Åpne Palett →</button></>}</span>
    </div>
  );
}

export function ChangeBadge({ change }: { change: Change }) {
  if (!change) return null;
  return <span className={`pd-change ${change}`}>{change === 'new' ? 'Ny' : 'Endret'}</span>;
}

/** Read-only step: instruction and paints. */
export function StepRead({ s, actions }: { s: DocStep; actions?: ReactNode }) {
  return (
    <div className={`pd-step ${s.change ?? ''}`}>
      <p>{s.instruction || <em className="muted">Ingen instruks</em>} <ChangeBadge change={s.change} /></p>
      {(s.materials.length > 0 || s.mix) && (
        <div className="pd-paints">
          {s.materials.map((m, i) => <PaintChip key={i} m={m} />)}
          {s.mix && <span className="small muted">Blanding: {s.mix}</span>}
        </div>
      )}
      {actions && <span className="pd-step-actions">{actions}</span>}
    </div>
  );
}

/** A whole plan, read-only (the approved version, or the current one next to a proposal). */
export function PlanRead({ elements }: { elements: DocElement[] }) {
  return (
    <div className="pd-elements">
      {elements.map((el, i) => (
        <section key={i} id={elementId(i)} className={`pd-el ${el.kind}`}>
          <h3>{el.name} <span className="eyebrow">{el.kind === 'operation' ? 'Felles' : 'Del'}</span> <ChangeBadge change={el.change} /></h3>
          <ol>{el.steps.map((s, si) => <li key={si}><StepRead s={s} /></li>)}</ol>
        </section>
      ))}
    </div>
  );
}

/** Closes the «⋯» menu a button sits in. */
export function closeMenu(e: { currentTarget: HTMLElement }) {
  const d = e.currentTarget.closest('details');
  if (d) d.open = false;
}
