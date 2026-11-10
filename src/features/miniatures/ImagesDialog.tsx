/**
 * Bilder for én miniatyr. Three ways in, one place to choose:
 * - «Let med AI»: a focused research turn; results arrive as a reference_selection proposal.
 * - «Fra lagrede kilder»: the user opens a source already saved for this game and picks images (no agent).
 * - «Last opp»: the user's own file.
 * The user ticks the images to keep and picks one as the illustration. Nothing is stored before «Lagre».
 */
import { useMemo, useRef, useState } from 'react';
import { useApp, useCommand, useView } from '../../app/context';
import { buildAgentContext, knownSources } from '../../domain/agent';
import type { ImageKind, ReferenceImage, ReferenceSelectionPayload } from '../../domain/agent';
import type { ResearchEvent } from '../../domain/ai';
import type { Id, Tables } from '../../domain/types';
import { subjectReferences } from '../../domain/views';
import { runAgentTurn } from '../../data/agent-runner';
import { IMAGE_KIND_LABEL } from '../../data/images-tx';
import { Badge, Button, Dialog, ErrorNote, FileImage, ImagePicker, Segmented } from '../../ui/components';
import { LiveSteps, useAgentActions } from '../agent/AgentPanel';
import './images.css';

type Tab = 'ai' | 'sources' | 'upload';

interface Candidate extends ReferenceImage {
  /** Set when the candidate comes from an agent proposal. */
  proposal_id: Id | null;
}

/**
 * The miniature's current illustration, scaled to at most 512 px, as a JPEG data URL.
 * The agent compares candidates against it. Vector placeholders are skipped.
 */
