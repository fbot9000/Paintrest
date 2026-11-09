import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useCommand, useView } from '../../app/context';
import type { BggCandidate } from '../../domain/commands';
import { attachedExpansions, liveExpansionsOfGame, projectSummary } from '../../domain/views';
import type { Expansion } from '../../domain/types';
import { searchBgg } from '../../data/bgg-fake';
import { Badge, Button, Card, Dialog, ErrorNote, Field, FileImage, ImagePicker, InlineText } from '../../ui/components';
import './game.css';

export function GamePage() {
  const { projectId = '' } = useParams();
  const data = useView((t) => {
    const s = projectSummary(t, projectId);
    if (!s) return undefined;
    return {
      ...s,
      all: liveExpansionsOfGame(t, s.game.id),
      attached: new Set(attachedExpansions(t, projectId).map((e) => e.id)),
      deletedEx: Object.values(t.expansion).filter((e) => e.game_id === s.game.id && e.deleted_at),
    };
  }, [projectId]);
  const { run, error, clearError } = useCommand();
  const navigate = useNavigate();
  const [bggOpen, setBggOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!data) return null;
  const { game, project } = data;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Spill og illustrasjon</h1>
          <p className="muted">Prosjektet kan brukes med en gang. Knytt det til BoardGameGeek når du vil.</p>
        </div>
      </div>
      <ErrorNote error={error} onClose={clearError} />

      <section className="hero">
        <FileImage fileId={game.cover_file_id} alt={`Illustrasjon for ${game.primary_name}`} className="hero-img" fallback={<span>Ingen illustrasjon</span>} />
        <div className="hero-panel">
          <span className="eyebrow">{game.origin === 'bgg' ? `BoardGameGeek · #${game.bgg_thing_id}` : 'Lokalt prosjekt'}</span>
          <InlineText as="h1" label="Navn" value={game.primary_name} onSave={(v) => run((c) => c.updateGame(game.id, { primary_name: v }))} />
          <dl className="facts">
            <div>
              <dt>Utgitt</dt>
              <dd><YearInput value={game.year_published} onSave={(y) => run((c) => c.updateGame(game.id, { year_published: y }))} /></dd>
            </div>
            <div>
              <dt>Utgiver</dt>
              <dd>
                <InlineText
                  label="Utgiver"
                  value={game.publishers.join(', ') || '—'}
                  onSave={(v) => run((c) => c.updateGame(game.id, { publishers: v === '—' ? [] : v.split(',') }))}
                />
              </dd>
            </div>
          </dl>
          <div className="hero-actions">
            <ImagePicker variant="moss" onPick={(f) => run((c) => c.setGameCover(game.id, f, f.name))}>
              {game.cover_file_id ? 'Bytt illustrasjon' : 'Last opp illustrasjon'}
            </ImagePicker>
            {game.cover_file_id && (
              <button type="button" className="link on-dark" onClick={() => run((c) => c.setGameCover(game.id, null))}>Fjern</button>
            )}
          </div>
        </div>
      </section>

      <Card className="row-card">
        <div>
          <h3>BoardGameGeek</h3>
          <p className="muted small">
            {game.origin === 'bgg' ? `Koblet til oppføring #${game.bgg_thing_id}. Lokale endringer beholdes.` : 'Ikke koblet. Oppslag er valgfritt.'}
          </p>
        </div>
        <div className="row-actions">
          {game.origin === 'bgg' && <Button variant="ghost" onClick={() => run((c) => c.unlinkBgg(game.id))}>Fjern kobling</Button>}
          <Button onClick={() => setBggOpen(true)} icon="⌕">{game.origin === 'bgg' ? 'Bytt oppføring' : 'Søk etter spillet'}</Button>
        </div>
      </Card>

      <Card>
        <div className="card-head">
          <div>
            <h3>Utvidelser</h3>
            <p className="muted small">Velg hvilke som er med i dette prosjektet. Utvidelsen selv endres ikke.</p>
          </div>
          <Button onClick={() => run((c) => c.createExpansion(game.id, { attach_to_project_id: project.id }))} icon="+">Ny utvidelse</Button>
        </div>
        {data.all.length === 0 ? (
          <p className="muted small">Ingen utvidelser registrert.</p>
        ) : (
          <ul className="ex-list">
            {data.all.map((e) => (
              <ExpansionRow
                key={e.id}
                e={e}
                included={data.attached.has(e.id)}
                onToggle={(on) => run((c) => (on ? c.attachExpansion(project.id, e.id) : c.detachExpansion(project.id, e.id)))}
                onRename={(v) => run((c) => c.updateExpansion(e.id, { name: v }))}
                onDelete={() => run((c) => c.deleteExpansion(e.id))}
              />
            ))}
          </ul>
        )}
        {data.deletedEx.length > 0 && (
          <p className="small muted restore-line">
            Slettet:{' '}
            {data.deletedEx.map((e) => (
              <button key={e.id} type="button" className="link" onClick={() => run((c) => c.restoreExpansion(e.id))}>
                gjenopprett {e.name}
              </button>
            ))}
          </p>
        )}
      </Card>

      <div className="page-foot">
        <Button variant="primary" onClick={() => navigate('../miniatyrer')} icon="→">Til miniatyrene</Button>
        <Button variant="danger" onClick={() => setConfirmDelete(true)}>Slett prosjekt</Button>
      </div>

      <BggDialog
        open={bggOpen}
        initialQuery={game.primary_name.startsWith('Nytt spill') ? '' : game.primary_name}
        onClose={() => setBggOpen(false)}
        onLink={async (cand, ids, replace) => {
          const r = await run((c) => c.linkBgg(game.id, cand, { expansion_thing_ids: ids, project_id: project.id, replace }));
          return r;
        }}
      />

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Slette prosjektet?"
        footer={<>
          <Button onClick={() => setConfirmDelete(false)}>Avbryt</Button>
          <Button variant="primary" onClick={async () => {
            await run((c) => c.deleteProject(project.id));
            navigate('/');
          }}>Slett</Button>
        </>}
      >
        <p>Prosjektet skjules fra listen. Du kan gjenopprette det fra «Vis slettede prosjekter».</p>
      </Dialog>
    </main>
  );
}

