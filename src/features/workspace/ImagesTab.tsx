/**
 * Bilder: the agent's suggestions with reasons, images from pages the agent
 * is reading right now, images from a known source, and upload. The user
 * ticks images and picks one illustration; nothing is stored before «Lagre».
 */
import { useEffect, useMemo, useState } from 'react';
import { useApp, useCommand, useView } from '../../app/context';
import type { Run } from '../../app/runs';
import type { HuntAnchor, ReferenceImage, ReferenceSelectionPayload, VideoRef } from '../../domain/agent';
import type { Id, MiniatureSubject, Tables } from '../../domain/types';
import { subjectReferences } from '../../domain/views';
import { Button, ErrorNote, ImagePicker } from '../../ui/components';
import { startImageHunt } from './agentRuns';

interface Candidate extends ReferenceImage {
  proposal_id: Id | null;
}

const CONFIDENCE = { high: 'Trolig riktig', medium: 'Mulig', low: 'Usikker' } as const;

function view(t: Tables, s: MiniatureSubject) {
  const openTasks = new Set(Object.values(t.research_task).filter((x) => x.status === 'open' && t.task_scope[x.id]?.work_project_id === s.project_id).map((x) => x.id));
  const proposals = Object.values(t.research_proposal)
    .filter((p) => p.decision === 'pending' && p.result_type === 'reference_selection' && openTasks.has(p.task_id)
      && (p.payload as ReferenceSelectionPayload).subject_id === s.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const suggested: Candidate[] = proposals.flatMap((p) => (p.payload as ReferenceSelectionPayload).images.map((i) => ({ ...i, proposal_id: p.id })));
  const saved = new Set(subjectReferences(t, s).map((r) => r.asset.locator).filter(Boolean) as string[]);
  const read = proposals.flatMap((p) => (p.payload as ReferenceSelectionPayload).sources_read ?? []);
  const withAnchor = proposals.find((p) => (p.payload as ReferenceSelectionPayload).anchor);
  const anchor = withAnchor ? { anchor: (withAnchor.payload as ReferenceSelectionPayload).anchor!, proposal_id: withAnchor.id } : null;
  const videos = proposals.flatMap((p) => (p.payload as ReferenceSelectionPayload).videos ?? []);
  const linked = new Set(Object.values(t.source_link).filter((l) => !l.deleted_at && l.target_type === 'subject' && l.target_id === s.id).map((l) => l.source_id));
  const savedVideos = new Set(Object.values(t.source).filter((x) => !x.deleted_at && x.kind === 'video' && linked.has(x.id) && x.url).map((x) => x.url!));
  return { proposals, suggested, saved, read, anchor, videos, savedVideos };
}

export function ImagesTab({ subject: s, game, run, browseUrl, setBrowseUrl, referenceFileId }: {
  subject: MiniatureSubject; game: string; run: Run | null; browseUrl: string | null; setBrowseUrl: (u: string | null) => void; referenceFileId: Id | null;
}) {
  const app = useApp();
  const { run: cmdRun, error, clearError } = useCommand();
  const data = useView((t) => view(t, s), [s]);
  const [selected, setSelected] = useState<Map<string, Candidate>>(new Map());
  // Pictures that do not load (or are tiny icons) are left out instead of shown as empty boxes.
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const [cover, setCover] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'page' | 'save'>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [page, setPage] = useState<{ url: string; title: string; candidates: Candidate[] } | null>(null);

  useEffect(() => { setSelected(new Map()); setCover(null); }, [s.id]);

  useEffect(() => {
    if (!browseUrl) { setPage(null); return; }
    let live = true;
    setBusy('page'); setLocalError(null);
    app.ai.pageImages(browseUrl).then((r) => {
      if (!live) return;
      setPage({ url: r.url, title: r.title, candidates: r.images.map((i) => ({
        image_url: i.url, page_url: r.url, page_title: r.title, site: r.site, creator: r.author,
        caption: i.caption ?? (i.alt || null), kind: null, proposal_id: null,
      })) });
    }).catch((e) => live && setLocalError(e instanceof Error ? e.message : String(e))).finally(() => live && setBusy(null));
    return () => { live = false; };
  }, [browseUrl, app.ai]);

  // Images on pages the agent is reading in the current run, as they arrive.
  const livePages = useMemo(() => (run?.pages ?? []).map((p) => ({
    ...p,
    candidates: p.images.map((i): Candidate => ({
      image_url: i.url, page_url: i.page_url ?? p.url, page_title: i.page_title ?? p.title, site: i.site ?? p.site, creator: p.search ? null : p.author,
      caption: i.caption ?? (i.alt || null), page_language: p.language, kind: null, proposal_id: null, thumbnail_url: i.thumbnail_url ?? null,
    })),
  })), [run?.pages]);

  const toggle = (c: Candidate, on: boolean) => {
    setSelected((cur) => {
      const n = new Map(cur);
      if (on) n.set(c.image_url, c); else n.delete(c.image_url);
      return n;
    });
    if (!on && cover === c.image_url) setCover(null);
  };

  const save = async () => {
    setBusy('save'); setLocalError(null);
    try {
      const chosen = [...selected.values()];
      const byProposal = new Map<Id, Candidate[]>();
      for (const c of chosen) if (c.proposal_id) byProposal.set(c.proposal_id, [...(byProposal.get(c.proposal_id) ?? []), c]);
      for (const [pid, imgs] of byProposal) {
        await app.research.approveProposal(pid, {
          image_urls: imgs.map((i) => i.image_url),
          ...(cover && imgs.some((i) => i.image_url === cover) ? { cover_image_url: cover } : {}),
        });
      }
      const direct = chosen.filter((c) => !c.proposal_id);
      if (direct.length) await app.cmd.attachWebImages(s.id, direct, cover && direct.some((c) => c.image_url === cover) ? cover : undefined);
      setSelected(new Map()); setCover(null);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const running = run?.status === 'running';
  // While the hunt runs, the anchor and phase arrive as events; afterwards they are in the proposal.
  const liveAnchor = running ? run!.events.flatMap((e) => (e.type === 'anchor' ? [e.anchor] : [])).at(-1) ?? null : null;
  const phase = running ? run!.events.flatMap((e) => (e.type === 'phase' ? [e.text] : [])).at(-1) ?? null : null;
  const anchor: { anchor: HuntAnchor; proposal_id: Id | null } | null = liveAnchor ? { anchor: liveAnchor, proposal_id: null } : data.anchor;
  const anchorCandidate: Candidate | null = anchor?.anchor.image_url ? {
    image_url: anchor.anchor.image_url, page_url: anchor.anchor.page_url ?? anchor.anchor.image_url,
    page_title: anchor.anchor.page_title ?? '', site: anchor.anchor.site ?? '', creator: anchor.anchor.painter,
    caption: null,
    kind: anchor.anchor.kind === 'painted' ? 'official' : anchor.anchor.kind, proposal_id: anchor.proposal_id,
    thumbnail_url: data.suggested.find((x) => x.image_url === anchor.anchor.image_url)?.thumbnail_url ?? null,
  } : null;
  const rest = dedupe(data.suggested).filter((c) => c.image_url !== anchorCandidate?.image_url);
  const official = rest.filter((c) => c.kind === 'official' || c.kind === 'concept_art');
  const painted = rest.filter((c) => c.kind !== 'official' && c.kind !== 'concept_art');
  const videos = dedupeVideos(data.videos);
  const visible = (list: Candidate[]) => dedupe(list).filter((c) => !broken.has(c.image_url));
  const grid = (list: Candidate[], withReasons: boolean) => (
    <div className="wsi-grid">
      {visible(list).map((c) => (
        <CandidateCard key={c.image_url} c={c} reasons={withReasons} saved={data.saved.has(c.image_url)}
          on={selected.has(c.image_url)} cover={cover === c.image_url}
          onToggle={(on) => toggle(c, on)} onCover={() => { setCover(c.image_url); toggle(c, true); }}
          onBroken={() => setBroken((cur) => new Set(cur).add(c.image_url))}
          proxy={app.ai.imageProxyUrl(c.image_url)} fallback={c.thumbnail_url ? app.ai.imageProxyUrl(c.thumbnail_url) : null} />
      ))}
    </div>
  );

  return (
    <div className="wsi">
      <div className="ws-toolbar">
        <div>{phase && <p className="small wsi-phase">{phase}</p>}</div>
        <div className="ws-toolbar-actions">
          <ImagePicker onPick={(f) => cmdRun((c) => c.setSubjectImage(s.id, f, f.name))}>Last opp bilde</ImagePicker>
          <Button variant="primary" disabled={running} onClick={() => startImageHunt(app, s, game, referenceFileId)}
            title={`Agenten finner først det beste offisielle bildet (utgiver, Kickstarter eller Gamefound, BoardGameGeek), og leter så bredt etter malte versjoner og malevideoer, på flere språk.`}>
            {running ? 'Agenten leter …' : data.suggested.length ? 'Let etter flere' : 'Let etter bilder med AI'}
          </Button>
        </div>
      </div>
      <ErrorNote error={localError ?? error} onClose={() => { setLocalError(null); clearError(); }} />

      {anchor && (
        <section className="wsi-section">
          <div className="wsi-section-head">
            <h3 title="Det beste offisielle bildet agenten fant og kontrollerte. Resten av jakten er sammenlignet med det.">Offisielt bilde</h3>
          </div>
          {anchorCandidate ? (
            <div className="wsi-anchor">
              <CandidateCard c={anchorCandidate} reasons={false} saved={data.saved.has(anchorCandidate.image_url)}
                on={selected.has(anchorCandidate.image_url)} cover={cover === anchorCandidate.image_url}
                onToggle={(on) => toggle(anchorCandidate, on)} onCover={() => { setCover(anchorCandidate.image_url); toggle(anchorCandidate, true); }}
                onBroken={() => {}}
                proxy={app.ai.imageProxyUrl(anchorCandidate.image_url)} fallback={anchorCandidate.thumbnail_url ? app.ai.imageProxyUrl(anchorCandidate.thumbnail_url) : null} />
              <div className="wsi-anchor-text" title={anchor.anchor.why ?? undefined}>
                {anchor.anchor.painter && <p><strong>Malt av {anchor.anchor.painter}</strong></p>}
                {anchor.anchor.description && <p>{anchor.anchor.description}</p>}
                {anchor.anchor.page_url && <a className="small" href={anchor.anchor.page_url} target="_blank" rel="noreferrer">{anchor.anchor.site || anchor.anchor.page_title} ↗</a>}
              </div>
            </div>
          ) : (
            <p className="small muted" title={anchor.anchor.why ?? undefined}>Fant ikke et offisielt bilde.</p>
          )}
        </section>
      )}

      {rest.length > 0 && (
        <section className="wsi-section">
          <div className="wsi-section-head">
            <h3>Forslag</h3>
            <button type="button" className="link small" onClick={() => data.proposals.forEach((p) => cmdRun(() => app.research.rejectProposal(p.id)))}>Forkast</button>
          </div>
          {official.length > 0 && painted.length > 0 && <h4 className="wsi-sub">Offisielle og konsept</h4>}
          {official.length > 0 && grid(official, true)}
          {official.length > 0 && painted.length > 0 && <h4 className="wsi-sub">Malt av andre</h4>}
          {painted.length > 0 && grid(painted, true)}
        </section>
      )}

      {videos.length > 0 && (
        <section className="wsi-section">
          <div className="wsi-section-head">
            <h3 title="Agenten kan ikke se videoene. Tittel og kanal er hentet fra YouTube.">Videoer</h3>
          </div>
          <ul className="wsi-videos">
            {videos.map((v) => (
              <VideoCard key={v.video_id} v={v} saved={data.savedVideos.has(v.url)} proxy={v.thumbnail_url ? app.ai.imageProxyUrl(v.thumbnail_url) : null}
                onSave={() => cmdRun((c) => c.saveVideoSource(s.id, v))} />
            ))}
          </ul>
        </section>
      )}

      {livePages.length > 0 && (
        <section className="wsi-section">
          <div className="wsi-section-head">
            <h3 title="Bilder rett fra sidene, uten agentens vurdering">{running ? 'Sidene agenten leser' : 'Sidene agenten leste'}</h3>
          </div>
          {livePages.map((p) => (
            <details key={p.url} className="wsi-page" open={livePages.length <= 2}>
              <summary>
                <strong>{p.title}</strong>
                <span className="small muted"> · {visible(p.candidates).length}</span>
                {!p.search && <a className="small" href={p.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}> ↗</a>}
              </summary>
              {grid(p.candidates, false)}
            </details>
          ))}
        </section>
      )}

      {browseUrl && (
        <section className="wsi-section">
          <div className="wsi-section-head">
            <h3>{page?.title ?? 'Leser …'}</h3>
            <button type="button" className="link small" onClick={() => setBrowseUrl(null)}>Lukk</button>
          </div>
          {page && grid(page.candidates, false)}
        </section>
      )}

      {!data.suggested.length && !videos.length && !anchor && !livePages.length && !browseUrl && (
        <div className="ws-empty">
          <p>Ingen bilder å velge mellom ennå.</p>
        </div>
      )}

      {selected.size > 0 && (
        <div className="ws-savebar">
          <span>{selected.size} valgt{cover ? ` · illustrasjon: ${selected.get(cover)?.caption ?? 'valgt bilde'}` : ''}</span>
          <span className="ws-savebar-actions">
            <Button onClick={() => { setSelected(new Map()); setCover(null); }}>Fjern valg</Button>
            <Button variant="primary" onClick={save} disabled={busy === 'save'}>{busy === 'save' ? 'Henter og lagrer …' : `Lagre ${selected.size} ${selected.size === 1 ? 'bilde' : 'bilder'}`}</Button>
          </span>
        </div>
      )}
    </div>
  );
}

function dedupeVideos(list: VideoRef[]): VideoRef[] {
  const seen = new Set<string>();
  return list.filter((v) => !seen.has(v.video_id) && !!seen.add(v.video_id));
}

function VideoCard({ v, saved, proxy, onSave }: { v: VideoRef; saved: boolean; proxy: string | null; onSave: () => void }) {
  return (
    <li className="wsi-video">
      <a href={v.url} target="_blank" rel="noreferrer" className="wsi-video-thumb" aria-label={`Se «${v.title}» på YouTube`}>
        {proxy ? <img src={proxy} alt="" loading="lazy" /> : <span className="small muted">YouTube</span>}
        <span className="wsi-play" aria-hidden>▶</span>
      </a>
      <div className="wsi-meta">
        <a className="wsi-video-title" href={v.url} target="_blank" rel="noreferrer" title={v.why ?? undefined}>{v.title}</a>
        <span className="wsi-video-actions">
          {v.channel && <span className="small muted">{v.channel}</span>}
          {saved ? <span className="small muted">Lagret</span> : <button type="button" className="link small" onClick={onSave}>Lagre</button>}
        </span>
      </div>
    </li>
  );
}

function dedupe(list: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return list.filter((c) => !seen.has(c.image_url) && !!seen.add(c.image_url));
}

function CandidateCard({ c, reasons, saved, on, cover, onToggle, onCover, onBroken, proxy, fallback = null }: {
  c: Candidate; reasons: boolean; saved: boolean; on: boolean; cover: boolean;
  onToggle: (on: boolean) => void; onCover: () => void; onBroken: () => void; proxy: string; fallback?: string | null;
}) {
  // The original may be blocked; an image search's small copy usually loads.
  const [src, setSrc] = useState(proxy);
  const failed = () => { if (fallback && src !== fallback) setSrc(fallback); else onBroken(); };
  // Cards straight from a page show only the picture; the agent's suggestions also show why.
  const meta = (reasons && (c.reason || c.caption)) || (on && !saved);
  return (
    <div className={`wsi-card ${on ? 'on' : ''} ${saved ? 'saved' : ''}`}>
      <button type="button" className="wsi-pic" onClick={() => !saved && onToggle(!on)} aria-pressed={on} disabled={saved}>
        <img src={src} alt={c.caption ?? ''} title={reasons ? undefined : [c.caption, c.site].filter(Boolean).join(' · ') || undefined} loading="lazy" onError={failed}
          onLoad={(e) => { if (e.currentTarget.naturalWidth < 100 || e.currentTarget.naturalHeight < 100) failed(); }} />
        {saved && <span className="ws-badge">Lagret</span>}
        {on && <span className="wsi-check" aria-hidden>✓</span>}
      </button>
      {meta && <div className="wsi-meta">
        {reasons && c.reason
          ? <span className="small wsi-reason" title={c.caption ?? undefined}>
              {c.confidence && c.confidence !== 'high' && <span className={`wsi-conf ${c.confidence}`}>{CONFIDENCE[c.confidence]}. </span>}{c.reason}
            </span>
          : reasons && c.caption && <span className="small">{c.caption}</span>}
        <span className="wsi-card-foot">
          {reasons && <a className="small muted" href={c.page_url} target="_blank" rel="noreferrer" title={c.page_title}>{c.creator ?? c.site} ↗</a>}
          {on && !saved && (
            <label className="wsi-cover">
              <input type="radio" checked={cover} onChange={onCover} /> Illustrasjon
            </label>
          )}
        </span>
      </div>}
    </div>
  );
}
