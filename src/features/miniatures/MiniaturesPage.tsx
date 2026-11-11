import { useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useApp, useCommand, useView } from '../../app/context';
import type { SubjectPatch } from '../../domain/commands';
import type { Expansion, Grouping, Id, MiniatureSubject, Tables } from '../../domain/types';
import type { ReferenceSelectionPayload } from '../../domain/agent';
import { assetFileId, attachedExpansions, deletedSubjects, liveSubjects, physicalStatus } from '../../domain/views';
import type { PhysicalStatus } from '../../domain/views';
import { Badge, Button, Dialog, ErrorNote, Field, FileImage, ImagePicker, Segmented, Stepper } from '../../ui/components';
import { runs, useRuns } from '../../app/runs';
import type { Run } from '../../app/runs';
import { LiveSteps } from '../agent/AgentPanel';
import { startGameSurvey } from '../workspace/agentRuns';
import './miniatures.css';

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
  }), [projectId]);
  const app = useApp();
  const survey = useRuns((r) => r.get(projectId, 'game'));
  const surveying = survey?.status === 'running';
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
    <main className="page">
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
          {data.subjects.length > 0 && (
            <Button onClick={() => startGameSurvey(app, projectId, data.game)} disabled={surveying}
              title="Én kjøring for hele spillet: agenten finner de beste kildene (offisielle sider, gallerier med malte figurer og maleguider), finner ut hvem hver miniatyr er, og foreslår bilder til hver. Det lagres for spillet, så senere bildejakt og maleplaner bygger på det.">
              {surveying ? 'Kartlegger …' : '✦ Kartlegg spillet med AI'}
            </Button>
          )}
          <Button variant="primary" onClick={() => setEditing('new')} icon="+">Legg til miniatyr</Button>
        </div>
      </div>
      <ErrorNote error={error} onClose={clearError} />
      {survey && <SurveyPanel run={survey} onStop={() => runs.stop(projectId, 'game')} onClose={() => runs.dismiss(projectId, 'game')} />}

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

/** The game survey's progress while it works, and what it found when it is done. */
function SurveyPanel({ run, onStop, onClose }: { run: Run; onStop: () => void; onClose: () => void }) {
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
              {found} {found === 1 ? 'miniatyr' : 'miniatyrer'} identifisert · {final.game_sources?.length ?? 0} kilder for spillet.
              {' '}Bildeforslagene ligger i Bilder-fanen til hver miniatyr, og kildene merket «Trolig figuren» bekrefter du der.
            </p>
          )}
          {final && final.type === 'final' && final.warnings.filter((w) => !w.startsWith('Fjernet')).map((w, i) => <p key={i} className="small survey-warn">{w}</p>)}
          {run.error && <p className="small survey-warn">{run.error}</p>}
        </div>
      )}
    </section>
  );
}

function MiniCard({ s, status, fileId, expansion, onEdit, onPaint, onAgent, onImages, working, pending }: {
  s: MiniatureSubject; status: PhysicalStatus; fileId: string | null; expansion?: Expansion; onEdit: () => void; onPaint: () => void; onAgent: () => void; onImages: () => void; working: boolean;
  pending: number;
}) {
  return (
    <article className={`mini-card status-${status}`}>
      <button type="button" className="mini-img-wrap" onClick={onImages} aria-label={`Åpne verkstedet for ${s.name}`}>
        <FileImage fileId={fileId} alt={s.name} className="mini-img" fallback={<span>Ingen bilde · trykk for å finne</span>} />
        <span className="mini-img-hint">Åpne verkstedet</span>
        {working && <span className="mini-working">Agenten jobber …</span>}
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
              <button type="button" className="link" onClick={onImages}
                title={s.identity.status === 'confirmed' ? 'Bekreftet av deg' : 'Forslag fra agenten. Bekreft eller avvis i Bilder-fanen.'}>
                {s.identity.status === 'confirmed' ? '✓ ' : ''}{s.identity.official_name ?? 'Identifisert'}{s.identity.status === 'proposed' ? '?' : ''}
              </button>
            )}
            {pending > 0 && <button type="button" className="link" onClick={onImages}>{pending} bildeforslag</button>}
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
