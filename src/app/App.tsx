import { createHashRouter, createMemoryRouter, Link, Navigate, NavLink, Outlet, RouterProvider, useMatch, useNavigate } from 'react-router';
import { useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { ProjectsPage } from '../features/projects/ProjectsPage';
import { ProjectLayout } from '../features/projects/ProjectLayout';
import { NotYetPage } from '../features/projects/NotYetPage';
import { LibraryLayout } from '../features/library/LibraryLayout';
import { Button, Dialog } from '../ui/components';
import { useCommand } from './context';
import { useSaveStatus } from './saveStatus';
import { useRuns } from './runs';
import { Logo } from '../ui/Logo';
import './shell.css';

/**
 * O-10: most pages are loaded when they are first opened (route.lazy), so the first
 * download is smaller. The projects page and the layouts load with the app.
 */
function page(load: () => Promise<unknown>, name: string) {
  return { lazy: async () => ({ Component: (await load() as Record<string, ComponentType>)[name] }) };
}

// Hash routing works on any static host. Embedded previews that only allow a plain
// #name in the hash are built with VITE_ROUTER=memory instead.
const routes = [
  {
    element: <Shell />,
    children: [
      { index: true, element: <ProjectsPage /> },
      { path: 'innstillinger', ...page(() => import('../features/settings/AiSettingsPage'), 'AiSettingsPage') },
      { path: 'malinger', ...page(() => import('../features/paints/PaintsPage'), 'PaintsPage') },
      { path: 'malinger/import', ...page(() => import('../features/paints/ImportPage'), 'ImportPage') },
      { path: 'malinger/handleliste', ...page(() => import('../features/paints/ShoppingPage'), 'ShoppingPage') },
      { path: 'p/:projectId/m/:subjectId', ...page(() => import('../features/workspace/Workspace'), 'Workspace') },
      { path: 'p/:projectId/m/:subjectId/:tab', ...page(() => import('../features/workspace/Workspace'), 'Workspace') },
      {
        path: 'bibliotek',
        element: <LibraryLayout />,
        children: [
          { index: true, element: <Navigate to="teknikker" replace /> },
          { path: 'teknikker', ...page(() => import('../features/library/TechniquesPage'), 'TechniquesPage') },
          { path: 'teknikker/:techniqueId', ...page(() => import('../features/library/TechniquePage'), 'TechniquePage') },
          { path: 'teknikker/:techniqueId/rediger', ...page(() => import('../features/library/TechniqueEditPage'), 'TechniqueEditPage') },
          { path: 'oppskrifter', ...page(() => import('../features/library/RecipesPage'), 'RecipesPage') },
          { path: 'research', ...page(() => import('../features/library/ResearchPage'), 'ResearchPage') },
          { path: 'research/:taskId', ...page(() => import('../features/library/ResearchTaskPage'), 'ResearchTaskPage') },
          { path: 'oppskrifter/:recipeId', ...page(() => import('../features/library/RecipePage'), 'RecipePage') },
        ],
      },
      {
        path: 'p/:projectId',
        element: <ProjectLayout />,
        children: [
          { index: true, element: <Navigate to="spill" replace /> },
          { path: 'spill', ...page(() => import('../features/game/GamePage'), 'GamePage') },
          { path: 'miniatyrer', ...page(() => import('../features/miniatures/MiniaturesPage'), 'MiniaturesPage') },
          { path: 'bilder', ...page(() => import('../features/images/DistributePage'), 'DistributePage') },
          { path: 'kilder', ...page(() => import('../features/images/DistributePage'), 'DistributePage') },
          { path: 'palett', element: <NotYetPage title="Palett og prosess" slice="bit 3" /> },
        ],
      },
    ],
  },
  { path: 'male/:subjectId', ...page(() => import('../features/painting/PaintingMode'), 'PaintingMode') },
  { path: 'bibliotek/teknikker/:techniqueId/verksted', ...page(() => import('../features/library/WorkshopGuide'), 'WorkshopGuide') },
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
