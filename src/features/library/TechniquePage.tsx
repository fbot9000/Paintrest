import { Link, useNavigate, useParams } from 'react-router';
import { useView } from '../../app/context';
import type { TechniquePatch, TechniqueStepInput } from '../../domain/commands';
import { libraryTags, techniqueDetail } from '../../domain/library';
import type { TechniqueStep } from '../../domain/types';
import { Badge, Button, Card, ErrorNote, InlineText } from '../../ui/components';
import {
  AutoField, ChipListEditor, EvidenceBadge, ExperienceBadge, RowTools, SaveState, StatusBadge, moved, useAutosave,
} from './parts';

/**
 * Skisse 04 «Rediger og godkjenn guide», without the agent panel (7.4).
 * Every field saves when you leave it. «Godkjent» is a label, not a lock
 * (brukerbeslutning 11.11.2026).
 */
export function TechniquePage() {
  const { techniqueId = '' } = useParams();
  const d = useView((t) => techniqueDetail(t, techniqueId), [techniqueId]);
  const tags = useView((t) => libraryTags(t, 'technique').map((x) => x.tag));
  const { save, error, clearError, busy, saved } = useAutosave();
  const navigate = useNavigate();

  if (!d) {
    return <main className="page"><h1>Fant ikke teknikken</h1><p><Link to="/bibliotek/teknikker">Til teknikkene</Link></p></main>;
  }
  const x = d.technique;
  const deleted = !!x.deleted_at;

  const patch = (p: TechniquePatch) => save((c) => c.updateTechnique(x.id, p));
  const toInput = (s: TechniqueStep): TechniqueStepInput => ({ id: s.id });
  const saveSteps = (steps: TechniqueStepInput[]) => save((c) => c.setTechniqueSteps(x.id, steps));
  const changeStep = (id: string, p: Partial<TechniqueStepInput>) =>
    saveSteps(d.steps.map((s) => (s.id === id ? { id, ...p } : toInput(s))));

  return (
    <main className="page tech-page">
      <div className="tech-head">
        <span className="eyebrow">
          <Link to="/bibliotek/teknikker">Teknikker</Link>
        </span>
        {deleted
          ? <h1>{x.name}</h1>
          : <InlineText as="h1" className="h1" value={x.name} label="Navn" onSave={(v) => patch({ name: v })} />}
        <div className="tech-badges">
          <StatusBadge status={x.status} />
          <ExperienceBadge experience={d.experience} />
          <EvidenceBadge evidence={x.evidence} />
          <SaveState busy={busy} saved={saved} />
        </div>
      </div>
      <ErrorNote error={error} onClose={clearError} />

      {deleted ? (
        <div className="empty">
          <p>Teknikken er slettet.</p>
          <Button variant="primary" onClick={() => save((c) => c.restoreTechnique(x.id))}>Gjenopprett</Button>
        </div>
      ) : (
        <>
          {x.uncertainty.length > 0 && (
            <div className="tech-uncertain" role="note">
              <strong>Uavklart:</strong>
              <ul>{x.uncertainty.map((u, i) => <li key={i}>{u.reason}</li>)}</ul>
            </div>
          )}

          <Card className="tech-section">
            <AutoField label="Ønsket resultat" multiline value={x.desired_result ?? ''}
              placeholder="Hva skal teknikken gi?" onSave={(v) => patch({ desired_result: v })} />
            <AutoField label="Bruksområde" value={x.use_area ?? ''}
              placeholder="For eksempel slitasje, pels eller lys" onSave={(v) => patch({ use_area: v })} />
            <div className="auto-field">
              <span className="eyebrow">Merkelapper</span>
              <ChipListEditor label="Merkelapper" items={x.tags} suggestions={tags}
                placeholder="Legg til merkelapp" onSave={(v) => patch({ tags: v })} />
            </div>
          </Card>

          <Card className="tech-section">
            <div className="auto-field">
              <span className="eyebrow">Dette trenger du</span>
              <ChipListEditor label="Materialer" items={x.materials}
                placeholder="For eksempel finporet svamp" onSave={(v) => patch({ materials: v })} />
            </div>
            <p className="small muted">Bestemte malinger velges i en oppskrift når du bruker teknikken.</p>
          </Card>

          <Card className="tech-section">
            <span className="eyebrow">Fremgangsmåte</span>
            {d.steps.length === 0 && <p className="muted">Ingen steg ennå.</p>}
            <ol className="tech-steps">
              {d.steps.map((s, i) => (
                <li key={s.id} className="tech-step">
                  <span className="tech-step-no mono">{String(i + 1).padStart(2, '0')}</span>
                  <div className="tech-step-body">
                    <AutoField label={`Steg ${i + 1}, overskrift`} hideLabel className="tech-step-title" value={s.title}
                      placeholder="Kort overskrift" onSave={(v) => changeStep(s.id, { title: v })} />
                    <AutoField label={`Steg ${i + 1}, forklaring`} hideLabel multiline value={s.instruction}
                      placeholder="Hvordan gjør du det?" onSave={(v) => changeStep(s.id, { instruction: v })} />
                    {s.basis === 'documented' && <Badge tone="moss">Vist i kilde</Badge>}
                    {s.basis === 'synthesized' && <Badge tone="warn">Forslag fra agenten</Badge>}
                  </div>
                  <RowTools index={i} count={d.steps.length} label={`steg ${i + 1}`}
                    onMove={(by) => saveSteps(moved(d.steps, i, by).map(toInput))}
                    onRemove={() => saveSteps(d.steps.filter((o) => o.id !== s.id).map(toInput))} />
                </li>
              ))}
            </ol>
            <div><Button icon="+" onClick={() => saveSteps([...d.steps.map(toInput), { title: '' }])}>Legg til steg</Button></div>
          </Card>

          <Card className="tech-section">
            <AutoField label="Varianter" multiline value={x.variants ?? ''}
              placeholder="Andre måter å gjøre det på" onSave={(v) => patch({ variants: v })} />
          </Card>

          <Card className="tech-section tech-risk">
            <AutoField label="Forbehold og risiko" multiline value={x.risk_note ?? ''}
              placeholder="Det du må passe på, for eksempel tørking, ventilasjon og rengjøring" onSave={(v) => patch({ risk_note: v })} />
          </Card>

          {d.recipes.length > 0 && (
            <Card className="tech-section">
              <span className="eyebrow">Brukt i oppskrifter</span>
              <ul className="tech-sources">
                {d.recipes.map((r) => <li key={r.id}><Link to={`/bibliotek/oppskrifter/${r.id}`}>{r.name}</Link></li>)}
              </ul>
            </Card>
          )}

          {d.sources.length > 0 && (
            <Card className="tech-section">
              <span className="eyebrow">Kilder</span>
              <ul className="tech-sources">
                {d.sources.map(({ source }) => (
                  <li key={source.id}>
                    {source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a> : source.title}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className="tech-actions">
            <Button variant="danger" onClick={async () => {
              if (await save((c) => c.deleteTechnique(x.id))) navigate('/bibliotek/teknikker');
            }}>Slett teknikken</Button>
            <div className="tech-approve">
              <p className="small muted">
                {x.status === 'approved'
                  ? 'Godkjent betyr klar til å teste. Du kan fortsatt endre teknikken.'
                  : 'Godkjenn når du vil prøve teknikken. Det betyr ikke at den er prøvd.'}
              </p>
              {x.status === 'approved'
                ? <Button onClick={() => save((c) => c.setTechniqueStatus(x.id, 'draft'))}>Sett tilbake til utkast</Button>
                : <Button variant="primary" icon="→" onClick={() => save((c) => c.setTechniqueStatus(x.id, 'approved'))}>Godkjenn til utprøving</Button>}
            </div>
          </div>
        </>
      )}
    </main>
  );
}
