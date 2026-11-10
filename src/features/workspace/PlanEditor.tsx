/**
 * Editor for a plan proposal: approach, palette, parts and steps with paints.
 * The user curates the agent's proposal freely before approving it.
 */
import { useMemo } from 'react';
import { matchProduct, planProductRefs, productKey } from '../../domain/agent';
import type { PaintPlanPayload, PlanElementPayload, PlanStepPayload, ProductRef } from '../../domain/agent';
import type { Id, MaterialRole, PaintProduct, Tables } from '../../domain/types';
import { ownershipOf } from '../../domain/views';
import { Badge, Button, OwnershipFlag, Swatch } from '../../ui/components';
import './plan.css';

const ROLES: MaterialRole[] = ['base', 'shade', 'layer', 'highlight', 'wash', 'glaze', 'mix', 'other'];
export const ROLE_LABEL: Record<MaterialRole, string> = {
  base: 'Base', shade: 'Shade', layer: 'Lag', highlight: 'Høylys', wash: 'Wash', glaze: 'Glasur', mix: 'Blanding', other: 'Annet',
};

export function PlanEditor({ draft, update, products, t, choices, setChoices, unresolvedCount, onRetry, busy }: {
  draft: PaintPlanPayload;
  update: (fn: (d: PaintPlanPayload) => void) => void;
  products: PaintProduct[];
  t: Tables;
  choices: Record<string, Id | 'create'>;
  setChoices: (c: Record<string, Id | 'create'>) => void;
  unresolvedCount: number;
  onRetry: () => void;
  busy: boolean;
}) {
  const refs = useMemo(() => planProductRefs(draft), [draft]);
  const missing = refs.filter((r) => !matchProduct(t, r));
  const swatch = (r: ProductRef) => matchProduct(t, r)?.swatch_hex ?? r.hex ?? null;

  return (
    <div className="plan-editor">
      <div className="plan-summary">
        <label htmlFor="plan-summary" className="eyebrow">Arbeidsmåte og fargevalg</label>
        <textarea id="plan-summary" value={draft.summary ?? ''} onChange={(e) => update((d) => { d.summary = e.target.value; })} rows={3} />
      </div>

      {(draft.palette?.length ?? 0) > 0 && (
        <div className="plan-palette">
          <span className="eyebrow">Palett for miniatyren ({draft.palette!.length})</span>
          <ul>
            {draft.palette!.map((p, i) => {
              const m = matchProduct(t, p.product);
              return (
                <li key={i}>
                  <Swatch hex={swatch(p.product)} size={26} />
                  <span className="plan-pal-name">
                    <strong>{p.product.name}</strong>
                    <span className="small muted">{[p.product.manufacturer, p.product.range].filter(Boolean).join(' · ')}</span>
                    <span className="small">{[p.part, p.role_label].filter(Boolean).join(' · ')}</span>
                  </span>
                  {m ? <OwnershipFlag ownership={ownershipOf(t, m.id)} /> : <Badge tone="warn">Ikke i katalogen</Badge>}
                  <button type="button" className="link small" onClick={() => update((d) => { d.palette!.splice(i, 1); })} aria-label={`Fjern ${p.product.name} fra paletten`}>Fjern</button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {missing.length > 0 && (
        <div className="plan-missing">
          <div className="plan-missing-head">
            <span className="eyebrow">Malinger som ikke finnes i katalogen ({missing.length})</span>
            <button type="button" className="link small" onClick={() => setChoices({ ...choices, ...Object.fromEntries(missing.filter((r) => !choices[productKey(r)]).map((r) => [productKey(r), 'create' as const])) })}>
              Opprett alle som ubekreftet
            </button>
          </div>
          <ul>
            {missing.map((r) => {
              const key = productKey(r);
              return (
                <li key={key}>
                  <Swatch hex={r.hex ?? null} size={20} />
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
          {unresolvedCount > 0 && <p className="small muted">Velg eller opprett {unresolvedCount} maling(er) før planen kan godkjennes.</p>}
        </div>
      )}

      <div className="plan-elements">
        {draft.elements.map((el, ei) => (
          <ElementEditor key={ei} el={el} products={products} t={t} swatch={swatch}
            onChange={(fn) => update((d) => fn(d.elements[ei]!))}
            onRemove={() => update((d) => { d.elements.splice(ei, 1); })}
            onMove={(dir) => update((d) => { const [x] = d.elements.splice(ei, 1); d.elements.splice(Math.max(0, ei + dir), 0, x!); })} />
        ))}
        <Button onClick={() => update((d) => { d.elements.push({ kind: 'part', name: `Ny del ${d.elements.length + 1}`, steps: [{ instruction: '', materials: [], mix: null }] }); })}>
          + Legg til del
        </Button>
      </div>

      {(draft.sources_read?.length ?? 0) > 0 && (
        <details className="img-read">
          <summary>Kilder agenten brukte ({draft.sources_read!.length})</summary>
          <ul>
            {draft.sources_read!.map((r) => (
              <li key={r.url}>
                <a href={r.url} target="_blank" rel="noreferrer">{r.title}</a>
                {r.summary && <p className="small">{r.summary}</p>}
                {r.original_excerpt && <p className="small muted img-orig" lang={r.language ?? undefined}>{r.original_excerpt}</p>}
              </li>
            ))}
          </ul>
        </details>
      )}
      <p className="small muted">Ikke fornøyd? <button type="button" className="link small" onClick={onRetry} disabled={busy}>Be agenten lage et nytt forslag</button>. Det erstatter ikke endringene dine før du forkaster dette.</p>
    </div>
  );
}

function ElementEditor({ el, products, t, swatch, onChange, onRemove, onMove }: {
  el: PlanElementPayload;
  products: PaintProduct[];
  t: Tables;
  swatch: (r: ProductRef) => string | null;
  onChange: (fn: (e: PlanElementPayload) => void) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  return (
    <section className={`plan-el ${el.kind}`}>
      <div className="plan-el-head">
        <select aria-label="Type" value={el.kind} onChange={(e) => onChange((x) => { x.kind = e.target.value as 'operation' | 'part'; })}>
          <option value="operation">Felles operasjon</option>
          <option value="part">Del</option>
        </select>
        <input aria-label="Navn på delen" value={el.name} onChange={(e) => onChange((x) => { x.name = e.target.value; })} />
        <span className="plan-el-actions">
          <button type="button" className="link small" onClick={() => onMove(-1)} aria-label="Flytt opp">↑</button>
          <button type="button" className="link small" onClick={() => onMove(1)} aria-label="Flytt ned">↓</button>
          <button type="button" className="link small" onClick={onRemove}>Fjern del</button>
        </span>
      </div>
      <ol>
        {el.steps.map((st, si) => (
          <li key={si}>
            <StepEditor st={st} products={products} t={t} swatch={swatch}
              onChange={(fn) => onChange((x) => fn(x.steps[si]!))}
              onRemove={() => onChange((x) => { x.steps.splice(si, 1); })} />
          </li>
        ))}
      </ol>
      <button type="button" className="link small" onClick={() => onChange((x) => { x.steps.push({ instruction: '', materials: [], mix: null }); })}>+ Legg til steg</button>
    </section>
  );
}

function StepEditor({ st, products, t, swatch, onChange, onRemove }: {
  st: PlanStepPayload;
  products: PaintProduct[];
  t: Tables;
  swatch: (r: ProductRef) => string | null;
  onChange: (fn: (s: PlanStepPayload) => void) => void;
  onRemove: () => void;
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
              <Swatch hex={swatch(m.product)} size={20} />
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
              {match ? <OwnershipFlag ownership={ownershipOf(t, match.id)} /> : <Badge tone="warn">Ny</Badge>}
              <button type="button" className="link small" onClick={() => onChange((x) => { x.materials.splice(mi, 1); })} aria-label="Fjern malingen">×</button>
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
        <button type="button" className="link small" onClick={onRemove}>Fjern steg</button>
      </div>
    </div>
  );
}
