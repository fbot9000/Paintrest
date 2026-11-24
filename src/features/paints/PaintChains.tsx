import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useApp, useView } from '../../app/context';
import { useAiStatus } from '../../app/ai-status';
import { chainPrompt, recipesWithPaint } from '../../domain/paints';
import type { Id, MaterialRole } from '../../domain/types';
import { Button, ErrorNote, Segmented } from '../../ui/components';
import { startRun } from '../library/research-runs';

const ROLE_LABEL: Record<MaterialRole, string> = {
  base: 'base', shade: 'shade', layer: 'lag', highlight: 'høylys', wash: 'wash', glaze: 'glasur', mix: 'blanding', other: 'annet',
};

/**
 * Malekjeder (O-16, brukerbeslutning 24.11.2026): the recipes the paint is in, and «Lag malekjede»,
 * which starts a library research for a recipe around this paint. The draft is saved in the
 * library only when you approve it there.
 */
export function PaintChains({ productId }: { productId: Id }) {
  const app = useApp();
  const status = useAiStatus();
  const navigate = useNavigate();
  const [choice, setChoice] = useState<'owned' | 'best'>('owned');
  const [error, setError] = useState<string | null>(null);
  const data = useView((t) => ({ product: t.paint_product[productId], recipes: recipesWithPaint(t, productId) }), [productId]);
  if (!data.product) return null;
  const product = data.product;

  const start = async () => {
    setError(null);
    try {
      const task = await app.research.startKnowledgeTask('recipe', { paint_choice: choice });
      startRun({ store: app.store, research: app.research, agent: app.agent, ai: app.ai, cmd: app.cmd }, task, chainPrompt(product, choice));
      navigate(`/bibliotek/research/${task}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <section className="paint-chains" aria-label="Oppskrifter og malekjeder">
      <strong>Oppskrifter</strong>
      {data.recipes.length === 0 ? <span className="small muted">Malingen er ikke med i noen oppskrift ennå.</span> : (
        <ul>
          {data.recipes.map(({ recipe, role }) => (
            <li key={recipe.id}>
              <Link to={`/bibliotek/oppskrifter/${recipe.id}`}>{recipe.name}</Link>
              {role && <span className="small muted"> · som {ROLE_LABEL[role]}</span>}
            </li>
          ))}
        </ul>
      )}
      {status === 'ready' && (
        <div className="paint-chains-start">
          <Segmented label="Malinger i kjeden" value={choice} onChange={setChoice}
            options={[{ value: 'owned', label: 'Bare det jeg har' }, { value: 'best', label: 'Beste valg' }]} />
          <Button onClick={start}>Lag malekjede med AI</Button>
        </div>
      )}
      {status === 'ready' && <span className="small muted">Agenten lager en fargerekke (shade, base, layer, høylys) med denne malingen. Den lagres i biblioteket når du godkjenner den.</span>}
      <ErrorNote error={error} onClose={() => setError(null)} />
    </section>
  );
}
