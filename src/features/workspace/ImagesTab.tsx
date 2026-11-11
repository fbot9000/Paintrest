/**
 * Bilder: the agent's suggestions with reasons, images from pages the agent
 * is reading right now, images from a known source, and upload. The user
 * ticks images and picks one illustration; nothing is stored before «Lagre».
 */
import { useEffect, useMemo, useState } from 'react';
import { useApp, useCommand, useView } from '../../app/context';
import type { Run } from '../../app/runs';
import type { GuideRef, ReferenceImage, ReferenceSelectionPayload, VideoRef } from '../../domain/agent';
import type { Id, MiniatureSubject, SubjectIdentity, Tables } from '../../domain/types';
import { linkedSources, subjectReferences, suggestedSources } from '../../domain/views';
import { Badge, Button, ErrorNote, ImagePicker } from '../../ui/components';
import { startImageHunt, tagPage } from './agentRuns';
import { addPasted, removePasted, usePasted } from './pasted';
import { dataUrlToBlob, parsePasted } from './pasteLinks';

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
  const videos = proposals.flatMap((p) => (p.payload as ReferenceSelectionPayload).videos ?? []);
  const guides = proposals.flatMap((p) => (p.payload as ReferenceSelectionPayload).guides ?? []);
  const linked = new Set(Object.values(t.source_link).filter((l) => !l.deleted_at && l.target_type === 'subject' && l.target_id === s.id).map((l) => l.source_id));
  const savedVideos = new Set(Object.values(t.source).filter((x) => !x.deleted_at && x.kind === 'video' && linked.has(x.id) && x.url).map((x) => x.url!));
  const savedGuides = new Set(linkedSources(t, s.id, 'method').map((x) => x.url!));
  // Pages the user tagged as showing the figure («Viser figuren»).
  const tagged = new Set(linkedSources(t, s.id, 'evidence').map((x) => x.url!));
  // Pages a game survey found that probably show it («Trolig figuren»), not yet confirmed.
  const likely = new Set(suggestedSources(t, s.id).map((x) => x.url!));
  return { proposals, suggested, saved, read, videos, savedVideos, guides, savedGuides, tagged, likely };
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
      removePasted(s.id, chosen.map((c) => c.image_url));
      setSelected(new Map()); setCover(null);
    } catch (e) {
      const pastedFailed = [...selected.values()].some((c) => pasted.some((p) => p.image_url === c.image_url));
      setLocalError((e instanceof Error ? e.message : String(e))
        + (pastedFailed ? ' Stenger nettstedet for lenken (vanlig på Instagram og Facebook), høyreklikk bildet i Google og velg «Kopier bilde», og lim det inn i stedet.' : ''));
    } finally {
      setBusy(null);
    }
  };

  const pasted = usePasted(s.id);
  const [pasteText, setPasteText] = useState('');

  // What the user pastes from Google Images: pictures are saved at once, image links become
  // candidates (already ticked), and a page link opens that page's pictures.
  const takePaste = async (files: File[], text: string) => {
    setLocalError(null);
    const images = files.filter((f) => f.type.startsWith('image/'));
    const items = images.length ? [] : parsePasted(text.replace(/&amp;/g, '&'));
    const datas = items.flatMap((i) => (i.kind === 'data' ? [i.data_url] : []));
    const blobs = [...images.map((f) => ({ blob: f as Blob, title: f.name && f.name !== 'image.png' ? f.name : null })),
      ...(await Promise.all(datas.map(async (d) => ({ blob: await dataUrlToBlob(d), title: null }))))];
    if (blobs.length) await cmdRun((c) => c.addSubjectImages(s.id, blobs));
    const links = items.flatMap((i): Candidate[] => (i.kind === 'image' ? [{
      image_url: i.image_url, page_url: i.page_url ?? i.image_url, page_title: hostOf(i.page_url ?? i.image_url), site: hostOf(i.page_url ?? i.image_url),
      creator: null, caption: null, kind: null, proposal_id: null,
    }] : []));
    if (links.length) {
      addPasted(s.id, links);
      setSelected((cur) => { const n = new Map(cur); links.forEach((c) => n.set(c.image_url, c)); return n; });
    }
    const page = items.find((i) => i.kind === 'page');
    if (page && page.kind === 'page') setBrowseUrl(page.url);
    if (!blobs.length && !links.length && !page) setLocalError('Fant ingen bilder eller lenker i det du limte inn.');
  };

  // Paste anywhere on the tab (not while typing in another field).
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !el.classList.contains('wsi-paste')))) return;
      if (el?.classList.contains('wsi-paste')) return; // handled by the field itself
      e.preventDefault();
      void takePaste([...(e.clipboardData?.files ?? [])], `${e.clipboardData?.getData('text/plain') ?? ''}\n${e.clipboardData?.getData('text/html') ?? ''}`);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  });

  const running = run?.status === 'running';
  // While the hunt runs, the identification and phase arrive as events; afterwards the identification is on the miniature.
  const liveIdentity = running ? run!.events.flatMap((e) => (e.type === 'identity' ? [e.identity] : [])).at(-1) ?? null : null;
  const phase = running ? run!.events.flatMap((e) => (e.type === 'phase' ? [e.text] : [])).at(-1) ?? null : null;
  const identity: SubjectIdentity | null = liveIdentity ?? s.identity ?? null;
  const status = liveIdentity ? 'live' as const : s.identity?.status ?? null;
  // The official pictures can be saved like the others; through the hunt's proposal when they are in it.
  const allIdCandidates: Candidate[] = (identity?.images ?? []).map((i) => {
    const inProposal = data.suggested.find((x) => x.image_url === i.image_url);
    return {
      image_url: i.image_url, page_url: i.page_url, page_title: i.page_title ?? i.page_url, site: i.site ?? hostOf(i.page_url), creator: identity?.painter ?? null,
      caption: `${i.kind === 'concept_art' ? 'Konseptkunst' : i.kind === 'render' ? 'Render' : 'Offisielt bilde'} av ${identity?.official_name ?? s.name}`,
      kind: i.kind === 'concept_art' ? 'concept_art' : 'official', proposal_id: inProposal?.proposal_id ?? null,
      thumbnail_url: i.thumbnail_url ?? inProposal?.thumbnail_url ?? null,
    };
  });
  const idUrls = new Set(allIdCandidates.map((c) => c.image_url));
  // A picture that does not load is left out, as elsewhere on the tab.
  const idCandidates = allIdCandidates.filter((c) => !broken.has(c.image_url));
  const rest = dedupe(data.suggested).filter((c) => !idUrls.has(c.image_url));
  const guides = dedupeGuides(data.guides);
  const tag = (page: { url: string; title: string }, on: boolean) => cmdRun(() => tagPage(app, s.id, page, on));
  // The page being browsed may have moved (redirect); a tag on either address counts.
  const marked = (u: string) => data.tagged.has(u) || data.likely.has(u);
  const browseTagged = page && marked(page.url) ? page.url : browseUrl && marked(browseUrl) ? browseUrl : null;
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
          <input className="wsi-paste" value={pasteText} placeholder="Lim inn bilde eller lenke fra Google Bilder"
            aria-label="Lim inn bilde eller bildelenke"
            onChange={(e) => setPasteText(e.target.value)}
            onPaste={(e) => {
              e.preventDefault();
              void takePaste([...e.clipboardData.files], `${e.clipboardData.getData('text/plain')}\n${e.clipboardData.getData('text/html')}`);
            }}
            onKeyDown={(e) => { if (e.key === 'Enter' && pasteText.trim()) { void takePaste([], pasteText); setPasteText(''); } }} />
          <ImagePicker onPick={(f) => cmdRun((c) => c.setSubjectImage(s.id, f, f.name))}>Last opp</ImagePicker>
          <Button variant="primary" disabled={running} onClick={() => startImageHunt(app, s, game, referenceFileId)}
            title={s.identity?.status === 'confirmed'
              ? 'Figuren er bekreftet, så agenten går rett på bilder fra andre som har malt den, og så på maleguider og videoer.'
              : 'Agenten finner først ut hvilken figur det er (offisielt navn, beskrivelse og konseptkunst), leter så bredt etter malte versjoner på flere språk, og til slutt etter maleguider og videoer.'}>
            {running ? 'Agenten leter …' : data.suggested.length ? 'Let etter flere' : 'Let etter bilder med AI'}
          </Button>
        </div>
      </div>
      <ErrorNote error={localError ?? error} onClose={() => { setLocalError(null); clearError(); }} />

      {pasted.length > 0 && (
        <section className="wsi-section">
          <div className="wsi-section-head">
            <h3>Limt inn</h3>
            <button type="button" className="link small" onClick={() => {
              removePasted(s.id);
              setSelected((cur) => { const n = new Map(cur); pasted.forEach((p) => n.delete(p.image_url)); return n; });
            }}>Fjern</button>
          </div>
          {grid(pasted.map((p) => ({ ...p, proposal_id: null })), false)}
        </section>
      )}

      {identity && (
        <section className="wsi-section">
          <div className="wsi-section-head">
            <h3 title="Hvem figuren er: offisielt navn, beskrivelse og offisielle bilder. Agenten bruker dette i resten av jakten, og i maleplanen når du har bekreftet det.">Figuren</h3>
            {status === 'confirmed' ? <Badge tone="moss">Bekreftet av deg</Badge>
              : status === 'proposed' ? <Badge tone="neutral">Forslag fra agenten</Badge>
              : <span className="small muted">Agenten bruker dette videre i jakten</span>}
          </div>
          <div className={`wsi-id ${idCandidates.length ? '' : 'no-img'}`}>
            {idCandidates.length > 0 && <div className="wsi-id-images">
              {idCandidates.map((c) => (
                <CandidateCard key={c.image_url} c={c} reasons={false} saved={data.saved.has(c.image_url)}
                  on={selected.has(c.image_url)} cover={cover === c.image_url}
                  onToggle={(on) => toggle(c, on)} onCover={() => { setCover(c.image_url); toggle(c, true); }}
                  onBroken={() => setBroken((cur) => new Set(cur).add(c.image_url))}
                  proxy={app.ai.imageProxyUrl(c.image_url)} fallback={c.thumbnail_url ? app.ai.imageProxyUrl(c.thumbnail_url) : null} />
              ))}
            </div>}
            <div className="wsi-id-text" title={identity.why ?? undefined}>
              <p className="wsi-id-name"><strong>{identity.official_name ?? 'Navnet ble ikke funnet'}</strong>
                {identity.aliases.length > 0 && <span className="muted"> · også kalt {identity.aliases.join(', ')}</span>}</p>
              {(identity.edition || identity.faction) && <p className="small">{[identity.edition, identity.faction].filter(Boolean).join(' · ')}</p>}
              {identity.description && <p>{identity.description}</p>}
              {identity.painter && <p className="small">Offisielt malt av {identity.painter}</p>}
              {!allIdCandidates.length && <p className="small muted">Fant ikke offisielle bilder.</p>}
              {allIdCandidates.length > 0 && !idCandidates.length && (
                <p className="small muted">Det offisielle bildet kunne ikke vises. {allIdCandidates.map((c) => <a key={c.image_url} href={c.page_url} target="_blank" rel="noreferrer">Se det på {c.site} ↗</a>)}</p>
              )}
              {identity.sources.length > 0 && (
                <p className="small wsi-id-sources">
                  {identity.sources.slice(0, 4).map((x) => <a key={x.url} href={x.url} target="_blank" rel="noreferrer">{hostOf(x.url)} ↗</a>)}
                </p>
              )}
              {status === 'proposed' && (
                <span className="wsi-id-actions">
                  <Button variant="primary" onClick={() => cmdRun((c) => c.confirmIdentity(s.id))}
                    title="Agenten bygger på dette neste gang den leter etter bilder eller lager maleplan">Riktig figur</Button>
                  <Button onClick={() => cmdRun((c) => c.rejectIdentity(s.id))} title="Agenten velger ikke dette igjen">Feil figur</Button>
                </span>
              )}
              {status === 'confirmed' && (
                <button type="button" className="link small" onClick={() => cmdRun((c) => c.rejectIdentity(s.id))}
                  title="Fjerner identifiseringen. Neste jakt finner figuren på nytt, uten å velge dette igjen.">Feil figur</button>
              )}
            </div>
          </div>
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

      {guides.length > 0 && (
        <section className="wsi-section">
          <div className="wsi-section-head">
            <h3 title="Sider som forklarer hvordan figuren, fraksjonen eller spillet males. Lagrede guider leser agenten først når den lager maleplan.">Maleguider</h3>
          </div>
          <ul className="wsi-guides">
            {guides.map((g) => (
              <li key={g.url} className="wsi-guide">
                <a className="wsi-guide-title" href={g.url} target="_blank" rel="noreferrer">{g.title}</a>
                <span className="small muted">{g.site}{g.language ? ` · ${g.language}` : ''}{g.read ? '' : ' · bare sett i søk'}</span>
                {g.why && <span className="small">{g.why}</span>}
                {g.paints.length > 0 && <span className="wsi-guide-paints">{g.paints.slice(0, 10).map((p) => <span key={p} className="wsi-paint">{p}</span>)}</span>}
                <span className="wsi-video-actions">
                  {data.savedGuides.has(g.url) ? <span className="small muted">Lagret</span>
                    : <button type="button" className="link small" onClick={() => cmdRun((c) => c.saveGuideSource(s.id, { url: g.url, title: g.title, site: g.site }))}>Lagre</button>}
                </span>
              </li>
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
                {!p.search && <TagButton state={tagState(data, p.url)} onToggle={(on) => tag({ url: p.url, title: p.title }, on)} />}
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
            <span className="wsi-head-actions">
              <TagButton state={browseTagged ? tagState(data, browseTagged) : 'off'} onToggle={(on) => tag({ url: browseTagged ?? browseUrl, title: page?.title ?? browseUrl }, on)} />
              <button type="button" className="link small" onClick={() => setBrowseUrl(null)}>Lukk</button>
            </span>
          </div>
          {page && grid(page.candidates, false)}
        </section>
      )}

      {!data.suggested.length && !videos.length && !guides.length && !identity && !livePages.length && !browseUrl && !pasted.length && (
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

function hostOf(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; }
}

function dedupeGuides(list: GuideRef[]): GuideRef[] {
  const seen = new Set<string>();
  return list.filter((g) => !seen.has(g.url) && !!seen.add(g.url));
}

export type TagState = 'on' | 'likely' | 'off';

/** Tagged by the user, suggested by a game survey («Trolig figuren»), or neither. */
export function tagState(d: { tagged: Set<string>; likely: Set<string> }, url: string): TagState {
  return d.tagged.has(url) ? 'on' : d.likely.has(url) ? 'likely' : 'off';
}

/**
 * «Viser figuren»: the user tags a page as showing the miniature; a running hunt hears about it at once.
 * A page the game survey suggested shows «Trolig figuren»: one click confirms it, × says it does not.
 */
export function TagButton({ state, onToggle }: { state: TagState; onToggle: (on: boolean) => void }) {
  const click = (on: boolean) => (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); onToggle(on); };
  if (state === 'likely') {
    return (
      <span className="wsi-tag-likely">
        <button type="button" className="wsi-tag likely" onClick={click(true)}
          title="Kartleggingen av spillet mener at siden viser figuren. Trykk for å bekrefte.">Trolig figuren</button>
        <button type="button" className="wsi-tag-x" onClick={click(false)} aria-label="Viser ikke figuren" title="Siden viser ikke figuren">×</button>
      </span>
    );
  }
  const on = state === 'on';
  return (
    <button type="button" className={`wsi-tag ${on ? 'on' : ''}`} aria-pressed={on}
      title={on ? 'Du har merket at siden viser figuren. Trykk for å fjerne merket.' : 'Merk at siden viser figuren. Agenten åpner merkede sider først, også mens den jobber.'}
      onClick={click(!on)}>
      {on ? '✓ Viser figuren' : 'Viser figuren?'}
    </button>
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
