import { NavLink, Outlet } from 'react-router';
import { useView } from '../../app/context';
import { libraryRecipes, libraryTechniques } from '../../domain/library';
import './library.css';

/** The global library (bit 7): its own section beside the projects (skisse 01). */
export function LibraryLayout() {
  const count = useView((t) => ({ techniques: libraryTechniques(t).length, recipes: libraryRecipes(t).length }));
  return (
    <div className="project library">
      <nav className="sidebar" aria-label="Bibliotek">
        <div className="sidebar-title">
          <h2>Bibliotek</h2>
        </div>
        <NavLink to="teknikker">Teknikker <span className="small">{count.techniques || ''}</span></NavLink>
        <NavLink to="oppskrifter">Oppskrifter <span className="small">{count.recipes || ''}</span></NavLink>
        <p className="sidebar-note small muted">
          Teknikker og oppskrifter du kan bruke i alle spillene dine.
        </p>
      </nav>
      <div className="project-main">
        <Outlet />
      </div>
    </div>
  );
}
