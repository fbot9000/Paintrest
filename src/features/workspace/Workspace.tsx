/**
 * Miniatyrverkstedet: one page per miniature, using the whole screen.
 * Left: the miniature's pictures. Middle: Bilder · Maleplan · Palett.
 * Right: what the agent is doing and the sources found for the game.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, useNavigate, useParams } from 'react-router';
import { useCommand, useView } from '../../app/context';
import { useRuns } from '../../app/runs';
import type { Run } from '../../app/runs';
import { knownSources } from '../../domain/agent';
import type { PaintPlanPayload } from '../../domain/agent';
import type { Id, Tables } from '../../domain/types';
import { attachedExpansions, linkedSources, liveSubjects, subjectReferences } from '../../domain/views';
import { Badge, Button, ErrorNote, FileImage } from '../../ui/components';
import { LiveSteps } from '../agent/AgentPanel';
import { runs } from '../../app/runs';
import { ImagesTab, TagButton } from './ImagesTab';
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
    planSourceUrls: planSourceUrls(t, s),
    // Pages the user tagged as showing this miniature («Viser figuren»); shown first, and the agent opens them first.
    tagged: new Set(linkedSources(t, s.id, 'evidence').map((x) => x.url!)),
  };
}

/** Pages the plan (pending proposal, or the agent's notes on it) was built on, shown first on the Maleplan tab. */
function planSourceUrls(t: Tables, s: NonNullable<Tables['miniature_subject'][string]>): string[] {
  const p = Object.values(t.research_proposal)
    .filter((x) => x.decision === 'pending' && (x.result_type === 'paint_plan' || x.result_type === 'plan_revision')
      && (x.payload as PaintPlanPayload).subject_id === s.id)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  if (!p) return [];
  const payload = p.payload as PaintPlanPayload;
  return [...(payload.sources_read ?? []).map((x) => x.url), ...(payload.sources ?? []).map((x) => x.url)];
}

const COLLAPSE_KEY = 'paintrest.ws.refsCollapsed';
function readCollapsed(): boolean {
  try { return localStorage.getItem(COLLAPSE_KEY) === '1'; } catch { return false; }
}

