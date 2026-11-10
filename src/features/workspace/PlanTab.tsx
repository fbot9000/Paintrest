/**
 * Maleplan: start the agent with the chosen pictures, edit its proposal and
 * approve it, or read the current plan. The run keeps going if the user leaves.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useApp, useView } from '../../app/context';
import type { Run } from '../../app/runs';
import { matchProduct, planProductRefs, productKey } from '../../domain/agent';
import type { PaintPlanPayload } from '../../domain/agent';
import type { Id, MiniatureSubject, Tables } from '../../domain/types';
import { paintingView } from '../../domain/views';
import { Button, ErrorNote, OwnershipFlag, Swatch } from '../../ui/components';
import { startPlan } from './agentRuns';
import { PlanEditor, ROLE_LABEL } from './PlanEditor';

function view(t: Tables, s: MiniatureSubject) {
  const openTasks = new Set(Object.values(t.research_task).filter((x) => x.status === 'open' && t.task_scope[x.id]?.work_project_id === s.project_id).map((x) => x.id));
  const proposal = Object.values(t.research_proposal)
    .filter((p) => p.decision === 'pending' && (p.result_type === 'paint_plan' || p.result_type === 'plan_revision') && openTasks.has(p.task_id)
      && (p.payload as PaintPlanPayload).subject_id === s.id)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null;
  return {
    proposal,
    current: paintingView(t, s.id),
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
  const proposalId = data.proposal?.id ?? null;
  const stamp = data.proposal?.updated_at ?? null;

  useEffect(() => {
    setDraft(data.proposal ? structuredClone(data.proposal.payload as PaintPlanPayload) : null);
    setChoices({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposalId, stamp]);

  const running = run?.status === 'running';
  const current = data.current;
  const hasPlan = !!current?.elements.length;
  const refs = draft ? planProductRefs(draft) : [];
  const unresolved = refs.filter((r) => !matchProduct(data.t, r) && !choices[productKey(r)]);

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

  return (
    <div className="wsp">
      <div className="ws-toolbar">
        <div>
          <h2>Maleplan</h2>
          <p className="small muted">
            Agenten ser på {planFileIds.length ? `${planFileIds.length} valgte bilder` : 'miniatyren (ingen bilder valgt)'}, leser maleguider og foreslår arbeidsmåte,
            deler og steg med eksakte malinger, og en palett. Velg bildene i kolonnen til venstre.
          </p>
        </div>
        <div className="ws-toolbar-actions">
          {hasPlan && <Button onClick={() => navigate(`/male/${s.id}`)}>Åpne i Painting Mode</Button>}
          {!data.proposal && (
            <Button variant="primary" disabled={running} onClick={start}>
              {running ? 'Agenten lager forslag …' : hasPlan ? 'Lag ny versjon med AI' : 'Lag maleplan med AI'}
            </Button>
          )}
        </div>
      </div>
      <ErrorNote error={error ?? data.proposal?.last_error ?? null} onClose={() => setError(null)} />

      {data.proposal && draft ? (
        <>
          <p className="small muted">
            {data.proposal.result_type === 'plan_revision' ? 'Forslag til ny versjon. Den gjeldende planen beholdes som historikk.' : 'Forslag til maleplan.'} Rediger fritt før du godkjenner.
          </p>
          <PlanEditor draft={draft} update={update} products={data.products} t={data.t} choices={choices} setChoices={setChoices}
            unresolvedCount={unresolved.length} onRetry={start} busy={!!busy || running} />
          <div className="ws-savebar">
            <span>{unresolved.length ? `Velg eller opprett ${unresolved.length} maling(er) før du godkjenner` : 'Klar til godkjenning'}</span>
            <span className="ws-savebar-actions">
              <Button variant="ghost" disabled={!!busy} onClick={() => app.research.rejectProposal(data.proposal!.id)}>Forkast forslaget</Button>
              <Button disabled={!!busy} onClick={() => act('save')}>{busy === 'save' ? 'Lagrer …' : 'Lagre endringer'}</Button>
              <Button variant="primary" disabled={!!busy || unresolved.length > 0} onClick={() => act('approve')}>
                {busy === 'approve' ? 'Godkjenner …' : data.proposal.result_type === 'plan_revision' ? 'Godkjenn som ny versjon' : 'Godkjenn maleplanen'}
              </Button>
            </span>
          </div>
        </>
      ) : hasPlan && current ? (
        <div className="wsp-current">
          <div className="wsp-current-head">
            <h3>Gjeldende plan · versjon {current.plan?.version_number}</h3>
          </div>
          {current.plan?.summary && <p className="wsp-summary">{current.plan.summary}</p>}
          {current.elements.map((ev) => (
            <section key={ev.element.id} className={`wsp-el ${ev.element.kind}`}>
              <h4>{ev.element.name} <span className="eyebrow">{ev.element.kind === 'operation' ? 'Felles operasjon' : 'Del'}</span></h4>
              <ol>
                {ev.steps.map((sv) => (
                  <li key={sv.step.id}>
                    <p>{sv.step.instruction || <em className="muted">Ingen instruks</em>}</p>
                    {sv.materials.length > 0 && (
                      <ul className="wsp-mats">
                        {sv.materials.map((m) => (
                          <li key={m.material.id}>
                            <Swatch hex={m.product.swatch_hex} size={18} />
                            <span className="small">{ROLE_LABEL[m.material.role]}</span>
                            <strong className="small">{m.product.name}</strong>
                            <span className="small muted">{[m.product.manufacturer, m.product.range_name].filter(Boolean).join(' · ')}</span>
                            <OwnershipFlag ownership={m.ownership} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          ))}
        </div>
      ) : (
        <div className="ws-empty">
          <p>{running ? 'Agenten lager et forslag. Du kan følge med til høyre, eller gjøre noe annet i mellomtiden.' : 'Miniatyren har ingen maleplan ennå.'}</p>
          {!running && <p className="small muted">Velg bildene planen skal bygge på i kolonnen til venstre, og trykk «Lag maleplan med AI».</p>}
        </div>
      )}
    </div>
  );
}
