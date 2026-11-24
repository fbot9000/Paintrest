/**
 * «Planen virker ikke» (O-13, spec §5, datamodell v3 §14). From Painting Mode the user says
 * what is wrong; the agent makes a proposal for a new version of exactly this plan. The proposal
 * is reviewed in the workspace (Maleplan), not here: Painting Mode shows decisions, not new AI
 * choices (prinsipp A10). The current version and its completions stand until the user approves.
 */
import { useState } from 'react';
import { Link } from 'react-router';
import { useApp, useView } from '../../app/context';
import { useRuns } from '../../app/runs';
import { pendingPlanProposal } from '../../domain/plan-versions';
import { subjectReferences } from '../../domain/views';
import type { PaintingView } from '../../domain/views';
import { Button, Dialog, Field } from '../../ui/components';
import { startPlan } from '../workspace/agentRuns';

/** Where the agent's work on the plan stands: running, failed, or a proposal waiting in the workspace. */
export function PlanProblemStatus({ view }: { view: PaintingView }) {
  const s = view.subject;
  const run = useRuns((r) => r.get(s.id, 'plan'));
  const proposal = useView((t) => pendingPlanProposal(t, s), [s]);
  const href = `/p/${view.project.id}/m/${s.id}/maleplan`;
  const version = view.plan?.version_number ?? 0;
  if (run?.status === 'running') {
    return (
      <p className="pm-agent" role="status">
        Agenten lager et forslag til en ny versjon. Du maler videre etter versjon {version} til du har godkjent det.
      </p>
    );
  }
  if (proposal) {
    return (
      <p className="pm-agent" role="status">
        {version ? `Et forslag til versjon ${version + 1} venter.` : 'Et forslag til maleplan venter.'} Du ser det og godkjenner det i verkstedet. <Link to={href}>Åpne Maleplan</Link>
      </p>
    );
  }
  if (run?.status === 'error' && run.error) {
    return <p className="pm-agent warn" role="status">Agenten kunne ikke lage et forslag: {run.error}</p>;
  }
  return null;
}

export function PlanProblemDialog({ view, part, onClose }: { view: PaintingView; part: string | null; onClose: () => void }) {
  const app = useApp();
  const [text, setText] = useState('');
  const [where, setWhere] = useState<string>(part ?? '');
  const s = view.subject;
  const run = useRuns((r) => r.get(s.id, 'plan'));
  const busy = run?.status === 'running';
  const send = (paints: 'owned' | 'best') => {
    // The plan's own pictures, as in the workspace: the illustration first, at most four.
    const fileIds = subjectReferences(app.store.getTables(), s).slice(0, 4).map((r) => r.file_id);
    startPlan(app, s, view.game.primary_name, fileIds, paints, { text: text.trim(), part: where || null });
    onClose();
  };
  const ready = !!text.trim() && !busy;
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title="Planen virker ikke"
      footer={<>
        <Button onClick={onClose}>Avbryt</Button>
        <span className="small muted">Lag forslag med</span>
        <Button variant="primary" disabled={!ready} onClick={() => send('owned')}>Malinger jeg har</Button>
        <Button variant="primary" disabled={!ready} onClick={() => send('best')}>Beste valg</Button>
      </>}
    >
      <p className="small muted">
        Agenten lager et forslag til en ny versjon av denne planen. Du maler videre etter versjon {view.plan?.version_number} til du har sett forslaget og godkjent det i verkstedet. Da velger du også hvilke av avvikene dine som skal bli en del av planen. Det du har krysset av, følger med.
      </p>
      <Field label="Hva er galt?">
        {(id) => <textarea id={id} value={text} rows={4} autoFocus placeholder="For eksempel: Washen blir flekkete på kappen, og høylyset forsvinner." onChange={(e) => setText(e.target.value)} />}
      </Field>
      <Field label="Gjelder">
        {(id) => (
          <select id={id} value={where} onChange={(e) => setWhere(e.target.value)}>
            <option value="">Hele planen</option>
            {view.elements.map((e) => <option key={e.element.id} value={e.element.name}>{e.element.name}</option>)}
          </select>
        )}
      </Field>
      {busy && <p className="small muted">Agenten jobber allerede med planen. Vent til den er ferdig.</p>}
    </Dialog>
  );
}
