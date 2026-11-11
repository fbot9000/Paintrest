import { useEffect, useState } from 'react';
import type { ExperienceOutcome, Id } from '../../domain/types';
import { Button, Dialog, ErrorNote, Field, Segmented } from '../../ui/components';
import { useAutosave } from './parts';

/**
 * Skisse 07 «Enkel erfaring»: optional feedback after trying a technique.
 * «Foreslå forbedring» needs the agent and comes in 7.6.
 */
export function ExperienceDialog({ techniqueId, initial, open, onClose, onSaved }:
  { techniqueId: Id; initial: ExperienceOutcome | null; open: boolean; onClose: () => void; onSaved?: () => void }) {
  const [outcome, setOutcome] = useState<ExperienceOutcome>(initial ?? 'worked');
  const [note, setNote] = useState('');
  const { save, error, clearError, busy } = useAutosave();
  useEffect(() => {
    if (open) { setOutcome(initial ?? 'worked'); setNote(''); clearError(); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  const submit = async () => {
    if (await save((c) => c.recordExperience(techniqueId, { outcome, note }))) {
      onSaved?.();
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Hvordan fungerte teknikken?"
      footer={<>
        <Button onClick={onClose}>Lukk</Button>
        <Button variant="primary" disabled={busy} onClick={submit}>Lagre</Button>
      </>}
    >
      <p className="muted">Valgfritt. Erfaringen vises på teknikken, slik at du husker den neste gang.</p>
      <ErrorNote error={error} onClose={clearError} />
      <Segmented
        label="Utfall"
        value={outcome}
        onChange={setOutcome}
        options={[{ value: 'worked', label: 'Fungerte' }, { value: 'needs_adjustment', label: 'Trenger justering' }]}
      />
      <Field label="Merknad">
        {(id) => <textarea id={id} value={note} placeholder="For eksempel: svampen ga for grov struktur" onChange={(e) => setNote(e.target.value)} />}
      </Field>
    </Dialog>
  );
}
