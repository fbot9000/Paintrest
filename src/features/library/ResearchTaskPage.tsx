import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useApp, useView } from '../../app/context';
import { matchProduct, productKey, recipeProductRefs, variantsText } from '../../domain/agent';
import type { KnowledgeComparison, ProductRef, RecipePayload, SourceRead, SourceRef, TechniquePayload } from '../../domain/agent';
import { catalogProducts, knowledgeTaskView, techniqueDetail } from '../../domain/library';
import { ownershipOf } from '../../domain/views';
import type { Id, ResearchMessage, ResearchProposal } from '../../domain/types';
import { Badge, Button, ErrorNote, OwnershipFlag } from '../../ui/components';
import { LiveSteps, Message } from '../agent/AgentPanel';
import { EvidenceBadge } from './parts';
import { AiStatusNote, PaintChoicePicker, useAiStatus } from './ResearchPage';
import { runs, useRuns } from '../../app/runs';
import { startRun } from './research-runs';

/**
 * Skisse 03 «Kildearbeid og syntese», simplified: the conversation with the
 * agent, its progress, and the drafts it made. A draft enters the library
 * only when the user saves it (global zone).
 */
export function ResearchTaskPage() {
  const { taskId = '' } = useParams();
  const app = useApp();
  const view = useView((t) => knowledgeTaskView(t, taskId), [taskId]);
  const run = useRuns((r) => r.get(taskId, 'knowledge'));
  const running = run?.status === 'running';
  const choice = useView((t) => t.task_scope[taskId]?.paint_choice ?? null, [taskId]);
  const status = useAiStatus();
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  // Follow the agent's progress while it works; otherwise leave the scroll alone so the draft stays in view.
  useEffect(() => { if (running) endRef.current?.scrollIntoView({ block: 'nearest' }); }, [running, run?.events.length]);

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
        <span className="eyebrow">
          <Link to="/bibliotek/research">Research</Link> / {view.revision_of
            ? <Link to={`/bibliotek/teknikker/${view.revision_of.id}`}>{view.revision_of.name}</Link>
            : view.target === 'technique' ? 'Teknikk' : 'Oppskrift'}
        </span>
        <h1>{view.title}</h1>
      </div>
      <AiStatusNote status={status} />
      {/* Errors the agent wrote into the conversation are not shown twice; only those that happened before it got that far. */}
      <ErrorNote error={run?.status === 'error' && !run.error_reported ? run.error ?? 'Agenten feilet.' : null} onClose={() => runs.dismiss(taskId, 'knowledge')} />

      {pending.map((p) => <DraftCard key={p.id} p={p} messages={view.messages} revisionOf={view.revision_of?.id ?? null} />)}

      <section className="research-chat" aria-label="Samtale med agenten">
        {view.messages.map((m) => <Message key={m.id} m={m} />)}
        {running && <LiveSteps events={run.events} onStop={() => runs.stop(taskId, 'knowledge')} />}
        <div ref={endRef} />
      </section>

      {view.target === 'recipe' && !view.revision_of && choice && (
        <div className="research-choice">
          <PaintChoicePicker value={choice} onChange={(v) => app.research.setPaintChoice(taskId, v)} />
          <p className="small muted">Gjelder fra neste melding.</p>
        </div>
      )}

      <div className="research-input">
        <label htmlFor="research-msg" className="sr-only">Melding til agenten</label>
        <textarea id="research-msg" value={text} rows={2} placeholder="Spør, rett eller be om mer research"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send(); }} />
        <Button variant="primary" disabled={!text.trim() || running || status !== 'ready'} onClick={send}>Send</Button>
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
      {p.decision === 'approved' ? <Badge tone="moss">Tatt i bruk</Badge> : <Badge>Forkastet</Badge>}{' '}
      <strong>{name}</strong>
      {p.decision === 'approved' && exists && <> · <Link to={`/bibliotek/${path}/${p.applied_target_id}`}>Åpne i biblioteket</Link></>}
    </p>
  );
}

