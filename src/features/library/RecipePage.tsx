import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useView } from '../../app/context';
import type { RecipePatch, RecipePaintInput, RecipeStepInput } from '../../domain/commands';
import { catalogProducts, libraryTags, libraryTechniques, recipeDetail } from '../../domain/library';
import type { RecipePaintView } from '../../domain/library';
import type { Id, MaterialRole, PaintProduct } from '../../domain/types';
import { Button, Card, ErrorNote, InlineText, OwnershipFlag, ProductName, Swatch } from '../../ui/components';
import { AutoField, ChipListEditor, EvidenceBadge, RowTools, SaveState, StatusBadge, moved, useAutosave } from './parts';

const ROLES: MaterialRole[] = ['base', 'shade', 'layer', 'highlight', 'wash', 'glaze', 'mix', 'other'];
const ROLE_LABEL: Record<MaterialRole, string> = {
  base: 'Base', shade: 'Shade', layer: 'Lag', highlight: 'Høylys', wash: 'Wash', glaze: 'Glasur', mix: 'Blanding', other: 'Annet',
};

/**
 * Bit 7.2: one recipe. The colour sequence comes first; steps are optional.
 * Every field saves when you leave it. «Godkjent» is a label, not a lock.
 */
export function RecipePage() {
  const { recipeId = '' } = useParams();
  const d = useView((t) => recipeDetail(t, recipeId), [recipeId]);
  const tags = useView((t) => libraryTags(t, 'recipe').map((x) => x.tag));
  const products = useView((t) => catalogProducts(t));
  const techniques = useView((t) => libraryTechniques(t).map((c) => c.technique));
  const { save, error, clearError, busy, saved } = useAutosave();
  const navigate = useNavigate();

  if (!d) {
    return <main className="page"><h1>Fant ikke oppskriften</h1><p><Link to="/bibliotek/oppskrifter">Til oppskriftene</Link></p></main>;
  }
  const x = d.recipe;
  const deleted = !!x.deleted_at;

  const patch = (p: RecipePatch) => save((c) => c.updateRecipe(x.id, p));
  const paintInput = (p: RecipePaintView): RecipePaintInput => ({ id: p.row.id, product_id: p.row.product_id });
  const savePaints = (list: RecipePaintInput[]) => save((c) => c.setRecipePaints(x.id, list));
  const changePaint = (id: Id, p: Partial<RecipePaintInput>) =>
    savePaints(d.paints.map((o) => (o.row.id === id ? { ...paintInput(o), ...p } : paintInput(o))));
  const stepInput = (s: { row: { id: Id } }): RecipeStepInput => ({ id: s.row.id });
  const saveSteps = (list: RecipeStepInput[]) => save((c) => c.setRecipeSteps(x.id, list));
  const changeStep = (id: Id, p: Partial<RecipeStepInput>) =>
    saveSteps(d.steps.map((o) => (o.row.id === id ? { id, ...p } : stepInput(o))));

  const addPaint = async (product_id: Id) => savePaints([...d.paints.map(paintInput), { product_id }]);
  const addNewPaint = async (name: string) => {
    let id: Id | undefined;
    const ok = await save(async (c) => { id = await c.createProduct({ name }); });
    if (ok && id) await addPaint(id);
  };

  // Techniques for the step picker: live ones, plus a deleted one a step still points to.
  const techniqueOptions = [
    ...techniques,
    ...d.steps.map((s) => s.technique).filter((t): t is NonNullable<typeof t> => !!t && !!t.deleted_at),
  ];

  return (
    <main className="page tech-page">
      <div className="tech-head">
        <span className="eyebrow"><Link to="/bibliotek/oppskrifter">Oppskrifter</Link></span>
        {deleted
          ? <h1>{x.name}</h1>
          : <InlineText as="h1" className="h1" value={x.name} label="Navn" onSave={(v) => patch({ name: v })} />}
        <div className="tech-badges">
          <StatusBadge status={x.status} />
          <EvidenceBadge evidence={x.evidence} />
          <SaveState busy={busy} saved={saved} />
        </div>
      </div>
      <ErrorNote error={error} onClose={clearError} />

      {deleted ? (
        <div className="empty">
          <p>Oppskriften er slettet.</p>
          <Button variant="primary" onClick={() => save((c) => c.restoreRecipe(x.id))}>Gjenopprett</Button>
        </div>
      ) : (
        <>
          {x.uncertainty.length > 0 && (
            <div className="tech-uncertain" role="note">
              <strong>Uavklart:</strong>
              <ul>{x.uncertainty.map((u, i) => <li key={i}>{u.reason}</li>)}</ul>
            </div>
          )}

          <Card className="tech-section">
            <AutoField label="Effekt" multiline value={x.effect ?? ''}
              placeholder="Hva gir oppskriften? La stå tom for en ren fargerekke." onSave={(v) => patch({ effect: v })} />
            <div className="auto-field">
              <span className="eyebrow">Merkelapper</span>
              <ChipListEditor label="Merkelapper" items={x.tags} suggestions={tags}
                placeholder="Legg til merkelapp" onSave={(v) => patch({ tags: v })} />
            </div>
          </Card>

          <Card className="tech-section">
            <span className="eyebrow">Fargerekke</span>
            {d.paints.length > 0 && (
              <span className="recipe-strip recipe-strip-lg" aria-hidden>
                {d.paints.map((p) => <Swatch key={p.row.id} hex={p.product.swatch_hex} size={32} />)}
              </span>
            )}
            {d.paints.length === 0 && <p className="muted">Ingen malinger ennå.</p>}
            <ol className="recipe-paints">
              {d.paints.map((p, i) => (
                <li key={p.row.id} className="recipe-paint">
                  <Swatch hex={p.product.swatch_hex} size={28} />
                  <div className="recipe-paint-main">
                    <ProductName product={p.product} />
                    <OwnershipFlag ownership={p.ownership} />
                  </div>
                  <label className="sr-only" htmlFor={`role-${p.row.id}`}>Rolle for {p.product.name}</label>
                  <select id={`role-${p.row.id}`} className="recipe-role" value={p.row.role ?? ''}
                    onChange={(e) => changePaint(p.row.id, { role: (e.target.value || null) as MaterialRole | null })}>
                    <option value="">Ingen rolle</option>
                    {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                  </select>
                  <AutoField label={`Merknad til ${p.product.name}`} hideLabel className="recipe-paint-note" value={p.row.note ?? ''}
                    placeholder="Merknad, for eksempel tynn ut" onSave={(v) => changePaint(p.row.id, { note: v })} />
                  <RowTools index={i} count={d.paints.length} label={p.product.name}
                    onMove={(by) => savePaints(moved(d.paints, i, by).map(paintInput))}
                    onRemove={() => savePaints(d.paints.filter((o) => o.row.id !== p.row.id).map(paintInput))} />
                </li>
              ))}
            </ol>
            <PaintPicker products={products} onPick={addPaint} onCreate={addNewPaint} />
          </Card>

          <Card className="tech-section">
            <div>
              <span className="eyebrow">Fremgangsmåte</span>
              <p className="small muted">Valgfritt. Uten steg er oppskriften en ren fargerekke.</p>
            </div>
            <ol className="tech-steps">
              {d.steps.map((s, i) => (
                <li key={s.row.id} className="tech-step">
                  <span className="tech-step-no mono">{String(i + 1).padStart(2, '0')}</span>
                  <div className="tech-step-body">
                    <AutoField label={`Steg ${i + 1}`} hideLabel multiline value={s.row.instruction}
                      placeholder="Hva gjør du i dette steget?" onSave={(v) => changeStep(s.row.id, { instruction: v })} />
                    {d.paints.length > 0 && (
                      <div className="step-paints" role="group" aria-label={`Malinger i steg ${i + 1}`}>
                        {d.paints.map((p) => {
                          const on = s.row.paint_ids.includes(p.row.id);
                          return (
                            <button key={p.row.id} type="button" className={`step-paint ${on ? 'on' : ''}`} aria-pressed={on}
                              onClick={() => changeStep(s.row.id, {
                                paint_ids: on ? s.row.paint_ids.filter((id) => id !== p.row.id) : [...s.row.paint_ids, p.row.id],
                              })}>
                              <Swatch hex={p.product.swatch_hex} size={14} /> {p.product.name}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <div className="step-technique">
                      <label htmlFor={`tech-${s.row.id}`} className="small muted">Teknikk</label>
                      <select id={`tech-${s.row.id}`} value={s.row.technique_id ?? ''}
                        onChange={(e) => changeStep(s.row.id, { technique_id: e.target.value || null })}>
                        <option value="">Ingen</option>
                        {techniqueOptions.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}{t.deleted_at ? ' (slettet)' : ''}</option>
                        ))}
                      </select>
                      {s.technique && !s.technique.deleted_at && (
                        <Link className="small" to={`/bibliotek/teknikker/${s.technique.id}`}>Åpne teknikken</Link>
                      )}
                    </div>
                  </div>
                  <RowTools index={i} count={d.steps.length} label={`steg ${i + 1}`}
                    onMove={(by) => saveSteps(moved(d.steps, i, by).map(stepInput))}
                    onRemove={() => saveSteps(d.steps.filter((o) => o.row.id !== s.row.id).map(stepInput))} />
                </li>
              ))}
            </ol>
            <div><Button icon="+" onClick={() => saveSteps([...d.steps.map(stepInput), { instruction: '' }])}>Legg til steg</Button></div>
          </Card>

          <Card className="tech-section">
            <AutoField label="Notat" multiline value={x.note ?? ''}
              placeholder="Det du vil huske om oppskriften" onSave={(v) => patch({ note: v })} />
          </Card>

          {d.sources.length > 0 && (
            <Card className="tech-section">
              <span className="eyebrow">Kilder</span>
              <ul className="tech-sources">
                {d.sources.map(({ source }) => (
                  <li key={source.id}>
                    {source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.title} ↗</a> : source.title}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className="tech-actions">
            <Button variant="danger" onClick={async () => {
              if (await save((c) => c.deleteRecipe(x.id))) navigate('/bibliotek/oppskrifter');
            }}>Slett oppskriften</Button>
            <div className="tech-approve">
              <p className="small muted">
                {x.status === 'approved'
                  ? 'Godkjent betyr klar til bruk. Du kan fortsatt endre oppskriften.'
                  : 'Godkjenn når du vil bruke oppskriften. Du kan fortsatt endre den etterpå.'}
              </p>
              {x.status === 'approved'
                ? <Button onClick={() => save((c) => c.setRecipeStatus(x.id, 'draft'))}>Sett tilbake til utkast</Button>
                : <Button variant="primary" onClick={() => save((c) => c.setRecipeStatus(x.id, 'approved'))}>Godkjenn</Button>}
            </div>
          </div>
        </>
      )}
    </main>
  );
}

/** Search the catalogue and add a paint. A name that is not found can be added as a new, unconfirmed paint. */
function PaintPicker({ products, onPick, onCreate }:
  { products: PaintProduct[]; onPick: (id: Id) => void; onCreate: (name: string) => void }) {
  const [q, setQ] = useState('');
  const norm = (s: string) => s.toLocaleLowerCase('nb');
  const hits = useMemo(() => {
    const words = norm(q.trim()).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    return products.filter((p) => {
      const hay = norm([p.name, p.manufacturer, p.range_name].filter(Boolean).join(' '));
      return words.every((w) => hay.includes(w));
    }).slice(0, 8);
  }, [q, products]);
  const exact = hits.some((p) => norm(p.name) === norm(q.trim()));
  return (
    <div className="paint-picker">
      <label htmlFor="paint-q" className="eyebrow">Legg til maling</label>
      <input id="paint-q" type="search" value={q} placeholder="Søk i malingskatalogen" autoComplete="off"
        onChange={(e) => setQ(e.target.value)} />
      {q.trim() && (
        <ul className="paint-hits">
          {hits.map((p) => (
            <li key={p.id}>
              <button type="button" onClick={() => { onPick(p.id); setQ(''); }}>
                <Swatch hex={p.swatch_hex} /> <ProductName product={p} />
              </button>
            </li>
          ))}
          {!exact && (
            <li>
              <button type="button" className="paint-new" onClick={() => { onCreate(q.trim()); setQ(''); }}>
                + Legg til «{q.trim()}» som ny maling (ubekreftet)
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
