import { memo, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAiStatus } from '../../app/ai-status';
import { useApp, useCommand, useView } from '../../app/context';
import { useRuns } from '../../app/runs';
import type { ImportSummary } from '../../domain/commands';
import {
  FIELD_LABEL, KIND_LABEL, PRODUCT_KINDS, discussMessage, importInputs, paintLabel, planChunks, plannedImport, splitLines, uncoveredLines,
} from '../../domain/paints';
import type { ImportDraft, ImportField, ImportRow, PlannedStatus } from '../../domain/paints';
import type { ProductKind } from '../../domain/types';
import { Badge, Button, ErrorNote, Swatch } from '../../ui/components';
import { Chip } from '../library/parts';
import { AiStatusNote } from '../library/ResearchPage';
import { ACCEPT, fileToText } from './fileText';
import { importStore, useImport } from './importStore';
import './paints.css';

/**
 * Import of a paint list: paste or upload, the AI reads it part by part, asks
 * when something is unclear, and the user checks every row before saving.
 * Nothing reaches the catalogue before «Legg inn i samlingen».
 */
export function ImportPage() {
  const status = useAiStatus();
  const { draft } = useImport();
  const [result, setResult] = useState<ImportSummary | null>(null);
  return (
    <main className="page import-page">
      <div className="page-head">
        <div>
          <span className="eyebrow"><Link to="/malinger">Malinger</Link></span>
          <h1>Importer malinger</h1>
          <p className="muted">
            Lim inn en liste eller last opp en fil. AI-en finner hver maling med produsent, serie og type, og spør når noe er uklart.
            Du ser alt før noe lagres.
          </p>
        </div>
      </div>
      {result ? <ImportDone sum={result} onAgain={() => setResult(null)} />
        : draft ? <ImportReview draft={draft} status={status} onSaved={setResult} />
          : <ImportStart status={status} />}
    </main>
  );
}

// ---------- 1. Lim inn eller last opp ----------

function ImportStart({ status }: { status: ReturnType<typeof useAiStatus> }) {
  const { ai } = useApp();
  const [text, setText] = useState('');
  const [source, setSource] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const lines = useMemo(() => splitLines(text), [text]);
  const filled = lines.filter((l) => l.trim()).length;
  const parts = useMemo(() => planChunks(lines).length, [lines]);

  const readFile = async (f: File) => {
    setError(null);
    try {
      setText(await fileToText(f));
      setSource(f.name);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const begin = (withAi: boolean) => importStore.begin(text, source ?? 'Innlimt tekst', note, withAi, ai);

  return (
    <div className="import-start">
      <section className="card import-input">
        <div className="field">
          <label htmlFor="import-text">Listen din</label>
          <textarea id="import-text" className={drag ? 'drag' : ''} value={text} spellCheck={false} rows={14}
            placeholder={'Lim inn hva som helst, for eksempel:\n\nCitadel: Abaddon Black, Mephiston Red, Nuln Oil x2\nVallejo Model Color 70.950 Black\nArmy Painter speedpaint – Grim Black, Hardened Leather\n\n… eller et regneark, en ordrebekreftelse eller notater.'}
            onChange={(e) => { setText(e.target.value); if (!e.target.value) setSource(null); }}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault(); setDrag(false);
              const f = e.dataTransfer.files[0];
              if (f) void readFile(f);
            }} />
        </div>
        <div className="import-file">
          <Button onClick={() => fileRef.current?.click()}>Last opp fil</Button>
          <input ref={fileRef} type="file" accept={ACCEPT} hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); e.target.value = ''; }} />
          <span className="small muted">
            {source ? <>Fra <strong>{source}</strong>. </> : null}
            Tekst, CSV/TSV, Excel (.xlsx), JSON eller HTML. Fra PDF eller e-post: kopier teksten og lim den inn.
          </span>
        </div>
        <ErrorNote error={error} onClose={() => setError(null)} />
        <div className="field">
          <label htmlFor="import-note">Til AI-en (valgfritt)</label>
          <input id="import-note" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="For eksempel: Uten produsent er det Vallejo Model Color. Linjene med * har jeg ikke." />
        </div>
        <p className="small muted">
          {filled ? `${filled} ${filled === 1 ? 'linje' : 'linjer'}` : 'Ingen linjer ennå'}
          {filled && status === 'ready' ? ` · AI-en leser dem i ${parts} ${parts === 1 ? 'del' : 'deler'}` : ''}
          {parts > 25 ? '. Det er mange kall til AI-en, og det kan ta en stund.' : ''}
        </p>
        <AiStatusNote status={status} />
        <div className="import-start-actions">
          <Button onClick={() => begin(false)} disabled={!filled} title="Ett navn per linje, eller et regneark med kolonnenavn">Les uten AI</Button>
          <Button variant="primary" onClick={() => begin(true)} disabled={!filled || status !== 'ready'}>Les listen med AI</Button>
        </div>
      </section>
      <aside className="import-how">
        <h2>Slik virker det</h2>
        <ol>
          <li><strong>AI-en leser listen</strong> i deler på opptil 40 linjer og foreslår hver maling: produsent, serie, navn, kode, type og en omtrentlig farge.</li>
          <li><strong>Du ser hva som er gjettet.</strong> Felt AI-en fylte inn selv, og ikke fant i teksten din, er merket. Linjer den ikke brukte, vises.</li>
          <li><strong>Svar på spørsmålene</strong> eller gi en beskjed («alle Vallejo er Game Color»). AI-en retter listen.</li>
          <li><strong>Legg inn i samlingen.</strong> Malinger du har fra før, oppdateres i stedet for å bli doble.</li>
        </ol>
        <p className="small muted">Uten AI: ett navn per linje, eller et regneark med kolonnenavn som Produsent, Serie, Navn, Kode og Type. AI-en kan hjelpe med resten etterpå.</p>
        <p className="small muted">Utkastet lagres i denne nettleseren til du legger det inn eller forkaster det.</p>
      </aside>
    </div>
  );
}

