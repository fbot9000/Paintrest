import { useState } from 'react';
import type { AiStatus } from '../../app/ai-status';
import { useAiStatus } from '../../app/ai-status';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useApp, useView } from '../../app/context';
import { knowledgeTasks } from '../../domain/library';
import type { KnowledgeTarget } from '../../domain/research';
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
  const [target, setTarget] = useState<KnowledgeTarget>(params.get('type') === 'recipe' ? 'recipe' : 'technique');
  const [idea, setIdea] = useState('');
  const [source, setSource] = useState('');
  const [error, setError] = useState<string | null>(null);
  const status = useAiStatus();
  const tasks = useView((t) => knowledgeTasks(t));
  const navigate = useNavigate();

  const start = async () => {
    if (!idea.trim()) return;
    setError(null);
    try {
      const task = await app.research.startKnowledgeTask(target);
      const text = source.trim() ? `${idea.trim()}\n\nKilde: ${source.trim()}` : idea.trim();
      startRun({ store: app.store, research: app.research, agent: app.agent, ai: app.ai }, task, text);
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
          options={[{ value: 'technique', label: 'Teknikk' }, { value: 'recipe', label: 'Oppskrift' }]}
        />
        <Field label={target === 'technique' ? 'Hva vil du undersøke?' : 'Hvilken effekt eller hvilke farger?'}>
          {(id) => (
            <textarea id={id} value={idea} onChange={(e) => setIdea(e.target.value)}
              placeholder={target === 'technique' ? 'For eksempel: svamp og oljemaling for tekstur' : 'For eksempel: varm rust på mørkt metall, med malinger jeg har'} />
          )}
        </Field>
        <Field label="Kilde (valgfritt)" hint="En lenke til en video, artikkel eller et innlegg du har sett.">
          {(id) => <input id={id} value={source} onChange={(e) => setSource(e.target.value)} placeholder="https://…" />}
        </Field>
        <p className="small muted">Utkastet lagres ikke i biblioteket før du godkjenner det.</p>
        <div>
          <Button variant="primary" icon="→" disabled={!idea.trim() || status !== 'ready'} onClick={start}>Start research</Button>
        </div>
      </section>

      {tasks.length > 0 && (
        <section className="tech-section">
          <h2>Tidligere research</h2>
          <ul className="research-list">
            {tasks.map((x) => (
              <li key={x.task.id}>
                <Link to={x.task.id}>
                  <span className="eyebrow">{x.revision_of ? 'Forbedring' : x.target === 'technique' ? 'Teknikk' : 'Oppskrift'}</span>
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
