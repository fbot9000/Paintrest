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
import type { CatalogSubjectPayload, PaintPlanPayload, ReferenceSelectionPayload, SourceRef } from '../../domain/agent';
import type { ResearchEvent } from '../../domain/ai';
import type { Id, ResearchMessage, ResearchProposal, Tables } from '../../domain/types';
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

const PROMPTS_WEB = [
  'Finn ut hvilke miniatyrer som følger med spillet og utvidelsene våre, med kilder. Foreslå de som mangler i katalogen.',
  'Finn referansebilder av malte versjoner av miniatyrene som mangler bilder. Bruk virkelige kilder.',
];
const PROMPTS_OFFLINE = [
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
  const [web, setWeb] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<ResearchEvent[]>([]);
  const abortRef = useRef<AbortController | null>(null);
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
      const uib = r.status === 'ok' && r.credential && r.credential.hosted_search !== 'off';
      app.ai.getSearchCredential()
        .then((c) => live && setWeb(uib ? (c ? `UiB, reserve ${c.label}` : 'UiB') : c?.label ?? null))
        .catch(() => live && setWeb(uib ? 'UiB' : null));
    }).catch(() => live && setAi('no-server'));
    return () => { live = false; };
  }, [app.ai]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [view?.messages.length, busy, live.length]);

  useEffect(() => {
    if (ctl.open && ctl.draft) inputRef.current?.focus();
  }, [ctl.open, ctl.draft]);

  const send = async (text: string) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    setLive([]);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const task = view?.task.id ?? await app.research.startTask(projectId);
      ctl.setDraft('');
      await runAgentTurn({ store: app.store, research: app.research, agent: app.agent, ai: app.ai }, task, text.trim(),
        (e) => setLive((cur) => [...cur, e]), ac.signal);
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setLive([]);
      abortRef.current = null;
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
          {ai === 'ready' && (
            <>
              <span className="agent-sub">UiB · {model ?? 'ingen standardmodell'}</span>
              <span className="agent-sub">{web ? `Nettsøk: ${web}` : 'Uten nettsøk'}</span>
            </>
          )}
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
          <p>Legg inn UiB-nøkkelen under <Link to="/innstillinger">AI og nettsøk</Link>. Alt annet i appen virker uten AI.</p>
        </div>
      )}

      <div className="agent-scroll" ref={listRef}>
        <div className="agent-scope">
          <span className="eyebrow">Arbeidskontekst</span>
          <span>Dette prosjektet. Agenten kan lese prosjektet, miniatyrene, maleplanene og malingene dine{web ? ', søke på nettet og lese sider' : ''}, og lage forslag til nye miniatyrer, referansebilder og maleplaner.</span>
          {ai === 'ready' && !web && <span>Uten nettsøk bygger agenten bare på det modellen kan fra før. Legg inn en søketjeneste under <Link to="/innstillinger">AI og nettsøk</Link>.</span>}
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

        {view?.messages.map((m) => <Message key={m.id} m={m} />)}
        {busy && <LiveSteps events={live} onStop={() => abortRef.current?.abort()} />}

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
        {ai === 'ready' && !busy && !view?.messages.length && (
          <div className="agent-prompts">
            {(web ? PROMPTS_WEB : PROMPTS_OFFLINE).map((p) => (
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
  const isPlan = p.result_type === 'paint_plan' || p.result_type === 'plan_revision';
  const isRefs = p.result_type === 'reference_selection';
  const needsProducts = useView((t) => isPlan && planProductRefs(p.payload as PaintPlanPayload).some((r) => !matchProduct(t, r)), [p]);
  return (
    <article className="proposal">
      <div className="proposal-top">
        <span className="mono small">{p.ref}</span>
        <Badge tone="dark">{KIND_LABEL[p.result_type] ?? p.result_type}</Badge>
        <Badge tone={p.evidence === 'unresolved' ? 'warn' : 'neutral'}>{EVIDENCE_LABEL[p.evidence]}</Badge>
      </div>
      <strong>{title}</strong>
      {p.result_type === 'reference_selection' && <Thumbs payload={p.payload as ReferenceSelectionPayload} />}
      {p.result_type === 'catalog_subject' && <SourceList sources={(p.payload as CatalogSubjectPayload).sources ?? []} compact />}
      {p.uncertainty.length > 0 && (
        <ul className="proposal-unc">
          {p.uncertainty.slice(0, 3).map((u, i) => <li key={i}>{u.reason}</li>)}
          {p.uncertainty.length > 3 && <li>… og {p.uncertainty.length - 3} til</li>}
        </ul>
      )}
      {p.last_error && <p className="proposal-err">{p.last_error}</p>}
      <div className="proposal-actions">
        {isPlan || isRefs || needsProducts
          ? <Button variant="primary" onClick={onReview}>Se gjennom</Button>
          : <Button variant="primary" onClick={onApprove}>Godkjenn</Button>}
        {!isPlan && !isRefs && <Button onClick={onReview}>Rediger</Button>}
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
  const refsPayload = data?.p.result_type === 'reference_selection' ? (data.p.payload as ReferenceSelectionPayload) : null;
  const [picked, setPicked] = useState<string[]>(() => refsPayload?.images.map((i) => i.image_url) ?? []);
  const [cover, setCover] = useState(() => !!refsPayload && !data?.t.miniature_subject[refsPayload.subject_id]?.official_asset_id);
  if (!data) return null;
  const { p, t } = data;

  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      if (catalog) await app.research.editCatalogProposal(p.id, catalog);
      await app.research.approveProposal(p.id, { product_choices: choices, ...(refsPayload ? { image_urls: picked, set_cover: cover } : {}) });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const plan = p.result_type === 'paint_plan' || p.result_type === 'plan_revision' ? (p.payload as PaintPlanPayload) : null;
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
        <Button variant="primary" disabled={busy || unresolved.length > 0 || (!!refsPayload && !picked.length)} onClick={approve}>
          {busy ? (refsPayload ? 'Henter bilder …' : 'Godkjenner …') : p.result_type === 'plan_revision' ? 'Godkjenn ny versjon' : refsPayload ? `Lagre ${picked.length} bilde${picked.length === 1 ? '' : 'r'}` : 'Godkjenn'}
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
          <SourceList sources={catalog.sources ?? []} />
        </div>
      )}

      {refsPayload && (
        <div className="review-refs">
          {refsPayload.note && <p>{refsPayload.note}</p>}
          <p className="small muted">Bildene er hentet fra sidene agenten åpnet. Kryss av for dem du vil beholde. De lagres som kilder med lenke tilbake til siden.</p>
          <div className="ref-grid">
            {refsPayload.images.map((img) => {
              const on = picked.includes(img.image_url);
              return (
                <label key={img.image_url} className={`ref-tile ${on ? 'on' : ''}`}>
                  <img src={app.ai.imageProxyUrl(img.image_url)} alt={img.caption ?? ''} loading="lazy" />
                  <span className="ref-cap">
                    <input type="checkbox" checked={on} onChange={(e) => setPicked((cur) => e.target.checked ? [...cur, img.image_url] : cur.filter((u) => u !== img.image_url))} />
                    <span>{img.caption ?? 'Uten bildetekst'}</span>
                  </span>
                  <a href={img.page_url} target="_blank" rel="noreferrer" className="small" onClick={(e) => e.stopPropagation()}>{img.creator ?? img.site} ↗</a>
                </label>
              );
            })}
          </div>
          {!t.miniature_subject[refsPayload.subject_id]?.official_asset_id && (
            <label className="replace">
              <input type="checkbox" checked={cover} onChange={(e) => setCover(e.target.checked)} />
              Bruk det første valgte bildet som bilde for miniatyren
            </label>
          )}
        </div>
      )}

      {plan && (
        <>
          {plan.note && <p>{plan.note}</p>}
          <SourceList sources={plan.sources ?? []} />
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

// ---------- Små visninger ----------

const KIND_LABEL: Record<string, string> = {
  catalog_subject: 'Ny miniatyr', paint_plan: 'Ny maleplan', plan_revision: 'Ny planversjon', reference_selection: 'Referansebilder',
};

function Message({ m }: { m: ResearchMessage }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`msg msg-${m.role}`}>
      <span className="msg-who">{m.role === 'user' ? 'Du' : m.role === 'assistant' ? 'Agenten' : 'Paintrest'}</span>
      <p>{m.body}</p>
      {m.trace && m.trace.length > 0 && (
        <div className="trace">
          <button type="button" className="agent-link small" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
            {open ? 'Skjul' : 'Vis'} hvordan agenten fant dette ({m.trace.length} steg)
          </button>
          {open && (
            <ol>
              {m.trace.map((s, i) => (
                <li key={i}>
                  <span className="mono">{s.action === 'search' ? 'Søk' : 'Les'}</span>{' '}
                  {s.action === 'open' ? <a href={s.target} target="_blank" rel="noreferrer">{shortUrl(s.target)}</a> : <em>«{s.target}»</em>}
                  <span className="trace-res"> — {s.result}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}

function LiveSteps({ events, onStop }: { events: ResearchEvent[]; onStop: () => void }) {
  const lines = events.flatMap((e): { key: string; text: ReactNode; state: 'run' | 'ok' | 'err' }[] => {
    switch (e.type) {
      case 'status': return [{ key: 's' + e.text, text: e.text, state: 'ok' }];
      case 'search': return [{ key: 'q' + e.query, text: <>Søker: <em>«{e.query}»</em></>, state: 'run' }];
      case 'search_done': return [{ key: 'qd' + e.query, text: <>{e.hits.length} treff for «{e.query}»</>, state: 'ok' }];
      case 'open': return [{ key: 'o' + e.url, text: <>Leser {shortUrl(e.url)}</>, state: 'run' }];
      case 'open_done': return [{ key: 'od' + e.url, text: <>{e.title} · {e.image_count} bilder</>, state: 'ok' }];
      case 'tool_error': return [{ key: 'e' + e.target, text: <>{e.action === 'search' ? 'Søk' : 'Lesing'} feilet: {e.error}</>, state: 'err' }];
      default: return [];
    }
  });
  return (
    <div className="msg msg-assistant live">
      <div className="live-head">
        <span className="msg-who">Agenten jobber</span>
        <button type="button" className="agent-link small" onClick={onStop}>Stopp</button>
      </div>
      <ol className="live-steps">
        {lines.length === 0 && <li className="run">Starter …</li>}
        {lines.map((l, i) => <li key={l.key + i} className={i === lines.length - 1 && l.state === 'run' ? 'run' : l.state}>{l.text}</li>)}
      </ol>
    </div>
  );
}

function Thumbs({ payload }: { payload: ReferenceSelectionPayload }) {
  const { ai } = useApp();
  return (
    <div className="thumbs">
      {payload.images.slice(0, 4).map((i) => <img key={i.image_url} src={ai.imageProxyUrl(i.image_url)} alt={i.caption ?? ''} loading="lazy" />)}
      {payload.images.length > 4 && <span className="small">+{payload.images.length - 4}</span>}
    </div>
  );
}

function SourceList({ sources, compact }: { sources: SourceRef[]; compact?: boolean }) {
  if (!sources.length) return compact ? null : <p className="small muted">Ingen kilder oppgitt.</p>;
  return (
    <ul className={`sources ${compact ? 'compact' : ''}`}>
      {sources.slice(0, compact ? 2 : 20).map((s) => (
        <li key={s.url}>
          <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a>
          {!compact && <span className="small muted"> · {shortUrl(s.url)}{s.opened ? '' : ' · bare sett i søkeresultat'}</span>}
        </li>
      ))}
      {compact && sources.length > 2 && <li className="small">+{sources.length - 2} kilder</li>}
    </ul>
  );
}

function shortUrl(u: string): string {
  try {
    const x = new URL(u);
    const path = x.pathname.length > 32 ? `${x.pathname.slice(0, 30)}…` : x.pathname;
    return `${x.hostname.replace(/^www\./, '')}${path === '/' ? '' : path}`;
  } catch {
    return u;
  }
}
