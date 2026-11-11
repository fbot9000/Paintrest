import { NavLink, Outlet } from 'react-router';
import { useView } from '../../app/context';
import { knowledgeTasks, libraryRecipes, libraryTechniques } from '../../domain/library';
import './library.css';

/** The global library (bit 7): its own section beside the projects (skisse 01). */
export function LibraryLayout() {
  const count = useView((t) => ({
    techniques: libraryTechniques(t).length,
    recipes: libraryRecipes(t).length,
    waiting: knowledgeTasks(t).reduce((n, x) => n + x.pending, 0),
  }));
  return (
    <div className="project library">
      <nav className="sidebar" aria-label="Bibliotek">
        <div className="sidebar-title">
          <h2>Bibliotek</h2>
        </div>
        <NavLink to="teknikker">Teknikker <span className="small">{count.techniques || ''}</span></NavLink>
        <NavLink to="oppskrifter">Oppskrifter <span className="small">{count.recipes || ''}</span></NavLink>
        <NavLink to="research">Research {count.waiting > 0 && <span className="nav-waiting" aria-label={`${count.waiting} utkast venter`}>{count.waiting}</span>}</NavLink>
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
