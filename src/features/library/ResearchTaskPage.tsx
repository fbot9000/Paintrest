import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useApp, useView } from '../../app/context';
import { matchProduct, productKey, recipeProductRefs } from '../../domain/agent';
import type { ProductRef, RecipePayload, SourceRef, TechniquePayload } from '../../domain/agent';
import { catalogProducts, knowledgeTaskView } from '../../domain/library';
import type { Id, ResearchProposal } from '../../domain/types';
import { Badge, Button, ErrorNote } from '../../ui/components';
import { LiveSteps, Message } from '../agent/AgentPanel';
import { EvidenceBadge } from './parts';
import { AiStatusNote, useAiStatus } from './ResearchPage';
import { clearRunError, startRun, stopRun, useRun } from './research-runs';

/**
 * Skisse 03 «Kildearbeid og syntese», simplified: the conversation with the
 * agent, its progress, and the drafts it made. A draft enters the library
 * only when the user saves it (global zone).
 */
export function ResearchTaskPage() {
  const { taskId = '' } = useParams();
  const app = useApp();
  const view = useView((t) => knowledgeTaskView(t, taskId), [taskId]);
  const run = useRun(taskId);
  const status = useAiStatus();
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [view?.messages.length, run.events.length]);

  if (!view) {
    return <main className="page"><h1>Fant ikke researchen</h1><p><Link to="/bibliotek/research">Til research</Link></p></main>;
  }
  const send = () => {
    if (!text.trim()) return;
    startRun({ store: app.store, research: app.research, agent: app.agent, ai: app.ai }, taskId, text);
    setText('');
  };
  const pending = view.proposals.filter((p) => p.decision === 'pending');
  const done = view.proposals.filter((p) => p.decision !== 'pending');

  return (
    <main className="page tech-page">
      <div className="tech-head">
        <span className="eyebrow"><Link to="/bibliotek/research">Research</Link> / {view.target === 'technique' ? 'Teknikk' : 'Oppskrift'}</span>
        <h1>{view.title}</h1>
      </div>
      <AiStatusNote status={status} />
      <ErrorNote error={run.error} onClose={() => clearRunError(taskId)} />

      {pending.map((p) => <DraftCard key={p.id} p={p} />)}

      <section className="research-chat" aria-label="Samtale med agenten">
        {view.messages.map((m) => <Message key={m.id} m={m} />)}
        {run.running && <LiveSteps events={run.events} onStop={() => stopRun(taskId)} />}
        <div ref={endRef} />
      </section>

      <div className="research-input">
        <label htmlFor="research-msg" className="sr-only">Melding til agenten</label>
        <textarea id="research-msg" value={text} rows={2} placeholder="Spør, rett eller be om mer research"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }} />
        <Button variant="primary" disabled={!text.trim() || run.running || status !== 'ready'} onClick={send}>Send</Button>
      </div>

      {done.length > 0 && (
        <section className="tech-section">
          <h2>Behandlet</h2>
          {done.map((p) => <DoneLine key={p.id} p={p} />)}
        </section>
      )}
    </main>
  );
}

function DoneLine({ p }: { p: ResearchProposal }) {
  const name = (p.payload as { name?: string }).name ?? 'Utkast';
  const path = p.result_type === 'technique' ? 'teknikker' : 'oppskrifter';
  const exists = useView((t) => !!p.applied_target_id && !!(p.result_type === 'technique' ? t.technique[p.applied_target_id] : t.recipe[p.applied_target_id]), [p.applied_target_id]);
  return (
    <p className="done-line">
      {p.decision === 'approved' ? <Badge tone="moss">Lagret</Badge> : <Badge>Forkastet</Badge>}{' '}
      <strong>{name}</strong>
      {p.decision === 'approved' && exists && <> · <Link to={`/bibliotek/${path}/${p.applied_target_id}`}>Åpne i biblioteket</Link></>}
    </p>
  );
}

function DraftCard({ p }: { p: ResearchProposal }) {
  const app = useApp();
  const [error, setError] = useState<string | null>(p.last_error ?? null);
  const [busy, setBusy] = useState(false);
  const [choices, setChoices] = useState<Record<string, Id | 'create'>>({});
  const missing = useView((t) => p.result_type === 'recipe'
    ? recipeProductRefs(p.payload as RecipePayload).filter((r) => !matchProduct(t, r))
    : [], [p.payload]);
  const products = useView((t) => catalogProducts(t));

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const approve = () => act(() => app.research.approveProposal(p.id, {
    product_choices: Object.fromEntries(missing.map((r) => [productKey(r), choices[productKey(r)] ?? 'create'])),
  }));

  return (
    <article className="card tech-section draft-card">
      <div className="tech-head-row">
        <span className="eyebrow">Utkast fra agenten · {p.result_type === 'technique' ? 'teknikk' : 'oppskrift'}</span>
        <EvidenceBadge evidence={p.evidence} />
      </div>
      {p.result_type === 'technique'
        ? <TechniqueDraft x={p.payload as TechniquePayload} />
        : <RecipeDraft x={p.payload as RecipePayload} />}

      {p.uncertainty.length > 0 && (
        <div className="tech-uncertain" role="note">
          <strong>Uavklart:</strong>
          <ul>{p.uncertainty.map((u, i) => <li key={i}>{u.reason}</li>)}</ul>
        </div>
      )}

      {missing.length > 0 && (
        <div className="draft-missing">
          <span className="eyebrow">Malinger som ikke finnes i katalogen</span>
          {missing.map((r) => <MissingPaint key={productKey(r)} r={r} products={products}
            value={choices[productKey(r)] ?? 'create'} onChange={(v) => setChoices((c) => ({ ...c, [productKey(r)]: v }))} />)}
        </div>
      )}

      <ErrorNote error={error} onClose={() => setError(null)} />
      <div className="draft-actions">
        <Button variant="danger" disabled={busy} onClick={() => act(() => app.research.rejectProposal(p.id))}>Forkast</Button>
        <Button variant="primary" disabled={busy} onClick={approve}>Lagre i biblioteket</Button>
      </div>
      <p className="small muted draft-hint">Lagres som utkast. Du kan endre alt etterpå.</p>
    </article>
  );
}

