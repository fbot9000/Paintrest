import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useCommand, useView } from '../../app/context';
import { deletedRecipes, libraryRecipes, libraryTags } from '../../domain/library';
import type { RecipeCard } from '../../domain/library';
import { Button, ErrorNote, Swatch } from '../../ui/components';
import { Chip, EvidenceBadge, SearchBox, StatusBadge } from './parts';

type Filter = { kind: 'all' } | { kind: 'method' } | { kind: 'tag'; tag: string };

/**
 * Bit 7.2: no sketch. A recipe is a colour sequence, optionally with steps
 * for a certain effect (brukerbeslutning 11.11.2026).
 */
export function RecipesPage() {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const tag = filter.kind === 'tag' ? filter.tag : undefined;
  const data = useView((t) => ({
    all: libraryRecipes(t).length,
    cards: libraryRecipes(t, { query, tag }),
    tags: libraryTags(t, 'recipe'),
    deleted: deletedRecipes(t),
  }), [query, tag]);
  const { run, error, clearError } = useCommand();
  const navigate = useNavigate();

  const shown = filter.kind === 'method' ? data.cards.filter((c) => c.has_method) : data.cards;
  const isOn = (f: Filter) => f.kind === filter.kind && (f.kind !== 'tag' || f.tag === tag);

  const create = async () => {
    const id = await run((c) => c.createRecipe());
    if (id) navigate(id);
  };

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">Bibliotek</span>
          <h1>Oppskrifter</h1>
          <p className="muted">Fargerekker, og hvordan du bruker dem.</p>
        </div>
        <Button variant="primary" icon="+" onClick={create}>Ny oppskrift</Button>
      </div>
      <ErrorNote error={error} onClose={clearError} />

      {data.all > 0 && (
        <>
          <SearchBox value={query} onChange={setQuery} label="Søk i oppskriftene" placeholder="Søk etter navn, effekt eller maling" />
          <div className="filters" role="toolbar" aria-label="Filtrer">
            <Chip on={isOn({ kind: 'all' })} onClick={() => setFilter({ kind: 'all' })}>Alle</Chip>
            <Chip on={isOn({ kind: 'method' })} onClick={() => setFilter({ kind: 'method' })}>Med fremgangsmåte</Chip>
            {data.tags.length > 0 && <span className="filters-sep" />}
            {data.tags.map(({ tag: t, count }) => (
              <Chip key={t} on={isOn({ kind: 'tag', tag: t })} onClick={() => setFilter({ kind: 'tag', tag: t })}>
                {t} <span className="chip-count">{count}</span>
              </Chip>
            ))}
          </div>
        </>
      )}

      {data.all === 0 ? (
        <div className="empty">
          <h2>Ingen oppskrifter ennå</h2>
          <p className="muted">En oppskrift kan være bare en fargerekke, eller ha steg for en bestemt effekt.</p>
        </div>
      ) : shown.length === 0 ? (
        <p className="muted">Ingen oppskrifter passer søket eller filteret.</p>
      ) : (
        <div className="tech-grid">
          {shown.map((c) => <RecipeCardView key={c.recipe.id} card={c} />)}
        </div>
      )}

      {data.deleted.length > 0 && (
        <p className="small muted restore-line">
          Slettet:{' '}
          {data.deleted.map((x) => (
            <button key={x.id} type="button" className="link" onClick={() => run((c) => c.restoreRecipe(x.id))}>gjenopprett {x.name}</button>
          ))}
        </p>
      )}
    </main>
  );
}

function RecipeCardView({ card }: { card: RecipeCard }) {
  const { recipe: x, paints, has_method } = card;
  return (
    <Link to={x.id} className="tech-card">
      {x.tags.length > 0 && <span className="eyebrow">{x.tags.join(' · ')}</span>}
      <h3>{x.name}</h3>
      {paints.length > 0 && (
        <span className="recipe-strip" aria-label={paints.map((p) => p.product.name).join(', ')}>
          {paints.map((p) => <Swatch key={p.row.id} hex={p.product.swatch_hex} size={22} />)}
        </span>
      )}
      {x.effect && <p className="muted tech-card-text">{x.effect}</p>}
      <div className="tech-badges">
        <StatusBadge status={x.status} />
        <EvidenceBadge evidence={x.evidence} />
      </div>
      <span className="small muted">
        {paints.length} {paints.length === 1 ? 'maling' : 'malinger'} · {has_method ? 'med fremgangsmåte' : 'fargerekke'}
      </span>
    </Link>
  );
}
