/**
 * Miniatyrverkstedet: one page per miniature, using the whole screen.
 * Left: the miniature's pictures. Middle: Bilder · Maleplan · Palett.
 * Right: the agent column, the same as in the project (O-17): what the agent is doing, what waits
 * for you, and the conversation. The sources for the game are on the Bilder tab.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useNavigate, useParams, useSearchParams } from 'react-router';
import { useCommand, useView } from '../../app/context';
import { useRuns } from '../../app/runs';
import { knownSources } from '../../domain/agent';
import type { Id, Tables } from '../../domain/types';
import { attachedExpansions, linkedSources, liveSubjects, subjectReferences, suggestedSources } from '../../domain/views';
import { Button, ErrorNote, FileImage } from '../../ui/components';
import { AgentPanel, AgentPanelProvider, useAgentPanel } from '../agent/AgentPanel';
import { useImageDrop } from '../images/dragImages';
import { ImagesTab, TagButton, tagState } from './ImagesTab';
import { reviewQueue } from '../../domain/review';
import type { ReviewItem } from '../../domain/review';
import { tagPage } from './agentRuns';
import { useApp } from '../../app/context';
import { PaletteTab } from './PaletteTab';
import { PlanTab } from './PlanTab';
import { closeMenu } from './PlanDoc';
import './plan.css';
import './workspace.css';

export type Tab = 'bilder' | 'maleplan' | 'palett';

function view(t: Tables, project_id: Id, subject_id: Id) {
  const s = t.miniature_subject[subject_id];
  const project = t.project[project_id];
  if (!s || !project || s.project_id !== project_id) return null;
  const game = t.game[project.game_id]?.primary_name ?? '';
  const siblings = liveSubjects(t, project_id);
  const i = siblings.findIndex((x) => x.id === s.id);
  const refs = subjectReferences(t, s).map((r) => ({ ...r, cover: r.asset.id === s.official_asset_id }));
  return {
    s, game,
    expansion: attachedExpansions(t, project_id).find((e) => e.id === s.expansion_id)?.name ?? 'Grunnspill',
    prev: i > 0 ? siblings[i - 1] : undefined,
    next: i >= 0 && i < siblings.length - 1 ? siblings[i + 1] : undefined,
    position: `${i + 1} av ${siblings.length}`,
    refs,
    sources: knownSources(t, project_id),
    // Pages the user tagged as showing this miniature («Viser figuren»); shown first, and the agent opens them first.
    tagged: new Set(linkedSources(t, s.id, 'evidence').map((x) => x.url!)),
    likely: new Set(suggestedSources(t, s.id).map((x) => x.url!)),
    queue: reviewQueue(t, project_id),
    order: siblings.map((x) => x.id),
  };
}

const COLLAPSE_KEY = 'paintrest.ws.refsCollapsed';
/** Tagged first, then the survey's suggestions, then the rest. */
const TAG_ORDER = { on: 0, likely: 1, off: 2 } as const;
const ROLE_LABEL = { official: 'Offisiell', painted: 'Malt', guide: 'Guide', other: '' } as const;
function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
}

export function Workspace() {
  return <AgentPanelProvider><WorkspacePage /></AgentPanelProvider>;
}

