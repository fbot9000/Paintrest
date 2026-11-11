/**
 * Read functions for the library (bit 7): techniques and recipes.
 * Pure functions over the tables, like views.ts. Rows with `deleted_at` are
 * left out unless a function says otherwise.
 */
import type {
  Id, Ownership, PaintProduct, Recipe, RecipePaint, RecipeStep, Source, SourceLink, Tables, Technique,
  TechniqueExperience, TechniqueStep,
} from './types';
import { ownershipOf } from './views';

/** The «praktisk erfaring» dimension. Worked out from experiences, never stored. */
export type PracticalExperience = 'untried' | 'tried' | 'succeeded';

export function liveExperiences(t: Tables, technique_id: Id): TechniqueExperience[] {
  return Object.values(t.technique_experience)
    .filter((e) => e.technique_id === technique_id && !e.deleted_at)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export function practicalExperience(t: Tables, technique_id: Id): PracticalExperience {
  const all = liveExperiences(t, technique_id);
  if (!all.length) return 'untried';
  return all.some((e) => e.outcome === 'worked') ? 'succeeded' : 'tried';
}

export function techniqueSteps(t: Tables, technique_id: Id): TechniqueStep[] {
  return Object.values(t.technique_step)
    .filter((s) => s.technique_id === technique_id)
    .sort((a, b) => a.position - b.position);
}

export function recipePaints(t: Tables, recipe_id: Id): RecipePaint[] {
  return Object.values(t.recipe_paint)
    .filter((p) => p.recipe_id === recipe_id)
    .sort((a, b) => a.position - b.position);
}

export function recipeSteps(t: Tables, recipe_id: Id): RecipeStep[] {
  return Object.values(t.recipe_step)
    .filter((s) => s.recipe_id === recipe_id)
    .sort((a, b) => a.position - b.position);
}

/** Live recipes with at least one step that uses the technique. */
export function recipesUsingTechnique(t: Tables, technique_id: Id): Recipe[] {
  const ids = new Set(Object.values(t.recipe_step).filter((s) => s.technique_id === technique_id).map((s) => s.recipe_id));
  return [...ids].map((id) => t.recipe[id]).filter((r): r is Recipe => !!r && !r.deleted_at)
    .sort((a, b) => a.name.localeCompare(b.name, 'nb'));
}

export interface LinkedSource {
  link: SourceLink;
  source: Source;
}

/** Sources linked to a technique or recipe (source_link, use = method). */
export function knowledgeSources(t: Tables, target_type: 'technique' | 'recipe', target_id: Id): LinkedSource[] {
  return Object.values(t.source_link)
    .filter((l) => l.target_type === target_type && l.target_id === target_id && l.use === 'method' && !l.deleted_at)
    .map((link) => ({ link, source: t.source[link.source_id] }))
    .filter((x): x is LinkedSource => !!x.source && !x.source.deleted_at);
}

// ---------- Søk og liste ----------

export interface LibraryFilter {
  /** Free text: matches name, tags and the descriptive fields. */
  query?: string;
  /** Only rows with this tag (case-insensitive). */
  tag?: string;
}

function norm(s: string): string {
  return s.toLocaleLowerCase('nb').normalize('NFKD').replace(/\p{M}/gu, '');
}

function matches(f: LibraryFilter | undefined, tags: string[], haystack: (string | null)[]): boolean {
  if (f?.tag) {
    const want = norm(f.tag.trim());
    if (!tags.some((x) => norm(x) === want)) return false;
  }
  const q = f?.query?.trim();
  if (!q) return true;
  const hay = norm([...tags, ...haystack].filter(Boolean).join(' \n '));
  return norm(q).split(/\s+/).every((word) => hay.includes(word));
}

/** Newest change first. */
function byUpdated<T extends { updated_at: string }>(a: T, b: T): number {
  return b.updated_at.localeCompare(a.updated_at);
}

export interface TechniqueCard {
  technique: Technique;
  experience: PracticalExperience;
  step_count: number;
  recipe_count: number;
}

export function libraryTechniques(t: Tables, f?: LibraryFilter): TechniqueCard[] {
  return Object.values(t.technique)
    .filter((x) => !x.deleted_at)
    .filter((x) => matches(f, x.tags, [
      x.name, x.desired_result, x.use_area, x.variants, ...x.materials,
      ...techniqueSteps(t, x.id).flatMap((s) => [s.title, s.instruction]),
    ]))
    .sort(byUpdated)
    .map((technique) => ({
      technique,
      experience: practicalExperience(t, technique.id),
      step_count: techniqueSteps(t, technique.id).length,
      recipe_count: recipesUsingTechnique(t, technique.id).length,
    }));
}

export function deletedTechniques(t: Tables): Technique[] {
  return Object.values(t.technique).filter((x) => x.deleted_at).sort(byUpdated);
}

export interface RecipePaintView {
  row: RecipePaint;
  product: PaintProduct;
  ownership: Ownership;
}

export interface RecipeCard {
  recipe: Recipe;
  paints: RecipePaintView[];
  /** true when the recipe has steps; false for a plain colour sequence. */
  has_method: boolean;
}

function paintViews(t: Tables, recipe_id: Id): RecipePaintView[] {
  return recipePaints(t, recipe_id)
    .map((row) => ({ row, product: t.paint_product[row.product_id], ownership: ownershipOf(t, row.product_id) }))
    .filter((x): x is RecipePaintView => !!x.product);
}

export function libraryRecipes(t: Tables, f?: LibraryFilter): RecipeCard[] {
  return Object.values(t.recipe)
    .filter((x) => !x.deleted_at)
    .map((recipe) => ({ recipe, paints: paintViews(t, recipe.id), has_method: recipeSteps(t, recipe.id).length > 0 }))
    .filter((c) => matches(f, c.recipe.tags, [
      c.recipe.name, c.recipe.effect, c.recipe.note,
      ...c.paints.flatMap((p) => [p.product.name, p.product.manufacturer, p.product.range_name]),
      ...recipeSteps(t, c.recipe.id).map((s) => s.instruction),
    ]))
    .sort((a, b) => byUpdated(a.recipe, b.recipe));
}

export function deletedRecipes(t: Tables): Recipe[] {
  return Object.values(t.recipe).filter((x) => x.deleted_at).sort(byUpdated);
}

/** All tags in use on live rows, with counts, most used first. Spelling from the first row found. */
export function libraryTags(t: Tables, kind: 'technique' | 'recipe'): { tag: string; count: number }[] {
  const rows: { tags: string[]; deleted_at: string | null }[] = Object.values(kind === 'technique' ? t.technique : t.recipe);
  const counts = new Map<string, { tag: string; count: number }>();
  for (const r of rows) {
    if (r.deleted_at) continue;
    for (const tag of r.tags) {
      const key = norm(tag);
      const c = counts.get(key) ?? { tag, count: 0 };
      c.count++;
      counts.set(key, c);
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'nb'));
}

// ---------- Detalj ----------

export interface TechniqueDetail {
  technique: Technique;
  steps: TechniqueStep[];
  experiences: TechniqueExperience[];
  experience: PracticalExperience;
  recipes: Recipe[];
  sources: LinkedSource[];
}

/** Also returns deleted techniques, so a deleted one can be shown and restored. */
export function techniqueDetail(t: Tables, technique_id: Id): TechniqueDetail | undefined {
  const technique = t.technique[technique_id];
  if (!technique) return undefined;
  return {
    technique,
    steps: techniqueSteps(t, technique_id),
    experiences: liveExperiences(t, technique_id),
    experience: practicalExperience(t, technique_id),
    recipes: recipesUsingTechnique(t, technique_id),
    sources: knowledgeSources(t, 'technique', technique_id),
  };
}

export interface RecipeStepView {
  row: RecipeStep;
  paints: RecipePaintView[];
  /** null when the step names no technique. Deleted techniques are still returned. */
  technique: Technique | null;
}

export interface RecipeDetail {
  recipe: Recipe;
  paints: RecipePaintView[];
  steps: RecipeStepView[];
  sources: LinkedSource[];
}

/** Also returns deleted recipes, so a deleted one can be shown and restored. */
export function recipeDetail(t: Tables, recipe_id: Id): RecipeDetail | undefined {
  const recipe = t.recipe[recipe_id];
  if (!recipe) return undefined;
  const paints = paintViews(t, recipe_id);
  const byId = new Map(paints.map((p) => [p.row.id, p]));
  return {
    recipe,
    paints,
    steps: recipeSteps(t, recipe_id).map((row) => ({
      row,
      paints: row.paint_ids.map((id) => byId.get(id)).filter((p): p is RecipePaintView => !!p),
      technique: row.technique_id ? t.technique[row.technique_id] ?? null : null,
    })),
    sources: knowledgeSources(t, 'recipe', recipe_id),
  };
}

/** Live paints in the catalogue, by name. For picking paints for a recipe. */
export function catalogProducts(t: Tables): PaintProduct[] {
  return Object.values(t.paint_product)
    .filter((p) => !p.deleted_at)
    .sort((a, b) => a.name.localeCompare(b.name, 'nb'));
}