// ---------- 2. Gå gjennom listen ----------

type RowFilter = 'all' | 'new' | 'existing' | 'unsure' | 'guessed' | 'excluded';

const STATUS_TEXT: Record<PlannedStatus, string> = { new: 'Ny', existing: 'Finnes fra før', restore: 'Tas i bruk igjen', duplicate: 'Dobbel' };

function ImportReview({ draft, status, onSaved }: { draft: ImportDraft; status: ReturnType<typeof useAiStatus>; onSaved: (s: ImportSummary) => void }) {
  const { ai } = useApp();
  const run = useRuns((r) => r.get(draft.id, 'paints'));
  const busy = run?.status === 'running';
  const reading = busy && run?.label === 'Leser malingslisten';
  const { run: save, error, clearError, busy: saving } = useCommand();
  const [filter, setFilter] = useState<RowFilter>('all');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);

  const planned = useView((t) => plannedImport(t, draft.rows), [draft.rows]);
  const byKey = useMemo(() => new Map(planned.map((p) => [p.row.key, p])), [planned]);
  const uncovered = useMemo(() => uncoveredLines(draft), [draft]);

  const included = draft.rows.filter((r) => r.include && r.name.trim());
  const count = (s: PlannedStatus) => planned.filter((p) => p.status === s).length;
  const unconfirmed = included.filter((r) => r.unsure || !r.manufacturer).length;
  const matches: Record<RowFilter, (r: ImportRow) => boolean> = {
    all: () => true,
    new: (r) => byKey.get(r.key)?.status === 'new',
    existing: (r) => byKey.get(r.key)?.status === 'existing' || byKey.get(r.key)?.status === 'restore' || byKey.get(r.key)?.status === 'duplicate',
    unsure: (r) => !!r.unsure,
    guessed: (r) => r.guessed.length > 0,
    excluded: (r) => !r.include,
  };
  const shown = draft.rows.filter(matches[filter]);
  const chunks = draft.chunks;
  const done = chunks.filter((c) => c.status === 'done').length;
  const waiting = chunks.filter((c) => c.status === 'waiting').length;
  const failed = chunks.filter((c) => c.status === 'error');

  const jump = (key: string) => {
    if (!shown.some((r) => r.key === key)) setFilter('all');
    setFlash(key);
    requestAnimationFrame(() => document.getElementById(`row-${key}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
    setTimeout(() => setFlash((f) => (f === key ? null : f)), 1800);
  };

  const commit = async () => {
    const sum = await save((c) => c.importProducts(importInputs(draft.rows)));
    if (sum) { importStore.discard(); onSaved(sum); }
  };

  return (
    <>
      <div className="import-review">
        <div className="import-main">
          <section className="import-progress" aria-live="polite">
            <p>
              <strong>{draft.source}</strong> · {draft.lines.filter((l) => l.trim()).length} linjer · {draft.rows.length} {draft.rows.length === 1 ? 'maling' : 'malinger'}
              {!draft.with_ai && ' · lest uten AI'}
            </p>
            {draft.with_ai && chunks.length > 0 && (done < chunks.length || reading) && (
              <div className="import-bar" role="progressbar" aria-valuemin={0} aria-valuemax={chunks.length} aria-valuenow={done}
                aria-label="Deler som er lest">
                <span style={{ width: `${(done / chunks.length) * 100}%` }} />
              </div>
            )}
            {reading && (
              <p className="small">
                <span className="run-dot" aria-hidden /> Leser {chunks.filter((c) => c.status === 'running').map((c) => `linje ${c.from}–${c.to}`).join(' og ')} · {done} av {chunks.length} deler ferdig
                {' '}<button type="button" className="link" onClick={() => importStore.stop()}>Stopp</button>
              </p>
            )}
            {!busy && (waiting > 0 || failed.length > 0) && (
              <p className="small">
                {waiting > 0 && `Lesingen stoppet: ${waiting} ${waiting === 1 ? 'del' : 'deler'} gjenstår. `}
                {status === 'ready' && <Button onClick={() => importStore.read(ai)}>{failed.length ? 'Prøv igjen' : 'Fortsett lesingen'}</Button>}
              </p>
            )}
            {failed.map((c) => (
              <p key={`${c.from}-${c.to}`} className="small tech-uncertain">Linje {c.from}–{c.to} ble ikke lest: {c.error}</p>
            ))}
          </section>

          {uncovered.length > 0 && !reading && (
            <section className="import-uncovered">
              <p><strong>{uncovered.length} {uncovered.length === 1 ? 'linje' : 'linjer'} ble ikke brukt.</strong> AI-en laget ingen maling av {uncovered.length === 1 ? 'den' : 'dem'} og sa ikke hvorfor.</p>
              <ul className="line-list">
                {uncovered.slice(0, 12).map((n) => <li key={n}><span className="mono">L{n}</span> {draft.lines[n - 1]}</li>)}
                {uncovered.length > 12 && <li className="muted">… og {uncovered.length - 12} til</li>}
              </ul>
              {status === 'ready' && <Button onClick={() => importStore.reread(uncovered, ai)} disabled={busy}>Be AI-en lese {uncovered.length === 1 ? 'den' : 'dem'} på nytt</Button>}
            </section>
          )}

          {draft.skipped.length > 0 && (
            <details className="import-skipped">
              <summary>AI-en hoppet over {draft.skipped.length} {draft.skipped.length === 1 ? 'linje' : 'linjer'} som ikke er malinger</summary>
              <ul className="line-list">
                {[...draft.skipped].sort((a, b) => a.line - b.line).map((s) => (
                  <li key={s.line}><span className="mono">L{s.line}</span> {draft.lines[s.line - 1]} <span className="muted">· {s.reason}</span></li>
                ))}
              </ul>
              <p className="small muted">Er noe av dette en maling, skriv det til AI-en («linje 12 er en maling»).</p>
            </details>
          )}

          <div className="filters" role="toolbar" aria-label="Vis">
            <Chip on={filter === 'all'} onClick={() => setFilter('all')}>Alle <span className="chip-count">{draft.rows.length}</span></Chip>
            <Chip on={filter === 'new'} onClick={() => setFilter('new')}>Nye <span className="chip-count">{count('new')}</span></Chip>
            <Chip on={filter === 'existing'} onClick={() => setFilter('existing')}>Finnes fra før <span className="chip-count">{count('existing') + count('restore') + count('duplicate')}</span></Chip>
            <Chip on={filter === 'unsure'} onClick={() => setFilter('unsure')}>Med tvil <span className="chip-count">{draft.rows.filter((r) => r.unsure).length}</span></Chip>
            <Chip on={filter === 'guessed'} onClick={() => setFilter('guessed')}>Med gjettede felt <span className="chip-count">{draft.rows.filter((r) => r.guessed.length).length}</span></Chip>
            <Chip on={filter === 'excluded'} onClick={() => setFilter('excluded')}>Utelatt <span className="chip-count">{draft.rows.filter((r) => !r.include).length}</span></Chip>
          </div>
          <p className="small ai-legend"><span className="ai-dot" aria-hidden /> Merket felt er fylt inn av AI-en og står ikke i teksten din. Sjekk dem. Endrer du et felt, er det ditt. Fargene er omtrentlige.</p>

          <div className="import-rows" role="table" aria-label="Malinger i importen">
            <div className="import-row import-head" role="row">
              <span role="columnheader">Med</span><span role="columnheader">Farge</span><span role="columnheader">Produsent</span>
              <span role="columnheader">Serie</span><span role="columnheader">Navn</span><span role="columnheader">Kode</span>
              <span role="columnheader">Type</span><span role="columnheader">Har</span>
            </div>
            {shown.map((r) => {
              const p = byKey.get(r.key);
              return (
                <RowEditor key={r.key} row={r} lines={r.lines.map((n) => `L${n}: ${draft.lines[n - 1] ?? ''}`).join(' · ')}
                  status={p?.status ?? null} detail={p?.duplicate_of ? `samme som ${p.duplicate_of}` : p?.match ? paintLabel(p.match) : null}
                  touched={draft.touched.includes(r.key)} flash={flash === r.key} />
              );
            })}
            {shown.length === 0 && <p className="muted small">{draft.rows.length ? 'Ingen rader passer filteret.' : reading ? 'Malingene dukker opp her mens AI-en leser.' : 'Ingen malinger ennå.'}</p>}
          </div>
          <Button variant="ghost" onClick={() => importStore.addRow()}>+ Legg til rad</Button>
        </div>

        <aside className="import-aside">
          <ImportDialog draft={draft} busy={busy} reading={reading} status={status} onJump={jump}
            error={run?.status === 'error' && !run.error_reported ? run.error : null} />
        </aside>
      </div>

      <div className="import-footer">
        <ErrorNote error={error} onClose={clearError} />
        <div className="import-footer-row">
          <p className="small">
            {included.length === 0 ? 'Ingen malinger er valgt.' : <>
              {count('new')} nye · {count('existing')} finnes fra før og fylles ut · {count('restore')} tas i bruk igjen
              {count('duplicate') > 0 && ` · ${count('duplicate')} doble hoppes over`}
              {unconfirmed > 0 && `. ${unconfirmed} uten produsent eller med tvil lagres som ubekreftet`}
              {draft.questions.length > 0 && `. ${draft.questions.length} spørsmål er ikke besvart`}.
            </>}
          </p>
          <span className="spacer" />
          {confirmDiscard ? (
            <>
              <span className="small">Forkaste hele importen?</span>
              <Button onClick={() => setConfirmDiscard(false)}>Nei</Button>
              <Button variant="danger" onClick={() => { importStore.discard(); setConfirmDiscard(false); }}>Ja, forkast</Button>
            </>
          ) : <Button variant="ghost" onClick={() => setConfirmDiscard(true)}>Forkast</Button>}
          <Button variant="primary" onClick={commit} disabled={busy || saving || included.length === 0}>
            Legg inn {included.length - count('duplicate')} {included.length - count('duplicate') === 1 ? 'maling' : 'malinger'} i samlingen
          </Button>
        </div>
      </div>
    </>
  );
}

const RowEditor = memo(function RowEditor({ row, lines, status, detail, touched, flash }: {
  row: ImportRow; lines: string; status: PlannedStatus | null; detail: string | null; touched: boolean; flash: boolean;
}) {
  const e = (patch: Partial<Omit<ImportRow, 'key' | 'lines' | 'guessed'>>) => importStore.edit(row.key, patch);
  const g = (f: ImportField) => (row.guessed.includes(f) ? 'guessed' : '');
  const title = (f: ImportField) => (row.guessed.includes(f) ? `${FIELD_LABEL[f][0]!.toUpperCase()}${FIELD_LABEL[f].slice(1)} er fylt inn av AI-en, ikke fra teksten din` : undefined);
  const txt = (f: 'manufacturer' | 'range_name' | 'name' | 'product_code', label: string, extra = '') => (
    <input className={`${g(f)} ${extra}`} value={row[f] ?? ''} aria-label={`${label}, ${row.key}`} title={title(f)} disabled={!row.include}
      onChange={(ev) => e({ [f]: f === 'name' ? ev.target.value : ev.target.value || null })} />
  );
  return (
    <div id={`row-${row.key}`} role="row"
      className={`import-row ${row.include ? '' : 'excluded'} ${touched ? 'touched' : ''} ${flash ? 'flash' : ''} ${row.unsure ? 'has-doubt' : ''}`}>
      <span role="cell" className="ir-check">
        <input type="checkbox" checked={row.include} aria-label={`Ta med ${row.name || row.key}`} onChange={(ev) => e({ include: ev.target.checked })} />
        <span className="mono small muted">{row.key}</span>
      </span>
      <span role="cell" className={`ir-color ${g('swatch_hex')}`} title={row.swatch_hex ? `${row.swatch_hex}${row.guessed.includes('swatch_hex') ? ' (anslått av AI-en)' : ''}` : 'Ingen farge'}>
        <label>
          <Swatch hex={row.swatch_hex} size={26} />
          <input type="color" className="color-hidden" value={row.swatch_hex ?? '#888888'} aria-label={`Farge, ${row.key}`} disabled={!row.include}
            onChange={(ev) => e({ swatch_hex: ev.target.value })} />
        </label>
      </span>
      <span role="cell" className="ir-maker">{txt('manufacturer', 'Produsent')}</span>
      <span role="cell" className="ir-range">{txt('range_name', 'Serie')}</span>
      <span role="cell" className="ir-name">{txt('name', 'Navn')}</span>
      <span role="cell" className="ir-code">{txt('product_code', 'Kode', 'mono')}</span>
      <span role="cell" className="ir-kind">
        <select className={g('product_kind')} value={row.product_kind} title={title('product_kind')} aria-label={`Type, ${row.key}`} disabled={!row.include}
          onChange={(ev) => e({ product_kind: ev.target.value as ProductKind })}>
          {PRODUCT_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
        </select>
      </span>
      <span role="cell" className="ir-own">
        <select value={row.ownership} aria-label={`Har du den, ${row.key}`} disabled={!row.include}
          onChange={(ev) => e({ ownership: ev.target.value as 'owns' | 'not_owned' })}>
          <option value="owns">Har</option>
          <option value="not_owned">Har ikke</option>
        </select>
      </span>
      <span role="cell" className="ir-meta small">
        {!row.include ? <Badge>Utelatt</Badge>
          : status ? <Badge tone={status === 'new' ? 'moss' : status === 'duplicate' ? 'warn' : 'neutral'}>{STATUS_TEXT[status]}</Badge> : <Badge tone="warn">Mangler navn</Badge>}
        {lines && <span className="muted">{lines}</span>}
        {detail && row.include && status !== 'new' && <span className="muted"> → {detail}</span>}
        {row.unsure && <span className="ir-doubt">Tvil: {row.unsure}</span>}
        {row.removed && <span className="muted">Tatt ut: {row.removed}</span>}
      </span>
    </div>
  );
});

// ---------- Dialogen med AI-en ----------

function ImportDialog({ draft, busy, reading, status, onJump, error }: {
  draft: ImportDraft; busy: boolean; reading: boolean; status: ReturnType<typeof useAiStatus>; onJump: (key: string) => void; error: string | null;
}) {
  const { ai } = useApp();
  const { answers, message } = useImport();
  const canSend = status === 'ready' && !busy && !!discussMessage(draft, answers, message);
  const rowName = (key: string) => {
    const r = draft.rows.find((x) => x.key === key);
    return r ? `${key} ${r.name}` : key;
  };
  return (
    <section className="import-dialog" aria-labelledby="dialog-h">
      <h2 id="dialog-h">Spørsmål og beskjeder</h2>
      {draft.questions.length === 0 && (
        <p className="small muted">{reading ? 'Spørsmål fra AI-en dukker opp her mens den leser.' : 'AI-en har ingen åpne spørsmål.'}</p>
      )}
      {draft.questions.map((q) => (
        <div key={q.id} className="iq">
          <p><span className="mono small muted">{q.id}</span> {q.text}</p>
          {q.rows.length > 0 && (
            <p className="iq-rows">
              {q.rows.slice(0, 8).map((k) => <button key={k} type="button" className="iq-row" onClick={() => onJump(k)}>{rowName(k)}</button>)}
              {q.rows.length > 8 && <span className="small muted">+{q.rows.length - 8}</span>}
            </p>
          )}
          {q.options.length > 0 && (
            <div className="iq-options" role="group" aria-label={`Svar på ${q.id}`}>
              {q.options.map((o) => (
                <button key={o} type="button" className={answers[q.id] === o ? 'on' : ''} aria-pressed={answers[q.id] === o}
                  onClick={() => importStore.setAnswer(q.id, answers[q.id] === o ? '' : o)}>{o}</button>
              ))}
            </div>
          )}
          <div className="iq-own">
            <input value={q.options.includes(answers[q.id] ?? '') ? '' : answers[q.id] ?? ''} placeholder="Eget svar"
              aria-label={`Eget svar på ${q.id}`} onChange={(e) => importStore.setAnswer(q.id, e.target.value)} />
            <button type="button" className="link small" onClick={() => importStore.dismissQuestion(q.id)}>Hopp over</button>
          </div>
        </div>
      ))}
      <div className="field">
        <label htmlFor="import-message">Beskjed til AI-en</label>
        <textarea id="import-message" rows={3} value={message} onChange={(e) => importStore.setMessage(e.target.value)}
          placeholder="For eksempel: «Alle Vallejo er Game Color», «ta ut pensler og lakk», «linje 40–60 er ønskelisten»." />
      </div>
      <ErrorNote error={error} />
      <Button variant="primary" onClick={() => importStore.discuss(ai)} disabled={!canSend}>
        {busy && !reading ? 'AI-en oppdaterer listen …' : 'Send til AI-en'}
      </Button>
      {status !== 'ready' && <AiStatusNote status={status} />}
      {draft.log.length > 0 && (
        <details className="import-log" open={draft.log.length <= 4}>
          <summary>Samtalen ({draft.log.length})</summary>
          <ol>
            {draft.log.map((l, i) => (
              <li key={i} className={l.role}><span className="eyebrow">{l.role === 'user' ? 'Du' : 'AI-en'}</span> {l.text}</li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}

// ---------- 3. Ferdig ----------

function ImportDone({ sum, onAgain }: { sum: ImportSummary; onAgain: () => void }) {
  return (
    <section className="card import-done" role="status">
      <h2>Lagt inn i samlingen</h2>
      <ul>
        <li><strong>{sum.created}</strong> nye malinger</li>
        {sum.updated > 0 && <li><strong>{sum.updated}</strong> fantes fra før; tomme felt er fylt inn og eierskapet satt</li>}
        {sum.restored > 0 && <li><strong>{sum.restored}</strong> skjulte malinger er tatt i bruk igjen</li>}
        {sum.duplicates > 0 && <li><strong>{sum.duplicates}</strong> sto to ganger i listen og ble lagret én gang</li>}
      </ul>
      <div className="head-actions">
        <Link className="btn btn-primary" to="/malinger">Se samlingen</Link>
        <Button onClick={onAgain}>Importer en liste til</Button>
      </div>
    </section>
  );
}
