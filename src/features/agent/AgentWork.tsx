/**
 * The agent column's first two parts (O-17, skisser 18.11.2026 «Agenten på miniatyrsiden»):
 * «Jobber nå» (every run in the project, with Stopp) and «Venter på deg» (what the work waits for,
 * for the whole project, with one action each). The conversation comes after. The column is the
 * same in the project pages and in the workspace. Results live where they belong; this points there.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useApp, useView } from '../../app/context';
import { runs, useRuns } from '../../app/runs';
import type { Run } from '../../app/runs';
import { projectWaiting } from '../../domain/waiting';
import type { Id, Tables } from '../../domain/types';
import { dragImages } from '../images/dragImages';
import { LiveSteps } from './AgentPanel';

const KIND_LABEL: Partial<Record<Run['kind'], string>> = { images: 'Bildejakt', plan: 'Maleplan', game: 'Kartlegging av spillet' };

/** The project's runs: the game survey, and the image hunts and plans for its miniatures. The panel's own turn shows in the conversation. */
function projectRuns(t: Tables, project_id: Id, all: Run[]): Run[] {
  return all.filter((r) => (r.kind === 'game' && r.id === project_id)
    || ((r.kind === 'images' || r.kind === 'plan') && t.miniature_subject[r.id]?.project_id === project_id));
}

function runName(t: Tables, r: Run): string {
  const kind = KIND_LABEL[r.kind] ?? 'Agenten';
  const subject = r.kind === 'game' ? null : t.miniature_subject[r.id]?.name;
  return subject ? `${kind}: ${subject}` : kind;
}

export function WorkingNow({ projectId, subjectId }: { projectId: Id; subjectId?: Id }) {
  const all = useRuns((r) => r.all());
  const items = useView((t) => projectRuns(t, projectId, all).map((r) => ({ r, name: runName(t, r) })), [projectId, all]);
  if (!items.length) return null;
  // The run that belongs to this page shows its steps; the others are one line each.
  const mine = (r: Run) => (subjectId ? r.id === subjectId : r.kind === 'game');
  return (
    <section className="aw" aria-label="Jobber nå">
      <h3 className="eyebrow">Jobber nå</h3>
      {items.map(({ r, name }) => (
        <div key={r.key} className={`aw-run ${r.status}`}>
          {r.status === 'running' && mine(r) ? (
            <>
              <span className="aw-run-name">{name}</span>
              <LiveSteps events={r.events} onStop={() => runs.stop(r.id, r.kind)} />
            </>
          ) : r.status === 'running' ? (
            <div className="aw-line">
              <span className="run-dot" aria-hidden />
              {r.href ? <Link to={r.href}>{name}</Link> : <span>{name}</span>}
              <button type="button" className="agent-link small" onClick={() => runs.stop(r.id, r.kind)}>Stopp</button>
            </div>
          ) : (
            <RunDone r={r} name={name} />
          )}
        </div>
      ))}
    </section>
  );
}

