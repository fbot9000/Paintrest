/**
 * «Finn med AI» on the game page (brukerønske 11.11.2026): the agent looks up the game's year,
 * publisher and official website, and suggests pictures for its illustration. The run lives in the
 * shared registry, so it keeps going when the user leaves the page. Nothing is stored before the
 * user chooses what to use (applyGameInfo).
 */
import type { useApp } from '../../app/context';
import { runs } from '../../app/runs';
import type { Run } from '../../app/runs';
import { knownSources } from '../../domain/agent';
import type { GameInfo, GameInfoImage } from '../../domain/ai';
import type { GamePatch } from '../../domain/commands';
import type { Game, Id, Tables } from '../../domain/types';
import { attachedExpansions } from '../../domain/views';

type App = ReturnType<typeof useApp>;

/** Official pages a game survey already found for the project: the agent opens them first. */
function officialPages(t: Tables, project_id: Id) {
  return knownSources(t, project_id)
    .filter((k) => k.source.role === 'official' && !!k.source.url)
    .slice(0, 8)
    .map((k) => ({ url: k.source.url!, title: k.source.title, ...(k.summary ? { summary: k.summary.slice(0, 300) } : {}) }));
}

export function startGameLookup(app: App, project_id: Id, game: Game) {
  runs.start(game.id, 'gameinfo', async (onEvent, signal) => {
    const t = app.store.getTables();
    const g = t.game[game.id] ?? game;
    const prompt = `Finn fakta om brettspillet «${g.primary_name}»: utgivelsesår, utgiver og offisiell nettside. `
      + 'Foreslå også bilder til spillets illustrasjon: forsiden av esken eller hovedillustrasjonen. '
      + 'Oppgi kilden for hver opplysning; jeg velger selv hva som tas i bruk.';
    await app.ai.runAgent({
      context: {},
      messages: [{ role: 'user', content: prompt }],
      result_types: [],
      focus: {
        kind: 'game_info', game: g.primary_name, year: g.year_published, publishers: g.publishers, website: g.website_url ?? null,
        expansions: attachedExpansions(t, project_id).map((e) => e.name), known_pages: officialPages(t, project_id),
      },
    }, onEvent, signal);
  }, { label: `Fakta og illustrasjon for ${game.primary_name}`, href: `/p/${project_id}/spill` });
}

/** The checked answer of a finished lookup, if it gave one. */
export function lookupResult(run: Run | null): { message: string; info: GameInfo | null; warnings: string[]; model: string } | null {
  const final = run ? [...run.events].reverse().find((e) => e.type === 'final') : undefined;
  if (!final || final.type !== 'final') return null;
  return { message: final.message, info: final.game_info ?? null, warnings: final.warnings, model: final.model };
}

/** What the user ticked in the suggestions. */
export interface GameInfoChoice {
  year: boolean;
  publishers: boolean;
  website: boolean;
  /** The picture to use as the illustration, or null. */
  image: GameInfoImage | null;
}

/** Whether a suggestion differs from what the game page holds now (same value: nothing to choose). */
export function differs(game: Game, info: GameInfo) {
  const same = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x.trim().toLowerCase() === b[i]?.trim().toLowerCase());
  return {
    year: !!info.year_published && info.year_published.value !== game.year_published,
    publishers: !!info.publishers && !same(info.publishers.value, game.publishers),
    website: !!info.website && normSite(info.website.url) !== normSite(game.website_url ?? ''),
  };
}

function normSite(u: string): string {
  return u.trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '');
}

/**
 * Pre-ticked: empty fields get the suggestion; a field that already has a value is only replaced
 * when the user ticks it (as with the BoardGameGeek link). The illustration is suggested only when
 * the game has none, and then the first picture of the box or the main illustration.
 */
export function defaultChoice(game: Game, info: GameInfo): GameInfoChoice {
  const d = differs(game, info);
  return {
    year: d.year && game.year_published == null,
    publishers: d.publishers && game.publishers.length === 0,
    website: d.website && !game.website_url,
    image: game.cover_file_id ? null : info.images.find((i) => i.kind !== 'other') ?? null,
  };
}

/**
 * Writes what the user chose: the facts in one command, and the picture (fetched through the server,
 * with the image search's small copy when the original site refuses) as the illustration, with its source.
 */
export async function applyGameInfo(app: App, game: Game, info: GameInfo, choice: GameInfoChoice): Promise<string[]> {
  const done: string[] = [];
  const patch: GamePatch = {};
  if (choice.year && info.year_published) patch.year_published = info.year_published.value;
  if (choice.publishers && info.publishers) patch.publishers = info.publishers.value;
  if (choice.website && info.website) patch.website_url = info.website.url;
  if (Object.keys(patch).length) {
    await app.cmd.updateGame(game.id, patch);
    if (patch.year_published !== undefined) done.push('utgivelsesår');
    if (patch.publishers) done.push('utgiver');
    if (patch.website_url) done.push('nettside');
  }
  const img = choice.image;
  if (img) {
    let blob: Blob;
    try {
      blob = await app.ai.fetchImage(img.image_url).catch((err) => {
        if (img.thumbnail_url) return app.ai.fetchImage(img.thumbnail_url);
        throw err;
      });
    } catch (e) {
      const what = done.length ? `${capital(done.join(', '))} er lagt inn, men bildet` : 'Bildet';
      throw new Error(`${what} kunne ikke hentes (${e instanceof Error ? e.message : String(e)}). Velg et annet bilde, eller last det opp selv.`);
    }
    if (!blob.type.startsWith('image/')) throw new Error('Adressen ga ikke et bilde. Velg et annet bilde.');
    await app.cmd.setGameCover(game.id, blob, fileName(img.image_url, blob.type), { image_url: img.image_url, page_url: img.page_url, page_title: img.page_title });
    done.push('illustrasjon');
  }
  return done;
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fileName(url: string, type: string): string {
  const last = (() => { try { return new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? ''; } catch { return ''; } })();
  return /\.[a-z0-9]{2,5}$/i.test(last) ? last.slice(-80) : `illustrasjon.${type.split('/')[1]?.replace(/[^a-z0-9]/g, '') || 'jpg'}`;
}