export function Workspace() {
  const { projectId = '', subjectId = '', tab: tabParam } = useParams();
  const tab: Tab = tabParam === 'maleplan' || tabParam === 'palett' ? tabParam : 'bilder';
  const data = useView((t) => view(t, projectId, subjectId), [projectId, subjectId]);
  const navigate = useNavigate();
  const app = useApp();
  const { run, error, clearError } = useCommand();
  const imagesRun = useRuns((r) => r.get(subjectId, 'images'));
  const planRun = useRuns((r) => r.get(subjectId, 'plan'));
  // Pictures the plan is built on. Until the user ticks anything (null), it follows the
  // pictures: the illustration and up to three more, also when new pictures are saved.
  const [chosenRefs, setChosenRefs] = useState<Set<Id> | null>(null);
  const [viewing, setViewing] = useState<Id | null>(null);
  const [zoom, setZoom] = useState(false);
  const [browseUrl, setBrowseUrl] = useState<string | null>(null);
  const [showSide, setShowSide] = useState(false);
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
  const activeRun = [imagesRun, planRun].filter((r): r is Run => !!r).sort((a, b) => b.started_at.localeCompare(a.started_at))[0] ?? null;
  // The right column belongs to finding pictures; elsewhere it shows only while the agent works, or when asked for.
  const sideShown = tab === 'bilder' || activeRun?.status === 'running' || showSide;

  return (
    <div className="ws">
      <header className="ws-head">
        <Link to={`/p/${projectId}/miniatyrer`} className="ws-back">← Miniatyrer</Link>
        <div className="ws-title">
          <span className="eyebrow" title={data.position}>{data.game}{data.expansion !== 'Grunnspill' ? ` · ${data.expansion}` : ''}</span>
          <h1>{s.name}{s.grouping === 'group' && <span className="ws-count"> ×{s.physical_count}</span>}</h1>
        </div>
        <nav className="ws-tabs" aria-label="Arbeid med miniatyren">
          <NavLink to={`${base}/${s.id}/bilder`} className={tab === 'bilder' ? 'active' : ''}>Bilder {imagesRun?.status === 'running' && <span className="ws-dot" aria-label="agenten jobber" />}</NavLink>
          <NavLink to={`${base}/${s.id}/maleplan`} className={tab === 'maleplan' ? 'active' : ''}>Maleplan {planRun?.status === 'running' && <span className="ws-dot" aria-label="agenten jobber" />}</NavLink>
          <NavLink to={`${base}/${s.id}/palett`} className={tab === 'palett' ? 'active' : ''}>Palett</NavLink>
        </nav>
        <div className="ws-head-actions">
          <Button variant="ghost" disabled={!data.prev} onClick={() => data.prev && navigate(`${base}/${data.prev.id}/${tab}`)} aria-label="Forrige miniatyr">‹ {data.prev?.name ?? ''}</Button>
          <Button variant="ghost" disabled={!data.next} onClick={() => data.next && navigate(`${base}/${data.next.id}/${tab}`)} aria-label="Neste miniatyr">{data.next?.name ?? ''} ›</Button>
          {s.current_plan_version_id && <Button variant="primary" onClick={() => navigate(`/male/${s.id}`)} title="Åpne planen i Painting Mode">Mal</Button>}
          <Button className={`ws-side-toggle ${tab !== 'bilder' ? 'always' : ''}`} onClick={() => setShowSide((v) => !v)} aria-expanded={sideShown}>Kilder</Button>
        </div>
      </header>
      <ErrorNote error={error} onClose={clearError} />

      <div className={`ws-body ${showSide ? 'side-open' : ''} ${sideShown ? '' : 'side-hidden'} ${collapsed ? 'refs-collapsed' : ''} ${data.refs.length ? '' : 'no-refs'}`}>
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
          {tab === 'bilder' && <ImagesTab subject={s} game={data.game} run={imagesRun} browseUrl={browseUrl} setBrowseUrl={setBrowseUrl} referenceFileId={data.refs.find((r) => r.cover)?.file_id ?? data.refs[0]?.file_id ?? null} />}
          {tab === 'maleplan' && <PlanTab subject={s} game={data.game} run={planRun} planFileIds={data.refs.filter((r) => planRefs.has(r.asset.id)).map((r) => r.file_id)} />}
          {tab === 'palett' && <PaletteTab subject={s} />}
        </main>

        <aside className={`ws-side ${tab === 'maleplan' ? 'compact' : ''}`} aria-label="Agenten og kildene">
          {activeRun && (
            <section className="ws-agent">
              {activeRun.status === 'running'
                ? <div className="ws-live"><LiveSteps events={activeRun.events} onStop={() => runs.stop(s.id, activeRun.kind)} /></div>
                : <RunResult run={activeRun} />}
            </section>
          )}
          <section className="ws-sources">
            <h2 className="eyebrow">Kilder ({data.sources.length})</h2>
            <ul>
              {(tab === 'maleplan'
                ? [...data.sources].sort((a, b) => Number(data.planSourceUrls.includes(b.source.url!)) - Number(data.planSourceUrls.includes(a.source.url!)))
                : [...data.sources].sort((a, b) => Number(data.tagged.has(b.source.url!)) - Number(data.tagged.has(a.source.url!)))).map((k) => (
                <li key={k.source.id} className={`${browseUrl === k.source.url ? 'on' : ''} ${data.tagged.has(k.source.url!) ? 'tagged' : ''}`}>
                  <button type="button" onClick={() => { setBrowseUrl(k.source.url); if (tab !== 'bilder') navigate(`${base}/${s.id}/bilder`); }}
                    title={[k.source.creator, k.source.language && languageName(k.source.language), k.status === 'kept' ? `lagret, ${k.asset_count} bilder` : 'funnet av agenten', k.summary].filter(Boolean).join(' · ')}>
                    <span className="ws-src-head">
                      <strong>{k.source.title}</strong>
                      {tab === 'maleplan' && data.planSourceUrls.includes(k.source.url!) && <Badge tone="moss">I planen</Badge>}
                    </span>
                  </button>
                  <span className="ws-src-actions">
                    {tab === 'bilder' && <TagButton on={data.tagged.has(k.source.url!)} onToggle={(on) => run(() => tagPage(app, s.id, { url: k.source.url!, title: k.source.title }, on))} />}
                    <a className="small" href={k.source.url!} target="_blank" rel="noreferrer" aria-label="Åpne siden">↗</a>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
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

function RunResult({ run: r }: { run: Run }) {
  const final = [...r.events].reverse().find((e) => e.type === 'final');
  const label = r.kind === 'images' ? 'Bildejakt' : 'Maleplan';
  return (
    <div className="ws-result">
      <span className="small">
        {label} {r.status === 'done' ? 'ferdig' : r.status === 'stopped' ? 'stoppet' : 'feilet'}
        {r.finished_at ? ` kl. ${new Date(r.finished_at).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })}` : ''}
      </span>
      {final && final.type === 'final' && <p>{final.message}</p>}
      {/* Notes about removed, unconfirmed finds are bookkeeping; only problems the user must act on are shown. */}
      {final && final.type === 'final' && final.warnings.filter((w) => !w.startsWith('Fjernet')).map((w, i) => <p key={i} className="small ws-warn">{w}</p>)}
      {r.error && <p className="small ws-warn">{r.error}</p>}
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
