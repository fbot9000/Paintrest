import { createHashRouter, createMemoryRouter, Link, Navigate, Outlet, RouterProvider, useNavigate } from 'react-router';
import { useState } from 'react';
import { ProjectsPage } from '../features/projects/ProjectsPage';
import { ProjectLayout } from '../features/projects/ProjectLayout';
import { GamePage } from '../features/game/GamePage';
import { MiniaturesPage } from '../features/miniatures/MiniaturesPage';
import { PaintingMode } from '../features/painting/PaintingMode';
import { NotYetPage } from '../features/projects/NotYetPage';
import { AiSettingsPage } from '../features/settings/AiSettingsPage';
import { Workspace } from '../features/workspace/Workspace';
import { Button, Dialog } from '../ui/components';
import { useCommand } from './context';
import { useSaveStatus } from './saveStatus';
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
      { path: 'p/:projectId/m/:subjectId', element: <Workspace /> },
      { path: 'p/:projectId/m/:subjectId/:tab', element: <Workspace /> },
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
  const [typed, setTyped] = useState('');
  const { run } = useCommand();
  const navigate = useNavigate();
  return (
    <header className="topbar">
      <Link to="/" className="brand" aria-label="Paintrest – til prosjektene">
        <Logo />
        <span>Paintrest</span>
      </Link>
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
        <p>Alt du har lagt inn erstattes av eksempelprosjektet: prosjekter, miniatyrer, planer, kilder og historikk.</p>
        <p className="small muted">Det tas en sikkerhetskopi først når dataene ligger i datamappen. Skriv «tilbakestill» for å bekrefte.</p>
        <input aria-label="Skriv tilbakestill" className="reset-input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="tilbakestill" />
      </Dialog>
    </header>
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
