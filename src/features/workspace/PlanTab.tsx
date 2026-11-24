/**
 * Maleplan: the agent's proposal, the approved plan, or the user's own edit of it,
 * read as text. A proposal or an edit has a status line on top (what it changes,
 * save, discard); steps open for editing one at a time, or all with «Rediger alt».
 * Before a new version is saved, the open deviations from Painting Mode are shown,
 * and the user chooses which become part of the plan (O-1, beslutning 24.11.2026).
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useApp, useView } from '../../app/context';
import type { Run } from '../../app/runs';
import { matchProduct, planProductRefs, productKey } from '../../domain/agent';
import type { PaintPlanPayload } from '../../domain/agent';
import { inheritLinks, openDeviations, payloadFromVersion, pendingPlanProposal } from '../../domain/plan-versions';
import type { Id, LocalDeviation, MiniatureSubject, Tables } from '../../domain/types';
import { paintingView, subjectPalette } from '../../domain/views';
import { Button, ErrorNote } from '../../ui/components';
import { startPlan } from './agentRuns';
import { DeviationChoice, toggleBake } from './DeviationChoice';
import type { Bake } from './DeviationChoice';
import { ElementBlock, MissingPaints } from './PlanEditor';
import { Outline, PaletteStrip, PlanRead, docFromPayload, docFromView, markChanges } from './PlanDoc';

function view(t: Tables, s: MiniatureSubject) {
  const proposal = pendingPlanProposal(t, s);
  return {
    proposal,
    current: paintingView(t, s.id),
    deviations: s.current_plan_version_id ? openDeviations(t, s.current_plan_version_id) : [],
    palette: subjectPalette(t, s).map((p) => ({ name: p.product.name, hex: p.product.swatch_hex })),
    products: Object.values(t.paint_product).filter((p) => !p.deleted_at).sort((a, b) => a.name.localeCompare(b.name, 'nb')),
    t,
  };
}

/** The user's own edit: the version it builds on, and where it started. */
interface Edit {
  base: Id | null;
  start: PaintPlanPayload;
}

const emptyPlan = (subject_id: Id): PaintPlanPayload => ({
  subject_id, note: null, summary: null,
  elements: [{ kind: 'part', name: 'Del 1', steps: [{ instruction: '', materials: [], mix: null }] }],
});

