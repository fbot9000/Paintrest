import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useApp, useCommand, useView } from '../../app/context';
import { useAiStatus } from '../../app/ai-status';
import type { AiStatus } from '../../app/ai-status';
import { runs, useRuns } from '../../app/runs';
import type { Run } from '../../app/runs';
import type { GameFact, GameInfo, GameInfoImage } from '../../domain/ai';
import type { BggCandidate } from '../../domain/commands';
import { attachedExpansions, liveExpansionsOfGame, projectSummary } from '../../domain/views';
import type { Expansion, Game } from '../../domain/types';
import { searchBgg } from '../../data/bgg-fake';
import { Badge, Button, Card, Dialog, ErrorNote, Field, FileImage, ImagePicker, InlineText } from '../../ui/components';
import { LiveSteps } from '../agent/AgentPanel';
import { applyGameInfo, defaultChoice, differs, lookupResult, startGameLookup } from './gameLookup';
import type { GameInfoChoice } from './gameLookup';
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
  const app = useApp();
  const aiStatus = useAiStatus();
  const lookup = useRuns((r) => (data ? r.get(data.game.id, 'gameinfo') : null));
  const navigate = useNavigate();
  const [bggOpen, setBggOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!data) return null;
  const { game, project } = data;
  const looking = lookup?.status === 'running';

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
            <div>
              <dt>Nettside</dt>
              <dd className="site-cell">
                <InlineText
                  label="Offisiell nettside"
                  value={game.website_url ?? '—'}
                  onSave={(v) => run((c) => c.updateGame(game.id, { website_url: v }))}
                />
                {game.website_url && <a className="site-link" href={game.website_url} target="_blank" rel="noreferrer" aria-label="Åpne nettsiden">↗</a>}
              </dd>
            </div>
          </dl>
          {game.cover_file_id && game.cover_source && (
            <p className="small cover-source">
              Illustrasjonen er fra <a href={game.cover_source.page_url} target="_blank" rel="noreferrer" title={game.cover_source.page_title ?? undefined}>{hostOf(game.cover_source.page_url)} ↗</a>
            </p>
          )}
          <div className="hero-actions">
            <ImagePicker variant="moss" onPick={(f) => run((c) => c.setGameCover(game.id, f, f.name))}>
              {game.cover_file_id ? 'Bytt illustrasjon' : 'Last opp illustrasjon'}
            </ImagePicker>
            <Button className="btn-on-dark" onClick={() => startGameLookup(app, project.id, game)} disabled={looking || aiStatus !== 'ready'}
              title={aiTitle(aiStatus)}>
              {looking ? 'Leter …' : '✦ Finn bilde og fakta med AI'}
            </Button>
            {game.cover_file_id && (
              <button type="button" className="link on-dark" onClick={() => run((c) => c.setGameCover(game.id, null))}>Fjern</button>
            )}
          </div>
          {(aiStatus === 'no-key' || aiStatus === 'no-server') && (
            <p className="small hero-note">
              {aiStatus === 'no-key'
                ? <>AI-søket krever en nøkkel. Legg den inn under <Link to="/innstillinger">AI og nettsøk</Link>.</>
                : 'AI-søket krever Paintrest-serveren. Start appen lokalt med «npm run dev».'}
            </p>
          )}
        </div>
      </section>

      {lookup && <LookupPanel run={lookup} game={game} onStop={() => runs.stop(game.id, 'gameinfo')} onClose={() => runs.dismiss(game.id, 'gameinfo')}
        imageUrl={(u) => app.ai.imageProxyUrl(u)} onApply={(info, choice) => applyGameInfo(app, game, info, choice)} />}

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

function aiTitle(status: AiStatus): string {
  if (status === 'no-key') return 'Legg inn AI-nøkkelen under AI og nettsøk først.';
  if (status === 'no-server') return 'Krever Paintrest-serveren (npm run dev).';
  return 'Agenten søker opp utgivelsesår, utgiver og offisiell nettside, og foreslår bilder av esken eller hovedillustrasjonen. Hver opplysning vises med kilden. Du velger selv hva som tas i bruk.';
}

function hostOf(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; }
}

