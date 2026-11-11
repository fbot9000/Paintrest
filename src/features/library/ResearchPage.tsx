import { useEffect, useState } from 'react';
import type { AiStatus } from '../../app/ai-status';
import { useAiStatus } from '../../app/ai-status';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useApp, useView } from '../../app/context';
import { knowledgeTasks } from '../../domain/library';
import type { KnowledgeTarget } from '../../domain/research';
import type { PaintChoice } from '../../domain/types';
import { Badge, Button, ErrorNote, Field, Segmented } from '../../ui/components';
import { startRun } from './research-runs';

export type { AiStatus };
export { useAiStatus };

export function AiStatusNote({ status }: { status: AiStatus }) {
  if (status === 'no-server') {
    return <div className="tech-uncertain" role="note">Research krever Paintrest-serveren. Start appen lokalt med «npm run dev».</div>;
  }
  if (status === 'no-key') {
    return <div className="tech-uncertain" role="note">Legg inn AI-nøkkelen under <Link to="/innstillinger">AI og nettsøk</Link> først.</div>;
  }
  return null;
}

/**
 * Skisse 02 «Start teknikkresearch»: describe an idea, optionally add a source,
 * and the agent finds more sources and drafts one guide.
 */
export function ResearchPage() {
  const app = useApp();
  const [params] = useSearchParams();
  const [target, setTarget] = useState<KnowledgeTarget>(params.get('type') === 'recipe' ? 'recipe' : params.get('type') === 'image' ? 'image' : 'technique');
  const [pictures, setPictures] = useState<File[]>([]);
  const [idea, setIdea] = useState('');
  const [source, setSource] = useState('');
  const [paints, setPaints] = useState<PaintChoice>('both');
  const [error, setError] = useState<string | null>(null);
  const status = useAiStatus();
  const tasks = useView((t) => knowledgeTasks(t));
  const navigate = useNavigate();

  const fromImage = target === 'image';
  const ready = fromImage ? pictures.length > 0 : !!idea.trim();

  const start = async () => {
    if (!ready) return;
    setError(null);
    try {
      // The pictures are stored first, so they go with every turn of the research.
      const image_file_ids = fromImage ? await Promise.all(pictures.map((f) => app.cmd.storeImage(f))) : [];
      const task = await app.research.startKnowledgeTask(target, target === 'technique' ? {} : { paint_choice: paints, image_file_ids });
      const ask = idea.trim() || 'Foreslå oppskrifter og teknikker som gir uttrykket i bildet.';
      const text = source.trim() ? `${ask}\n\nKilde: ${source.trim()}` : ask;
      startRun({ store: app.store, research: app.research, agent: app.agent, ai: app.ai, cmd: app.cmd }, task, text);
      navigate(task);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <main className="page tech-page">
      <div className="page-head">
        <div>
          <span className="eyebrow">Bibliotek</span>
          <h1>Research</h1>
          <p className="muted">Beskriv noe du vil lære. Agenten finner flere kilder og lager et utkast du kan rette og godkjenne.</p>
        </div>
      </div>
      <AiStatusNote status={status} />
      <ErrorNote error={error} onClose={() => setError(null)} />

      <section className="card tech-section">
        <Segmented
          label="Hva vil du lage?"
          value={target}
          onChange={setTarget}
          options={[{ value: 'technique', label: 'Teknikk' }, { value: 'recipe', label: 'Oppskrift' }, { value: 'image', label: 'Fra bilde' }]}
        />
        {fromImage && <PicturePicker files={pictures} onChange={setPictures} />}
        <Field label={fromImage ? 'Hva vil du oppnå? (valgfritt)' : target === 'technique' ? 'Hva vil du undersøke?' : 'Hvilken effekt eller hvilke farger?'}>
          {(id) => (
            <textarea id={id} value={idea} onChange={(e) => setIdea(e.target.value)}
              placeholder={fromImage ? 'For eksempel: gløden i øynene og den slitte rustningen' : target === 'technique' ? 'For eksempel: svamp og oljemaling for tekstur' : 'For eksempel: varm rust på mørkt metall, med malinger jeg har'} />
          )}
        </Field>
        {target !== 'technique' && <PaintChoicePicker value={paints} onChange={setPaints} />}
        <Field label="Kilde (valgfritt)" hint="En lenke til en video, artikkel eller et innlegg du har sett.">
          {(id) => <input id={id} value={source} onChange={(e) => setSource(e.target.value)} placeholder="https://…" />}
        </Field>
        <p className="small muted">Utkastet lagres ikke i biblioteket før du godkjenner det.</p>
        <div>
          <Button variant="primary" icon="→" disabled={!ready || status !== 'ready'} onClick={start}>Start research</Button>
        </div>
      </section>

      {tasks.length > 0 && (
        <section className="tech-section">
          <h2>Tidligere research</h2>
          <ul className="research-list">
            {tasks.map((x) => (
              <li key={x.task.id}>
                <Link to={x.task.id}>
                  <span className="eyebrow">{x.revision_of ? 'Forbedring' : x.target === 'image' ? 'Fra bilde' : x.target === 'technique' ? 'Teknikk' : 'Oppskrift'}</span>
                  <strong>{x.title}</strong>
                  <span className="research-meta small muted">
                    {new Date(x.task.created_at).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short' })}
                    {x.pending > 0 && <Badge tone="warn">{x.pending} venter på deg</Badge>}
                    {x.approved > 0 && <Badge tone="moss">{x.approved} lagret</Badge>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}

/** Up to 4 pictures to research from. Shown as thumbnails; each can be removed. */
function PicturePicker({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const u = files.map((f) => URL.createObjectURL(f));
    setUrls(u);
    return () => u.forEach((x) => URL.revokeObjectURL(x));
  }, [files]);
  return (
    <div className="picture-picker">
      <span className="field-label">Bilder (1–4)</span>
      <div className="picture-row">
        {urls.map((u, i) => (
          <figure key={u} className="picture-thumb">
            <img src={u} alt={files[i]?.name ?? ''} />
            <button type="button" aria-label={`Fjern ${files[i]?.name ?? 'bildet'}`} onClick={() => onChange(files.filter((_, j) => j !== i))}>×</button>
          </figure>
        ))}
        {files.length < 4 && (
          <label className="picture-add">
            <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple className="sr-only"
              onChange={(e) => { onChange([...files, ...Array.from(e.target.files ?? [])].slice(0, 4)); e.target.value = ''; }} />
            <span>+ Legg til bilde</span>
          </label>
        )}
      </div>
      <p className="small muted">For eksempel en malt figur du liker. Agenten ser på bildet og foreslår oppskrifter og teknikker.</p>
    </div>
  );
}

export const PAINT_CHOICE_LABEL: Record<PaintChoice, string> = {
  both: 'Begge', owned: 'Bare det jeg har', best: 'Beste valg',
};

/** The user's active choice of paints (brukerbeslutning 11.11.2026): never a hidden preference. */
export function PaintChoicePicker({ value, onChange }: { value: PaintChoice; onChange: (v: PaintChoice) => void }) {
  return (
    <div className="paint-choice">
      <span className="field-label">Malinger</span>
      <Segmented
        label="Malinger"
        value={value}
        onChange={onChange}
        options={(['both', 'owned', 'best'] as PaintChoice[]).map((v) => ({ value: v, label: PAINT_CHOICE_LABEL[v] }))}
      />
      <p className="small muted">
        {value === 'both' && 'To utkast side om side: ett med malinger du har, og ett med de beste malingene.'}
        {value === 'owned' && 'Bare malinger du har. Agenten sier fra hvis det går ut over resultatet.'}
        {value === 'best' && 'Malingene som gir best resultat. Du ser hvilke du ikke har.'}
      </p>
    </div>
  );
}
