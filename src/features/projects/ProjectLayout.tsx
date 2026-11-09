import type { ReactNode } from 'react';
import { NavLink, Outlet, useParams } from 'react-router';
import { useView } from '../../app/context';
import { projectSummary } from '../../domain/views';
import { Badge } from '../../ui/components';
import { AgentPanel, AgentPanelProvider, useAgentPanel } from '../agent/AgentPanel';

export function ProjectLayout() {
  const { projectId = '' } = useParams();
  const p = useView((t) => projectSummary(t, projectId), [projectId]);
  if (!p) {
    return <main className="page"><h1>Fant ikke prosjektet</h1><p><NavLink to="/">Til prosjektene</NavLink></p></main>;
  }
  return (
    <AgentPanelProvider>
      <ProjectGrid projectId={projectId}>
      <nav className="sidebar" aria-label="Prosjekt">
        <div className="sidebar-title">
          <span className="eyebrow">Prosjekt</span>
          <h2>{p.game.primary_name}</h2>
          {p.project.deleted_at && <Badge tone="warn">Slettet</Badge>}
        </div>
        <NavLink to="spill">Spill og illustrasjon</NavLink>
        <NavLink to="miniatyrer">Miniatyrer <span className="small">{p.subject_count || ''}</span></NavLink>
        <NavLink to="kilder">Kilder og bilder <span className="soon">snart</span></NavLink>
        <NavLink to="palett">Palett og prosess <span className="soon">snart</span></NavLink>
      </nav>
      <div className="project-main">
        <Outlet />
      </div>
      </ProjectGrid>
    </AgentPanelProvider>
  );
}

function ProjectGrid({ projectId, children }: { projectId: string; children: ReactNode }) {
  const { open } = useAgentPanel();
  return (
    <div className={`project ${open ? 'with-agent' : 'agent-closed'}`}>
      {children}
      <AgentPanel projectId={projectId} />
    </div>
  );
}