function DraftCard({ p, messages, revisionOf }: { p: ResearchProposal; messages: ResearchMessage[]; revisionOf: Id | null }) {
  const app = useApp();
  const payload = p.payload as TechniquePayload | RecipePayload;
  // Improvement (bit 7.6): compare with the technique as it is now.
  const current = useView((t) => (revisionOf ? techniqueDetail(t, revisionOf) : undefined), [revisionOf]);
  const stale = !!current && current.technique.updated_at !== p.base_version_id;
  const comparison = payload.comparison ?? null;
  const [primary, setPrimary] = useState(() => Math.max(0, comparison?.variants.findIndex((v) => v.primary) ?? 0));
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
    ...(comparison?.variants.length ? { primary_variant: primary } : {}),
  }));

  return (
    <article className="card draft-card">
      <SourceInspector sources={payload.sources} read={payload.sources_read ?? []} messages={messages} />
      <div className="draft-main tech-section">
      <div className="tech-head-row">
        <span className="eyebrow">{current ? 'Forslag til endring' : `Utkast fra agenten · ${p.result_type === 'technique' ? 'teknikk' : 'oppskrift'}`}</span>
        <div className="tech-badges">
          <Badge>{payload.sources.length} {payload.sources.length === 1 ? 'kilde' : 'kilder'}</Badge>
          {comparison && comparison.variants.length > 0 && <Badge tone="dark">{comparison.variants.length} {comparison.variants.length === 1 ? 'variant' : 'varianter'}</Badge>}
          <EvidenceBadge evidence={p.evidence} />
          {'paint_choice' in payload && payload.paint_choice && (
            <Badge tone={payload.paint_choice === 'owned' ? 'moss' : 'neutral'}>{payload.paint_choice === 'owned' ? 'Med malinger du har' : 'Beste valg'}</Badge>
          )}
        </div>
      </div>
      {current
        ? <TechniqueChanges x={p.payload as TechniquePayload} cur={current} primary={primary}
            comparison={comparison && <Comparison c={comparison} sources={payload.sources} primary={primary} onPick={setPrimary} />} />
        : p.result_type === 'technique'
        ? <TechniqueDraft x={p.payload as TechniquePayload} comparison={comparison && <Comparison c={comparison} sources={payload.sources} primary={primary} onPick={setPrimary} />} />
        : <RecipeDraft x={p.payload as RecipePayload} comparison={comparison && <Comparison c={comparison} sources={payload.sources} primary={primary} onPick={setPrimary} />} />}

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

      {stale && (
        <div className="tech-uncertain" role="alert">
          Du har endret teknikken etter at forslaget ble laget. Be agenten om et nytt forslag, så det bygger på det som står der nå.
        </div>
      )}
      <ErrorNote error={error} onClose={() => setError(null)} />
      <div className="draft-actions">
        <Button variant="danger" disabled={busy} onClick={() => act(() => app.research.rejectProposal(p.id))}>Forkast</Button>
        <Button variant="primary" disabled={busy || stale} onClick={approve}>{current ? 'Ta i bruk endringene' : 'Lagre i biblioteket'}</Button>
      </div>
      <p className="small muted draft-hint">{current ? 'Endringene skrives inn i teknikken. Erfaringer og status blir værende.' : 'Lagres som utkast. Du kan endre alt etterpå.'}</p>
      </div>
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

function TechniqueDraft({ x, comparison }: { x: TechniquePayload; comparison: ReactNode }) {
  return (
    <>
      <h2>{x.name}</h2>
      {x.desired_result && <p className="tech-lead">{x.desired_result}</p>}
      {x.tags.length > 0 && <div className="tech-badges">{x.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>}
      {comparison}
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
      {x.variants && !x.comparison?.variants.length && <div className="article-block"><span className="eyebrow">Varianter</span><p className="pre-line">{x.variants}</p></div>}
      {x.risk_note && <div className="tech-risk-note"><span className="eyebrow">Forbehold</span><p className="pre-line">{x.risk_note}</p></div>}
      {x.note && <p className="small muted">{x.note}</p>}
    </>
  );
}

function RecipeDraft({ x, comparison }: { x: RecipePayload; comparison: ReactNode }) {
  const techniques = useView((t) => Object.fromEntries(Object.values(t.technique).map((tq) => [tq.id, tq.name])));
  // Shown for every paint, so the choice of paints is never hidden.
  const owned = useView((t) => x.paints.map((pe) => {
    const m = matchProduct(t, pe.product);
    return m ? ownershipOf(t, m.id) : 'missing';
  }), [x.paints]);
  const notOwned = owned.filter((o) => o !== 'owns').length;
  return (
    <>
      <h2>{x.name}</h2>
      {x.effect && <p className="tech-lead">{x.effect}</p>}
      {x.tags.length > 0 && <div className="tech-badges">{x.tags.map((t) => <Badge key={t}>{t}</Badge>)}</div>}
      {comparison}
      <div className="article-block">
        <span className="eyebrow">Fargerekke</span>
        {x.paint_choice === 'owned' && notOwned > 0 && (
          <p className="tech-uncertain small" role="note">Du valgte bare malinger du har, men {notOwned} av malingene står ikke som eid hos deg.</p>
        )}
        {x.paint_choice !== 'owned' && notOwned > 0 && <p className="small muted">{notOwned} av {x.paints.length} malinger har du ikke.</p>}
        <ol className="draft-paints">
          {x.paints.map((pe, i) => (
            <li key={i}>
              <span className="swatch" style={{ width: 18, height: 18, background: pe.product.hex ?? undefined }} aria-hidden />
              <strong>{pe.product.name}</strong>
              <span className="small muted">{[pe.product.manufacturer, pe.product.range].filter(Boolean).join(' · ')}</span>
              {pe.note && <span className="small">– {pe.note}</span>}
              {owned[i] === 'missing' ? <span className="own own-not_owned">Ikke i katalogen</span> : <OwnershipFlag ownership={owned[i] as 'owns' | 'not_owned' | 'unknown'} />}
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
    </>
  );
}

/**
 * Bit 7.6: what the improvement changes, field by field («Nå» and «Forslag»).
 * Unchanged fields are left out.
 */
function TechniqueChanges({ x, cur, primary, comparison }:
  { x: TechniquePayload; cur: NonNullable<ReturnType<typeof techniqueDetail>>; primary: number; comparison: ReactNode }) {
  const now = cur.technique;
  const list = (v: string[]) => v.join(', ');
  const stepText = (steps: { title: string; instruction: string }[]) =>
    steps.map((s, i) => `${i + 1}. ${[s.title, s.instruction].filter(Boolean).join(': ')}`).join('\n');
  const rows: { label: string; before: string; after: string }[] = [
    { label: 'Navn', before: now.name, after: x.name },
    { label: 'Ønsket resultat', before: now.desired_result ?? '', after: x.desired_result ?? '' },
    { label: 'Bruksområde', before: now.use_area ?? '', after: x.use_area ?? '' },
    { label: 'Merkelapper', before: list(now.tags), after: list(x.tags) },
    { label: 'Dette trenger du', before: list(now.materials), after: list(x.materials) },
    { label: 'Steg', before: stepText(cur.steps), after: stepText(x.steps) },
    { label: 'Varianter', before: now.variants ?? '', after: variantsText(x.comparison, primary) ?? x.variants ?? '' },
    { label: 'Forbehold', before: now.risk_note ?? '', after: x.risk_note ?? '' },
  ].filter((r) => r.before.trim() !== r.after.trim());
  return (
    <>
      <h2>{x.name}</h2>
      {x.note && <p className="tech-lead">{x.note}</p>}
      {comparison}
      {rows.length === 0
        ? <p className="muted">Forslaget endrer ikke teksten i teknikken.</p>
        : (
          <div className="changes">
            {rows.map((r) => (
              <div key={r.label} className="change-row">
                <span className="eyebrow">{r.label}</span>
                <div className="change-before"><span className="small muted">Nå</span><p className="pre-line">{r.before || '–'}</p></div>
                <div className="change-after"><span className="small">Forslag</span><p className="pre-line">{r.after || '–'}</p></div>
              </div>
            ))}
          </div>
        )}
    </>
  );
}

function hostOf(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; }
}

/** Links in the user's own messages, so a link the agent could not read is still shown. */
function userLinks(messages: ResearchMessage[]): string[] {
  const urls = messages.filter((m) => m.role === 'user').flatMap((m) => m.body.match(/https?:\/\/[^\s)>\]]+/g) ?? []);
  return [...new Set(urls.map((u) => u.replace(/[.,;:]+$/, '')))];
}

/** What happened when the agent tried to open a page, from the trace on its replies. */
function openResult(messages: ResearchMessage[], url: string): string | null {
  const key = (u: string) => u.replace(/\/+$/, '').replace(/^https?:\/\/(www\.)?/, '').toLowerCase();
  const steps = messages.flatMap((m) => m.trace ?? []).filter((t) => t.action === 'open' && key(t.target) === key(url));
  return steps.at(-1)?.result ?? null;
}

/**
 * Skisse 03 «Kildeinspektør»: what each source contributed, and whether the
 * agent actually read it. Sources only seen in search results are marked.
 */
function SourceInspector({ sources, read, messages }: { sources: SourceRef[]; read: SourceRead[]; messages: ResearchMessage[] }) {
  const key = (u: string) => u.replace(/\/+$/, '').replace(/^https?:\/\/(www\.)?/, '').toLowerCase();
  const summary = new Map(read.map((r) => [key(r.url), r.summary]));
  const inDraft = new Set(sources.map((s) => key(s.url)));
  const missingUser = userLinks(messages).filter((u) => !inDraft.has(key(u)));
  return (
    <aside className="source-inspector" aria-label="Kilder">
      <span className="eyebrow">Kilder</span>
      <h3>Hva er dokumentert?</h3>
      {missingUser.map((u) => {
        const r = openResult(messages, u);
        const failed = r?.startsWith('Feil');
        return (
          <div key={u} className="source-card source-card-warn">
            <span className="eyebrow">Din kilde</span>
            <strong>{hostOf(u)}</strong>
            <Badge tone="warn">{failed ? 'Kunne ikke leses' : r ? 'Lest, men ikke brukt' : 'Ikke åpnet av agenten'}</Badge>
            {failed && <p className="small">{r!.replace(/^Feil:\s*/, '')}</p>}
            <a className="small" href={u} target="_blank" rel="noreferrer">Åpne ↗</a>
          </div>
        );
      })}
      {sources.length === 0 && missingUser.length === 0 && <p className="small muted">Agenten oppga ingen kilder. Utkastet bygger på det den vet fra før.</p>}
      {sources.map((s, i) => (
        <div key={s.url} className="source-card">
          <span className="eyebrow">Kilde {String(i + 1).padStart(2, '0')}</span>
          <strong>{s.title}</strong>
          <span className="small muted">{hostOf(s.url)}</span>
          {s.opened ? <Badge tone="moss">Lest</Badge> : <Badge tone="warn">Bare sett i søk</Badge>}
          {summary.get(key(s.url)) && <p className="small">{summary.get(key(s.url))}</p>}
          <a className="small" href={s.url} target="_blank" rel="noreferrer">Åpne ↗</a>
        </div>
      ))}
      <p className="small muted source-note">
        Agenten skal si hva den faktisk fikk lest. En videoside gir ofte bare tittel og beskrivelse, ikke selve videoen.
      </p>
    </aside>
  );
}

/** Skisse 03 «Fremgangsmåter»: the variants side by side. The user picks the one to test first. */
function Comparison({ c, sources, primary, onPick }:
  { c: KnowledgeComparison; sources: SourceRef[]; primary: number; onPick: (i: number) => void }) {
  const number = (u: string) => sources.findIndex((s) => s.url === u) + 1;
  return (
    <div className="article-block comparison">
      <span className="eyebrow">Fremgangsmåter</span>
      {c.common && <p><strong>Felles for kildene:</strong> {c.common}</p>}
      {c.variants.length > 0 && (
        <div className="variant-grid" role="radiogroup" aria-label="Velg utgangspunkt">
          {c.variants.map((v, i) => {
            const on = i === primary;
            const refs = v.sources.map(number).filter((n) => n > 0);
            return (
              <button key={i} type="button" role="radio" aria-checked={on} className={`variant-card ${on ? 'on' : ''}`} onClick={() => onPick(i)}>
                <strong>{String.fromCharCode(65 + i)} · {v.label}</strong>
                {v.description && <span>{v.description}</span>}
                <span className="small muted">{refs.length ? `Kilde ${refs.join(', ')}` : 'Ingen kilde oppgitt'}</span>
                <span className="variant-pick small">{on ? '✓ Utgangspunkt' : 'Bruk som utgangspunkt'}</span>
              </button>
            );
          })}
        </div>
      )}
      {c.variants.length > 1 && <p className="small muted">Stegene under følger agentens utgangspunkt. Varianten du velger, lagres først i teknikken.</p>}
    </div>
  );
}
