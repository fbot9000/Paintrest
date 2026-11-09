/**
 * Researchagent (spesifikasjon §4, datamodell v3 §12–13).
 * The panel only shows and sends; drafts are written by the agent command
 * set, and only the user's approval makes them canonical.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useApp, useView } from '../../app/context';
import { matchProduct, planProductRefs, productKey, proposalTitle } from '../../domain/agent';
import type { CatalogSubjectPayload, PaintPlanPayload } from '../../domain/agent';
import type { Id, ResearchProposal, Tables } from '../../domain/types';
import { ownershipOf } from '../../domain/views';
import { runAgentTurn } from '../../data/agent-runner';
import { Badge, Button, Dialog, ErrorNote, Field, OwnershipFlag, ProductName, Segmented, Stepper, Swatch } from '../../ui/components';
import './agent.css';

// ---------- Panel control shared with the project pages ----------

interface PanelCtl {
  open: boolean;
  setOpen: (v: boolean) => void;
  /** Opens the panel with text ready to send. */
  compose: (text: string) => void;
  draft: string;
  setDraft: (v: string) => void;
}

const PanelCtx = createContext<PanelCtl | null>(null);

export function AgentPanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(() => {
    try { return localStorage.getItem('paintrest.agentPanel') !== 'closed'; } catch { return true; }
  });
  const [draft, setDraft] = useState('');
  const setOpen = (v: boolean) => {
    setOpenState(v);
    try { localStorage.setItem('paintrest.agentPanel', v ? 'open' : 'closed'); } catch { /* per-viewer convenience only */ }
  };
  const value = useMemo<PanelCtl>(() => ({
    open, setOpen, draft, setDraft,
    compose: (text) => { setDraft(text); setOpen(true); },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [open, draft]);
  return <PanelCtx.Provider value={value}>{children}</PanelCtx.Provider>;
}

export function useAgentPanel(): PanelCtl {
  const c = useContext(PanelCtx);
  if (!c) throw new Error('AgentPanelProvider mangler');
  return c;
}

/** Actions the project pages use to hand work to the agent. */
export function useAgentActions(projectId: Id) {
  const app = useApp();
  const ctl = useAgentPanel();
  const ensureTask = async () => {
    const t = app.store.getTables();
    return researchView(t, projectId)?.task.id ?? app.research.startTask(projectId);
  };
  return {
    suggestPlan: (name: string) => ctl.compose(`Foreslå en maleplan for ${name}. `),
    /** Opens one plan as revision target: an explicit user action (datamodell v3 §12). */
    revisePlan: async (subjectId: Id, name: string) => {
      const task = await ensureTask();
      await app.research.openRevisionTarget(task, subjectId);
      ctl.compose(`Foreslå en ny versjon av maleplanen for ${name}. Dette bør endres: `);
    },
  };
}

// ---------- Read model ----------

function researchView(t: Tables, project_id: Id) {
  const task = Object.values(t.research_task)
    .filter((x) => x.status === 'open' && t.task_scope[x.id]?.work_project_id === project_id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (!task) return null;
  const messages = Object.values(t.research_message).filter((m) => m.task_id === task.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const proposals = Object.values(t.research_proposal).filter((p) => p.task_id === task.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const targets = Object.values(t.task_revision_target).filter((r) => r.task_id === task.id).map((r) => ({
    ...r,
    subject: t.miniature_subject[r.target_id]?.name ?? '?',
    version: t.paint_plan_version[r.base_version_id]?.version_number ?? 0,
    stale: t.miniature_subject[r.target_id]?.current_plan_version_id !== r.base_version_id,
  }));
  return { task, messages, proposals, targets };
}

type AiState = 'checking' | 'ready' | 'no-key' | 'no-server';

const PROMPTS = [
  'Kartlegg miniatyrene i spillet. Foreslå de som mangler i katalogen.',
  'Foreslå maleplaner for miniatyrene som ikke har plan. Bruk malinger jeg eier der det går.',
];

// ---------- Panel ----------

export function AgentPanel({ projectId }: { projectId: Id }) {
  const app = useApp();
  const ctl = useAgentPanel();
  const view = useView((t) => researchView(t, projectId), [projectId]);
  const titles = useView((t) => Object.fromEntries((view?.proposals ?? []).map((p) => [p.id, proposalTitle(t, p.result_type, p.payload)])), [view]);
  const [ai, setAi] = useState<AiState>('checking');
  const [model, setModel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<ResearchProposal | null>(null);
  const [showDone, setShowDone] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let live = true;
    app.ai.getCredential().then((r) => {
      if (!live) return;
      if (r.status === 'unavailable') setAi('no-server');
      else if (!r.credential) setAi('no-key');
      else { setAi('ready'); setModel(r.credential.default_model); }
    }).catch(() => live && setAi('no-server'));
    return () => { live = false; };
  }, [app.ai]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [view?.messages.length, busy]);

  useEffect(() => {
    if (ctl.open && ctl.draft) inputRef.current?.focus();
  }, [ctl.open, ctl.draft]);

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const task = view?.task.id ?? await app.research.startTask(projectId);
      ctl.setDraft('');
      await runAgentTurn({ store: app.store, research: app.research, agent: app.agent, ai: app.ai }, task, text.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  if (!ctl.open) {
    return (
      <aside className="agent-rail">
        <button type="button" className="agent-rail-btn" onClick={() => ctl.setOpen(true)} aria-label="Åpne researchagenten">
          <span aria-hidden>✦</span>
          <span className="agent-rail-label">Researchagent</span>
          {!!view?.proposals.filter((p) => p.decision === 'pending').length && (
            <span className="agent-rail-count">{view.proposals.filter((p) => p.decision === 'pending').length}</span>
          )}
        </button>
      </aside>
    );
  }

  const pending = view?.proposals.filter((p) => p.decision === 'pending') ?? [];
  const done = view?.proposals.filter((p) => p.decision !== 'pending') ?? [];

  return (
    <aside className="agent" aria-label="Researchagent">
      <header className="agent-head">
        <div>
          <h2>Researchagent</h2>
          <span className="agent-sub">{ai === 'ready' ? `UiB · ${model ?? 'ingen standardmodell'}` : ' '}</span>
        </div>
        <div className="agent-head-actions">
          {view && (
            <button type="button" className="agent-link" onClick={() => act(() => app.research.closeTask(view.task.id))} title="Lukk oppgaven og start en ny samtale">
              Ny oppgave
            </button>
          )}
          <button type="button" className="agent-close" onClick={() => ctl.setOpen(false)} aria-label="Skjul panelet">×</button>
        </div>
      </header>

      {ai === 'no-server' && (
        <div className="agent-note">
          <strong>AI er ikke tilgjengelig her.</strong>
          <p>Agenten trenger Paintrest-serveren. Start appen med <code>npm run dev</code>. Alt annet i appen virker uten AI.</p>
        </div>
      )}
      {ai === 'no-key' && (
        <div className="agent-note">
          <strong>Ingen AI-nøkkel er lagret.</strong>
          <p>Legg inn UiB-nøkkelen under <Link to="/innstillinger">AI-nøkkel</Link>. Alt annet i appen virker uten AI.</p>
        </div>
      )}

      <div className="agent-scroll" ref={listRef}>
        <div className="agent-scope">
          <span className="eyebrow">Arbeidskontekst</span>
          <span>Dette prosjektet. Agenten kan lese prosjektet, miniatyrene, maleplanene og malingene dine, og lage forslag til nye miniatyrer og nye maleplaner.</span>
          {view?.targets.map((r) => (
            <Badge key={r.id} tone={r.stale ? 'warn' : 'moss'}>
              Åpnet for revisjon: {r.subject} v{r.version}{r.stale ? ' (utdatert)' : ''}
            </Badge>
          ))}
        </div>

        {!view?.messages.length && ai === 'ready' && (
          <div className="agent-empty">
            <p>Spør om miniatyrene, eller be om forslag. Forslagene blir liggende til du godkjenner eller avviser dem.</p>
          </div>
        )}

        {view?.messages.map((m) => (
          <div key={m.id} className={`msg msg-${m.role}`}>
            <span className="msg-who">{m.role === 'user' ? 'Du' : m.role === 'assistant' ? 'Agenten' : 'Paintrest'}</span>
            <p>{m.body}</p>
          </div>
        ))}
        {busy && <div className="msg msg-assistant msg-busy"><span className="msg-who">Agenten</span><p>Tenker …</p></div>}

        {pending.length > 0 && (
          <section className="agent-proposals">
            <h3 className="eyebrow">Forslag som venter ({pending.length})</h3>
            {pending.map((p) => (
              <ProposalCard
                key={p.id}
                p={p}
                title={titles[p.id] ?? p.result_type}
                onReview={() => setReview(p)}
                onReject={() => act(() => app.research.rejectProposal(p.id))}
                onApprove={() => act(() => app.research.approveProposal(p.id))}
              />
            ))}
          </section>
        )}
        {done.length > 0 && (
          <section className="agent-proposals">
            <button type="button" className="agent-link" onClick={() => setShowDone((v) => !v)}>
              {showDone ? 'Skjul' : 'Vis'} behandlede forslag ({done.length})
            </button>
            {showDone && done.map((p) => (
              <div key={p.id} className="proposal done">
                <span className="mono small">{p.ref}</span>
                <span>{titles[p.id]}</span>
                <Badge tone={p.decision === 'approved' ? 'moss' : 'neutral'}>{p.decision === 'approved' ? 'Godkjent' : 'Avvist'}</Badge>
              </div>
            ))}
          </section>
        )}
      </div>

      <ErrorNote error={error} onClose={() => setError(null)} />

      <form className="agent-input" onSubmit={(e) => { e.preventDefault(); send(ctl.draft); }}>
        {ai === 'ready' && !busy && (
          <div className="agent-prompts">
            {PROMPTS.map((p) => (
              <button key={p} type="button" onClick={() => send(p)}>{p}</button>
            ))}
          </div>
        )}
        <label htmlFor="agent-input" className="sr-only">Melding til agenten</label>
        <textarea
          id="agent-input"
          ref={inputRef}
          value={ctl.draft}
          disabled={ai !== 'ready' || busy}
          placeholder={ai === 'ready' ? 'Skriv til agenten …' : 'Agenten er ikke tilgjengelig'}
          onChange={(e) => ctl.setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(ctl.draft); }
          }}
        />
        <div className="agent-input-row">
          <span className="small">⌘/Ctrl + Enter sender</span>
          <Button variant="moss" type="submit" disabled={ai !== 'ready' || busy || !ctl.draft.trim()}>{busy ? 'Venter …' : 'Send'}</Button>
        </div>
      </form>

      {review && (
        <ReviewDialog
          proposalId={review.id}
          onClose={() => setReview(null)}
          onDone={() => setReview(null)}
        />
      )}
    </aside>
  );
}

// ---------- Forslagskort ----------

const EVIDENCE_LABEL = { documented: 'Dokumentert', synthesized: 'Foreslått av AI', unresolved: 'Uavklart' } as const;

function ProposalCard({ p, title, onReview, onReject, onApprove }: {
  p: ResearchProposal; title: string; onReview: () => void; onReject: () => void; onApprove: () => void;
}) {
  const isPlan = p.result_type !== 'catalog_subject';
  const needsProducts = useView((t) => isPlan && planProductRefs(p.payload as PaintPlanPayload).some((r) => !matchProduct(t, r)), [p]);
  return (
    <article className="proposal">
      <div className="proposal-top">
        <span className="mono small">{p.ref}</span>
        <Badge tone="dark">{p.result_type === 'catalog_subject' ? 'Ny miniatyr' : p.result_type === 'plan_revision' ? 'Ny planversjon' : 'Ny maleplan'}</Badge>
        <Badge tone={p.evidence === 'unresolved' ? 'warn' : 'neutral'}>{EVIDENCE_LABEL[p.evidence]}</Badge>
      </div>
      <strong>{title}</strong>
      {p.uncertainty.length > 0 && (
        <ul className="proposal-unc">
          {p.uncertainty.slice(0, 3).map((u, i) => <li key={i}>{u.reason}</li>)}
          {p.uncertainty.length > 3 && <li>… og {p.uncertainty.length - 3} til</li>}
        </ul>
      )}
      {p.last_error && <p className="proposal-err">{p.last_error}</p>}
      <div className="proposal-actions">
        {isPlan || needsProducts
          ? <Button variant="primary" onClick={onReview}>Se gjennom</Button>
          : <Button variant="primary" onClick={onApprove}>Godkjenn</Button>}
        {!isPlan && <Button onClick={onReview}>Rediger</Button>}
        <Button variant="ghost" onClick={onReject}>Avvis</Button>
      </div>
    </article>
  );
}

// ---------- Gjennomgang ----------

function ReviewDialog({ proposalId, onClose, onDone }: { proposalId: Id; onClose: () => void; onDone: () => void }) {
  const app = useApp();
  const data = useView((t) => {
    const p = t.research_proposal[proposalId];
    if (!p) return null;
    const products = Object.values(t.paint_product).filter((x) => !x.deleted_at)
      .sort((a, b) => a.name.localeCompare(b.name, 'nb'));
    return { p, t, products, title: proposalTitle(t, p.result_type, p.payload) };
  }, [proposalId]);
  const [choices, setChoices] = useState<Record<string, Id | 'create'>>({});
  const [catalog, setCatalog] = useState<CatalogSubjectPayload | null>(
    () => (data?.p.result_type === 'catalog_subject' ? { ...(data.p.payload as CatalogSubjectPayload) } : null),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!data) return null;
  const { p, t } = data;

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      if (catalog) await app.research.editCatalogProposal(p.id, catalog);
      await app.research.approveProposal(p.id, { product_choices: choices });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const plan = p.result_type !== 'catalog_subject' ? (p.payload as PaintPlanPayload) : null;
  const refs = plan ? planProductRefs(plan) : [];
  const unresolved = refs.filter((r) => !matchProduct(t, r) && !choices[productKey(r)]);

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={`${p.ref} · ${data.title}`}
      footer={<>
        <Button variant="ghost" className="push-left" onClick={async () => { await app.research.rejectProposal(p.id); onDone(); }}>Avvis</Button>
        <Button onClick={onClose}>Lukk</Button>
        <Button variant="primary" disabled={busy || unresolved.length > 0} onClick={approve}>
          {busy ? 'Godkjenner …' : p.result_type === 'plan_revision' ? 'Godkjenn ny versjon' : 'Godkjenn'}
        </Button>
      </>}
    >
      <div className="review-meta">
        <Badge>{EVIDENCE_LABEL[p.evidence]}</Badge>
        <span className="small muted">Laget av {p.model_id}</span>
      </div>
      {p.uncertainty.length > 0 && (
        <div className="review-unc">
          <span className="eyebrow">Usikkerhet</span>
          <ul>{p.uncertainty.map((u, i) => <li key={i}>{u.path && <span className="mono small">{u.path}: </span>}{u.reason}</li>)}</ul>
        </div>
      )}

      {catalog && (
        <div className="review-catalog">
          <Field label="Navn">{(id) => <input id={id} value={catalog.name} onChange={(e) => setCatalog({ ...catalog, name: e.target.value })} />}</Field>
          <div className="field">
            <span className="field-label">Gruppering</span>
            <Segmented label="Gruppering" value={catalog.grouping} onChange={(g) => setCatalog({ ...catalog, grouping: g, physical_count: g === 'single' ? 1 : Math.max(2, catalog.physical_count) })}
              options={[{ value: 'single', label: 'Enkeltfigur' }, { value: 'group', label: 'Malegruppe' }]} />
          </div>
          {catalog.grouping === 'group' && (
            <div className="field-row">
              <span className="field-label">Fysiske figurer</span>
              <Stepper label="Fysiske figurer" value={catalog.physical_count} min={1} onChange={(n) => setCatalog({ ...catalog, physical_count: n })} />
            </div>
          )}
          <p className="small muted">
            Utvidelse: {catalog.expansion_name ?? 'grunnspill'} · Kategori: {catalog.category_label ?? '–'}
            {catalog.count_basis && ` · Antall ${catalog.count_basis === 'documented' ? 'dokumentert' : 'utledet'}`}
          </p>
          {catalog.note && <p>{catalog.note}</p>}
        </div>
      )}

      {plan && (
        <>
          {plan.note && <p>{plan.note}</p>}
          <div className="review-products">
            <span className="eyebrow">Malinger i planen</span>
            <p className="small muted">Malinger som ikke finnes i katalogen, må kobles til et produkt eller opprettes som ubekreftet før planen kan godkjennes.</p>
            <ul>
              {refs.map((r) => {
                const key = productKey(r);
                const m = matchProduct(t, r);
                return (
                  <li key={key}>
                    {m ? (
                      <>
                        <Swatch hex={m.swatch_hex} size={20} />
                        <ProductName product={m} />
                        <OwnershipFlag ownership={ownershipOf(t, m.id)} />
                      </>
                    ) : (
                      <>
                        <Swatch hex={null} size={20} />
                        <span><strong>{r.name}</strong> <span className="small muted">{[r.manufacturer, r.range].filter(Boolean).join(' · ') || 'ukjent produsent'}</span></span>
                        <select
                          aria-label={`Produkt for ${r.name}`}
                          value={choices[key] ?? ''}
                          onChange={(e) => setChoices({ ...choices, [key]: e.target.value as Id | 'create' })}
                        >
                          <option value="">Velg …</option>
                          <option value="create">Opprett som ubekreftet produkt</option>
                          {data.products.map((x) => <option key={x.id} value={x.id}>{x.name}{x.manufacturer ? ` (${x.manufacturer})` : ''}</option>)}
                        </select>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
          <div className="review-plan">
            {plan.elements.map((el, i) => (
              <section key={i}>
                <h3>{el.name} <span className="eyebrow">{el.kind === 'operation' ? 'Felles operasjon' : 'Del'}</span></h3>
                <ol>
                  {el.steps.map((s, j) => (
                    <li key={j}>
                      <p>{s.instruction || <em className="muted">Ingen instruks</em>}</p>
                      {(s.materials.length > 0 || s.mix) && (
                        <p className="small muted">
                          {s.materials.map((m) => `${m.role}: ${m.product.name}`).join(' · ')}
                          {s.mix && ` · ${s.mix.label ?? 'Blanding'}: ${s.mix.components.map((c) => `${c.parts} ${c.product.name}`).join(' + ')}`}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        </>
      )}
      <ErrorNote error={error ?? p.last_error ?? null} />
    </Dialog>
  );
}