export function PlanTab({ subject: s, game, run, planFileIds }: { subject: MiniatureSubject; game: string; run: Run | null; planFileIds: (Id | null)[] }) {
  const app = useApp();
  const navigate = useNavigate();
  const data = useView((t) => view(t, s), [s]);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [draft, setDraft] = useState<PaintPlanPayload | null>(null);
  const [bakes, setBakes] = useState<Bake[]>([]);
  const [choices, setChoices] = useState<Record<string, Id | 'create'>>({});
  const [busy, setBusy] = useState<null | 'save' | 'approve'>(null);
  const [error, setError] = useState<string | null>(null);
  const [editAll, setEditAll] = useState(false);
  const [editSummary, setEditSummary] = useState(false);
  const [showCurrent, setShowCurrent] = useState(false);
  // An agent proposal comes first; the user's own edit is only possible when none is waiting.
  const proposal = edit ? null : data.proposal;
  const proposalId = proposal?.id ?? null;
  const stamp = proposal?.updated_at ?? null;

  useEffect(() => {
    setDraft(edit ? structuredClone(edit.start) : proposal ? inheritLinks(data.t, s.current_plan_version_id, structuredClone(proposal.payload as PaintPlanPayload)) : null);
    setBakes([]); setChoices({}); setEditAll(false); setEditSummary(false); setShowCurrent(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposalId, stamp, edit]);

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
  const dirty = !!draft && (edit ? JSON.stringify(draft) !== JSON.stringify(edit.start) : !!proposal && JSON.stringify(draft) !== JSON.stringify(inheritLinks(data.t, s.current_plan_version_id, proposal.payload as PaintPlanPayload)));
  const openPalette = () => navigate(`/p/${s.project_id}/m/${s.id}/palett`);
  // Deviations belong to the version the draft replaces.
  const baseVersion = edit ? edit.base : s.current_plan_version_id;
  const deviations = baseVersion === s.current_plan_version_id ? data.deviations : [];
  const stale = !!edit && edit.base !== (s.current_plan_version_id ?? null);

  const update = (fn: (d: PaintPlanPayload) => void) => setDraft((cur) => {
    if (!cur) return cur;
    const next = structuredClone(cur);
    fn(next);
    return next;
  });

  const bake = (d: LocalDeviation) => {
    if (!draft || !baseVersion) return;
    const r = toggleBake(data.t, baseVersion, draft, bakes, d);
    setDraft(r.draft); setBakes(r.bakes);
  };
  const baked = bakes.map((b) => b.id);

  const act = async (kind: 'save' | 'approve') => {
    if (!proposal || !draft) return;
    setBusy(kind); setError(null);
    try {
      await app.research.editPlanProposal(proposal.id, draft);
      if (kind === 'approve') await app.research.approveProposal(proposal.id, { product_choices: choices, baked_deviation_ids: baked });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const saveEdit = async () => {
    if (!edit || !draft) return;
    setBusy('approve'); setError(null);
    try {
      await app.cmd.savePlanVersion(s.id, { base_version_id: edit.base, payload: draft, baked_deviation_ids: baked });
      setEdit(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const startEdit = () => {
    setError(null);
    const base = s.current_plan_version_id ?? null;
    setEdit({ base, start: base && hasPlan ? payloadFromVersion(data.t, base) : emptyPlan(s.id) });
  };

  const start = (paints: 'owned' | 'best') => startPlan(app, s, game, planFileIds, paints);
  /** Two explicit choices instead of a hidden preference for paints the user owns. */
  const startButtons = (label: string, variant: 'primary' | 'secondary' | 'ghost', disabled: boolean) => (
    <span className="plan-start" role="group" aria-label={label}>
      <span className="small muted">{label}</span>
      <Button variant={variant} disabled={disabled} onClick={() => start('owned')} title={agentHelp}>Malinger jeg har</Button>
      <Button variant={variant} disabled={disabled} onClick={() => start('best')} title={agentHelp}>Beste valg</Button>
    </span>
  );
  const n = planFileIds.length;
  const revision = hasPlan && !!draft;
  const nextVersion = Math.max(current?.plan?.version_number ?? 0, 0) + 1;
  // When most steps changed, marking each one says nothing: say it once instead.
  const totalSteps = draft ? draft.elements.reduce((a, e) => a + e.steps.length, 0) : 0;
  const rewritten = !!diff && revision && diff.changed + diff.added > totalSteps / 2;
  const shown = diff && rewritten
    ? diff.elements.map((e) => ({ ...e, change: null, steps: e.steps.map((x) => ({ ...x, change: null })) }))
    : diff?.elements ?? [];
  const agentHelp = `Agenten ser på ${n ? `${n} ${n === 1 ? 'valgt bilde' : 'valgte bilder'}` : 'miniatyren'}, leser maleguider og foreslår arbeidsmåte, steg med eksakte malinger og en palett. Velg bilder med hakene i bildekolonnen.`;
  const changes = diff && revision
    ? (rewritten ? 'Planen er skrevet om'
      : [diff.changed && `${diff.changed} ${diff.changed === 1 ? 'endret steg' : 'endrede steg'}`, diff.added && `${diff.added} ${diff.added === 1 ? 'nytt steg' : 'nye steg'}`, diff.removed.length && `${diff.removed.length} ${diff.removed.length === 1 ? 'del fjernet' : 'deler fjernet'}`].filter(Boolean).join(', ') || 'Ingen endrede steg')
    : null;

  return (
    <div className="wsp">
      <ErrorNote error={error ?? proposal?.last_error ?? null} onClose={() => setError(null)} />

      {draft && diff && (proposal || edit) ? (
        <>
          <div className="pd-status" role="region" aria-label={edit ? 'Redigering' : 'Forslag'}>
            <div className="pd-status-text">
              <strong>{edit ? (hasPlan ? `Rediger planen: versjon ${nextVersion}` : 'Ny maleplan') : revision ? `Forslag til versjon ${nextVersion}` : 'Forslag til maleplan'}</strong>
              {!edit && draft.paint_choice && <span className="small">{draft.paint_choice === 'owned' ? 'Med malinger du har' : 'Beste valg'}</span>}
              {(changes || unresolved.length > 0 || (dirty && !edit)) && (
                <span className="small">
                  {[changes, dirty && !edit && 'ulagret'].filter(Boolean).join(' · ')}
                  {unresolved.length > 0 && <>{changes || (dirty && !edit) ? ' · ' : ''}<a href="#plan-mangler" className="pd-status-warn">{unresolved.length} {unresolved.length === 1 ? 'ukjent maling' : 'ukjente malinger'}</a></>}
                </span>
              )}
            </div>
            <div className="pd-status-actions">
              {!edit && dirty && <Button disabled={!!busy} onClick={() => act('save')}>{busy === 'save' ? 'Lagrer …' : 'Lagre'}</Button>}
              <Button variant="ghost" onClick={() => setEditAll((v) => !v)} aria-pressed={editAll}>{editAll ? 'Ferdig' : 'Rediger alt'}</Button>
              {edit ? (
                <>
                  <Button variant="ghost" disabled={!!busy} onClick={() => setEdit(null)}>Avbryt</Button>
                  <Button variant="primary" disabled={!!busy || stale || unresolved.length > 0} onClick={saveEdit}
                    title={stale ? 'Planen har fått en ny versjon mens du redigerte' : undefined}>
                    {busy ? 'Lagrer …' : hasPlan ? `Lagre som versjon ${nextVersion}` : 'Lagre planen'}
                  </Button>
                </>
              ) : (
                <>
                  {startButtons('Lag på nytt:', 'ghost', !!busy || running)}
                  <Button variant="ghost" disabled={!!busy} onClick={() => app.research.rejectProposal(proposal!.id)}>Forkast</Button>
                  <Button variant="primary" disabled={!!busy || unresolved.length > 0} onClick={() => act('approve')}
                    title={unresolved.length ? 'Velg produkt for de ukjente malingene først' : undefined}>
                    {busy === 'approve' ? 'Godkjenner …' : 'Godkjenn'}
                  </Button>
                </>
              )}
            </div>
          </div>

          {stale && <ErrorNote error="Planen har fått en ny versjon mens du redigerte. Avbryt og rediger den nye versjonen." />}

          {revision && (
            <div className="pd-switch" role="group" aria-label="Vis">
              <button type="button" aria-pressed={!showCurrent} onClick={() => setShowCurrent(false)}>{edit ? 'Endringen' : 'Forslaget'}</button>
              <button type="button" aria-pressed={showCurrent} onClick={() => setShowCurrent(true)}>Versjon {current?.plan?.version_number}</button>
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
              <DeviationChoice t={data.t} deviations={deviations} bakes={bakes} draft={draft} onToggle={bake} />
              <MissingPaints missing={missing} products={data.products} choices={choices} setChoices={setChoices} />
              {editSummary || editAll ? (
                <div className="pd-summary-edit">
                  <textarea aria-label="Arbeidsmåte og fargevalg" value={draft.summary ?? ''} rows={4} onChange={(e) => update((d) => { d.summary = e.target.value; })} />
                  {!editAll && <span><Button onClick={() => setEditSummary(false)}>Ferdig</Button></span>}
                </div>
              ) : (
                <div className="pd-summary-row">
                  <p className="pd-summary">{draft.summary || <em className="muted">Ingen beskrivelse.</em>}</p>
                  <button type="button" className="link small pd-hover" onClick={() => setEditSummary(true)}>Rediger</button>
                </div>
              )}
              {edit
                ? <PaletteStrip items={data.palette} onOpen={openPalette} />
                : <PaletteStrip items={(draft.palette ?? []).map((p) => ({ name: p.product.name, hex: matchProduct(data.t, p.product)?.swatch_hex ?? p.product.hex ?? null }))} />}
              {diff.removed.length > 0 && (
                <p className="small muted">Fjernet fra versjon {current?.plan?.version_number}: {diff.removed.join(', ')}</p>
              )}
              <Outline elements={shown} />
              <div className="pd-elements">
                {draft.elements.map((el, ei) => (
                  <ElementBlock key={ei} el={el} doc={shown[ei]!} index={ei} products={data.products} t={data.t} editAll={editAll}
                    onChange={(fn) => update((d) => fn(d.elements[ei]!))}
                    onRemove={() => update((d) => { d.elements.splice(ei, 1); })}
                    onMove={(dir) => update((d) => { const [x] = d.elements.splice(ei, 1); d.elements.splice(Math.max(0, ei + dir), 0, x!); })} />
                ))}
                <span><Button onClick={() => update((d) => { d.elements.push({ kind: 'part', name: `Ny del ${d.elements.length + 1}`, steps: [{ instruction: '', materials: [], mix: null }] }); })}>+ Legg til del</Button></span>
              </div>
            </>
          )}
        </>
      ) : hasPlan && current ? (
        <>
          <div className="pd-plan-head">
            <span className="small muted">Versjon {current.plan?.version_number}{data.deviations.length ? ` · ${data.deviations.length} ${data.deviations.length === 1 ? 'åpent avvik' : 'åpne avvik'}` : ''}</span>
            <Button variant="secondary" onClick={startEdit} disabled={running}>Rediger planen</Button>
            {running ? <span className="small muted">Agenten jobber …</span> : startButtons('Ny versjon med AI:', 'secondary', false)}
          </div>
          {current.plan?.summary && <p className="pd-summary">{current.plan.summary}</p>}
          <PaletteStrip items={data.palette} onOpen={openPalette} />
          <Outline elements={currentDoc} />
          <PlanRead elements={currentDoc} />
        </>
      ) : (
        <div className="ws-empty">
          <p>{running ? 'Agenten lager et forslag …' : 'Ingen maleplan ennå.'}</p>
          {!running && startButtons('Lag maleplan med AI:', 'primary', false)}
          {!running && <Button onClick={startEdit}>Skriv planen selv</Button>}
        </div>
      )}
    </div>
  );
}