function WorkspacePage() {
  const { projectId = '', subjectId = '', tab: tabParam } = useParams();
  const { open: agentOpen } = useAgentPanel();
  const tab: Tab = tabParam === 'maleplan' || tabParam === 'palett' ? tabParam : 'bilder';
  const data = useView((t) => view(t, projectId, subjectId), [projectId, subjectId]);
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const reviewing = params.has('gjennomgang');
  const app = useApp();
  const { run, error, clearError } = useCommand();
  // O-17: a found picture dragged from «Venter på deg» onto the workspace goes on this miniature.
  const drop = useImageDrop(app, projectId, () => data?.s.name ?? 'miniatyren');
  const imagesRun = useRuns((r) => r.get(subjectId, 'images'));
  const planRun = useRuns((r) => r.get(subjectId, 'plan'));
  // Pictures the plan is built on. Until the user ticks anything (null), it follows the
  // pictures: the illustration and up to three more, also when new pictures are saved.
  const [chosenRefs, setChosenRefs] = useState<Set<Id> | null>(null);
  const [viewing, setViewing] = useState<Id | null>(null);
  const [zoom, setZoom] = useState(false);
  const [browseUrl, setBrowseUrl] = useState<string | null>(null);
  const [collapsed, setCollapsedState] = useState(readCollapsed);
  const setCollapsed = (v: boolean) => {
    setCollapsedState(v);
    try { localStorage.setItem(COLLAPSE_KEY, v ? '1' : '0'); } catch { /* only a convenience */ }
  };

  useEffect(() => { setChosenRefs(null); setViewing(null); setBrowseUrl(null); }, [subjectId]);
  const planRefs = useMemo(() => chosenRefs
    ?? new Set([...(data?.refs ?? [])].sort((a, b) => Number(b.cover) - Number(a.cover)).slice(0, 4).map((r) => r.asset.id)), [chosenRefs, data]);
  const setPlanRefs = (fn: (cur: Set<Id>) => Set<Id>) => setChosenRefs(fn(planRefs));

  const current = useMemo(() => data?.refs.find((r) => r.asset.id === viewing) ?? data?.refs.find((r) => r.cover) ?? data?.refs[0], [data, viewing]);

  if (!data) {
    return <main className="page"><h1>Fant ikke miniatyren</h1><Link to={`/p/${projectId}/miniatyrer`}>Til miniatyrene</Link></main>;
  }
  const { s } = data;
  const base = `/p/${projectId}/m`;
  // In a walkthrough the walkthrough follows along, also with the header's previous and next.
  const to = (id: Id, t: Tab = tab) => `${base}/${id}/${t}${reviewing ? '?gjennomgang=1' : ''}`;
  const review = reviewing ? reviewPosition(data.queue, data.order, s.id) : null;

  return (
    <div className="ws">
      <header className="ws-head">
        <Link to={`/p/${projectId}/miniatyrer`} className="ws-back">← Miniatyrer</Link>
        <div className="ws-title">
          <span className="eyebrow" title={data.position}>{data.game}{data.expansion !== 'Grunnspill' ? ` · ${data.expansion}` : ''}</span>
          <h1>{s.name}{s.grouping === 'group' && <span className="ws-count"> ×{s.physical_count}</span>}</h1>
        </div>
        <nav className="ws-tabs" aria-label="Arbeid med miniatyren">
          <NavLink to={to(s.id, 'bilder')} className={tab === 'bilder' ? 'active' : ''}>Bilder {imagesRun?.status === 'running' && <span className="ws-dot" aria-label="agenten jobber" />}</NavLink>
          <NavLink to={`${base}/${s.id}/maleplan`} className={tab === 'maleplan' ? 'active' : ''}>Maleplan {planRun?.status === 'running' && <span className="ws-dot" aria-label="agenten jobber" />}</NavLink>
          <NavLink to={`${base}/${s.id}/palett`} className={tab === 'palett' ? 'active' : ''}>Palett</NavLink>
        </nav>
        <div className="ws-head-actions">
          <Button variant="ghost" disabled={!data.prev} onClick={() => data.prev && navigate(to(data.prev.id))} aria-label="Forrige miniatyr">‹ {data.prev?.name ?? ''}</Button>
          <Button variant="ghost" disabled={!data.next} onClick={() => data.next && navigate(to(data.next.id))} aria-label="Neste miniatyr">{data.next?.name ?? ''} ›</Button>
          {s.current_plan_version_id && <Button variant="primary" onClick={() => navigate(`/male/${s.id}`)} title="Åpne planen i Painting Mode">Mal</Button>}
        </div>
      </header>
      <ErrorNote error={error} onClose={clearError} />
      {review && (
        <ReviewBar review={review} name={s.name}
          onGo={(id) => navigate(`${base}/${id}/bilder?gjennomgang=1`)}
          onEnd={() => navigate(`${base}/${s.id}/${tab}`)}
          onList={() => navigate(`/p/${projectId}/miniatyrer`)} />
      )}

      <ErrorNote error={drop.error} onClose={drop.clearError} />
      {drop.note && (
        <p className="drop-note" role="status">
          {drop.note.text}. <button type="button" className="link" onClick={() => { const u = drop.note!.undo; drop.clearNote(); void run(u); }}>Angre</button>
          <button type="button" className="link small" onClick={drop.clearNote} aria-label="Lukk">×</button>
        </p>
      )}

      <div className={`ws-body ${agentOpen ? 'agent-open' : 'agent-closed'} ${collapsed ? 'refs-collapsed' : ''} ${data.refs.length ? '' : 'no-refs'} ${drop.over === s.id ? 'drop-over' : ''}`} {...drop.dropOn(s.id)}>
        {data.refs.length > 0 && <aside className="ws-refs" aria-label="Bilder av miniatyren">
          <button type="button" className="ws-refs-toggle" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}
            aria-label={collapsed ? 'Vis bildekolonnen' : 'Skjul bildekolonnen'} title={collapsed ? 'Vis bildene' : 'Skjul bildene'}>{collapsed ? '›' : '‹'}</button>
          {collapsed ? (
            <div className="ws-refs-mini">
              {data.refs.map((r) => (
                <button key={r.asset.id} type="button" onClick={() => { setViewing(r.asset.id); setZoom(true); }} aria-label={`Forstørr ${r.label}`}>
                  <FileImage fileId={r.file_id} alt="" className="ws-thumb-img" />
                </button>
              ))}
            </div>
          ) : current ? (
            <>
              <button type="button" className="ws-ref-main" onClick={() => setZoom(true)} aria-label={`Forstørr ${current.label}`}>
                <FileImage fileId={current.file_id} alt={current.label} className="ws-ref-img" />
              </button>
              <div className="ws-ref-meta">
                <span className="small" title={[current.label, current.source.title, current.source.creator].filter(Boolean).join(' · ')}>{current.source.creator ?? current.source.title}</span>
                <details className="pd-more">
                  <summary aria-label="Valg for bildet">⋯</summary>
                  <div className="pd-menu">
                    {!current.cover && <button type="button" onClick={(e) => { closeMenu(e); run((c) => c.setSubjectCover(s.id, current.asset.id)); }}>Gjør til illustrasjon</button>}
                    {current.source.url && <button type="button" onClick={(e) => { closeMenu(e); window.open(current.source.url!, '_blank', 'noreferrer'); }}>Åpne kilden ↗</button>}
                    <button type="button" className="danger" onClick={(e) => { closeMenu(e); run((c) => c.detachSubjectImage(s.id, current.asset.id)); }}>Fjern bildet</button>
                  </div>
                </details>
              </div>
              <div className="ws-thumbs">
                {data.refs.map((r) => {
                  const inPlan = planRefs.has(r.asset.id);
                  return (
                    <div key={r.asset.id} className={`ws-thumb ${current.asset.id === r.asset.id ? 'on' : ''}`}>
                      <button type="button" onClick={() => setViewing(r.asset.id)} aria-label={`Vis ${r.label}`}>
                        <FileImage fileId={r.file_id} alt="" className="ws-thumb-img" />
                        {r.cover && <span className="ws-star" title="Illustrasjon" aria-label="Illustrasjon">★</span>}
                      </button>
                      {tab === 'maleplan' && (
                        <button type="button" className={`ws-inplan ${inPlan ? 'on' : ''}`} aria-pressed={inPlan}
                          title={inPlan ? 'Agenten ser på dette bildet når den lager maleplanen' : 'Ta med i maleplanen (høyst 4)'}
                          aria-label={`${r.label}: med i maleplanen`}
                          onClick={() => setPlanRefs((cur) => {
                            const n = new Set(cur);
                            if (!inPlan) { if (n.size < 4) n.add(r.asset.id); } else n.delete(r.asset.id);
                            return n;
                          })}>✓</button>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}
        </aside>}

        <main className="ws-main">
          {tab === 'bilder' && <ImagesTab subject={s} game={data.game} run={imagesRun} browseUrl={browseUrl} setBrowseUrl={setBrowseUrl} referenceFileId={data.refs.find((r) => r.cover)?.file_id ?? data.refs[0]?.file_id ?? null}
            review={review ? { next: review.next ? () => navigate(`${base}/${review.next!.subject_id}/bilder?gjennomgang=1`) : () => navigate(`/p/${projectId}/miniatyrer`), nextName: review.next?.name ?? null } : null} />}
          {tab === 'bilder' && data.sources.length > 0 && (
            <section className="ws-sources" aria-label="Kilder for spillet">
              <h2 className="eyebrow">Kilder for spillet ({data.sources.length})</h2>
              <ul>
                {[...data.sources].sort((a, b) => TAG_ORDER[tagState(data, a.source.url!)] - TAG_ORDER[tagState(data, b.source.url!)]).map((k) => (
                  <li key={k.source.id} className={`${browseUrl === k.source.url ? 'on' : ''} ${data.tagged.has(k.source.url!) ? 'tagged' : data.likely.has(k.source.url!) ? 'likely' : ''}`}>
                    <button type="button" onClick={() => { setBrowseUrl(k.source.url); document.querySelector('.ws-main')?.scrollTo({ top: 0, behavior: 'smooth' }); }}
                      title={[k.source.creator, k.source.language && languageName(k.source.language), k.status === 'kept' ? `lagret, ${k.asset_count} bilder` : 'funnet av agenten', k.summary].filter(Boolean).join(' · ')}>
                      <span className="ws-src-head">
                        <strong>{k.source.title}</strong>
                        {k.source.role && k.source.role !== 'other' && <span className="ws-src-role">{ROLE_LABEL[k.source.role]}</span>}
                      </span>
                    </button>
                    <span className="ws-src-actions">
                      <TagButton state={tagState(data, k.source.url!)} onToggle={(on) => run(() => tagPage(app, s.id, { url: k.source.url!, title: k.source.title }, on))} />
                      <a className="small" href={k.source.url!} target="_blank" rel="noreferrer" aria-label="Åpne siden">↗</a>
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {tab === 'maleplan' && <PlanTab subject={s} game={data.game} run={planRun} planFileIds={data.refs.filter((r) => planRefs.has(r.asset.id)).map((r) => r.file_id)} />}
          {tab === 'palett' && <PaletteTab subject={s} />}
        </main>

        <AgentPanel projectId={projectId} subjectId={s.id} />
      </div>

      {zoom && current && (
        <div className="pm-zoom" role="dialog" aria-label="Forstørret bilde" onClick={() => setZoom(false)}>
          <FileImage fileId={current.file_id} alt={current.label} className="pm-zoom-img" />
          <button type="button" className="pm-zoom-close">Lukk</button>
        </div>
      )}
    </div>
  );
}

interface ReviewPos {
  /** This miniature's place in the walkthrough (1-based), or null when nothing waits here any more. */
  index: number | null;
  total: number;
  current: ReviewItem | null;
  prev: ReviewItem | null;
  next: ReviewItem | null;
}

/** Where this miniature is in the walkthrough. A miniature that is done stays in place, so «Neste» goes on from here. */
function reviewPosition(queue: ReviewItem[], order: Id[], id: Id): ReviewPos {
  const at = (sid: Id) => order.indexOf(sid);
  const here = at(id);
  const i = queue.findIndex((q) => q.subject_id === id);
  return {
    index: i >= 0 ? i + 1 : null, total: queue.length, current: i >= 0 ? queue[i]! : null,
    prev: [...queue].reverse().find((q) => at(q.subject_id) < here) ?? null,
    next: queue.find((q) => at(q.subject_id) > here) ?? queue.find((q) => q.subject_id !== id && at(q.subject_id) < here) ?? null,
  };
}

/** «Gjennomgang»: what waits here, and the way on to the next miniature with something waiting. */
function ReviewBar({ review: r, name, onGo, onEnd, onList }: { review: ReviewPos; name: string; onGo: (id: Id) => void; onEnd: () => void; onList: () => void }) {
  const waiting = r.current ? [
    r.current.images ? `${r.current.images} bildeforslag` : '',
    r.current.identity ? 'figuren venter på «Riktig figur»' : '',
    r.current.likely ? `${r.current.likely} ${r.current.likely === 1 ? 'side' : 'sider'} «Trolig figuren»` : '',
  ].filter(Boolean).join(' · ') : '';
  return (
    <div className={`ws-review ${r.current ? '' : 'done'}`} role="region" aria-label="Gjennomgang">
      <span className="ws-review-pos">
        <strong>Gjennomgang</strong>
        {r.index ? ` ${r.index} av ${r.total}` : r.total ? ` · ${r.total} igjen` : ''}
      </span>
      <span className="ws-review-what">
        {r.current ? waiting : r.total ? `Ferdig med ${name}.` : 'Alt er gjennomgått.'}
      </span>
      <span className="ws-review-actions">
        {r.prev && <Button variant="ghost" onClick={() => onGo(r.prev!.subject_id)}>‹ {r.prev.name}</Button>}
        {r.next
          ? <Button variant={r.current ? undefined : 'primary'} onClick={() => onGo(r.next!.subject_id)}>{r.current ? 'Hopp over' : 'Neste'}: {r.next.name} ›</Button>
          : !r.current && <Button variant="primary" onClick={onList}>Til miniatyrlisten</Button>}
        <button type="button" className="link small" onClick={onEnd}>Avslutt</button>
      </span>
    </div>
  );
}

export function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(['nb'], { type: 'language' }).of(code.split('-')[0]!) ?? code;
  } catch {
    return code;
  }
}
