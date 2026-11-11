import { createHashRouter, createMemoryRouter, Link, Navigate, NavLink, Outlet, RouterProvider, useMatch, useNavigate } from 'react-router';
import { useState } from 'react';
import { ProjectsPage } from '../features/projects/ProjectsPage';
import { ProjectLayout } from '../features/projects/ProjectLayout';
import { GamePage } from '../features/game/GamePage';
import { MiniaturesPage } from '../features/miniatures/MiniaturesPage';
import { PaintingMode } from '../features/painting/PaintingMode';
import { NotYetPage } from '../features/projects/NotYetPage';
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
import { Button, Dialog } from '../ui/components';
import { useCommand } from './context';
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
          { path: 'kilder', element: <NotYetPage title="Kilder og bilder" slice="bit 6" /> },
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
        <NavLink to="/bibliotek">Bibliotek</NavLink>
      </nav>
      <span className="topbar-proto">Prototype · data lagres bare på denne enheten</span>
      <div className="topbar-menu">
        <button type="button" className="avatar" aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu((m) => !m)}>
          ⋯
        </button>
        {menu && (
          <div className="menu" role="menu">
            <button role="menuitem" type="button" onClick={() => { setMenu(false); navigate('/innstillinger'); }}>
              AI og nettsøk
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
          <Button variant="primary" onClick={async () => {
            await run((c) => c.resetToSampleData());
            setConfirm(false);
            navigate('/');
          }}>Tilbakestill</Button>
        </>}
      >
        <p>Alt du har lagt inn på denne enheten erstattes av eksempelprosjektet. Dette kan ikke angres.</p>
      </Dialog>
    </header>
  );
}
