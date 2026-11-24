import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useApp, useView } from '../../app/context';
import { projectName } from '../../domain/shopping';
import type { ExperienceOutcome, Id } from '../../domain/types';
import { Button, Dialog, ErrorNote, Field, Segmented } from '../../ui/components';
import { useAutosave } from './parts';
import { useAiStatus } from './ResearchPage';
import { startImprovement } from './research-runs';

/**
 * Skisse 07 «Enkel erfaring»: optional feedback after trying a technique.
 * «Lagre og foreslå forbedring» (bit 7.6) also asks the agent for a changed technique;
 * nothing changes until the user approves it.
 */
export function ExperienceDialog({ techniqueId, initial, open, onClose, onSaved, subjectId = null }:
  { techniqueId: Id; initial: ExperienceOutcome | null; open: boolean; onClose: () => void; onSaved?: () => void;
    /** O-7: the miniature the technique was used on, chosen in advance when the guide was opened from Painting Mode. */
    subjectId?: Id | null }) {
  const [outcome, setOutcome] = useState<ExperienceOutcome>(initial ?? 'worked');
  const [note, setNote] = useState('');
  const [subject, setSubject] = useState<Id>(subjectId ?? '');
  // Live miniatures, grouped by project, for «Miniatyr».
  const groups = useView((t) => {
    const by = new Map<Id, { project: string; subjects: { id: Id; name: string }[] }>();
    for (const s of Object.values(t.miniature_subject)) {
      const p = t.project[s.project_id];
      if (s.deleted_at || !p || p.deleted_at) continue;
      const g = by.get(p.id) ?? { project: projectName(t, p.id), subjects: [] };
      g.subjects.push({ id: s.id, name: s.name });
      by.set(p.id, g);
    }
    return [...by.values()].map((g) => ({ ...g, subjects: g.subjects.sort((a, b) => a.name.localeCompare(b.name, 'nb')) }))
      .sort((a, b) => a.project.localeCompare(b.project, 'nb'));
  });
  const { save, error, clearError, busy } = useAutosave();
  const app = useApp();
  const ai = useAiStatus();
  const navigate = useNavigate();
  const [startError, setStartError] = useState<string | null>(null);
  useEffect(() => {
    if (open) { setOutcome(initial ?? 'worked'); setNote(''); setSubject(subjectId ?? ''); clearError(); setStartError(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial, subjectId]);

  const submit = async () => {
    if (await save((c) => c.recordExperience(techniqueId, { outcome, note, subject_id: subject || null }))) {
      onSaved?.();
      onClose();
    }
  };

  const improve = async () => {
    if (!(await save((c) => c.recordExperience(techniqueId, { outcome, note, subject_id: subject || null })))) return;
    const label = outcome === 'worked' ? 'Fungerte' : 'Trenger justering';
    const text = `Forbedre teknikken ut fra erfaringen min (${label})${note.trim() ? `: ${note.trim()}` : '.'}`;
    try {
      const task = await startImprovement({ store: app.store, research: app.research, agent: app.agent, ai: app.ai }, techniqueId, text);
      onClose();
      navigate(`/bibliotek/research/${task}`);
    } catch (e) {
      onSaved?.();
      setStartError(`Erfaringen er lagret, men agenten kunne ikke startes: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Hvordan fungerte teknikken?"
      footer={<>
        <Button onClick={onClose}>Lukk</Button>
        {ai === 'ready' && <Button disabled={busy} onClick={improve}>Lagre og foreslå forbedring →</Button>}
        <Button variant="primary" disabled={busy} onClick={submit}>Lagre</Button>
      </>}
    >
      <p className="muted">Valgfritt. Erfaringen vises på teknikken, slik at du husker den neste gang.</p>
      <ErrorNote error={error ?? startError} onClose={() => { clearError(); setStartError(null); }} />
      <Segmented
        label="Utfall"
        value={outcome}
        onChange={setOutcome}
        options={[{ value: 'worked', label: 'Fungerte' }, { value: 'needs_adjustment', label: 'Trenger justering' }]}
      />
      {ai === 'ready' && <p className="small muted">«Foreslå forbedring» ber agenten om en endret teknikk. Ingenting endres før du godtar forslaget.</p>}
      {groups.length > 0 && (
        <Field label="Miniatyr (valgfritt)">
          {(id) => (
            <select id={id} value={subject} onChange={(e) => setSubject(e.target.value)}>
              <option value="">Ingen bestemt</option>
              {groups.map((g) => (
                <optgroup key={g.project} label={g.project}>
                  {g.subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </optgroup>
              ))}
            </select>
          )}
        </Field>
      )}
      <Field label="Merknad">
        {(id) => <textarea id={id} value={note} placeholder="For eksempel: svampen ga for grov struktur" onChange={(e) => setNote(e.target.value)} />}
      </Field>
    </Dialog>
  );
}