function MissingPaint({ r, products, value, onChange }:
  { r: ProductRef; products: { id: Id; name: string; manufacturer: string | null }[]; value: Id | 'create'; onChange: (v: Id | 'create') => void }) {
  const id = `miss-${productKey(r)}`;
  return (
    <div className="draft-missing-row">
      <label htmlFor={id}><strong>{r.name}</strong> <span className="small muted">{[r.manufacturer, r.range].filter(Boolean).join(' · ')}</span></label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as Id | 'create')}>
        <option value="create">Legg til som ny maling (ubekreftet)</option>
        {products.map((p) => <option key={p.id} value={p.id}>Bruk {p.name}{p.manufacturer ? ` (${p.manufacturer})` : ''}</option>)}
      </select>
    </div>
  );
}

function TechniqueDraft({ x }: { x: TechniquePayload }) {
  return (
    <>
      <h2>{x.name}</h2>
      {x.desired_result && <p className="tech-lead">{x.desired_result}</p>}
      {x.tags.length > 0 && <div className="tech-badges">{x.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>}
      {x.use_area && <div className="article-block"><span className="eyebrow">Bruksområde</span><p>{x.use_area}</p></div>}
      {x.materials.length > 0 && (
        <div className="article-block">
          <span className="eyebrow">Dette trenger du</span>
          <ul className="article-materials">{x.materials.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </div>
      )}
      {x.steps.length > 0 && (
        <div className="article-block">
          <span className="eyebrow">Slik gjør du</span>
          <ol className="article-steps">
            {x.steps.map((s, i) => (
              <li key={i}>
                <span className="mono muted">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  {s.title && <strong>{s.title} </strong>}
                  {s.basis === 'documented' && <Badge tone="moss">Vist i kilde</Badge>}
                  {s.basis === 'synthesized' && <Badge tone="warn">Forslag fra agenten</Badge>}
                  {s.instruction && <p>{s.instruction}</p>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
      {x.variants && <div className="article-block"><span className="eyebrow">Varianter</span><p className="pre-line">{x.variants}</p></div>}
      {x.risk_note && <div className="tech-risk-note"><span className="eyebrow">Forbehold</span><p className="pre-line">{x.risk_note}</p></div>}
      {x.note && <p className="small muted">{x.note}</p>}
      <Sources sources={x.sources} />
    </>
  );
}

function RecipeDraft({ x }: { x: RecipePayload }) {
  const techniques = useView((t) => Object.fromEntries(Object.values(t.technique).map((tq) => [tq.id, tq.name])));
  return (
    <>
      <h2>{x.name}</h2>
      {x.effect && <p className="tech-lead">{x.effect}</p>}
      {x.tags.length > 0 && <div className="tech-badges">{x.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>}
      <div className="article-block">
        <span className="eyebrow">Fargerekke</span>
        <ol className="draft-paints">
          {x.paints.map((pe, i) => (
            <li key={i}>
              <span className="swatch" style={{ width: 18, height: 18, background: pe.product.hex ?? undefined }} aria-hidden />
              <strong>{pe.product.name}</strong>
              <span className="small muted">{[pe.product.manufacturer, pe.product.range].filter(Boolean).join(' · ')}</span>
              {pe.note && <span className="small">– {pe.note}</span>}
            </li>
          ))}
        </ol>
      </div>
      {x.steps.length > 0 && (
        <div className="article-block">
          <span className="eyebrow">Fremgangsmåte</span>
          <ol className="article-steps">
            {x.steps.map((s, i) => (
              <li key={i}>
                <span className="mono muted">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <p>{s.instruction}</p>
                  {s.paints.length > 0 && <p className="small muted">{s.paints.map((n) => x.paints[n]?.product.name).filter(Boolean).join(', ')}</p>}
                  {s.technique_id && techniques[s.technique_id] && <p className="small">Teknikk: {techniques[s.technique_id]}</p>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
      {x.note && <p className="small muted">{x.note}</p>}
      <Sources sources={x.sources} />
    </>
  );
}

function Sources({ sources }: { sources: SourceRef[] }) {
  if (!sources.length) return <p className="small muted">Ingen kilder oppgitt.</p>;
  return (
    <div className="article-block">
      <span className="eyebrow">Kilder</span>
      <ul className="tech-sources">
        {sources.map((s) => (
          <li key={s.url}>
            <a href={s.url} target="_blank" rel="noreferrer">{s.title} ↗</a>
            {!s.opened && <span className="small muted"> · bare sett i søk</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
