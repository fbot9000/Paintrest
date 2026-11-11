import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useApp, useView } from '../../app/context';
import { knowledgeImages, techniqueDetail } from '../../domain/library';
import { Badge, Button, Card, ErrorNote } from '../../ui/components';
import { ExperienceDialog } from './ExperienceDialog';
import { EvidenceBadge, ExperienceBadge, KnowledgeGallery, StatusBadge, useAutosave } from './parts';
import { useAiStatus } from './ResearchPage';
import { startImprovement } from './research-runs';

/**
 * Skisse 05 «Global teknikkartikkel»: the technique as one readable guide.
 * Editing happens on …/rediger. «Bruk i prosjekt» needs plan editing (bit 4) and comes in 7.7.
 */
export function TechniquePage() {
  const { techniqueId = '' } = useParams();
  const d = useView((t) => techniqueDetail(t, techniqueId), [techniqueId]);
  const images = useView((t) => knowledgeImages(t, 'technique', techniqueId), [techniqueId]);
  const { save, error, clearError } = useAutosave();
  const [experienceOpen, setExperienceOpen] = useState(false);
  const app = useApp();
  const ai = useAiStatus();
  const navigate = useNavigate();

  if (!d) {
    return <main className="page"><h1>Fant ikke teknikken</h1><p><Link to="/bibliotek/teknikker">Til teknikkene</Link></p></main>;
  }
  const x = d.technique;
  const deleted = !!x.deleted_at;
  const improve = async () => {
    const text = d.experiences.length ? 'Forbedre teknikken ut fra erfaringene mine.' : 'Gå gjennom teknikken og foreslå forbedringer.';
    let task: string | undefined;
    await save(async () => { task = await startImprovement({ store: app.store, research: app.research, agent: app.agent, ai: app.ai }, x.id, text); });
    if (task) navigate(`/bibliotek/research/${task}`);
  };

  return (
    <main className="page tech-page article-page">
      <div className="tech-head">
        <div className="tech-head-row">
          <span className="eyebrow"><Link to="/bibliotek/teknikker">Teknikker</Link></span>
          {!deleted && (
            <div className="head-actions">
              {ai === 'ready' && <Button onClick={improve}>Forbedre med agenten</Button>}
              <Link className="btn btn-secondary" to="rediger">Rediger</Link>
            </div>
          )}
        </div>
        <h1>{x.name}</h1>
        {x.desired_result && <p className="tech-lead">{x.desired_result}</p>}
        <div className="tech-badges">
          <StatusBadge status={x.status} />
          <ExperienceBadge experience={d.experience} />
          <EvidenceBadge evidence={x.evidence} />
          {x.tags.map((t) => <Badge key={t}>{t}</Badge>)}
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

          <div className="article-layout">
            <div className="article-side-top">
            <div className="article-workshop">
              <span className="eyebrow">Ved malebordet</span>
              <p>Kort guide med bare stegene, laget for iPad.</p>
              <Link className="btn btn-primary" to="verksted">Åpne verkstedguiden →</Link>
              <Button onClick={() => setExperienceOpen(true)}>Registrer erfaring</Button>
            </div>
            <Card className="tech-section">
              {x.use_area && (
                <div className="article-block">
                  <span className="eyebrow">Bruksområde</span>
                  <p>{x.use_area}</p>
                </div>
              )}
              <div className="article-block">
                <span className="eyebrow">Dette trenger du</span>
                {x.materials.length
                  ? <ul className="article-materials">{x.materials.map((m, i) => <li key={i}>{m}</li>)}</ul>
                  : <p className="muted">Ingen materialer lagt inn.</p>}
                <p className="small muted">Bestemte malinger velges i oppskriften du bruker teknikken med.</p>
              </div>
            </Card>
            </div>
            <div className="article-main">
          <KnowledgeGallery images={images} />
          <Card className="tech-section">
            <span className="eyebrow">Slik gjør du</span>
            {d.steps.length === 0
              ? <p className="muted">Ingen steg ennå. <Link to="rediger">Legg til steg</Link></p>
              : (
                <ol className="article-steps">
                  {d.steps.map((s, i) => (
                    <li key={s.id}>
                      <span className="mono muted">{String(i + 1).padStart(2, '0')}</span>
                      <div>
                        {s.title && <strong>{s.title}</strong>}
                        {s.instruction && <p>{s.instruction}</p>}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
          </Card>

          {x.variants && (
            <Card className="tech-section">
              <span className="eyebrow">Varianter</span>
              <p className="pre-line">{x.variants}</p>
            </Card>
          )}

          {x.risk_note && (
            <div className="tech-risk-note" role="note">
              <span className="eyebrow">Forbehold</span>
              <p className="pre-line">{x.risk_note}</p>
            </div>
          )}

            </div>
            <div className="article-side-bottom">
          <Card className="tech-section">
            <div className="tech-head-row">
              <span className="eyebrow">Erfaringer</span>
              <Button variant="ghost" onClick={() => setExperienceOpen(true)}>+ Registrer erfaring</Button>
            </div>
            {d.experiences.length === 0
              ? <p className="muted">Ikke prøvd ennå.</p>
              : (
                <ul className="experience-list">
                  {d.experiences.map((e) => (
                    <li key={e.id}>
                      {e.outcome === 'worked' ? <Badge tone="moss">Fungerte</Badge> : <Badge tone="warn">Trenger justering</Badge>}
                      <span className="small muted">{new Date(e.created_at).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                      {e.note && <p>{e.note}</p>}
                      <button type="button" className="link small" onClick={() => save((c) => c.deleteExperience(e.id))}>Fjern</button>
                    </li>
                  ))}
                </ul>
              )}
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
            </div>
          </div>
        </>
      )}

      <ExperienceDialog techniqueId={x.id} initial={null} open={experienceOpen} onClose={() => setExperienceOpen(false)} />
    </main>
  );
}
