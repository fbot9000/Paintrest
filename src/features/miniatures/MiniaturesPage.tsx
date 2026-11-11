import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useApp, useCommand, useView } from '../../app/context';
import type { SubjectPatch } from '../../domain/commands';
import type { Expansion, Grouping, Id, MiniatureSubject, Tables } from '../../domain/types';
import type { CatalogSubjectPayload, ReferenceSelectionPayload } from '../../domain/agent';
import type { Evidence, ResearchProposal } from '../../domain/types';
import { assetFileId, attachedExpansions, deletedSubjects, liveSubjects, physicalStatus } from '../../domain/views';
import type { PhysicalStatus } from '../../domain/views';
import { Badge, Button, Dialog, ErrorNote, Field, FileImage, ImagePicker, Segmented, Stepper } from '../../ui/components';
import { runs, useRuns } from '../../app/runs';
import type { Run } from '../../app/runs';
import { LiveSteps } from '../agent/AgentPanel';
import { startGameSurvey, surveyRefs } from '../workspace/agentRuns';
import { reviewQueue } from '../../domain/review';
import type { ReviewItem } from '../../domain/review';
import './miniatures.css';

/** Miniatures the game survey found missing from the list, waiting for the user. */
function missingMiniatures(t: Tables, project_id: Id) {
  const surveys = new Set(Object.values(t.research_task).filter((x) => x.status === 'open' && t.task_scope[x.id]?.work_project_id === project_id && t.task_scope[x.id]?.game_focus).map((x) => x.id));
  const attached = new Set(attachedExpansions(t, project_id).map((e) => e.name.trim().toLowerCase()));
  return Object.values(t.research_proposal)
    .filter((p) => p.decision === 'pending' && p.result_type === 'catalog_subject' && surveys.has(p.task_id))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((p) => {
      const c = p.payload as CatalogSubjectPayload;
      return { p, c, unknownExpansion: !!c.expansion_name && !attached.has(c.expansion_name.trim().toLowerCase()) };
    });
}

/** Pictures waiting in image proposals (image hunt or game survey), per miniature. */
function pendingImages(t: Tables, project_id: Id): Map<Id, number> {
  const open = new Set(Object.values(t.research_task).filter((x) => x.status === 'open' && t.task_scope[x.id]?.work_project_id === project_id).map((x) => x.id));
  const out = new Map<Id, number>();
  for (const p of Object.values(t.research_proposal)) {
    if (p.decision !== 'pending' || p.result_type !== 'reference_selection' || !open.has(p.task_id)) continue;
    const pl = p.payload as ReferenceSelectionPayload;
    out.set(pl.subject_id, (out.get(pl.subject_id) ?? 0) + pl.images.length);
  }
  return out;
}

type Filter = 'all' | 'base' | string;

