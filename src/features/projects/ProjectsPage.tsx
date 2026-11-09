import { Link, useNavigate } from 'react-router';
import { useState } from 'react';
import { useCommand, useView } from '../../app/context';
import { projectList } from '../../domain/views';
import type { ProjectSummary } from '../../domain/views';
import { Badge, Button, ErrorNote, FileImage } from '../../ui/components';
import './projects.css';

export function ProjectsPage() {
  const { live, deleted } = useView(projectList);
  const { run, error, clearError, busy } = useCommand();
  const navigate = useNavigate();
  const [showDeleted, setShowDeleted] = useState(false);

  // skjema §1: «Nytt prosjekt» creates game + project at once, no form.
  const create = async () => {
    const r = await run((c) => c.createProject());
    if (r) navigate(`/p/${r.project_id}/spill`);
  };

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">Paintrest</span>
          <h1>Mine spillprosjekter</h1>
        </div>
        <Button variant="primary" onClick={create} disabled={busy} icon="+">Nytt prosjekt</Button>
      </div>
      <ErrorNote error={error} onClose={clearError} />

      {live.length === 0 ? (
        <div className="empty">
          <h2>Ingen prosjekter ennå</h2>
          <p className="muted">«Nytt prosjekt» oppretter et spill du kan fylle ut etter hvert. Navn, bilde og BoardGameGeek kan komme senere.</p>
        </div>
      ) : (
        <div className="project-grid">
          {live.map((p) => <ProjectCard key={p.project.id} p={p} />)}
        </div>
      )}

      {deleted.length > 0 && (
        <section className="deleted">
          <button type="button" className="link" aria-expanded={showDeleted} onClick={() => setShowDeleted((s) => !s)}>
            {showDeleted ? 'Skjul' : 'Vis'} slettede prosjekter ({deleted.length})
          </button>
          {showDeleted && (
            <ul>
              {deleted.map((p) => (
                <li key={p.project.id}>
                  <span>{p.game.primary_name}</span>
                  <Button onClick={() => run((c) => c.restoreProject(p.project.id))}>Gjenopprett</Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </main>
  );
}

function ProjectCard({ p }: { p: ProjectSummary }) {
  const pct = p.physical_total ? Math.round((p.physical_finished / p.physical_total) * 100) : 0;
  return (
    <Link to={`/p/${p.project.id}/spill`} className="project-card">
      <FileImage fileId={p.cover_file_id} alt="" className="project-cover" fallback={<span>Ingen illustrasjon</span>} />
      <div className="project-card-body">
        <span className="eyebrow">{p.game.origin === 'bgg' ? 'Koblet til BGG' : 'Lokalt prosjekt'}</span>
        <h2>{p.game.primary_name}</h2>
        {p.expansions.length > 0 && <p className="small muted">{p.expansions.map((e) => e.name).join(' · ')}</p>}
        {p.subject_count === 0 ? (
          <p className="small muted">Ingen miniatyrer ennå</p>
        ) : (
          <div className="progress-block">
            <div className="progress-line">
              <strong>{p.physical_finished} / {p.physical_total}</strong>
              <span className="small muted">figurer ferdigmalt</span>
            </div>
            <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Malefremdrift">
              <span style={{ width: `${pct}%` }} />
            </div>
            <div className="chips">
              <Badge tone="moss">{p.plans_ready} av {p.subject_count} har maleplan</Badge>
              {p.in_progress > 0 && <Badge>{p.in_progress} under arbeid</Badge>}
            </div>
          </div>
        )}
      </div>
    </Link>
  );
}
