import { describe, expect, it } from 'vitest';
import { createLocalCommands } from '../../data/local-commands';
import { memoryPersistence } from '../../data/persistence';
import { Store, emptyTables } from '../../data/store';
import type { GameInfo } from '../../domain/ai';
import { SCHEMA_VERSION } from '../../domain/types';
import type { Game } from '../../domain/types';
import { applyGameInfo, defaultChoice, differs } from './gameLookup';

const box = { image_url: 'https://www.cmon.com/img/box.png', thumbnail_url: 'https://imgs.search.brave.com/b1', page_url: 'https://www.cmon.com/zombicide',
  page_title: 'Zombicide', site: 'cmon.com', kind: 'box' as const, caption: null, confidence: 'high' as const };
const info: GameInfo = {
  official_name: 'Zombicide',
  year_published: { value: 2012, source: { url: 'https://boardgamegeek.com/boardgame/113924', title: 'BGG' }, basis: 'checked' },
  publishers: { value: ['CMON', 'Guillotine Games'], source: null, basis: 'model' },
  website: { url: 'https://www.cmon.com/zombicide', title: 'Zombicide', basis: 'read', why: null },
  images: [{ ...box, image_url: 'https://www.cmon.com/img/logo.png', kind: 'other' }, box],
  sources: [], uncertainty: null,
};

async function setup() {
  const store = new Store({ schema_version: SCHEMA_VERSION, workspace_id: 'ws', tables: emptyTables() }, memoryPersistence());
  const cmd = createLocalCommands(store);
  const { game_id } = await cmd.createProject({ name: 'Zombicide' });
  return { store, cmd, game: () => store.getTables().game[game_id]! };
}

describe('fakta og illustrasjon fra AI: valgene (brukerønske 11.11.2026)', () => {
  it('krysser av for tomme felt og foreslår esken som illustrasjon; felt med verdi erstattes bare når brukeren velger det', async () => {
    const { cmd, game } = await setup();
    expect(defaultChoice(game(), info)).toEqual({ year: true, publishers: true, website: true, image: box });
    await cmd.updateGame(game().id, { year_published: 2013, publishers: ['cmon', 'guillotine games'], website_url: 'www.cmon.com/zombicide/' });
    // Same publishers (case aside) and the same website: nothing to choose; another year: shown, not ticked.
    expect(differs(game(), info)).toEqual({ year: true, publishers: false, website: false });
    expect(defaultChoice(game(), info)).toMatchObject({ year: false, publishers: false, website: false });
    const withCover: Game = { ...game(), cover_file_id: 'f1' };
    expect(defaultChoice(withCover, info).image).toBeNull();
  });

  it('legger inn det som er valgt, og illustrasjonen med kilden; det lille bildet brukes når originalen stenger', async () => {
    const { cmd, store, game } = await setup();
    const fetched: string[] = [];
    const app = { cmd, store, ai: { fetchImage: async (u: string) => {
      fetched.push(u);
      if (!u.includes('brave')) throw new Error('403');
      return new Blob([new Uint8Array([1])], { type: 'image/png' });
    } } } as never;
    const done = await applyGameInfo(app, game(), info, { year: true, publishers: false, website: true, image: box });
    expect(done).toEqual(['utgivelsesår', 'nettside', 'illustrasjon']);
    expect(fetched).toEqual([box.image_url, box.thumbnail_url]);
    const g = game();
    expect([g.year_published, g.publishers, g.website_url]).toEqual([2012, [], 'https://www.cmon.com/zombicide']);
    expect(g.cover_source).toEqual({ image_url: box.image_url, page_url: box.page_url, page_title: 'Zombicide' });
    expect(store.getTables().stored_file[g.cover_file_id!]).toMatchObject({ purpose: 'cover', media_type: 'image/png' });
  });

  it('sier hva som ble lagt inn når bildet ikke kan hentes', async () => {
    const { cmd, store, game } = await setup();
    const app = { cmd, store, ai: { fetchImage: async () => { throw new Error('404'); } } } as never;
    await expect(applyGameInfo(app, game(), info, { year: true, publishers: false, website: false, image: { ...box, thumbnail_url: null } }))
      .rejects.toThrow(/^Utgivelsesår er lagt inn, men bildet kunne ikke hentes \(404\)/);
    expect(game().year_published).toBe(2012);
    expect(game().cover_file_id).toBeNull();
  });
});