export function MiniaturesPage() {
  const { projectId = '' } = useParams();
  const data = useView((t) => ({
    subjects: liveSubjects(t, projectId).map((s) => ({ s, status: physicalStatus(t, s), file: assetFileId(t, s.official_asset_id) })),
    expansions: attachedExpansions(t, projectId),
    deleted: deletedSubjects(t, projectId),
    game: t.game[t.project[projectId]?.game_id ?? '']?.primary_name ?? '',
    pending: pendingImages(t, projectId),
    missing: missingMiniatures(t, projectId),
    queue: reviewQueue(t, projectId),
  }), [projectId]);
  const app = useApp();
  const survey = useRuns((r) => r.get(projectId, 'game'));
  const surveying = survey?.status === 'running';
  // While the survey works: the miniatures it has identified so far.
  const identifiedNow = new Set(surveying ? survey!.events.flatMap((e) => (e.type === 'identity' && e.subject_ref ? [surveyRefs.get(projectId)?.[e.subject_ref]] : []))
    .filter((x): x is string => !!x) : []);
  const queueBy = new Map(data.queue.map((q) => [q.subject_id, q]));
  const startReview = (id?: Id) => {
    const first = id ?? data.queue[0]?.subject_id;
    if (first) navigate(`/p/${projectId}/m/${first}/bilder?gjennomgang=1`);
  };
  const { run, error, clearError } = useCommand();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const [onlyActive, setOnlyActive] = useState(false);
  const [editing, setEditing] = useState<MiniatureSubject | 'new' | null>(null);
  const working = useRuns((r) => new Set(r.active('images', 'plan').map((x) => x.id)));

  const shown = data.subjects.filter(({ s, status }) => {
    if (onlyActive && status !== 'in_progress') return false;
    if (filter === 'all') return true;
    if (filter === 'base') return !s.expansion_id;
    return s.expansion_id === filter;
  });
  const total = data.subjects.reduce((n, x) => n + x.s.physical_count, 0);
  const done = data.subjects.reduce((n, x) => n + x.s.finished_count, 0);
  const ready = data.subjects.filter((x) => x.s.plan_state === 'approved').length;

  return (
    <main className="page page-wide">
      <div className="page-head">
        <div>
          <h1>Miniatyrer</h1>
          <p className="muted">
            {data.subjects.length === 0
              ? 'Registrer figurer med bare et navn. Bilde, antall og maleplan kan fylles ut senere.'
              : <><strong className="mono">{done}/{total}</strong> figurer ferdigmalt · {ready} av {data.subjects.length} har maleplan</>}
          </p>
        </div>
        <div className="page-head-actions">
          {data.queue.length > 0 && !surveying && (
            <Button variant="primary" onClick={() => startReview()}
              title="Gå gjennom miniatyrene som har noe som venter på deg: bildeforslag, en identifisering å bekrefte, eller sider som trolig viser figuren. Én om gangen.">
              Gå gjennom forslag ({data.queue.length})
            </Button>
          )}
          {data.subjects.length > 0 && (
            <Button onClick={() => startGameSurvey(app, projectId, data.game)} disabled={surveying}
              title="Én kjøring for hele spillet: agenten finner de beste kildene (offisielle sider, gallerier med malte figurer og maleguider), finner ut hvem hver miniatyr er, og foreslår bilder til hver. Det lagres for spillet, så senere bildejakt og maleplaner bygger på det.">
              {surveying ? 'Kartlegger …' : '✦ Kartlegg spillet med AI'}
            </Button>
          )}
          <Button variant={data.queue.length > 0 && !surveying ? undefined : 'primary'} onClick={() => setEditing('new')} icon="+">Legg til miniatyr</Button>
        </div>
      </div>
      <ErrorNote error={error} onClose={clearError} />
      {survey && <SurveyPanel run={survey} missing={data.missing.length} queue={data.queue.length} onReview={() => startReview()} onStop={() => runs.stop(projectId, 'game')} onClose={() => runs.dismiss(projectId, 'game')} />}
      {data.missing.length > 0 && (
        <MissingList items={data.missing} imageUrl={(u) => app.ai.imageProxyUrl(u)}
          onAdd={(id) => run(() => app.research.approveProposal(id))}
          onReject={(id) => run(() => app.research.rejectProposal(id))}
          onAddAll={() => run(async () => { for (const m of data.missing) await app.research.approveProposal(m.p.id); })} />
      )}

      {data.subjects.length > 0 && (
        <div className="filters" role="toolbar" aria-label="Filtrer">
          <FilterChip on={filter === 'all'} onClick={() => setFilter('all')}>Alle</FilterChip>
          <FilterChip on={filter === 'base'} onClick={() => setFilter('base')}>Grunnspill</FilterChip>
          {data.expansions.map((e) => (
            <FilterChip key={e.id} on={filter === e.id} onClick={() => setFilter(e.id)}>{e.name}</FilterChip>
          ))}
          <span className="filters-sep" />
          <FilterChip on={onlyActive} onClick={() => setOnlyActive((v) => !v)}>Under arbeid</FilterChip>
        </div>
      )}

      {data.subjects.length === 0 ? (
        <div className="empty">
          <h2>Katalogen er tom</h2>
          <p className="muted">«Legg til miniatyr» lager «Ny miniatyr 1» hvis du ikke skriver et navn.</p>
        </div>
      ) : shown.length === 0 ? (
        <p className="muted">Ingen miniatyrer passer filteret.</p>
      ) : (
        <div className="mini-grid">
          {shown.map(({ s, status, file }) => (
            <MiniCard
              key={s.id}
              s={s}
              status={status}
              fileId={file}
              expansion={data.expansions.find((e) => e.id === s.expansion_id)}
              onEdit={() => setEditing(s)}
              onImages={() => navigate(`/p/${projectId}/m/${s.id}/bilder`)}
              working={working.has(s.id)}
              pending={data.pending.get(s.id) ?? 0}
              review={queueBy.get(s.id) ?? null}
              identifiedNow={identifiedNow.has(s.id)}
              previewUrl={(u) => app.ai.imageProxyUrl(u)}
              onReview={() => startReview(s.id)}
              onAgent={() => navigate(`/p/${projectId}/m/${s.id}/maleplan`)}
              onPaint={async () => {
                if (!s.current_plan_version_id) await run((c) => c.createEmptyPlan(s.id));
                navigate(`/male/${s.id}`);
              }}
            />
          ))}
        </div>
      )}

      {data.deleted.length > 0 && (
        <p className="small muted restore-line">
          Slettet:{' '}
          {data.deleted.map((s) => (
            <button key={s.id} type="button" className="link" onClick={() => run((c) => c.restoreSubject(s.id))}>gjenopprett {s.name}</button>
          ))}
        </p>
      )}


      {editing && (
        <SubjectDialog
          subject={editing === 'new' ? null : editing}
          expansions={data.expansions}
          onClose={() => setEditing(null)}
          onSave={async (patch, image) => {
            const id = editing === 'new'
              ? await run((c) => c.createSubject(projectId, patch))
              : (await run((c) => c.updateSubject(editing.id, patch)), editing.id);
            if (id && image) await run((c) => c.setSubjectImage(id, image, image.name));
            if (id) setEditing(null);
          }}
          onDelete={editing === 'new' ? undefined : async () => {
            await run((c) => c.deleteSubject(editing.id));
            setEditing(null);
          }}
        />
      )}
    </main>
  );
}

