import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useApp } from '../../app/context';
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
export function ExperienceDialog({ techniqueId, initial, open, onClose, onSaved }:
  { techniqueId: Id; initial: ExperienceOutcome | null; open: boolean; onClose: () => void; onSaved?: () => void }) {
  const [outcome, setOutcome] = useState<ExperienceOutcome>(initial ?? 'worked');
  const [note, setNote] = useState('');
  const { save, error, clearError, busy } = useAutosave();
  const app = useApp();
  const ai = useAiStatus();
  const navigate = useNavigate();
  const [startError, setStartError] = useState<string | null>(null);
  useEffect(() => {
    if (open) { setOutcome(initial ?? 'worked'); setNote(''); clearError(); setStartError(null); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  const submit = async () => {
    if (await save((c) => c.recordExperience(techniqueId, { outcome, note }))) {
      onSaved?.();
      onClose();
    }
  };

  const improve = async () => {
    if (!(await save((c) => c.recordExperience(techniqueId, { outcome, note })))) return;
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
      <Field label="Merknad">
        {(id) => <textarea id={id} value={note} placeholder="For eksempel: svampen ga for grov struktur" onChange={(e) => setNote(e.target.value)} />}
      </Field>
    </Dialog>
  );
}