function YearInput({ value, onSave }: { value: number | null; onSave: (y: number | null) => void }) {
  return (
    <InlineText
      label="Utgivelsesår"
      value={value ? String(value) : '—'}
      onSave={(v) => {
        const n = Number.parseInt(v, 10);
        onSave(Number.isFinite(n) ? n : null);
      }}
    />
  );
}

function ExpansionRow({ e, included, onToggle, onRename, onDelete }:
  { e: Expansion; included: boolean; onToggle: (on: boolean) => void; onRename: (v: string) => void; onDelete: () => void }) {
  return (
    <li className={included ? 'on' : ''}>
      <label className="check">
        <input type="checkbox" checked={included} onChange={(ev) => onToggle(ev.target.checked)} />
        <span className="sr-only">Med i prosjektet</span>
      </label>
      <div className="ex-name">
        <InlineText label="Navn på utvidelse" value={e.name} onSave={onRename} />
        <span className="small muted">{e.origin === 'bgg' ? 'Fra BoardGameGeek' : 'Manuell'}{included ? ' · med i prosjektet' : ''}</span>
      </div>
      <Button variant="ghost" onClick={onDelete} aria-label={`Slett ${e.name}`}>Slett</Button>
    </li>
  );
}

function BggDialog({ open, onClose, onLink, initialQuery }: {
  open: boolean;
  initialQuery: string;
  onClose: () => void;
  onLink: (c: BggCandidate, expansionIds: number[], replace: boolean) => Promise<{ status: string; other_name?: string } | undefined>;
}) {
  const [q, setQ] = useState(initialQuery);
  const [results, setResults] = useState<BggCandidate[] | null>(null);
  const [picked, setPicked] = useState<BggCandidate | null>(null);
  const [ex, setEx] = useState<number[]>([]);
  const [replace, setReplace] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const reset = () => { setResults(null); setPicked(null); setEx([]); setMsg(null); setReplace(false); };
  const close = () => { reset(); setQ(initialQuery); onClose(); };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Knytt spillet til BoardGameGeek"
      wide
      footer={<>
        <Button onClick={close}>Fortsett uten kobling</Button>
        <Button variant="primary" disabled={!picked} onClick={async () => {
          if (!picked) return;
          const r = await onLink(picked, ex, replace);
          if (r?.status === 'duplicate') setMsg(`Denne oppføringen er allerede koblet til «${r.other_name}». Ingenting er endret.`);
          else if (r) close();
        }}>Knytt til prosjektet</Button>
      </>}
    >
      <Badge tone="warn">Simulert oppslag · eksempeldata, ikke ekte BGG</Badge>
      <form className="search-row" onSubmit={async (e) => {
        e.preventDefault();
        setLoading(true);
        reset();
        setResults(await searchBgg(q));
        setLoading(false);
      }}>
        <Field label="Spillets tittel">{(id) => <input id={id} value={q} onChange={(e) => setQ(e.target.value)} placeholder="For eksempel Avalon" />}</Field>
        <Button variant="primary" type="submit" disabled={loading || !q.trim()}>{loading ? 'Søker …' : 'Søk'}</Button>
      </form>
      {results && results.length === 0 && <p className="muted">Ingen treff. Prøv et kortere søkeord, eller fortsett med det manuelle spillet.</p>}
      {results && results.length > 0 && (
        <ul className="bgg-results">
          {results.map((r) => (
            <li key={r.thing_id}>
              <label>
                <input type="radio" name="bgg" checked={picked?.thing_id === r.thing_id} onChange={() => { setPicked(r); setEx(r.expansions.map((x) => x.thing_id)); setMsg(null); }} />
                <span><strong>{r.primary_name}</strong> <span className="muted small">{r.year_published} · {r.publishers.join(', ')} · #{r.thing_id}</span></span>
              </label>
              {picked?.thing_id === r.thing_id && r.expansions.length > 0 && (
                <div className="bgg-ex">
                  <span className="eyebrow">Utvidelser som skal være med</span>
                  {r.expansions.map((x) => (
                    <label key={x.thing_id}>
                      <input type="checkbox" checked={ex.includes(x.thing_id)} onChange={(e) => setEx((cur) => e.target.checked ? [...cur, x.thing_id] : cur.filter((i) => i !== x.thing_id))} />
                      {x.name}
                    </label>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {picked && (
        <label className="replace">
          <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
          Erstatt navn, år og utgiver med verdiene fra oppføringen. Uten dette fylles bare tomme felt.
        </label>
      )}
      {msg && <ErrorNote error={msg} />}
    </Dialog>
  );
}
