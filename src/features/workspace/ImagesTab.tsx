/**
 * Bilder: the agent's suggestions with reasons, images from pages the agent
 * is reading right now, images from a known source, and upload. The user
 * ticks images and picks one illustration; nothing is stored before «Lagre».
 */
import { useEffect, useMemo, useState } from 'react';
import { useApp, useCommand, useView } from '../../app/context';
import type { Run } from '../../app/runs';
import type { ImageKind, ReferenceImage, ReferenceSelectionPayload } from '../../domain/agent';
import type { Id, MiniatureSubject, Tables } from '../../domain/types';
import { subjectReferences } from '../../domain/views';
import { IMAGE_KIND_LABEL } from '../../data/images-tx';
import { Badge, Button, ErrorNote, ImagePicker } from '../../ui/components';
import { startImageHunt } from './agentRuns';
import { languageName } from './Workspace';

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
  return { proposals, suggested, saved, read };
}

export function ImagesTab({ subject: s, game, run, browseUrl, setBrowseUrl, referenceFileId }: {
  subject: MiniatureSubject; game: string; run: Run | null; browseUrl: string | null; setBrowseUrl: (u: string | null) => void; referenceFileId: Id | null;
}) {
  const app = useApp();
  const { run: cmdRun, error, clearError } = useCommand();
  const data = useView((t) => view(t, s), [s]);
  const [selected, setSelected] = useState<Map<string, Candidate>>(new Map());
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
      image_url: i.url, page_url: p.url, page_title: p.title, site: p.site, creator: p.author,
      caption: i.caption ?? (i.alt || null), original_text: i.context, page_language: p.language, kind: null, proposal_id: null,
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
  const grid = (list: Candidate[], withReasons: boolean) => (
    <div className="wsi-grid">
      {dedupe(list).map((c) => (
        <CandidateCard key={c.image_url} c={c} reasons={withReasons} saved={data.saved.has(c.image_url)}
          on={selected.has(c.image_url)} cover={cover === c.image_url}
          onToggle={(on) => toggle(c, on)} onCover={() => { setCover(c.image_url); toggle(c, true); }}
          proxy={app.ai.imageProxyUrl(c.image_url)} />
      ))}
    </div>
  );

  return (
    <div className="wsi">
      <div className="ws-toolbar">
        <div>
          <h2>Bilder</h2>
          <p className="small muted">Agenten leter etter konseptillustrasjon, offisielle bilder og malte eksempler av {s.name}, på flere språk, og ser først i kildene for spillet.</p>
        </div>
        <div className="ws-toolbar-actions">
          <ImagePicker onPick={(f) => cmdRun((c) => c.setSubjectImage(s.id, f, f.name))}>Last opp bilde</ImagePicker>
          <Button variant="primary" disabled={running} onClick={() => startImageHunt(app, s, game, referenceFileId)}>
            {running ? 'Agenten leter …' : data.suggested.length ? 'Let etter flere' : 'Let etter bilder med AI'}
          </Button>
        </div>
      </div>
      <ErrorNote error={localError ?? error} onClose={() => { setLocalError(null); clearError(); }} />

      {data.suggested.length > 0 && (
        <section className="wsi-section">
          <div className="wsi-section-head">
            <h3>Agentens forslag ({dedupe(data.suggested).length})</h3>
            <button type="button" className="link small" onClick={() => data.proposals.forEach((p) => cmdRun(() => app.research.rejectProposal(p.id)))}>Forkast forslagene</button>
          </div>
          {grid(data.suggested, true)}
        </section>
      )}

      {livePages.length > 0 && (
        <section className="wsi-section">
          <div className="wsi-section-head">
            <h3>{running ? 'Sider agenten leser nå' : 'Sider agenten leste'} ({livePages.length})</h3>
            <span className="small muted">Bilder rett fra sidene, uten agentens vurdering. Du kan velge med en gang.</span>
          </div>
          {livePages.map((p) => (
            <details key={p.url} className="wsi-page" open={livePages.length <= 2}>
              <summary>
                <strong>{p.title}</strong>
                <span className="small muted"> · {p.site}{p.language ? ` · ${languageName(p.language)}` : ''} · {p.candidates.length} bilder</span>
                <a className="small" href={p.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}> ↗</a>
              </summary>
              {grid(p.candidates, false)}
            </details>
          ))}
        </section>
      )}

      {browseUrl && (
        <section className="wsi-section">
          <div className="wsi-section-head">
            <h3>Fra kilde: {page?.title ?? 'leser …'}</h3>
            <button type="button" className="link small" onClick={() => setBrowseUrl(null)}>Lukk kilden</button>
          </div>
          {busy === 'page' && <p className="small muted">Leser siden …</p>}
          {page && grid(page.candidates, false)}
        </section>
      )}

      {!data.suggested.length && !livePages.length && !browseUrl && (
        <div className="ws-empty">
          <p>Ingen kandidater ennå.</p>
          <p className="small muted">Trykk «Let etter bilder med AI», velg en kilde i kolonnen til høyre, eller last opp et bilde.</p>
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

function dedupe(list: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return list.filter((c) => !seen.has(c.image_url) && !!seen.add(c.image_url));
}

function CandidateCard({ c, reasons, saved, on, cover, onToggle, onCover, proxy }: {
  c: Candidate; reasons: boolean; saved: boolean; on: boolean; cover: boolean;
  onToggle: (on: boolean) => void; onCover: () => void; proxy: string;
}) {
  return (
    <div className={`wsi-card ${on ? 'on' : ''} ${saved ? 'saved' : ''}`}>
      <button type="button" className="wsi-pic" onClick={() => !saved && onToggle(!on)} aria-pressed={on} disabled={saved}>
        <img src={proxy} alt={c.caption ?? ''} loading="lazy" />
        {saved && <span className="ws-badge">Lagret</span>}
        {on && <span className="wsi-check" aria-hidden>✓</span>}
      </button>
      <div className="wsi-meta">
        {reasons && (
          <span className="wsi-badges">
            {c.confidence && <Badge tone={c.confidence === 'high' ? 'moss' : c.confidence === 'low' ? 'warn' : 'neutral'}>{CONFIDENCE[c.confidence]}</Badge>}
            {c.kind && <Badge tone={c.kind === 'concept_art' ? 'dark' : 'neutral'}>{IMAGE_KIND_LABEL[c.kind as ImageKind]}</Badge>}
          </span>
        )}
        {c.caption && <span className="small">{c.caption}</span>}
        {reasons && c.reason && <span className="small wsi-reason">{c.reason}</span>}
        {c.original_text && (
          <details className="wsi-orig">
            <summary className="small">{reasons ? 'Originaltekst' : 'Tekst rundt bildet'}{c.page_language ? ` (${languageName(c.page_language)})` : ''}</summary>
            <p className="small muted" lang={c.page_language ?? undefined}>{c.original_text}</p>
          </details>
        )}
        <a className="small muted" href={c.page_url} target="_blank" rel="noreferrer">{c.creator ?? c.site} ↗</a>
        {!saved && (
          <label className="wsi-cover">
            <input type="radio" checked={cover} onChange={onCover} /> Illustrasjon
          </label>
        )}
      </div>
    </div>
  );
}