function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return <button type="button" className={`chip ${on ? 'on' : ''}`} aria-pressed={on} onClick={onClick}>{children}</button>;
}

const STATUS_LABEL: Record<PhysicalStatus, string> = { not_started: 'Ikke startet', in_progress: 'Under arbeid', finished: 'Ferdig' };

const EVIDENCE_LABEL: Record<Evidence, string> = { documented: 'Fra kilde', synthesized: 'Agentens vurdering', unresolved: 'Uavklart' };

/**
 * «Mangler i listen»: figures the game survey found in the game (component list, rulebook, campaign)
 * that are not in the project. Nothing is added before the user says so.
 */
function MissingList({ items, imageUrl, onAdd, onReject, onAddAll }: {
  items: { p: ResearchProposal; c: CatalogSubjectPayload; unknownExpansion: boolean }[];
  imageUrl: (u: string) => string; onAdd: (id: Id) => void; onReject: (id: Id) => void; onAddAll: () => void;
}) {
  return (
    <section className="missing" aria-label="Miniatyrer som mangler i listen">
      <div className="missing-head">
        <div>
          <h2>Mangler i listen ({items.length})</h2>
          <p className="small muted">Kartleggingen fant disse figurene i spillet. Ingenting legges til før du sier ja. Identifiseringen og kildene følger med.</p>
        </div>
        {items.length > 1 && <Button onClick={onAddAll}>Legg til alle</Button>}
      </div>
      <ul className="missing-list">
        {items.map(({ p, c, unknownExpansion }) => {
          const img = c.identity?.images[0];
          return (
            <li key={p.id} className="missing-item">
              {img && <img className="missing-img" src={imageUrl(img.thumbnail_url ?? img.image_url)} alt="" loading="lazy"
                onError={(e) => { e.currentTarget.style.display = 'none'; }} />}
              <div className="missing-body">
                <p className="missing-name"><strong>{c.name}</strong> <Badge tone={p.evidence === 'documented' ? 'moss' : 'neutral'}>{EVIDENCE_LABEL[p.evidence]}</Badge></p>
                <p className="small muted">
                  {c.grouping === 'group' ? `Malegruppe · ${c.physical_count} figurer` : 'Enkeltfigur'} · {c.expansion_name ?? 'Grunnspill'}
                  {c.category_label ? ` · ${c.category_label}` : ''}
                </p>
                {c.identity?.description && <p className="small">{c.identity.description}</p>}
                {c.note && <p className="small muted">{c.note}</p>}
                {unknownExpansion && <p className="small missing-warn">Utvidelsen «{c.expansion_name}» er ikke med i prosjektet.</p>}
                {p.uncertainty.map((u, i) => <p key={i} className="small missing-warn">{u.reason}</p>)}
                {c.sources.length > 0 && (
                  <p className="small missing-sources">
                    {c.sources.slice(0, 4).map((x) => <a key={x.url} href={x.url} target="_blank" rel="noreferrer" title={x.title}>{hostOf(x.url)} ↗</a>)}
                  </p>
                )}
              </div>
              <div className="missing-actions">
                <Button variant="primary" onClick={() => onAdd(p.id)}>Legg til</Button>
                <Button variant="ghost" onClick={() => onReject(p.id)}>Avvis</Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function hostOf(u: string): string {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; }
}

/** The game survey's progress while it works, and what it found when it is done. */
function SurveyPanel({ run, missing, queue, onReview, onStop, onClose }: {
  run: Run; missing: number; queue: number; onReview: () => void; onStop: () => void; onClose: () => void;
}) {
  const final = [...run.events].reverse().find((e) => e.type === 'final');
  const found = run.events.filter((e) => e.type === 'identity').length;
  return (
    <section className="survey-panel" aria-label="Kartlegging av spillet">
      {run.status === 'running' ? <LiveSteps events={run.events} onStop={onStop} /> : (
        <div className="survey-result">
          <div className="survey-head">
            <span className="eyebrow">Kartlegging {run.status === 'done' ? 'ferdig' : run.status === 'stopped' ? 'stoppet' : 'feilet'}</span>
            <button type="button" className="link small" onClick={onClose}>Lukk</button>
          </div>
          {final && final.type === 'final' && <p>{final.message}</p>}
          {final && final.type === 'final' && (
            <p className="small">
              {found} {found === 1 ? 'miniatyr' : 'miniatyrer'} identifisert · {final.game_sources?.length ?? 0} kilder for spillet
              {missing > 0 ? ` · ${missing} mangler i listen (se under)` : ''}.
            </p>
          )}
          {queue > 0 && (
            <div className="survey-next">
              <Button variant="moss" onClick={onReview}>Gå gjennom forslagene ({queue} {queue === 1 ? 'miniatyr' : 'miniatyrer'})</Button>
              <span className="small">Én miniatyr om gangen: bekreft figuren, velg bilder (de sikre er forhåndsvalgt) og gå videre.</span>
            </div>
          )}
          {final && final.type === 'final' && final.warnings.filter((w) => !w.startsWith('Fjernet')).map((w, i) => <p key={i} className="small survey-warn">{w}</p>)}
          {run.error && <p className="small survey-warn">{run.error}</p>}
        </div>
      )}
    </section>
  );
}

function MiniCard({ s, status, fileId, expansion, onEdit, onPaint, onAgent, onImages, working, pending, review, identifiedNow, previewUrl, onReview }: {
  s: MiniatureSubject; status: PhysicalStatus; fileId: string | null; expansion?: Expansion; onEdit: () => void; onPaint: () => void; onAgent: () => void; onImages: () => void; working: boolean;
  pending: number; review: ReviewItem | null; identifiedNow: boolean; previewUrl: (u: string) => string; onReview: () => void;
}) {
  // No picture of its own yet, but the agent has found one: shown as a suggestion, so the list fills up after a survey.
  const preview = !fileId && review?.preview ? review.preview : null;
  return (
    <article className={`mini-card status-${status}`}>
      <button type="button" className="mini-img-wrap" onClick={review ? onReview : onImages} aria-label={`Åpne verkstedet for ${s.name}`}>
        {preview
          ? <><img className="mini-img mini-preview" src={previewUrl(preview.thumbnail_url ?? preview.image_url)} alt="" loading="lazy" /><span className="mini-suggest">Forslag</span></>
          : <FileImage fileId={fileId} alt={s.name} className="mini-img" fallback={<span>Ingen bilde · trykk for å finne</span>} />}
        <span className="mini-img-hint">{review ? 'Gå gjennom' : 'Åpne verkstedet'}</span>
        {working && <span className="mini-working">Agenten jobber …</span>}
        {identifiedNow && !working && <span className="mini-working">Identifisert</span>}
        <span className={`mini-status`}>{STATUS_LABEL[status]}</span>
      </button>
      <div className="mini-body">
        <h3><button type="button" className="mini-name" onClick={onImages}>{s.name}</button></h3>
        <p className="small muted">
          {s.grouping === 'group' ? `Malegruppe · ${s.physical_count} figurer` : 'Enkeltfigur'}
          {' · '}{expansion?.name ?? 'Grunnspill'}
        </p>
        {(s.identity || pending > 0) && (
          <p className="mini-found small">
            {s.identity && (
              <button type="button" className="link" onClick={review ? onReview : onImages}
                title={s.identity.status === 'confirmed' ? 'Bekreftet av deg' : 'Forslag fra agenten. Bekreft eller avvis i Bilder-fanen.'}>
                {s.identity.status === 'confirmed' ? '✓ ' : ''}{s.identity.official_name ?? 'Identifisert'}{s.identity.status === 'proposed' ? '?' : ''}
              </button>
            )}
            {pending > 0 && <button type="button" className="link" onClick={onReview}>{pending} bildeforslag</button>}
          </p>
        )}
        <div className="mini-meta">
          {s.plan_state === 'approved'
            ? <Badge tone="moss">Maleplan</Badge>
            : <Badge>Ingen maleplan</Badge>}
          <span className="mono small">{s.finished_count}/{s.physical_count} ferdig</span>
        </div>
        <div className="mini-actions">
          <Button variant="primary" onClick={onPaint}>{s.current_plan_version_id ? 'Mal' : 'Lag maleplan'}</Button>
          <Button onClick={onEdit}>Rediger</Button>
        </div>
        <button type="button" className="mini-agent" onClick={onAgent}>
          ✦ {s.current_plan_version_id ? 'Maleplan og palett' : 'Lag maleplan og palett med AI'}
        </button>
      </div>
    </article>
  );
}

function SubjectDialog({ subject, expansions, onClose, onSave, onDelete }: {
  subject: MiniatureSubject | null;
  expansions: Expansion[];
  onClose: () => void;
  onSave: (patch: SubjectPatch, image: File | null) => Promise<void>;
  onDelete?: () => Promise<void>;
}) {
  const [name, setName] = useState(subject?.name ?? '');
  const [grouping, setGrouping] = useState<Grouping>(subject?.grouping ?? 'single');
  const [count, setCount] = useState(subject?.physical_count ?? 1);
  const [expansion, setExpansion] = useState(subject?.expansion_id ?? '');
  const [image, setImage] = useState<File | null>(null);
  return (
    <Dialog
      open
      onClose={onClose}
      title={subject ? 'Rediger miniatyr' : 'Legg til miniatyr'}
      footer={<>
        {onDelete && <Button variant="danger" onClick={onDelete} className="push-left">Slett</Button>}
        <Button onClick={onClose}>Avbryt</Button>
        <Button variant="primary" onClick={() => onSave({
          name: subject ? name : name || undefined,
          grouping,
          physical_count: grouping === 'single' ? 1 : count,
          expansion_id: expansion || null,
        }, image)}>Lagre</Button>
      </>}
    >
      <Field label="Navn i prosjektet" hint={subject ? undefined : 'Tomt felt gir et automatisk navn.'}>
        {(id) => <input id={id} value={name} placeholder="Ny miniatyr" onChange={(e) => setName(e.target.value)} />}
      </Field>
      <div className="field">
        <span className="field-label">Gruppering</span>
        <Segmented
          label="Gruppering"
          value={grouping}
          onChange={(g) => { setGrouping(g); if (g === 'group' && count < 2) setCount(2); }}
          options={[{ value: 'single', label: 'Enkeltfigur' }, { value: 'group', label: 'Malegruppe' }]}
        />
      </div>
      {grouping === 'group' && (
        <div className="field-row">
          <span className="field-label">Fysiske figurer</span>
          <Stepper label="Fysiske figurer" value={count} min={Math.max(1, subject?.finished_count ?? 1)} onChange={setCount} />
        </div>
      )}
      <Field label="Hører til">
        {(id) => (
          <select id={id} value={expansion} onChange={(e) => setExpansion(e.target.value)}>
            <option value="">Grunnspill</option>
            {expansions.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
        )}
      </Field>
      <div className="field-row">
        <span className="field-label">Bilde</span>
        <span className="small muted">{image ? image.name : subject?.official_asset_id ? 'Har bilde' : 'Ingen bilde'}</span>
        <ImagePicker onPick={setImage}>Velg bilde</ImagePicker>
      </div>
      {subject && <p className="small muted">Se også <Link to={`/male/${subject.id}`}>malevisningen</Link>.</p>}
    </Dialog>
  );
}