async function referenceImage(app: ReturnType<typeof useApp>, file_id: Id | null): Promise<string | null> {
  if (!file_id) return null;
  const f = app.store.getTables().stored_file[file_id];
  if (!f || !/^image\/(jpeg|png|webp|gif)/.test(f.media_type)) return null;
  try {
    const url = await app.cmd.getFileUrl(file_id);
    if (!url) return null;
    const bmp = await createImageBitmap(await (await fetch(url)).blob());
    const scale = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch {
    return null;
  }
}

function view(t: Tables, subject_id: Id, project_id: Id) {
  const s = t.miniature_subject[subject_id];
  if (!s) return null;
  const game = t.game[t.project[s.project_id]?.game_id ?? '']?.primary_name ?? '';
  const saved = subjectReferences(t, s).map((r) => ({ ...r, cover: r.asset.id === s.official_asset_id }));
  const savedUrls = new Set(saved.map((r) => r.asset.locator).filter(Boolean));
  const openTasks = new Set(Object.values(t.research_task).filter((x) => x.status === 'open' && t.task_scope[x.id]?.work_project_id === project_id).map((x) => x.id));
  const proposals = Object.values(t.research_proposal)
    .filter((p) => p.decision === 'pending' && p.result_type === 'reference_selection' && openTasks.has(p.task_id)
      && (p.payload as ReferenceSelectionPayload).subject_id === subject_id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const fromAgent: Candidate[] = proposals.flatMap((p) => (p.payload as ReferenceSelectionPayload).images.map((i) => ({ ...i, proposal_id: p.id })));
  const read = proposals.flatMap((p) => (p.payload as ReferenceSelectionPayload).sources_read ?? []);
  return { s, game, saved, savedUrls, proposals, fromAgent, read, sources: knownSources(t, project_id) };
}

export function ImagesDialog({ subjectId, projectId, onClose }: { subjectId: Id; projectId: Id; onClose: () => void }) {
  const app = useApp();
  const { run, error, clearError } = useCommand();
  const data = useView((t) => view(t, subjectId, projectId), [subjectId, projectId]);
  const actions = useAgentActions(projectId);
  const [tab, setTab] = useState<Tab>('ai');
  const [busy, setBusy] = useState<null | 'ai' | 'page' | 'save'>(null);
  const [live, setLive] = useState<ResearchEvent[]>([]);
  const [agentNote, setAgentNote] = useState<string | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [page, setPage] = useState<{ url: string; title: string; site: string; author: string | null; images: Candidate[] } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cover, setCover] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const candidates = useMemo(() => {
    if (!data) return [];
    const list = tab === 'sources' ? page?.images ?? [] : tab === 'ai' ? data.fromAgent : [];
    const seen = new Set<string>();
    return list.filter((c) => !seen.has(c.image_url) && seen.add(c.image_url));
  }, [data, tab, page]);

  if (!data) return null;
  const { s } = data;

  const toggle = (url: string, on: boolean) => {
    setSelected((cur) => {
      const n = new Set(cur);
      if (on) n.add(url); else n.delete(url);
      return n;
    });
    if (!on && cover === url) setCover(null);
  };

  const fail = (e: unknown) => setLocalError(e instanceof Error ? e.message : String(e));

  const searchWithAi = async () => {
    setBusy('ai'); setLive([]); setLocalError(null); setAgentNote(null);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const task = await actions.ensureTask();
      const refs = buildAgentContext(app.store.getTables(), task).subjectRefs;
      const ref = Object.entries(refs).find(([, id]) => id === s.id)?.[0] ?? s.name;
      const prompt = `Finn konseptillustrasjon og bilder av miniatyren «${s.name}» fra spillet «${data.game}». `
        + 'Gjør grundig research på flere språk og foreslå kandidater med begrunnelse; jeg vurderer bildene selv.';
      const reference = await referenceImage(app, data.saved.find((r) => r.cover)?.file_id ?? data.saved[0]?.file_id ?? null);
      await runAgentTurn({ store: app.store, research: app.research, agent: app.agent, ai: app.ai }, task, prompt,
        (e) => setLive((cur) => [...cur, e]), ac.signal,
        { kind: 'images', subject_ref: ref, subject_name: s.name, game: data.game, reference_image: reference });
      const last = Object.values(app.store.getTables().research_message)
        .filter((m) => m.task_id === task && m.role !== 'user')
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
      setAgentNote(last?.body ?? null);
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) fail(e);
    } finally {
      setBusy(null); abortRef.current = null;
    }
  };

  const openSource = async (url: string) => {
    setBusy('page'); setLocalError(null); setPage(null);
    try {
      const r = await app.ai.pageImages(url);
      setPage({
        ...r,
        images: r.images.map((i) => ({
          image_url: i.url, page_url: r.url, page_title: r.title, site: r.site, creator: r.author,
          caption: i.caption ?? (i.alt || null), kind: null, proposal_id: null,
        })),
      });
    } catch (e) { fail(e); } finally { setBusy(null); }
  };

  const save = async () => {
    setBusy('save'); setLocalError(null);
    try {
      const chosen = candidates.filter((c) => selected.has(c.image_url));
      const coverIsNew = !!cover && chosen.some((c) => c.image_url === cover);
      // Agent images: approve each proposal with the chosen subset (skjema §8).
      const byProposal = new Map<Id, Candidate[]>();
      for (const c of chosen) if (c.proposal_id) byProposal.set(c.proposal_id, [...(byProposal.get(c.proposal_id) ?? []), c]);
      for (const [pid, imgs] of byProposal) {
        await app.research.approveProposal(pid, {
          image_urls: imgs.map((i) => i.image_url),
          ...(coverIsNew && imgs.some((i) => i.image_url === cover) ? { cover_image_url: cover! } : {}),
        });
      }
      // Images from a source the user opened: the user's own command.
      const direct = chosen.filter((c) => !c.proposal_id);
      if (direct.length) {
        await app.cmd.attachWebImages(s.id, direct, coverIsNew && direct.some((c) => c.image_url === cover) ? cover! : undefined);
      }
      setSelected(new Set()); setCover(null);
    } catch (e) { fail(e); } finally { setBusy(null); }
  };

  const discardProposals = async () => {
    for (const p of data.proposals) await run(() => app.research.rejectProposal(p.id));
  };

  const coverLabel = cover ? candidates.find((c) => c.image_url === cover)?.caption ?? 'valgt bilde' : null;

  return (
    <Dialog
      open
      wide
      onClose={() => { abortRef.current?.abort(); onClose(); }}
      title={`Bilder for ${s.name}`}
      footer={<>
        {tab === 'ai' && data.proposals.length > 0 && (
          <Button variant="ghost" className="push-left" onClick={discardProposals} disabled={!!busy}>Forkast AI-forslagene</Button>
        )}
        <Button onClick={onClose}>Lukk</Button>
        <Button variant="primary" onClick={save} disabled={!!busy || selected.size === 0}>
          {busy === 'save' ? 'Henter og lagrer …' : `Lagre ${selected.size || ''} ${selected.size === 1 ? 'bilde' : 'bilder'}`.replace('  ', ' ')}
        </Button>
      </>}
    >
      <section className="img-saved">
        <h3 className="eyebrow">Lagret på miniatyren ({data.saved.length})</h3>
        {data.saved.length === 0 ? (
          <p className="small muted">Ingen bilder ennå. Let med AI, hent fra en lagret kilde eller last opp.</p>
        ) : (
          <div className="img-row">
            {data.saved.map((r) => (
              <figure key={r.asset.id} className={`img-saved-tile ${r.cover ? 'cover' : ''}`}>
                <FileImage fileId={r.file_id} alt={r.label} className="img-thumb" />
                {r.cover && <span className="img-cover-badge">Illustrasjon</span>}
                <figcaption>
                  <span className="small">{r.label}</span>
                  {r.asset.image_kind && <Badge>{IMAGE_KIND_LABEL[r.asset.image_kind]}</Badge>}
                  <span className="img-saved-actions">
                    {!r.cover && <button type="button" className="link small" onClick={() => run((c) => c.setSubjectCover(s.id, r.asset.id))}>Bruk som illustrasjon</button>}
                    <button type="button" className="link small" onClick={() => run((c) => c.detachSubjectImage(s.id, r.asset.id))}>Fjern</button>
                    {r.source.url && <a className="small" href={r.source.url} target="_blank" rel="noreferrer">Kilde ↗</a>}
                  </span>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </section>

      <Segmented
        label="Finn bilder"
        value={tab}
        onChange={(v) => { setTab(v); setSelected(new Set()); setCover(null); }}
        options={[{ value: 'ai', label: 'Let med AI' }, { value: 'sources', label: `Fra lagrede kilder (${data.sources.length})` }, { value: 'upload', label: 'Last opp' }]}
      />

      {tab === 'ai' && (
        <div className="img-ai">
          <div className="img-ai-row">
            <p className="small muted">
              Agenten leter etter konseptillustrasjon, offisielle bilder og malte eksempler av {s.name}, og ser først i kildene du har lagret for spillet.
            </p>
            <Button variant="primary" onClick={searchWithAi} disabled={!!busy}>{busy === 'ai' ? 'Leter …' : data.fromAgent.length ? 'Let etter flere' : 'Let etter bilder'}</Button>
          </div>
          {busy === 'ai' && <div className="img-live"><LiveSteps events={live} onStop={() => abortRef.current?.abort()} /></div>}
          {agentNote && busy !== 'ai' && <p className="img-note">{agentNote}</p>}
          {data.read.length > 0 && busy !== 'ai' && (
            <details className="img-read">
              <summary>Kilder agenten leste ({data.read.length})</summary>
              <ul>
                {data.read.map((r) => (
                  <li key={r.url}>
                    <a href={r.url} target="_blank" rel="noreferrer">{r.title}</a>
                    <span className="small muted"> · {r.site}{r.language ? ` · ${languageName(r.language)}` : ''}</span>
                    {r.summary && <p className="small">{r.summary}</p>}
                    {r.original_excerpt && <p className="small muted img-orig" lang={r.language ?? undefined}>{r.original_excerpt}</p>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {tab === 'sources' && (
        <div className="img-sources">
          {data.sources.length === 0 ? (
            <p className="small muted">Ingen kilder er lagret for dette spillet ennå. Når du lagrer bilder fra en side, dukker siden opp her for de andre miniatyrene.</p>
          ) : (
            <ul>
              {data.sources.map((k) => (
                <li key={k.source.id}>
                  <button type="button" className={page?.url === k.source.url ? 'on' : ''} onClick={() => openSource(k.source.url!)} disabled={!!busy}>
                    <strong>{k.source.title}</strong>
                    <span className="small muted">{k.source.creator ?? ''} · {k.asset_count} lagret</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {busy === 'page' && <p className="small muted">Leser siden …</p>}
          {page && <p className="small muted">{page.images.length} bilder på <a href={page.url} target="_blank" rel="noreferrer">{page.title}</a></p>}
        </div>
      )}

      {tab === 'upload' && (
        <div className="img-upload">
          <p className="small muted">Ditt eget bilde blir illustrasjon for miniatyren.</p>
          <ImagePicker variant="primary" onPick={(f) => run((c) => c.setSubjectImage(s.id, f, f.name))}>Velg bilde</ImagePicker>
        </div>
      )}

      {candidates.length > 0 && (
        <section className="img-candidates">
          <div className="img-cand-head">
            <h3 className="eyebrow">Velg bilder ({selected.size} valgt{coverLabel ? ` · illustrasjon: ${coverLabel}` : ''})</h3>
            <button type="button" className="link small" onClick={() => setSelected(new Set(candidates.filter((c) => !data.savedUrls.has(c.image_url)).map((c) => c.image_url)))}>Velg alle</button>
          </div>
          <div className="img-grid">
            {candidates.map((c) => {
              const saved = data.savedUrls.has(c.image_url);
              const on = selected.has(c.image_url);
              return (
                <div key={c.image_url} className={`img-cand ${on ? 'on' : ''} ${saved ? 'saved' : ''}`}>
                  <button type="button" className="img-cand-pic" onClick={() => !saved && toggle(c.image_url, !on)} aria-pressed={on} disabled={saved}>
                    <img src={app.ai.imageProxyUrl(c.image_url)} alt={c.caption ?? ''} loading="lazy" />
                    {saved && <span className="img-cover-badge">Lagret</span>}
                    {on && <span className="img-check" aria-hidden>✓</span>}
                  </button>
                  <div className="img-cand-meta">
                    <span className="img-badges">
                      {c.confidence && <Badge tone={c.confidence === 'high' ? 'moss' : c.confidence === 'low' ? 'warn' : 'neutral'}>{CONFIDENCE[c.confidence]}</Badge>}
                      {c.kind && <Badge tone={c.kind === 'concept_art' ? 'dark' : 'neutral'}>{IMAGE_KIND_LABEL[c.kind as ImageKind]}</Badge>}
                    </span>
                    <span className="small">{c.caption ?? 'Uten bildetekst'}</span>
                    {c.reason && <span className="small img-reason">{c.reason}</span>}
                    {c.original_text && (
                      <details className="img-orig-toggle">
                        <summary className="small">Originaltekst{c.page_language ? ` (${languageName(c.page_language)})` : ''}</summary>
                        <p className="small muted img-orig" lang={c.page_language ?? undefined}>{c.original_text}</p>
                      </details>
                    )}
                    <a className="small muted" href={c.page_url} target="_blank" rel="noreferrer">{c.creator ?? c.site} ↗</a>
                    {!saved && (
                      <label className="img-cover-pick">
                        <input type="radio" name="cover" checked={cover === c.image_url} onChange={() => { setCover(c.image_url); toggle(c.image_url, true); }} />
                        Illustrasjon
                      </label>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <ErrorNote error={localError ?? error} onClose={() => { setLocalError(null); clearError(); }} />
    </Dialog>
  );
}

const CONFIDENCE = { high: 'Trolig riktig', medium: 'Mulig', low: 'Usikker' } as const;

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(['nb'], { type: 'language' }).of(code.split('-')[0]!) ?? code;
  } catch {
    return code;
  }
}