const KIND_LABEL: Record<GameInfoImage['kind'], string> = { box: 'Eske', cover_art: 'Illustrasjon', other: 'Annet bilde' };
const SURE: Record<'high' | 'medium' | 'low', string> = { high: 'Sikker', medium: 'Trolig', low: 'Usikker' };
const BASIS: Record<GameFact<unknown>['basis'], { text: string; tone: 'moss' | 'neutral' | 'warn'; hint: string }> = {
  checked: { text: 'Står i kilden', tone: 'moss', hint: 'Paintrest fant verdien i teksten på kilden.' },
  source: { text: 'Fra kilde, ikke kontrollert', tone: 'neutral', hint: 'Agenten leste eller fant kilden, men Paintrest kunne ikke finne verdien i teksten.' },
  model: { text: 'Ikke sjekket mot kilde', tone: 'warn', hint: 'Agenten oppga ingen kilde den hadde lest eller søkt fram. Det bygger på modellens egen kunnskap.' },
};

/**
 * The game lookup: what the agent does while it works, then its suggestions. Pictures for the illustration,
 * and the year, publisher and website, each with its source and how well it is checked. Nothing changes
 * before the user presses «Bruk valgte».
 */
function LookupPanel({ run, game, imageUrl, onStop, onClose, onApply }: {
  run: Run; game: Game; imageUrl: (u: string) => string; onStop: () => void; onClose: () => void;
  onApply: (info: GameInfo, choice: GameInfoChoice) => Promise<string[]>;
}) {
  const result = lookupResult(run);
  const info = result?.info ?? null;
  const [choice, setChoice] = useState<GameInfoChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState<string[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // A new answer (a new run) gets a fresh choice; the user's ticks are kept while the page re-renders.
  useEffect(() => {
    setChoice(info ? defaultChoice(game, info) : null);
    setApplied(null);
    setFailed(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.finished_at]);

  if (run.status === 'running') {
    return <section className="lookup lookup-live" aria-label="AI-søk etter fakta og illustrasjon"><LiveSteps events={run.events} onStop={onStop} /></section>;
  }
  const d = info ? differs(game, info) : null;
  const any = !!choice && !!d && ((choice.year && d.year) || (choice.publishers && d.publishers) || (choice.website && d.website) || !!choice.image);
  const head = run.status === 'done' ? 'Forslag fra AI' : run.status === 'stopped' ? 'AI-søket ble stoppet' : 'AI-søket feilet';
  return (
    <Card className="lookup">
      <div className="lookup-head">
        <div>
          <span className="eyebrow">{head}{result?.model ? ` · ${result.model}` : ''}</span>
          {result?.message && <p className="lookup-msg">{result.message}</p>}
          {info?.official_name && <p className="small">Spillet agenten fant: <strong>{info.official_name}</strong></p>}
        </div>
        <button type="button" className="link small" onClick={onClose}>Lukk</button>
      </div>
      {run.error && !result && <ErrorNote error={run.error} />}
      {applied && <p className="lookup-done" role="status">{applied.length ? `Lagt inn: ${applied.join(', ')}.` : 'Ingenting å legge inn.'}</p>}
      {failed && <ErrorNote error={failed} onClose={() => setFailed(null)} />}

      {info && choice && d && (
        <>
          <h3 className="lookup-sub">Bilder til illustrasjonen</h3>
          {info.images.length === 0 ? (
            <p className="small muted">Agenten fant ingen bilder som Paintrest kunne sjekke. Last opp et bilde selv, eller prøv igjen.</p>
          ) : (
            <div className="lookup-images" role="radiogroup" aria-label="Velg illustrasjon">
              {info.images.map((img) => {
                const on = choice.image?.image_url === img.image_url;
                return (
                  <label key={img.image_url} className={`lookup-img ${on ? 'on' : ''}`}>
                    <input type="radio" name="lookup-cover" checked={on} onChange={() => setChoice({ ...choice, image: img })} />
                    <img src={imageUrl(img.thumbnail_url ?? img.image_url)} alt={img.caption ?? ''} loading="lazy"
                      onError={(e) => {
                        // The search service's small copy first; then the original through the server.
                        const el = e.currentTarget;
                        if (img.thumbnail_url && !el.dataset.fallback) { el.dataset.fallback = '1'; el.src = imageUrl(img.image_url); } else el.classList.add('broken');
                      }} />
                    <span className="lookup-img-meta">
                      <Badge tone={img.kind === 'other' ? 'neutral' : 'moss'}>{KIND_LABEL[img.kind]}</Badge>
                      {img.confidence && <span className="small muted">{SURE[img.confidence]}</span>}
                    </span>
                    {img.caption && <span className="small lookup-cap">{img.caption}</span>}
                    <a className="small" href={img.page_url} target="_blank" rel="noreferrer" title={img.page_title ?? img.page_url}>{img.site || hostOf(img.page_url)} ↗</a>
                  </label>
                );
              })}
              <label className={`lookup-img lookup-none ${choice.image ? '' : 'on'}`}>
                <input type="radio" name="lookup-cover" checked={!choice.image} onChange={() => setChoice({ ...choice, image: null })} />
                <span className="small">{game.cover_file_id ? 'Behold illustrasjonen' : 'Ingen av disse'}</span>
              </label>
            </div>
          )}

          <h3 className="lookup-sub">Opplysninger</h3>
          {!info.year_published && !info.publishers && !info.website ? (
            <p className="small muted">Agenten fant ingen opplysninger om spillet.</p>
          ) : (
            <ul className="lookup-facts">
              {info.year_published && (
                <FactRow label="Utgitt" value={String(info.year_published.value)} now={game.year_published ? String(game.year_published) : null}
                  differs={d.year} checked={choice.year} onCheck={(v) => setChoice({ ...choice, year: v })}
                  badge={BASIS[info.year_published.basis]} source={info.year_published.source} />
              )}
              {info.publishers && (
                <FactRow label="Utgiver" value={info.publishers.value.join(', ')} now={game.publishers.join(', ') || null}
                  differs={d.publishers} checked={choice.publishers} onCheck={(v) => setChoice({ ...choice, publishers: v })}
                  badge={BASIS[info.publishers.basis]} source={info.publishers.source} />
              )}
              {info.website && (
                <FactRow label="Offisiell nettside" value={info.website.url} link now={game.website_url ?? null}
                  differs={d.website} checked={choice.website} onCheck={(v) => setChoice({ ...choice, website: v })}
                  badge={info.website.basis === 'read'
                    ? { text: 'Åpnet av agenten', tone: 'moss', hint: 'Agenten åpnet siden.' }
                    : { text: 'Funnet i søk, ikke åpnet', tone: 'neutral', hint: 'Siden kom opp i et søk, men agenten åpnet den ikke.' }}
                  source={null} note={info.website.why} />
              )}
            </ul>
          )}
          {info.uncertainty && <p className="small lookup-warn">Usikkert: {info.uncertainty}</p>}
          {result!.warnings.length > 0 && (
            <details className="small lookup-checks">
              <summary>Paintrest sin kontroll ({result!.warnings.length})</summary>
              <ul>{result!.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </details>
          )}
          {info.sources.length > 0 && (
            <p className="small lookup-sources">
              Kilder: {info.sources.map((x) => <a key={x.url} href={x.url} target="_blank" rel="noreferrer" title={x.title}>{hostOf(x.url)}{x.opened ? '' : ' (søk)'} ↗</a>)}
            </p>
          )}
          <div className="lookup-actions">
            <Button variant="primary" disabled={!any || busy} onClick={async () => {
              setBusy(true);
              setFailed(null);
              try {
                setApplied(await onApply(info, choice));
                setChoice({ year: false, publishers: false, website: false, image: null });
              } catch (e) {
                setFailed(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}>{busy ? 'Legger inn …' : 'Bruk valgte'}</Button>
            <span className="small muted">Felt som er tomme, er krysset av. Kryss av for å erstatte det som står der nå.</span>
          </div>
        </>
      )}
      {!info && run.status === 'done' && result && result.warnings.length > 0 && (
        <ul className="small lookup-warn">{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
      )}
    </Card>
  );
}

function FactRow({ label, value, now, differs, checked, onCheck, badge, source, link, note }: {
  label: string; value: string; now: string | null; differs: boolean; checked: boolean; onCheck: (v: boolean) => void;
  badge: { text: string; tone: 'moss' | 'neutral' | 'warn'; hint: string }; source: { url: string; title: string } | null; link?: boolean; note?: string | null;
}) {
  return (
    <li className={differs && checked ? 'on' : ''}>
      <label className="check">
        <input type="checkbox" checked={differs && checked} disabled={!differs} onChange={(e) => onCheck(e.target.checked)} />
        <span className="sr-only">Bruk {label.toLowerCase()}</span>
      </label>
      <div className="lookup-fact">
        <span className="small muted">{label}</span>
        <span className="lookup-value">{link ? <a href={value} target="_blank" rel="noreferrer">{value} ↗</a> : <strong>{value}</strong>}</span>
        <span className="small muted">{differs ? `Nå: ${now ?? '—'}` : 'Samme som nå'}</span>
        {note && <span className="small muted">{note}</span>}
      </div>
      <div className="lookup-basis">
        <span title={badge.hint}><Badge tone={badge.tone}>{badge.text}</Badge></span>
        {source && <a className="small" href={source.url} target="_blank" rel="noreferrer" title={source.title}>{hostOf(source.url)} ↗</a>}
      </div>
    </li>
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
