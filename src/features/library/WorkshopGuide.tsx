import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useView } from '../../app/context';
import { techniqueDetail } from '../../domain/library';
import type { ExperienceOutcome } from '../../domain/types';
import { ExperienceDialog } from './ExperienceDialog';
import { ExperienceBadge, StatusBadge } from './parts';
import './workshop.css';

/**
 * Skisse 06 «iPad verkstedguide»: full screen, landscape first. Only what you
 * need at the painting table: materials, warnings and steps. Step ticks are
 * only on screen and are not saved.
 */
export function WorkshopGuide() {
  const { techniqueId = '' } = useParams();
  const d = useView((t) => techniqueDetail(t, techniqueId), [techniqueId]);
  const [done, setDone] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<ExperienceOutcome | null>(null);
  const [thanks, setThanks] = useState(false);

  if (!d || d.technique.deleted_at) {
    return <main className="page"><h1>Fant ikke teknikken</h1><p><Link to="/bibliotek/teknikker">Til teknikkene</Link></p></main>;
  }
  const x = d.technique;
  const toggle = (id: string) => setDone((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  return (
    <div className="wg">
      <header className="wg-bar">
        <Link to={`/bibliotek/teknikker/${x.id}`} className="wg-back" aria-label="Tilbake til teknikken">←</Link>
        <div className="wg-title">
          <span className="eyebrow">Verkstedguide</span>
          <h1>{x.name}</h1>
        </div>
        <div className="wg-bar-badges">
          <StatusBadge status={x.status} />
          <ExperienceBadge experience={d.experience} />
        </div>
      </header>

      <div className="wg-body">
        <aside className="wg-side" aria-label="Materialer">
          <span className="eyebrow">Dette trenger du</span>
          {x.materials.length
            ? <ul>{x.materials.map((m, i) => <li key={i}>{m}</li>)}</ul>
            : <p className="wg-dim">Ingen materialer lagt inn.</p>}
          <p className="wg-dim small">Malingene velges i oppskriften du bruker teknikken med.</p>
          <Link to={`/bibliotek/teknikker/${x.id}`} className="wg-more">Hele teknikken</Link>
        </aside>

        <main className="wg-main">
          {x.desired_result && <p className="wg-lead">{x.desired_result}</p>}
          {x.risk_note && <div className="wg-warn" role="note">{x.risk_note}</div>}

          <h2>Slik gjør du</h2>
          {d.steps.length === 0 ? (
            <p className="muted">Teknikken har ingen steg ennå.</p>
          ) : (
            <ol className="wg-steps">
              {d.steps.map((s, i) => {
                const on = done.has(s.id);
                return (
                  <li key={s.id}>
                    <button type="button" className={`wg-step ${on ? 'done' : ''}`} aria-pressed={on} onClick={() => toggle(s.id)}>
                      <span className="wg-step-no mono">{on ? '✓' : String(i + 1).padStart(2, '0')}</span>
                      <span className="wg-step-text">
                        {s.title && <strong>{s.title}</strong>}
                        {s.instruction && <span>{s.instruction}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          {d.steps.length > 0 && <p className="small muted">Trykk på et steg for å krysse det av. Avkryssingen lagres ikke.</p>}
        </main>
      </div>

      <footer className="wg-foot">
        {thanks && <span className="wg-thanks" role="status">Erfaringen er lagret.</span>}
        <button type="button" className="wg-btn" onClick={() => setDialog('needs_adjustment')}>Må justeres</button>
        <button type="button" className="wg-btn wg-btn-ok" onClick={() => setDialog('worked')}>Dette fungerte ✓</button>
      </footer>

      <ExperienceDialog
        techniqueId={x.id}
        initial={dialog}
        open={dialog !== null}
        onClose={() => setDialog(null)}
        onSaved={() => setThanks(true)}
      />
    </div>
  );
}
