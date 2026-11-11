import { createHashRouter, createMemoryRouter, Link, Navigate, NavLink, Outlet, RouterProvider, useMatch, useNavigate } from 'react-router';
import { useEffect, useRef, useState } from 'react';
import { ProjectsPage } from '../features/projects/ProjectsPage';
import { ProjectLayout } from '../features/projects/ProjectLayout';
import { GamePage } from '../features/game/GamePage';
import { MiniaturesPage } from '../features/miniatures/MiniaturesPage';
import { PaintingMode } from '../features/painting/PaintingMode';
import { NotYetPage } from '../features/projects/NotYetPage';
import { DistributePage } from '../features/images/DistributePage';
import { AiSettingsPage } from '../features/settings/AiSettingsPage';
import { LibraryLayout } from '../features/library/LibraryLayout';
import { TechniquesPage } from '../features/library/TechniquesPage';
import { TechniquePage } from '../features/library/TechniquePage';
import { TechniqueEditPage } from '../features/library/TechniqueEditPage';
import { WorkshopGuide } from '../features/library/WorkshopGuide';
import { ResearchPage } from '../features/library/ResearchPage';
import { ResearchTaskPage } from '../features/library/ResearchTaskPage';
import { RecipesPage } from '../features/library/RecipesPage';
import { RecipePage } from '../features/library/RecipePage';
import { Workspace } from '../features/workspace/Workspace';
import { PaintsPage } from '../features/paints/PaintsPage';
import { ImportPage } from '../features/paints/ImportPage';
import { Button, Dialog } from '../ui/components';
import { useCommand } from './context';
import { useSaveStatus } from './saveStatus';
import { useRuns } from './runs';
import { Logo } from '../ui/Logo';
import './shell.css';

// Hash routing works on any static host. Embedded previews that only allow a plain
// #name in the hash are built with VITE_ROUTER=memory instead.
const routes = [
  {
    element: <Shell />,
    children: [
      { index: true, element: <ProjectsPage /> },
      { path: 'innstillinger', element: <AiSettingsPage /> },
      { path: 'malinger', element: <PaintsPage /> },
      { path: 'malinger/import', element: <ImportPage /> },
      { path: 'p/:projectId/m/:subjectId', element: <Workspace /> },
      { path: 'p/:projectId/m/:subjectId/:tab', element: <Workspace /> },
      {
        path: 'bibliotek',
        element: <LibraryLayout />,
        children: [
          { index: true, element: <Navigate to="teknikker" replace /> },
          { path: 'teknikker', element: <TechniquesPage /> },
          { path: 'teknikker/:techniqueId', element: <TechniquePage /> },
          { path: 'teknikker/:techniqueId/rediger', element: <TechniqueEditPage /> },
          { path: 'oppskrifter', element: <RecipesPage /> },
          { path: 'research', element: <ResearchPage /> },
          { path: 'research/:taskId', element: <ResearchTaskPage /> },
          { path: 'oppskrifter/:recipeId', element: <RecipePage /> },
        ],
      },
      {
        path: 'p/:projectId',
        element: <ProjectLayout />,
        children: [
          { index: true, element: <Navigate to="spill" replace /> },
          { path: 'spill', element: <GamePage /> },
          { path: 'miniatyrer', element: <MiniaturesPage /> },
          { path: 'bilder', element: <DistributePage /> },
          { path: 'kilder', element: <DistributePage /> },
          { path: 'palett', element: <NotYetPage title="Palett og prosess" slice="bit 3" /> },
        ],
      },
    ],
  },
  { path: 'male/:subjectId', element: <PaintingMode /> },
  { path: 'bibliotek/teknikker/:techniqueId/verksted', element: <WorkshopGuide /> },
  { path: '*', element: <Navigate to="/" replace /> },
];
const router = import.meta.env.VITE_ROUTER === 'memory' ? createMemoryRouter(routes) : createHashRouter(routes);

export function App() {
  return <RouterProvider router={router} />;
}

function Shell() {
  return (
    <div className="shell">
      <TopBar />
      <Outlet />
    </div>
  );
}

