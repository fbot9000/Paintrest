import { createHashRouter, createMemoryRouter, Link, Navigate, Outlet, RouterProvider, useNavigate } from 'react-router';
import { useState } from 'react';
import { ProjectsPage } from '../features/projects/ProjectsPage';
import { ProjectLayout } from '../features/projects/ProjectLayout';
import { GamePage } from '../features/game/GamePage';
import { MiniaturesPage } from '../features/miniatures/MiniaturesPage';
import { PaintingMode } from '../features/painting/PaintingMode';
import { NotYetPage } from '../features/projects/NotYetPage';
import { AiSettingsPage } from '../features/settings/AiSettingsPage';
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
  return (
    <header className="topbar">
      <Link to="/" className="brand" aria-label="Paintrest – til prosjektene">
        <Logo />
        <span>Paintrest</span>
      </Link>
      <span className="topbar-proto">Prototype · data lagres bare på denne enheten</span>
      <div className="topbar-menu">
        <button type="button" className="avatar" aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu((m) => !m)}>
          ⋯
        </button>
        {menu && (
          <div className="menu" role="menu">
            <button role="menuitem" type="button" onClick={() => { setMenu(false); navigate('/innstillinger'); }}>
              AI-nøkkel
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
