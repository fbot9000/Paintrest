/**
 * Maleplan: the agent's proposal or the approved plan, read as text.
 * A proposal has a status line on top (what it changes, approve, edit,
 * discard); steps open for editing one at a time, or all with «Rediger alt».
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useApp, useView } from '../../app/context';
import type { Run } from '../../app/runs';
import { matchProduct, planProductRefs, productKey } from '../../domain/agent';
import type { PaintPlanPayload } from '../../domain/agent';
import type { Id, MiniatureSubject, Tables } from '../../domain/types';
import { paintingView, subjectPalette } from '../../domain/views';
import { Button, ErrorNote } from '../../ui/components';
import { startPlan } from './agentRuns';
import { ElementBlock, MissingPaints, SourcesUsed } from './PlanEditor';
import { Outline, PaletteStrip, PlanRead, docFromPayload, docFromView, markChanges } from './PlanDoc';

function view(t: Tables, s: MiniatureSubject) {
  const openTasks = new Set(Object.values(t.research_task).filter((x) => x.status === 'open' && t.task_scope[x.id]?.work_project_id === s.project_id).map((x) => x.id));
  const proposal = Object.values(t.research_proposal)
    .filter((p) => p.decision === 'pending' && (p.result_type === 'paint_plan' || p.result_type === 'plan_revision') && openTasks.has(p.task_id)
      && (p.payload as PaintPlanPayload).subject_id === s.id)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null;
  return {
    proposal,
    current: paintingView(t, s.id),
    palette: subjectPalette(t, s).map((p) => ({ name: p.product.name, hex: p.product.swatch_hex })),
    products: Object.values(t.paint_product).filter((p) => !p.deleted_at).sort((a, b) => a.name.localeCompare(b.name, 'nb')),
    t,
  };
}

export function PlanTab({ subject: s, game, run, planFileIds }: { subject: MiniatureSubject; game: string; run: Run | null; planFileIds: (Id | null)[] }) {
  const app = useApp();
  const navigate = useNavigate();
  const data = useView((t) => view(t, s), [s]);
  const [draft, setDraft] = useState<PaintPlanPayload | null>(null);
  const [choices, setChoices] = useState<Record<string, Id | 'create'>>({});
  const [busy, setBusy] = useState<null | 'save' | 'approve'>(null);
  const [error, setError] = useState<string | null>(null);
  const [editAll, setEditAll] = useState(false);
  const [editSummary, setEditSummary] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  const proposalId = data.proposal?.id ?? null;
  const stamp = data.proposal?.updated_at ?? null;

  useEffect(() => {
    setDraft(data.proposal ? structuredClone(data.proposal.payload as PaintPlanPayload) : null);
    setChoices({}); setEditAll(false); setEditSummary(false); setShowCurrent(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposalId, stamp]);

  const running = run?.status === 'running';
  const current = data.current;
  const hasPlan = !!current?.elements.length;
  const currentDoc = useMemo(() => (current && hasPlan ? docFromView(current) : []), [current, hasPlan]);
  const diff = useMemo(() => {
    if (!draft) return null;
    const doc = docFromPayload(data.t, draft);
    return hasPlan ? markChanges(doc, currentDoc) : { elements: doc, changed: 0, added: 0, removed: [] as string[] };
  }, [draft, data.t, hasPlan, currentDoc]);
  const refs = draft ? planProductRefs(draft) : [];
  const missing = refs.filter((r) => !matchProduct(data.t, r));
  const unresolved = missing.filter((r) => !choices[productKey(r)]);
  const dirty = !!draft && !!data.proposal && JSON.stringify(draft) !== JSON.stringify(data.proposal.payload);
  const openPalette = () => navigate(`/p/${s.project_id}/m/${s.id}/palett`);

  const update = (fn: (d: PaintPlanPayload) => void) => setDraft((cur) => {
    if (!cur) return cur;
    const next = structuredClone(cur);
    fn(next);
    return next;
  });

  const act = async (kind: 'save' | 'approve') => {
    if (!data.proposal || !draft) return;
    setBusy(kind); setError(null);
    try {
      await app.research.editPlanProposal(data.proposal.id, draft);
      if (kind === 'approve') await app.research.approveProposal(data.proposal.id, { product_choices: choices });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const start = () => startPlan(app, s, game, planFileIds);
  const n = planFileIds.length;
  const revision = hasPlan && !!data.proposal;
  const nextVersion = (current?.plan?.version_number ?? 0) + 1;

  return (
    <div className="wsp">
      <div className="ws-toolbar">
        <div>
          <h2>Maleplan</h2>
          {!data.proposal && hasPlan && <p className="small muted">Gjeldende plan · versjon {current?.plan?.version_number}</p>}
        </div>
        <div className="ws-toolbar-actions">
          {!data.proposal && (
            <Button variant={hasPlan ? 'secondary' : 'primary'} disabled={running} onClick={start}>
              {running ? 'Agenten lager forslag …' : hasPlan ? 'Lag ny versjon med AI' : 'Lag maleplan med AI'}
            </Button>
          )}
        </div>
      </div>
      <ErrorNote error={error ?? data.proposal?.last_error ?? null} onClose={() => setError(null)} />

      {data.proposal && draft && diff ? (
        <>
          <div className="pd-status" role="region" aria-label="Status for forslaget">
            <div className="pd-status-text">
              <strong>{revision ? `Forslag til versjon ${nextVersion}` : 'Forslag til maleplan'}</strong>
              <span className="small">
                {revision
                  ? [diff.changed && `${diff.changed} ${diff.changed === 1 ? 'endret steg' : 'endrede steg'}`, diff.added && `${diff.added} ${diff.added === 1 ? 'nytt steg' : 'nye steg'}`, diff.removed.length && `fjerner ${diff.removed.join(', ')}`].filter(Boolean).join(' · ') || 'Ingen endringer i stegene'
                  : `${draft.elements.length} deler · ${draft.elements.reduce((a, e) => a + e.steps.length, 0)} steg`}
                {unresolved.length > 0 && <> · <a href="#plan-mangler" className="pd-status-warn">{unresolved.length} {unresolved.length === 1 ? 'maling må' : 'malinger må'} velges før godkjenning</a></>}
                {dirty && ' · ulagrede endringer'}
              </span>
            </div>
            <div className="pd-status-actions">
              {dirty && <Button disabled={!!busy} onClick={() => act('save')}>{busy === 'save' ? 'Lagrer …' : 'Lagre endringer'}</Button>}
              <Button variant="ghost" onClick={() => setEditAll((v) => !v)} aria-pressed={editAll}>{editAll ? 'Ferdig med redigering' : 'Rediger alt'}</Button>
              <Button variant="ghost" disabled={!!busy} onClick={() => app.research.rejectProposal(data.proposal!.id)}>Forkast</Button>
              <Button variant="primary" disabled={!!busy || unresolved.length > 0} onClick={() => act('approve')}>
                {busy === 'approve' ? 'Godkjenner …' : revision ? `Godkjenn som versjon ${nextVersion}` : 'Godkjenn maleplanen'}
              </Button>
            </div>
          </div>

          {revision && (
            <div className="pd-switch" role="group" aria-label="Vis">
              <button type="button" aria-pressed={!showCurrent} onClick={() => setShowCurrent(false)}>Forslaget</button>
              <button type="button" aria-pressed={showCurrent} onClick={() => setShowCurrent(true)}>Gjeldende versjon {current?.plan?.version_number}</button>
            </div>
          )}

          {showCurrent && current ? (
            <>
              {current.plan?.summary && <p className="pd-summary">{current.plan.summary}</p>}
              <Outline elements={currentDoc} />
              <PlanRead elements={currentDoc} />
            </>
          ) : (
            <>
              <MissingPaints missing={missing} products={data.products} choices={choices} setChoices={setChoices} />
              {editSummary || editAll ? (
                <div className="pd-summary-edit">
                  <label htmlFor="plan-summary" className="eyebrow">Arbeidsmåte og fargevalg</label>
                  <textarea id="plan-summary" value={draft.summary ?? ''} rows={4} onChange={(e) => update((d) => { d.summary = e.target.value; })} />
                  {!editAll && <span><Button onClick={() => setEditSummary(false)}>Ferdig</Button></span>}
                </div>
              ) : (
                <p className="pd-summary">
                  {draft.summary || <em className="muted">Ingen beskrivelse av arbeidsmåten.</em>}{' '}
                  <button type="button" className="link small" onClick={() => setEditSummary(true)}>Rediger</button>
                </p>
              )}
              <PaletteStrip items={(draft.palette ?? []).map((p) => ({ name: p.product.name, hex: matchProduct(data.t, p.product)?.swatch_hex ?? p.product.hex ?? null }))}
                note="Legges i Palett-fanen når du godkjenner, og redigeres der." />
              <Outline elements={diff.elements} />
              <div className="pd-elements">
                {draft.elements.map((el, ei) => (
                  <ElementBlock key={ei} el={el} doc={diff.elements[ei]!} index={ei} products={data.products} t={data.t} editAll={editAll}
                    onChange={(fn) => update((d) => fn(d.elements[ei]!))}
                    onRemove={() => update((d) => { d.elements.splice(ei, 1); })}
                    onMove={(dir) => update((d) => { const [x] = d.elements.splice(ei, 1); d.elements.splice(Math.max(0, ei + dir), 0, x!); })} />
                ))}
                <span><Button onClick={() => update((d) => { d.elements.push({ kind: 'part', name: `Ny del ${d.elements.length + 1}`, steps: [{ instruction: '', materials: [], mix: null }] }); })}>+ Legg til del</Button></span>
              </div>
              <SourcesUsed sources={draft.sources_read ?? []} />
              <p className="small muted">Ikke fornøyd? <button type="button" className="link small" onClick={start} disabled={!!busy || running}>Be agenten lage et nytt forslag</button>. Endringene dine her beholdes til du forkaster dette forslaget.</p>
            </>
          )}
        </>
      ) : hasPlan && current ? (
        <>
          {current.plan?.summary && <p className="pd-summary">{current.plan.summary}</p>}
          <PaletteStrip items={data.palette} note="" onOpen={openPalette} />
          <Outline elements={currentDoc} />
          <PlanRead elements={currentDoc} />
        </>
      ) : (
        <div className="ws-empty">
          <p>{running ? 'Agenten lager et forslag. Du kan følge med til høyre, eller gjøre noe annet i mellomtiden.' : 'Miniatyren har ingen maleplan ennå.'}</p>
          {!running && <p className="small muted">Velg bildene planen skal bygge på i kolonnen til venstre, og trykk «Lag maleplan med AI».</p>}
        </div>
      )}

      <details className="wsp-help">
        <summary className="small">Hvordan lager agenten maleplanen?</summary>
        <p className="small muted">
          Agenten ser på {n ? `${n} ${n === 1 ? 'valgt bilde' : 'valgte bilder'}` : 'miniatyren (ingen bilder valgt)'} av miniatyren, leser maleguider og foreslår arbeidsmåte,
          deler og steg med eksakte malinger, og en palett. Du velger bildene med «I planen» i kolonnen til venstre (høyst 4).
          Et forslag endrer ingenting før du godkjenner det, og en ny versjon beholder den gamle som historikk.
        </p>
      </details>
    </div>
  );
}
