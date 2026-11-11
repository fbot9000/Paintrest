/**
 * Fordel bildene (brukerønske 11.11.2026): every picture the agent found for the game, once, in one pool
 * («Funn»), surest first, each with the agent's guess. The user drags pictures onto the miniatures, or
 * taps pictures and then a miniature (iPad). Group pictures can go on several miniatures. Everything
 * can be undone. The pictures are saved through placeImages, so the proposals keep their other pictures.
 */
import { useMemo, useState } from 'react';
import type { DragEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useApp, useView } from '../../app/context';
import { imagePool } from '../../domain/review';
import type { PoolImage } from '../../domain/review';
import type { Id, MiniatureSubject } from '../../domain/types';
import { assetFileId, liveSubjects, subjectReferences } from '../../domain/views';
import { Badge, Button, ErrorNote, FileImage } from '../../ui/components';
import './distribute.css';

const DRAG_TYPE = 'application/x-paintrest-images';
const SURE = { high: 'Sikker', medium: 'Trolig', low: 'Usikker' } as const;

interface Target { s: MiniatureSubject; file: Id | null; count: number }

export function DistributePage() {
  const { projectId = '' } = useParams();
  const app = useApp();
  const data = useView((t) => ({
    pool: imagePool(t, projectId),
    targets: liveSubjects(t, projectId).map((s): Target => ({ s, file: assetFileId(t, s.official_asset_id), count: subjectReferences(t, s).length })),
  }), [projectId]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dragging, setDragging] = useState<string[] | null>(null);
  const [over, setOver] = useState<Id | null>(null);
  const [busy, setBusy] = useState<Id | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; undo: () => Promise<void> } | null>(null);
  const [zoom, setZoom] = useState<PoolImage | null>(null);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const [showUnsure, setShowUnsure] = useState(false);
  const [showUsed, setShowUsed] = useState(false);

  const byUrl = useMemo(() => new Map(data.pool.map((x) => [x.image.image_url, x])), [data.pool]);
  const visible = data.pool.filter((x) => !broken.has(x.image.image_url));
  const free = visible.filter((x) => !x.placed_on.length);
  const sure = free.filter((x) => x.confidence === 'high' || x.confidence === 'medium');
  const unsure = free.filter((x) => x.confidence !== 'high' && x.confidence !== 'medium');
  const used = visible.filter((x) => x.placed_on.length > 0);
  const name = (id: Id) => data.targets.find((x) => x.s.id === id)?.s.name ?? 'miniatyren';
  // Where the agent thinks the pictures being moved belong: those miniatures are marked.
  const moving = dragging ?? [...selected];
  const guessed = new Set(moving.flatMap((u) => byUrl.get(u)?.guesses.map((g) => g.subject_id) ?? []));

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };

  const place = (subject_id: Id, urls: string[]) => run(async () => {
    const items = urls.map((u) => byUrl.get(u)).filter((x): x is PoolImage => !!x);
    if (!items.length) return;
    setBusy(subject_id);
    try {
      const assets = await app.research.placeImages(subject_id, items.map((x) => x.image), { auto_cover: true });
      setSelected(new Set());
      setToast({
        text: `La ${items.length} ${items.length === 1 ? 'bilde' : 'bilder'} på ${name(subject_id)}`,
        undo: async () => {
          for (const asset of Object.values(assets)) await app.cmd.detachSubjectImage(subject_id, asset);
          // Proposals that closed because their last picture was used, open again.
          await app.research.restoreImages(projectId, items.map((x) => x.image.image_url));
        },
      });
    } finally {
      setBusy(null);
    }
  });

  const dismiss = (urls: string[]) => run(async () => {
    await app.research.dismissImages(projectId, urls);
    setSelected((cur) => { const n = new Set(cur); urls.forEach((u) => n.delete(u)); return n; });
    setToast({ text: `Forkastet ${urls.length} ${urls.length === 1 ? 'bilde' : 'bilder'}`, undo: () => app.research.restoreImages(projectId, urls) });
  });

  const toggle = (url: string) => setSelected((cur) => { const n = new Set(cur); if (n.has(url)) n.delete(url); else n.add(url); return n; });

  const onDragStart = (url: string) => (e: DragEvent) => {
    const urls = selected.has(url) ? [...selected] : [url];
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(urls));
    e.dataTransfer.effectAllowed = 'copy';
    setDragging(urls);
  };
  const dropOn = (id: Id) => ({
    onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setOver(id); } },
    onDragLeave: () => setOver((cur) => (cur === id ? null : cur)),
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      setOver(null);
      setDragging(null);
      let urls: string[] = [];
      try { urls = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) as string[]; } catch { /* not ours */ }
      if (urls.length) void place(id, urls);
    },
  });

  const card = (x: PoolImage) => {
    const url = x.image.image_url;
    const on = selected.has(url);
    const first = x.guesses[0];
    // A used picture (a group picture) can still go on the other miniatures the agent guessed.
    const nextGuess = x.guesses.find((g) => !x.placed_on.includes(g.subject_id));
    return (
      <div key={url} className={`pool-card ${on ? 'on' : ''} ${dragging?.includes(url) ? 'dragging' : ''}`} draggable
        onDragStart={onDragStart(url)} onDragEnd={() => { setDragging(null); setOver(null); }}>
        <button type="button" className="pool-pic" onClick={() => toggle(url)} aria-pressed={on}
          aria-label={`${on ? 'Fjern valget av' : 'Velg'} bildet${first ? `, trolig ${first.name}` : ''}`}
          title={[x.image.reason, x.image.caption, x.image.site].filter(Boolean).join(' · ') || undefined}>
          <img src={app.ai.imageProxyUrl(x.image.thumbnail_url ?? x.image.image_url)} alt={x.image.caption ?? ''} loading="lazy" draggable={false}
            onError={() => setBroken((cur) => new Set(cur).add(url))} />
          {on && <span className="pool-check" aria-hidden>✓</span>}
          {x.confidence && <span className={`pool-conf ${x.confidence}`}>{SURE[x.confidence]}</span>}
        </button>
        <div className="pool-meta">
          {nextGuess
            ? <button type="button" className="pool-accept" onClick={() => place(nextGuess.subject_id, [url])} disabled={busy === nextGuess.subject_id}
                title={`Legg bildet på ${nextGuess.name}, der agenten tror det hører hjemme`}>→ {nextGuess.name}</button>
            : x.placed_on.length > 0 && <span className="small pool-used">På {x.placed_on.map(name).join(', ')}</span>}
          <span className="pool-tools">
            <button type="button" className="pool-tool" onClick={() => setZoom(x)} aria-label="Vis stort" title="Vis stort">⤢</button>
            {!x.placed_on.length && <button type="button" className="pool-tool" onClick={() => dismiss([url])} aria-label="Forkast bildet" title="Forkast">×</button>}
          </span>
        </div>
        {x.placed_on.length > 0 && nextGuess
          ? <span className="small pool-used pool-also">På {x.placed_on.map(name).join(', ')}</span>
          : !x.placed_on.length && x.guesses.length > 1 && <span className="small muted pool-also">Også: {x.guesses.slice(1).map((g) => g.name).join(', ')}</span>}
      </div>
    );
  };

  return (
    <main className="page page-wide dist-page">
      <div className="page-head">
        <div>
          <h1>Fordel bildene</h1>
          <p className="muted">
            {data.pool.length
              ? <>{free.length} funn å fordele{used.length ? `, ${used.length} brukt` : ''}. Dra et bilde til en miniatyr, eller trykk på bilder og velg miniatyr. «→ navn» legger det der agenten tror det hører hjemme.</>
              : 'Ingen funn å fordele ennå.'}
          </p>
        </div>
        <Link className="btn btn-secondary" to={`/p/${projectId}/miniatyrer`}>Til miniatyrene</Link>
      </div>
      <ErrorNote error={error} onClose={() => setError(null)} />

      {!data.pool.length ? (
        <div className="empty">
          <h2>Her havner bildene agenten finner</h2>
          <p className="muted">Kartlegg spillet fra <Link to={`/p/${projectId}/miniatyrer`}>miniatyrlisten</Link>, eller let etter bilder for én miniatyr i verkstedet. Funnene dukker opp her, og du fordeler dem på miniatyrene.</p>
        </div>
      ) : (
        <div className="dist">
          <section className="dist-pool" aria-label="Funn">
            <div className="dist-head">
              <h2>Agenten tror på disse ({sure.length})</h2>
              {free.length > 0 && <button type="button" className="link small" onClick={() => setSelected(new Set(sure.map((x) => x.image.image_url)))}>Velg alle</button>}
            </div>
            {sure.length ? <div className="pool-grid">{sure.map(card)}</div> : <p className="small muted">Ingen bilder agenten er sikker på.</p>}

            {unsure.length > 0 && (
              <>
                <button type="button" className="dist-fold" onClick={() => setShowUnsure((v) => !v)} aria-expanded={showUnsure}>
                  {showUnsure ? '▾' : '▸'} Usikre ({unsure.length})
                </button>
                {showUnsure && <div className="pool-grid">{unsure.map(card)}</div>}
              </>
            )}
            {used.length > 0 && (
              <>
                <button type="button" className="dist-fold" onClick={() => setShowUsed((v) => !v)} aria-expanded={showUsed}
                  title="Bilder du har lagt på en miniatyr. Et gruppebilde kan også dras til andre miniatyrer.">
                  {showUsed ? '▾' : '▸'} Brukt ({used.length})
                </button>
                {showUsed && <div className="pool-grid">{used.map(card)}</div>}
              </>
            )}
          </section>

          <section className="dist-targets" aria-label="Miniatyrene">
            <h2 className="eyebrow">Miniatyrene</h2>
            {data.targets.map(({ s, file, count }) => (
              <div key={s.id} className={`dist-target ${over === s.id ? 'over' : ''} ${guessed.has(s.id) ? 'guessed' : ''} ${busy === s.id ? 'busy' : ''}`}
                {...dropOn(s.id)}>
                <button type="button" className="dist-target-main" disabled={!selected.size || busy === s.id}
                  onClick={() => place(s.id, [...selected])}
                  aria-label={selected.size ? `Legg ${selected.size} valgte bilder på ${s.name}` : s.name}>
                  <span className="dist-thumb"><FileImage fileId={file} alt="" className="dist-thumb-img" fallback={<span>{s.name.slice(0, 1)}</span>} /></span>
                  <span className="dist-target-text">
                    <strong>{s.name}</strong>
                    <span className="small muted">
                      {busy === s.id ? 'Henter og lagrer …' : `${count} ${count === 1 ? 'bilde' : 'bilder'}`}
                      {s.identity?.official_name && s.identity.official_name !== s.name ? ` · ${s.identity.official_name}${s.identity.status === 'proposed' ? '?' : ''}` : ''}
                    </span>
                  </span>
                  {selected.size > 0 && busy !== s.id && <span className="dist-cta">Legg {selected.size} her</span>}
                </button>
                <span className="dist-target-side">
                  {s.identity?.status === 'proposed' && (
                    <span className="dist-id" title={`Agenten mener dette er «${s.identity.official_name ?? '?'}»`}>
                      <button type="button" onClick={() => run(() => app.cmd.confirmIdentity(s.id))} aria-label={`Riktig figur: ${s.identity.official_name}`} title="Riktig figur">✓</button>
                      <button type="button" onClick={() => run(() => app.cmd.rejectIdentity(s.id))} aria-label="Feil figur" title="Feil figur">✗</button>
                    </span>
                  )}
                  <Link to={`/p/${projectId}/m/${s.id}/bilder`} className="dist-open" aria-label={`Åpne verkstedet for ${s.name}`} title="Åpne verkstedet">↗</Link>
                </span>
              </div>
            ))}
          </section>
        </div>
      )}

      {selected.size > 0 && (
        <div className="dist-bar" role="region" aria-label="Valgte bilder">
          <span>{selected.size} valgt · legg på:</span>
          <span className="dist-bar-chips">
            {[...data.targets].sort((a, b) => Number(guessed.has(b.s.id)) - Number(guessed.has(a.s.id))).map(({ s }) => (
              <button key={s.id} type="button" className={`chip ${guessed.has(s.id) ? 'on' : ''}`} disabled={busy === s.id} onClick={() => place(s.id, [...selected])}>{s.name}</button>
            ))}
          </span>
          <span className="dist-bar-actions">
            <Button variant="ghost" onClick={() => dismiss([...selected].filter((u) => !byUrl.get(u)?.placed_on.length))}>Forkast</Button>
            <Button variant="ghost" onClick={() => setSelected(new Set())}>Fjern valg</Button>
          </span>
        </div>
      )}

      {toast && (
        <div className="dist-toast" role="status">
          <span>{toast.text}</span>
          <button type="button" className="link" onClick={() => { const u = toast.undo; setToast(null); void run(u); }}>Angre</button>
          <button type="button" className="link small" onClick={() => setToast(null)} aria-label="Lukk">×</button>
        </div>
      )}

      {zoom && (
        <div className="dist-zoom" role="dialog" aria-label="Bildet i stort format" onClick={() => setZoom(null)}>
          <img src={app.ai.imageProxyUrl(zoom.image.image_url)} alt={zoom.image.caption ?? ''} className="dist-zoom-img" />
          <div className="dist-zoom-text" onClick={(e) => e.stopPropagation()}>
            {zoom.guesses.length > 0 && <p><strong>Agenten tror: {zoom.guesses.map((g) => g.name).join(', ')}</strong>{zoom.confidence ? <> · <Badge>{SURE[zoom.confidence]}</Badge></> : null}</p>}
            {zoom.image.reason && <p>{zoom.image.reason}</p>}
            {zoom.image.original_text && <p className="small muted">«{zoom.image.original_text}»</p>}
            <a href={zoom.image.page_url} target="_blank" rel="noreferrer">{zoom.image.site || zoom.image.page_title} ↗</a>
          </div>
          <button type="button" className="dist-zoom-close">Lukk</button>
        </div>
      )}
    </main>
  );
}
