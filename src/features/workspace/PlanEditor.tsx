/**
 * Editing a plan proposal. The proposal is read as text (PlanDoc); a step or
 * a part opens for editing only when the user asks, or everything at once
 * with «Rediger alt». The user curates the agent's proposal before approving.
 */
import { useState } from 'react';
import { matchProduct, productKey } from '../../domain/agent';
import type { PlanElementPayload, PlanStepPayload, ProductRef } from '../../domain/agent';
import type { Id, MaterialRole, PaintProduct, Tables } from '../../domain/types';
import { ownershipOf } from '../../domain/views';
import { Badge, Button, OwnershipFlag, Swatch } from '../../ui/components';
import { ChangeBadge, ROLE_LABEL, StepRead, closeMenu, elementId } from './PlanDoc';
import type { DocElement } from './PlanDoc';
import './plan.css';

export { ROLE_LABEL };
const ROLES: MaterialRole[] = ['base', 'shade', 'layer', 'highlight', 'wash', 'glaze', 'mix', 'other'];

/** Paints the agent named that are not in the catalogue: choose a product or create it as unconfirmed. */
export function MissingPaints({ missing, products, choices, setChoices }: {
  missing: ProductRef[];
  products: PaintProduct[];
  choices: Record<string, Id | 'create'>;
  setChoices: (c: Record<string, Id | 'create'>) => void;
}) {
  if (!missing.length) return null;
  const open = missing.filter((r) => !choices[productKey(r)]).length;
  return (
    <div className="plan-missing" id="plan-mangler">
      <div className="plan-missing-head">
        <strong>Ikke i katalogen</strong>
        {open > 0 && (
          <button type="button" className="link small" onClick={() => setChoices({ ...choices, ...Object.fromEntries(missing.filter((r) => !choices[productKey(r)]).map((r) => [productKey(r), 'create' as const])) })}>
            Opprett alle
          </button>
        )}
      </div>
      <ul>
        {missing.map((r) => {
          const key = productKey(r);
          return (
            <li key={key}>
              <Swatch hex={r.hex ?? null} size={18} />
              <span><strong>{r.name}</strong> <span className="small muted">{[r.manufacturer, r.range].filter(Boolean).join(' · ') || 'ukjent produsent'}</span></span>
              <select aria-label={`Produkt for ${r.name}`} value={choices[key] ?? ''} onChange={(e) => setChoices({ ...choices, [key]: e.target.value as Id | 'create' })}>
                <option value="">Velg …</option>
                <option value="create">Opprett som ubekreftet produkt</option>
                {products.map((x) => <option key={x.id} value={x.id}>{x.name}{x.manufacturer ? ` (${x.manufacturer})` : ''}</option>)}
              </select>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface ElementProps {
  el: PlanElementPayload;
  doc: DocElement;
  index: number;
  products: PaintProduct[];
  t: Tables;
  editAll: boolean;
  onChange: (fn: (e: PlanElementPayload) => void) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}

/** One part of a proposal: read as text, with editing per step and a «⋯» menu for the part. */
export function ElementBlock(p: ElementProps) {
  const { el, doc, index, onChange } = p;
  const [editing, setEditing] = useState<number | null>(null);
  const [renaming, setRenaming] = useState(false);
  if (p.editAll) return <ElementEditor {...p} />;

  return (
    <section id={elementId(index)} className={`pd-el ${el.kind}`}>
      <div className="pd-el-head">
        {renaming ? (
          <span className="pd-rename">
            <input aria-label="Navn på delen" value={el.name} autoFocus onChange={(e) => onChange((x) => { x.name = e.target.value; })}
              onKeyDown={(e) => { if (e.key === 'Enter') setRenaming(false); }} />
            <select aria-label="Type" value={el.kind} onChange={(e) => onChange((x) => { x.kind = e.target.value as 'operation' | 'part'; })}>
              <option value="operation">Felles operasjon</option>
              <option value="part">Del</option>
            </select>
            <Button onClick={() => setRenaming(false)}>Ferdig</Button>
          </span>
        ) : (
          <h3>{el.name} <ChangeBadge change={doc.change} /></h3>
        )}
        <details className="pd-more">
          <summary aria-label={`Flere valg for ${el.name}`}>⋯</summary>
          <div className="pd-menu">
            <button type="button" onClick={(e) => { closeMenu(e); setRenaming(true); }}>Gi nytt navn</button>
            <button type="button" onClick={(e) => { closeMenu(e); onChange((x) => { x.steps.push({ instruction: '', materials: [], mix: null }); }); setEditing(el.steps.length); }}>Legg til steg</button>
            <button type="button" onClick={(e) => { closeMenu(e); p.onMove(-1); }}>Flytt opp</button>
            <button type="button" onClick={(e) => { closeMenu(e); p.onMove(1); }}>Flytt ned</button>
            <button type="button" className="danger" onClick={(e) => { closeMenu(e); p.onRemove(); }}>Fjern delen</button>
          </div>
        </details>
      </div>
      <ol>
        {el.steps.map((st, si) => (
          <li key={si}>
            {editing === si ? (
              <div className="pd-editing">
                <StepEditor st={st} products={p.products} t={p.t} onChange={(fn) => onChange((x) => fn(x.steps[si]!))} />
                <span className="pd-editing-actions">
                  <button type="button" className="link small danger" onClick={() => { onChange((x) => { x.steps.splice(si, 1); }); setEditing(null); }}>Fjern steget</button>
                  <Button onClick={() => setEditing(null)}>Ferdig</Button>
                </span>
              </div>
            ) : (
              <StepRead s={doc.steps[si] ?? { instruction: st.instruction, materials: [], mix: null, change: null }}
                actions={<button type="button" className="link small" onClick={() => setEditing(si)} aria-label={`Rediger steg ${si + 1} i ${el.name}`}>Rediger</button>} />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** The full form for a part («Rediger alt»). */
function ElementEditor({ el, index, products, t, onChange, onRemove, onMove }: ElementProps) {
  return (
    <section id={elementId(index)} className={`plan-el ${el.kind}`}>
      <div className="plan-el-head">
        <select aria-label="Type" value={el.kind} onChange={(e) => onChange((x) => { x.kind = e.target.value as 'operation' | 'part'; })}>
          <option value="operation">Felles operasjon</option>
          <option value="part">Del</option>
        </select>
        <input aria-label="Navn på delen" value={el.name} onChange={(e) => onChange((x) => { x.name = e.target.value; })} />
        <span className="plan-el-actions">
          <button type="button" className="link small" onClick={() => onMove(-1)} aria-label="Flytt opp">↑</button>
          <button type="button" className="link small" onClick={() => onMove(1)} aria-label="Flytt ned">↓</button>
          <button type="button" className="link small danger" onClick={onRemove}>Fjern del</button>
        </span>
      </div>
      <ol>
        {el.steps.map((st, si) => (
          <li key={si}>
            <StepEditor st={st} products={products} t={t} onChange={(fn) => onChange((x) => fn(x.steps[si]!))}
              onRemove={() => onChange((x) => { x.steps.splice(si, 1); })} />
          </li>
        ))}
      </ol>
      <button type="button" className="link small" onClick={() => onChange((x) => { x.steps.push({ instruction: '', materials: [], mix: null }); })}>+ Legg til steg</button>
    </section>
  );
}

function StepEditor({ st, products, t, onChange, onRemove }: {
  st: PlanStepPayload;
  products: PaintProduct[];
  t: Tables;
  onChange: (fn: (s: PlanStepPayload) => void) => void;
  onRemove?: () => void;
}) {
  const fromProduct = (p: PaintProduct): ProductRef => ({ manufacturer: p.manufacturer, range: p.range_name, name: p.name, hex: p.swatch_hex });
  return (
    <div className="plan-step">
      <textarea aria-label="Instruks" rows={2} value={st.instruction} placeholder="Hva gjør du i dette steget?" onChange={(e) => onChange((x) => { x.instruction = e.target.value; })} />
      <ul className="plan-mats">
        {st.materials.map((m, mi) => {
          const match = matchProduct(t, m.product);
          return (
            <li key={mi}>
              <Swatch hex={match?.swatch_hex ?? m.product.hex ?? null} size={18} />
              <select aria-label="Rolle" value={m.role} onChange={(e) => onChange((x) => { x.materials[mi]!.role = e.target.value as MaterialRole; })}>
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
              <select aria-label="Maling" value={match?.id ?? '__agent'} onChange={(e) => {
                const p = products.find((x) => x.id === e.target.value);
                if (p) onChange((x) => { x.materials[mi]!.product = fromProduct(p); });
              }}>
                {!match && <option value="__agent">{m.product.name}{m.product.manufacturer ? ` (${m.product.manufacturer})` : ''} – agentens forslag</option>}
                {products.map((x) => <option key={x.id} value={x.id}>{x.name}{x.manufacturer ? ` (${x.manufacturer})` : ''}</option>)}
              </select>
              {match ? ownershipOf(t, match.id) !== 'owns' && <OwnershipFlag ownership={ownershipOf(t, match.id)} /> : <Badge tone="warn">Ny</Badge>}
              <button type="button" className="link small" onClick={() => onChange((x) => { x.materials.splice(mi, 1); })} aria-label={`Fjern ${m.product.name} fra steget`}>×</button>
            </li>
          );
        })}
        {st.mix && <li className="small muted">Blanding: {st.mix.components.map((c) => `${c.parts} ${c.product.name}`).join(' + ')}</li>}
      </ul>
      <div className="plan-step-actions">
        <select aria-label="Legg til maling" value="" onChange={(e) => {
          const p = products.find((x) => x.id === e.target.value);
          if (p) onChange((x) => { x.materials.push({ product: fromProduct(p), role: 'base', role_label: null }); });
        }}>
          <option value="">+ Legg til maling …</option>
          {products.map((x) => <option key={x.id} value={x.id}>{x.name}{x.manufacturer ? ` (${x.manufacturer})` : ''}</option>)}
        </select>
        {onRemove && <button type="button" className="link small danger" onClick={onRemove}>Fjern steg</button>}
      </div>
    </div>
  );
}
