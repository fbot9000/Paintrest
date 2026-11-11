import { NavLink, Outlet } from 'react-router';
import { useView } from '../../app/context';
import { libraryTechniques } from '../../domain/library';
import './library.css';

/** The global library (bit 7): its own section beside the projects (skisse 01). */
export function LibraryLayout() {
  const techniques = useView((t) => libraryTechniques(t).length);
  return (
    <div className="project library">
      <nav className="sidebar" aria-label="Bibliotek">
        <div className="sidebar-title">
          <span className="eyebrow">Kunnskapsbasen</span>
          <h2>Bibliotek</h2>
        </div>
        <NavLink to="teknikker">Teknikker <span className="small">{techniques || ''}</span></NavLink>
        <NavLink to="oppskrifter">Oppskrifter <span className="soon">snart</span></NavLink>
        <p className="sidebar-note small muted">
          Metoder og oppskrifter du kan bruke i alle spillene dine, og kildene de kommer fra.
        </p>
      </nav>
      <div className="project-main">
        <Outlet />
      </div>
    </div>
  );
}