function TopBar() {
  const [menu, setMenu] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [typed, setTyped] = useState('');
  const { run } = useCommand();
  const navigate = useNavigate();
  const inProject = useMatch('/p/*');
  return (
    <header className="topbar">
      <Link to="/" className="brand" aria-label="Paintrest – til prosjektene">
        <Logo />
        <span>Paintrest</span>
      </Link>
      <nav className="topnav" aria-label="Hovedmeny">
        <NavLink to="/" end className={({ isActive }) => (isActive || inProject ? 'active' : '')}>Prosjekter</NavLink>
        <NavLink to="/malinger">Malinger</NavLink>
        <NavLink to="/bibliotek">Bibliotek</NavLink>
      </nav>
      <RunIndicator />
      <SaveIndicator />
      <div className="topbar-menu">
        <button type="button" className="avatar" aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu((m) => !m)}>
          ⋯
        </button>
        {menu && (
          <div className="menu" role="menu">
            <button role="menuitem" type="button" onClick={() => { setMenu(false); navigate('/innstillinger'); }}>
              Innstillinger: AI, nettsøk og data
            </button>
            <button role="menuitem" type="button" onClick={() => { setMenu(false); setConfirm(true); }}>
              Tilbakestill eksempeldata
            </button>
          </div>
        )}
      </div>
      <Dialog
        open={confirm}
        onClose={() => setConfirm(false)}
        title="Tilbakestill eksempeldata?"
        footer={<>
          <Button onClick={() => setConfirm(false)}>Avbryt</Button>
          <Button variant="danger" disabled={typed.trim().toLowerCase() !== 'tilbakestill'} onClick={async () => {
            await run((c) => c.resetToSampleData());
            setConfirm(false);
            setTyped('');
            navigate('/');
          }}>Tilbakestill</Button>
        </>}
      >
        <p>Alt du har lagt inn erstattes av eksempelprosjektet: prosjekter, miniatyrer, planer, kilder, biblioteket og historikk.</p>
        <p>Malingssamlingen din beholdes. Eksempeldataene har ingen malinger.</p>
        <p className="small muted">Det tas en sikkerhetskopi først når dataene ligger i datamappen. Skriv «tilbakestill» for å bekrefte.</p>
        <input aria-label="Skriv tilbakestill" className="reset-input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="tilbakestill" />
      </Dialog>
    </header>
  );
}

/** Shows that an agent is working somewhere, and leads to it. Nothing happens out of sight. */
function RunIndicator() {
  const active = useRuns((r) => r.active());
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  if (!active.length) return null;
  const text = active.length === 1 ? 'Agenten arbeider' : `${active.length} agentkjøringer`;
  return (
    <div className="run-ind" ref={ref}>
      <button type="button" aria-expanded={open} aria-haspopup="menu" aria-label={text} title={text} onClick={() => setOpen((o) => !o)}>
        <span className="run-dot" aria-hidden />
        <span className="run-ind-text" aria-hidden>{text}</span>
        {active.length > 1 && <span className="run-ind-count" aria-hidden>{active.length}</span>}
      </button>
      {open && (
        <div className="menu" role="menu">
          {active.map((r) => r.href
            ? <Link key={r.key} role="menuitem" to={r.href} onClick={() => setOpen(false)}>{r.label ?? 'Agentkjøring'}</Link>
            : <span key={r.key} role="menuitem" className="menu-plain">{r.label ?? 'Agentkjøring'}</span>)}
        </div>
      )}
    </div>
  );
}

/** Where data is saved, and whether the last change got there. Never silent about a failed save. */
function SaveIndicator() {
  const st = useSaveStatus();
  const where = st.where === 'server' ? (st.data_dir ? shortPath(st.data_dir) : 'datamappen') : st.where === 'browser' ? 'denne nettleseren' : 'minnet (lagres ikke)';
  const time = st.saved_at ? new Date(st.saved_at).toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' }) : null;
  if (st.state === 'conflict' || st.state === 'error') {
    return (
      <span className={`save-ind ${st.state}`} role="alert">
        {st.message}
        {st.state === 'conflict' && <button type="button" onClick={() => window.location.reload()}>Last inn på nytt</button>}
      </span>
    );
  }
  return (
    <span className={`save-ind ${st.where}`} title={st.data_dir ?? undefined}>
      {st.state === 'saving' ? 'Lagrer …' : `Lagret i ${where}${time ? ` · ${time}` : ''}`}
    </span>
  );
}

function shortPath(p: string): string {
  return p.replace(/^\/(Users|home)\/[^/]+/, '~');
}
