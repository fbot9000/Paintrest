import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';
import { useCommand, useView } from '../../app/context';
import { deletedTechniques, libraryTags, libraryTechniques } from '../../domain/library';
import type { TechniqueCard } from '../../domain/library';
import { Button, ErrorNote } from '../../ui/components';
import { EvidenceBadge, ExperienceBadge, StatusBadge } from './parts';

type Filter = { kind: 'all' } | { kind: 'tried' } | { kind: 'tag'; tag: string };

/** Skisse 01 «Utforsk bibliotek», without images and research (they come later). */
export function TechniquesPage() {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>({ kind: 'all' });
  const tag = filter.kind === 'tag' ? filter.tag : undefined;
  const data = useView((t) => ({
    all: libraryTechniques(t).length,
    cards: libraryTechniques(t, { query, tag }),
    tags: libraryTags(t, 'technique'),
    deleted: deletedTechniques(t),
  }), [query, tag]);
  const { run, error, clearError } = useCommand();
  const navigate = useNavigate();

  const shown = filter.kind === 'tried' ? data.cards.filter((c) => c.experience !== 'untried') : data.cards;
  const isOn = (f: Filter) => f.kind === filter.kind && (f.kind !== 'tag' || f.tag === tag);

  const create = async () => {
    const id = await run((c) => c.createTechnique());
    if (id) navigate(id);
  };

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <span className="eyebrow">Bibliotek / Teknikker</span>
          <h1>Teknikker vi ikke trenger å gjenoppdage</h1>
          <p className="muted">Gjenbruk erfaringer fra bøker, videoer og tidligere prosjekter.</p>
        </div>
        <Button variant="primary" icon="+" onClick={create}>Ny teknikk</Button>
      </div>
      <ErrorNote error={error} onClose={clearError} />

      {data.all > 0 && (
        <>
          <div className="lib-search">
            <label htmlFor="lib-q" className="sr-only">Søk i teknikkene</label>
            <span aria-hidden>⌕</span>
            <input id="lib-q" type="search" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Søk etter metode, materiale eller effekt…" />
          </div>
          <div className="filters" role="toolbar" aria-label="Filtrer">
            <Chip on={isOn({ kind: 'all' })} onClick={() => setFilter({ kind: 'all' })}>Alle teknikker</Chip>
            <Chip on={isOn({ kind: 'tried' })} onClick={() => setFilter({ kind: 'tried' })}>Egne erfaringer</Chip>
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
          <h2>Biblioteket er tomt</h2>
          <p className="muted">Legg inn en teknikk du vil huske, med materialer og steg. Du kan endre den når som helst.</p>
        </div>
      ) : shown.length === 0 ? (
        <p className="muted">Ingen teknikker passer søket eller filteret.</p>
      ) : (
        <div className="tech-grid">
          {shown.map((c) => <TechniqueCardView key={c.technique.id} card={c} />)}
        </div>
      )}

      <aside className="lib-principle">
        <span className="eyebrow">Gjenbrukbar kunnskap</span>
        <p>Én teknikk kan brukes i mange spill, med ulike fargeoppskrifter. Kilder, egen erfaring og godkjenning holdes hver for seg.</p>
      </aside>

      {data.deleted.length > 0 && (
        <p className="small muted restore-line">
          Slettet:{' '}
          {data.deleted.map((x) => (
            <button key={x.id} type="button" className="link" onClick={() => run((c) => c.restoreTechnique(x.id))}>gjenopprett {x.name}</button>
          ))}
        </p>
      )}
    </main>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={onClick}>{children}</button>;
}

function TechniqueCardView({ card }: { card: TechniqueCard }) {
  const { technique: x, experience, step_count, recipe_count } = card;
  return (
    <Link to={x.id} className="tech-card">
      {x.tags.length > 0 && <span className="eyebrow">{x.tags.join(' · ')}</span>}
      <h3>{x.name}</h3>
      {x.desired_result && <p className="muted tech-card-text">{x.desired_result}</p>}
      <div className="tech-badges">
        <StatusBadge status={x.status} />
        <ExperienceBadge experience={experience} />
        <EvidenceBadge evidence={x.evidence} />
      </div>
      <span className="small muted">
        {step_count} steg
        {recipe_count > 0 && <> · brukt i {recipe_count} {recipe_count === 1 ? 'oppskrift' : 'oppskrifter'}</>}
      </span>
    </Link>
  );
}
