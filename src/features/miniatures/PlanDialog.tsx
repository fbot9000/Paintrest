/**
 * Maleplan for én miniatyr. The agent looks at the pictures the user chose,
 * reads painting guides, and proposes approach, parts, steps with exact paints,
 * and a palette. The user edits the proposal freely and approves it; approval
 * writes a new plan version and the miniature's palette (skjema §8).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, useView } from '../../app/context';
import { buildAgentContext, matchProduct, planProductRefs, productKey } from '../../domain/agent';
import type { PaintPlanPayload, PlanElementPayload, PlanStepPayload, ProductRef } from '../../domain/agent';
import type { ResearchEvent } from '../../domain/ai';
import type { Id, MaterialRole, PaintProduct, Tables } from '../../domain/types';
import { ownershipOf, paintingView, subjectReferences } from '../../domain/views';
import { runAgentTurn } from '../../data/agent-runner';
import { Badge, Button, Dialog, ErrorNote, FileImage, OwnershipFlag, Swatch } from '../../ui/components';
import { imageDataUrl } from '../../ui/imageData';
import { LiveSteps, useAgentActions } from '../agent/AgentPanel';
import './plan.css';

const ROLES: MaterialRole[] = ['base', 'shade', 'layer', 'highlight', 'wash', 'glaze', 'mix', 'other'];
const ROLE_LABEL: Record<MaterialRole, string> = {
  base: 'Base', shade: 'Shade', layer: 'Lag', highlight: 'Høylys', wash: 'Wash', glaze: 'Glasur', mix: 'Blanding', other: 'Annet',
};

function view(t: Tables, subject_id: Id, project_id: Id) {
  const s = t.miniature_subject[subject_id];
  if (!s) return null;
  const game = t.game[t.project[s.project_id]?.game_id ?? '']?.primary_name ?? '';
  const images = subjectReferences(t, s).map((r) => ({ ...r, cover: r.asset.id === s.official_asset_id }));
  const openTasks = new Set(Object.values(t.research_task).filter((x) => x.status === 'open' && t.task_scope[x.id]?.work_project_id === project_id).map((x) => x.id));
  const proposal = Object.values(t.research_proposal)
    .filter((p) => p.decision === 'pending' && (p.result_type === 'paint_plan' || p.result_type === 'plan_revision') && openTasks.has(p.task_id)
      && (p.payload as PaintPlanPayload).subject_id === subject_id)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null;
  const current = paintingView(t, subject_id);
  const products = Object.values(t.paint_product).filter((p) => !p.deleted_at).sort((a, b) => a.name.localeCompare(b.name, 'nb'));
  return { s, game, images, proposal, current, products, t };
}

export function PlanDialog({ subjectId, projectId, onClose }: { subjectId: Id; projectId: Id; onClose: () => void }) {
  const app = useApp();
  const data = useView((t) => view(t, subjectId, projectId), [subjectId, projectId]);
  const actions = useAgentActions(projectId);
  const [chosen, setChosen] = useState<Set<Id> | null>(null);
  const [busy, setBusy] = useState<null | 'ai' | 'save' | 'approve'>(null);
  const [live, setLive] = useState<ResearchEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<PaintPlanPayload | null>(null);
  const [choices, setChoices] = useState<Record<string, Id | 'create'>>({});
  const abortRef = useRef<AbortController | null>(null);

  // Default picture choice: the illustration plus up to three more.
  useEffect(() => {
    if (data && chosen === null) {
      const ids = [...data.images].sort((a, b) => Number(b.cover) - Number(a.cover)).slice(0, 4).map((r) => r.asset.id);
      setChosen(new Set(ids));
    }
  }, [data, chosen]);

  // Start editing from the latest proposal; keep local edits until saved.
  const proposalId = data?.proposal?.id ?? null;
  const proposalStamp = data?.proposal?.updated_at ?? null;
  useEffect(() => {
    setDraft(data?.proposal ? structuredClone(data.proposal.payload as PaintPlanPayload) : null);
    setChoices({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposalId, proposalStamp]);

  if (!data) return null;
  const { s, proposal, current } = data;
  const hasPlan = !!current?.elements.length;

  const run = async () => {
    setBusy('ai'); setError(null); setLive([]);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const task = await actions.ensureTask();
      if (s.current_plan_version_id) await app.research.openRevisionTarget(task, s.id);
      const ref = Object.entries(buildAgentContext(app.store.getTables(), task).subjectRefs).find(([, id]) => id === s.id)?.[0] ?? s.name;
      const picked = data.images.filter((r) => chosen?.has(r.asset.id));
      const reference_images = (await Promise.all(picked.map((r) => imageDataUrl(app.store.getTables(), app.cmd, r.file_id)))).filter((x): x is string => !!x);
      const prompt = `Lag en maleplan for «${s.name}» fra «${data.game}» som gjenskaper uttrykket i bildene jeg har valgt: arbeidsmåte, deler og steg med eksakte malinger, og en palett.`;
      await runAgentTurn({ store: app.store, research: app.research, agent: app.agent, ai: app.ai }, task, prompt,
        (e) => setLive((cur) => [...cur, e]), ac.signal,
        { kind: 'plan', subject_ref: ref, subject_name: s.name, game: data.game, reference_images, revision: !!s.current_plan_version_id });
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null); abortRef.current = null;
    }
  };

  const refs = draft ? planProductRefs(draft) : [];
  const unresolved = refs.filter((r) => !matchProduct(data.t, r) && !choices[productKey(r)]);

  const saveDraft = async () => {
    if (!proposal || !draft) return;
    setBusy('save'); setError(null);
    try { await app.research.editPlanProposal(proposal.id, draft); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(null); }
  };

  const approve = async () => {
    if (!proposal || !draft) return;
    setBusy('approve'); setError(null);
    try {
      await app.research.editPlanProposal(proposal.id, draft);
      await app.research.approveProposal(proposal.id, { product_choices: choices });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const update = (fn: (d: PaintPlanPayload) => void) => setDraft((cur) => {
    if (!cur) return cur;
    const next = structuredClone(cur);
    fn(next);
    return next;
  });

  return (
    <Dialog
      open
      xwide
      onClose={() => { abortRef.current?.abort(); onClose(); }}
      title={`Maleplan for ${s.name}`}
      footer={<>
        {proposal && <Button variant="ghost" className="push-left" disabled={!!busy} onClick={() => app.research.rejectProposal(proposal.id)}>Forkast forslaget</Button>}
        <Button onClick={onClose}>Lukk</Button>
        {proposal && <Button disabled={!!busy} onClick={saveDraft}>{busy === 'save' ? 'Lagrer …' : 'Lagre endringer'}</Button>}
        {proposal && (
          <Button variant="primary" disabled={!!busy || unresolved.length > 0} onClick={approve}>
            {busy === 'approve' ? 'Godkjenner …' : proposal.result_type === 'plan_revision' ? 'Godkjenn som ny versjon' : 'Godkjenn maleplanen'}
          </Button>
        )}
      </>}
    >
      <div className="plan-layout">
        <aside className="plan-images">
          <h3 className="eyebrow">Bilder planen bygger på</h3>
          {data.images.length === 0 ? (
            <p className="small muted">Miniatyren har ingen bilder. Legg til bilder først, så agenten har noe å se på. Uten bilder bygger den på kilder og beskrivelser.</p>
          ) : (
            <>
              <div className="plan-thumbs">
                {data.images.map((r) => {
                  const on = chosen?.has(r.asset.id) ?? false;
                  return (
                    <button key={r.asset.id} type="button" className={`plan-thumb ${on ? 'on' : ''}`} aria-pressed={on}
                      onClick={() => setChosen((cur) => {
                        const n = new Set(cur ?? []);
                        if (n.has(r.asset.id)) n.delete(r.asset.id); else if (n.size < 4) n.add(r.asset.id);
                        return n;
                      })}>
                      <FileImage fileId={r.file_id} alt={r.label} className="plan-thumb-img" />
                      {r.cover && <span className="plan-cover">Illustrasjon</span>}
                      {on && <span className="plan-check" aria-hidden>✓</span>}
                    </button>
                  );
                })}
              </div>
              <p className="small muted">{chosen?.size ?? 0} av høyst 4 valgt. Agenten ser på disse.</p>
            </>
          )}
          {hasPlan && current && (
            <div className="plan-current">
              <h3 className="eyebrow">Gjeldende plan · v{current.plan?.version_number}</h3>
              {current.plan?.summary && <p className="small">{current.plan.summary}</p>}
              <ul>{current.elements.map((e) => <li key={e.element.id} className="small">{e.element.name} · {e.steps.length} steg</li>)}</ul>
            </div>
          )}
        </aside>

        <section className="plan-main">
          {!proposal && (
            <div className="plan-start">
              <p>
                Agenten ser på bildene, leter etter maleguider for figuren og foreslår arbeidsmåte, deler og steg med eksakte malinger,
                og en palett for miniatyren. Den foretrekker malinger du eier. Du kan endre alt før du godkjenner.
                {hasPlan && ' Godkjent forslag blir en ny versjon av planen; den gamle beholdes.'}
              </p>
              <Button variant="primary" onClick={run} disabled={!!busy}>{busy === 'ai' ? 'Lager forslag …' : hasPlan ? 'Lag ny versjon med AI' : 'Lag maleplan med AI'}</Button>
            </div>
          )}
          {busy === 'ai' && <div className="plan-live"><LiveSteps events={live} onStop={() => abortRef.current?.abort()} /></div>}

          {proposal && draft && (
            <PlanEditor
              draft={draft}
              update={update}
              products={data.products}
              t={data.t}
              choices={choices}
              setChoices={setChoices}
              unresolvedCount={unresolved.length}
              onRetry={run}
              busy={!!busy}
            />
          )}
          <ErrorNote error={error ?? proposal?.last_error ?? null} onClose={() => setError(null)} />
        </section>
      </div>
    </Dialog>
  );
}

function PlanEditor({ draft, update, products, t, choices, setChoices, unresolvedCount, onRetry, busy }: {
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