function RunDone({ r, name }: { r: Run; name: string }) {
  const final = [...r.events].reverse().find((e) => e.type === 'final');
  const state = r.status === 'done' ? 'ferdig' : r.status === 'stopped' ? 'stoppet' : 'feilet';
  return (
    <div className="aw-done">
      <div className="aw-line">
        {r.href ? <Link to={r.href}>{name}</Link> : <span>{name}</span>}
        <span className="small">{state}{r.finished_at ? ` kl. ${new Date(r.finished_at).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>
        <button type="button" className="agent-link small" onClick={() => runs.dismiss(r.id, r.kind)} aria-label={`Lukk ${name}`}>Lukk</button>
      </div>
      {final && final.type === 'final' && <p className="small">{final.message}</p>}
      {/* Notes about removed, unconfirmed finds are bookkeeping; only problems the user must act on are shown. */}
      {final && final.type === 'final' && final.warnings.filter((w) => !w.startsWith('Fjernet')).map((w, i) => <p key={i} className="small aw-warn">{w}</p>)}
      {r.error && <p className="small aw-warn">{r.error}</p>}
    </div>
  );
}

/** «Venter på deg»: what the work waits for, with one action each. Several things are taken together. */
export function WaitingForYou({ projectId }: { projectId: Id }) {
  const app = useApp();
  const navigate = useNavigate();
  const w = useView((t) => projectWaiting(t, projectId), [projectId]);
  const [showMissing, setShowMissing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const identities = w.queue.filter((q) => q.identity).length;
  const review = (id?: Id) => {
    const first = id ?? w.queue[0]?.subject_id;
    if (first) navigate(`/p/${projectId}/m/${first}/bilder?gjennomgang=1`);
  };
  if (!w.pool.length && !w.queue.length && !w.missing.length && !w.plans.length) return null;
  return (
    <section className="aw" aria-label="Venter på deg">
      <h3 className="eyebrow">Venter på deg</h3>

      {w.pool.length > 0 && (
        <div className="aw-item">
          <div className="aw-line">
            <strong>{w.pool.length} {w.pool.length === 1 ? 'bilde' : 'bilder'} funnet</strong>
            <Link className="aw-act" to={`/p/${projectId}/bilder`}>Fordel bilder</Link>
          </div>
          <div className="aw-thumbs" aria-label="Dra et bilde til en miniatyr">
            {w.pool.slice(0, 8).map((x) => (
              <img key={x.image.image_url} src={app.ai.imageProxyUrl(x.image.thumbnail_url ?? x.image.image_url)} alt={x.image.caption ?? ''}
                title={`${x.guesses[0] ? `Trolig ${x.guesses[0].name}. ` : ''}Dra bildet til en miniatyr`} loading="lazy" draggable
                onDragStart={(e) => dragImages(e, [x.image.image_url])}
                onError={(e) => { e.currentTarget.style.display = 'none'; }} />
            ))}
          </div>
          <span className="small aw-hint">Dra et bilde til en miniatyr, eller fordel alle på tavlen.</span>
        </div>
      )}

      {w.queue.length > 0 && (
        <div className="aw-item">
          <div className="aw-line">
            <span>
              <strong>{w.queue.length} {w.queue.length === 1 ? 'miniatyr' : 'miniatyrer'}</strong> å gå gjennom
              {identities > 0 && <span className="small"> · {identities} venter på «Riktig figur»</span>}
            </span>
            <button type="button" className="aw-act" onClick={() => review()}>Gå gjennom</button>
          </div>
        </div>
      )}

      {w.missing.length > 0 && (
        <div className="aw-item">
          <div className="aw-line">
            <strong>{w.missing.length} {w.missing.length === 1 ? 'miniatyr mangler' : 'miniatyrer mangler'} i listen</strong>
            <button type="button" className="aw-act" onClick={() => act(async () => { for (const m of w.missing) await app.research.approveProposal(m.p.id); })}>
              {w.missing.length === 1 ? 'Legg til' : 'Legg til alle'}
            </button>
          </div>
          <button type="button" className="agent-link small" onClick={() => setShowMissing((v) => !v)} aria-expanded={showMissing}>
            {showMissing ? 'Skjul' : 'Vis'} hvilke
          </button>
          {showMissing && (
            <ul className="aw-list">
              {w.missing.map(({ p, c, unknownExpansion }) => (
                <li key={p.id} title={[c.identity?.description, c.note, unknownExpansion ? `Utvidelsen «${c.expansion_name}» er ikke med i prosjektet` : null].filter(Boolean).join(' · ')}>
                  <span>
                    <strong>{c.name}</strong>
                    <span className="small"> · {c.grouping === 'group' ? `${c.physical_count} figurer` : 'enkeltfigur'} · {c.expansion_name ?? 'Grunnspill'}</span>
                  </span>
                  <button type="button" className="agent-link small" onClick={() => act(() => app.research.approveProposal(p.id))} aria-label={`Legg til ${c.name}`}>Legg til</button>
                  <button type="button" className="agent-link small" onClick={() => act(() => app.research.rejectProposal(p.id))} aria-label={`Ta ut ${c.name}`}>×</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {w.plans.map((x) => (
        <div key={x.subject_id} className="aw-item">
          <div className="aw-line">
            <span><strong>{x.revision ? 'Ny versjon av maleplanen' : 'Maleplan'}</strong> for {x.name}</span>
            <Link className="aw-act" to={`/p/${projectId}/m/${x.subject_id}/maleplan`}>Se og godkjenn</Link>
          </div>
        </div>
      ))}

      {error && <p className="small aw-warn">{error}</p>}
    </section>
  );
}
