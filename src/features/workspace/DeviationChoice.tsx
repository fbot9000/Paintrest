/**
 * Before a new plan version is saved: the open deviations from Painting Mode, and
 * which of them become part of the plan (beslutning 24.11.2026). Baking one in writes
 * it into the draft, where it can be read and edited; the rest follow as deviations.
 */
import type { PaintPlanPayload } from '../../domain/agent';
import { bakeDeviation, describeDeviation, deviationPlace } from '../../domain/plan-versions';
import type { Id, LocalDeviation, Tables } from '../../domain/types';

export interface Bake {
  id: Id;
  before: PaintPlanPayload;
  after: PaintPlanPayload;
  applied: boolean;
}

/** Bakes a deviation into the draft, or takes it out again. Taking it out restores the draft only if it is unchanged since. */
export function toggleBake(t: Tables, version_id: Id, draft: PaintPlanPayload, bakes: Bake[], d: LocalDeviation): { draft: PaintPlanPayload; bakes: Bake[] } {
  const done = bakes.find((b) => b.id === d.id);
  if (done) {
    const untouched = JSON.stringify(draft) === JSON.stringify(done.after);
    return { draft: untouched ? done.before : draft, bakes: bakes.filter((b) => b.id !== d.id) };
  }
  const r = bakeDeviation(t, version_id, draft, d);
  return { draft: r.payload, bakes: [...bakes, { id: d.id, before: draft, after: r.payload, applied: r.applied }] };
}

export function DeviationChoice({ t, deviations, bakes, onToggle, draft }: {
  t: Tables;
  deviations: LocalDeviation[];
  bakes: Bake[];
  draft: PaintPlanPayload;
  onToggle: (d: LocalDeviation) => void;
}) {
  if (!deviations.length) return null;
  const n = deviations.length - bakes.length;
  return (
    <div className="plan-devs" role="region" aria-label="Åpne avvik">
      <div className="plan-missing-head">
        <strong>Åpne avvik fra Painting Mode</strong>
        <span className="small muted">
          {bakes.length ? `${bakes.length} bakt inn` : 'Ingen bakt inn'}{n ? ` · ${n} følger med som avvik` : ''}
        </span>
      </div>
      <p className="small muted">Kryss av for det som skal bli en del av planen. Resten følger med til den nye versjonen som avvik.</p>
      <ul>
        {deviations.map((d) => {
          const bake = bakes.find((b) => b.id === d.id);
          const kept = bake && JSON.stringify(draft) !== JSON.stringify(bake.after);
          return (
            <li key={d.id}>
              <label>
                <input type="checkbox" checked={!!bake} onChange={() => onToggle(d)} />
                <span>
                  <strong>{describeDeviation(t, d)}</strong>
                  <span className="small muted"> · {deviationPlace(t, d)}</span>
                  {bake && !bake.applied && <span className="small plan-devs-note"> · Fant ikke stedet i planen. Skriv det inn selv hvis det mangler.</span>}
                  {bake && bake.applied && <span className="small muted"> · Skrevet inn i planen.{kept ? ' Fjerner du haken, må du rette teksten selv.' : ''}</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
