/**
 * Sample data so there is something to click on. Everything here is example
 * content: the game and the sources are placeholders taken from the Figma
 * concept, the images are generated SVG placeholders, and swatch colours are
 * approximations, not manufacturer values.
 */
import { newId, now } from '../domain/ids';
import type {
  ElementKind, Id, MaterialRole, Ownership, ProductKind, StoredFile, Tables,
} from '../domain/types';
import { SCHEMA_VERSION } from '../domain/types';
import type { DbState, Persistence } from './store';
import { emptyTables } from './store';

function placeholderSvg(title: string, a: string, b: string, glyph: string): Blob {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 800">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
<radialGradient id="l" cx=".5" cy=".35" r=".6"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
<rect width="600" height="800" fill="url(#g)"/><rect width="600" height="800" fill="url(#l)"/>
<ellipse cx="300" cy="700" rx="170" ry="34" fill="#000" opacity=".25"/>
<path d="M300 170c-46 0-70 36-70 76 0 30 14 50 30 62-62 22-104 92-118 200l-14 170h344l-14-170c-14-108-56-178-118-200 16-12 30-32 30-62 0-40-24-76-70-76z" fill="#0d1a17" opacity=".55"/>
<text x="300" y="470" text-anchor="middle" font-family="Georgia, serif" font-size="150" fill="#f5f2e7" opacity=".85">${glyph}</text>
<text x="300" y="770" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="#f5f2e7" opacity=".8">${escapeXml(title)} · plassholder</text></svg>`;
  return new Blob([svg], { type: 'image/svg+xml' });
}

function coverSvg(): Blob {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 600">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f2621"/><stop offset=".55" stop-color="#2f6b52"/><stop offset="1" stop-color="#c3e1a3"/></linearGradient>
<filter id="b"><feGaussianBlur stdDeviation="30"/></filter></defs>
<rect width="1200" height="600" fill="url(#g)"/>
<g filter="url(#b)" opacity=".7"><circle cx="300" cy="200" r="160" fill="#4f9a6d"/><circle cx="820" cy="380" r="200" fill="#1b3f35"/><circle cx="1000" cy="140" r="110" fill="#d8f07a"/></g>
<text x="60" y="540" font-family="Georgia, serif" font-size="64" fill="#f5f2e7">Avalon · plassholder</text></svg>`;
  return new Blob([svg], { type: 'image/svg+xml' });
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
}

export async function buildSampleData(persistence: Persistence): Promise<DbState> {
  const t: Tables = emptyTables();
  const ws = newId();
  const ts = now();
  t.workspace[ws] = { id: ws, display_name: 'Mitt arbeidsrom', created_at: ts };

  async function file(blob: Blob, purpose: StoredFile['purpose']): Promise<Id> {
    const id = newId();
    await persistence.putBlob(id, blob);
    t.stored_file[id] = {
      id, workspace_id: ws, purpose, storage_key: id, media_type: blob.type,
      byte_size: blob.size, created_at: ts, deleted_at: null,
    };
    return id;
  }

  // ---------- Malinger ----------
  const products: Record<string, Id> = {};
  const P = (key: string, name: string, kind: ProductKind, hex: string, own: Ownership,
    manufacturer: string | null = 'Citadel', range: string | null = null, confirmed = true) => {
    const id = newId();
    products[key] = id;
    t.paint_product[id] = {
      id, workspace_id: ws, manufacturer, range_name: range ?? cap(kind), name, product_kind: kind,
      coverage: null, finish: null, identity_status: confirmed ? 'confirmed' : 'unconfirmed',
      swatch_hex: hex, created_at: ts, deleted_at: null,
    };
    t.inventory_entry.push({ workspace_id: ws, product_id: id, ownership: own, ownership_source: 'manual', updated_at: ts });
  };
  P('chaosBlack', 'Chaos Black', 'primer', '#1b1b1b', 'owns', 'Citadel', 'Spray');
  P('wraithbone', 'Wraithbone', 'primer', '#e3d8b8', 'owns', 'Citadel', 'Spray');
  P('caliban', 'Caliban Green', 'base', '#1f4a32', 'owns');
  P('nuln', 'Nuln Oil', 'shade', '#202323', 'owns');
  P('warpstone', 'Warpstone Glow', 'layer', '#2f7d3c', 'owns');
  P('moot', 'Moot Green', 'layer', '#5cad3c', 'not_owned');
  P('bugman', "Bugman's Glow", 'base', '#83514a', 'owns');
  P('reikland', 'Reikland Fleshshade', 'shade', '#5d3a22', 'owns');
  P('kislev', 'Kislev Flesh', 'layer', '#d1a17a', 'unknown');
  P('rhinox', 'Rhinox Hide', 'base', '#3d2b23', 'owns');
  P('leadbelcher', 'Leadbelcher', 'base', '#7a7c80', 'owns');
  P('agrax', 'Agrax Earthshade', 'shade', '#3b2f22', 'owns');
  P('white', 'Grey Seer', 'base', '#c9cbc7', 'owns');
  P('glaze', 'Grønn glasur fra hylla', 'other', '#3fae7a', 'owns', null, null, false);

  // ---------- Spill og prosjekt ----------
  const game_id = newId();
  const project_id = newId();
  t.game[game_id] = {
    id: game_id, workspace_id: ws, origin: 'manual', bgg_thing_id: null,
    primary_name: 'Avalon: The Riven Veil', year_published: 2026, publishers: ['Shadowborne Games'],
    cover_file_id: await file(coverSvg(), 'cover'), created_at: ts, deleted_at: null,
  };
  t.project[project_id] = { id: project_id, workspace_id: ws, game_id, content_revision: 0, created_at: ts, deleted_at: null };
  const exMist = newId();
  const exMyth = newId();
  t.expansion[exMist] = { id: exMist, game_id, origin: 'manual', bgg_thing_id: null, name: 'Mistwalkers', year_published: null, deleted_at: null };
  t.expansion[exMyth] = { id: exMyth, game_id, origin: 'manual', bgg_thing_id: null, name: 'Myths & Monsters', year_published: null, deleted_at: null };
  t.project_expansion.push({ project_id, expansion_id: exMist }, { project_id, expansion_id: exMyth });

  // Second, nearly empty project: shows an auto-named, incomplete object.
  const g2 = newId();
  const p2 = newId();
  const ts2 = new Date(Date.now() - 86_400_000).toISOString();
  t.game[g2] = { id: g2, workspace_id: ws, origin: 'manual', bgg_thing_id: null, primary_name: 'Nytt spill 1', year_published: null, publishers: [], cover_file_id: null, created_at: ts2, deleted_at: null };
  t.project[p2] = { id: p2, workspace_id: ws, game_id: g2, content_revision: 0, created_at: ts2, deleted_at: null };

  // ---------- Kilde med bilder ----------
  const source_id = newId();
  t.source[source_id] = {
    id: source_id, workspace_id: ws, kind: 'gallery', title: 'Druidene, ferdig malt (eksempelkilde)',
    creator: 'Eksempelkilde', url: null, locator: null, analysis_state: 'stored', retention: 'kept',
    created_by_task_id: null, created_at: ts, deleted_at: null,
  };
  async function asset(src: Id, pos: number, caption: string, blob: Blob): Promise<Id> {
    const id = newId();
    t.source_asset[id] = { id, source_id: src, position: pos, locator: `bilde ${pos + 1}`, caption, file_id: await file(blob, 'source_asset'), deleted_at: null };
    return id;
  }
  const aMerlinFront = await asset(source_id, 0, 'Merlin forfra', placeholderSvg('Merlin forfra', '#123a2f', '#55b07a', 'M'));
  const aMerlinBack = await asset(source_id, 1, 'Merlin bakfra', placeholderSvg('Merlin bakfra', '#0f2a24', '#2f7d5a', 'M'));
  const aRavens = await asset(source_id, 2, 'Ravnene · utsnitt', placeholderSvg('Ravnene', '#1a2422', '#3e5a52', 'R'));
  const aAncient = await asset(source_id, 3, 'The Ancient One', placeholderSvg('The Ancient One', '#183a3a', '#3fa3a0', 'A'));
  const aChamp = await asset(source_id, 4, 'Druid Champions', placeholderSvg('Druid Champions', '#2a2a18', '#8aa04a', 'D'));
  const aMist = await asset(source_id, 5, 'Druid Mistwalker', placeholderSvg('Druid Mistwalker', '#1e2a33', '#7aa6b8', 'W'));

  // ---------- Miniatyrer ----------
  const S = (name: string, grouping: 'single' | 'group', count: number, official: Id, expansion: Id | null = null) => {
    const id = newId();
    t.miniature_subject[id] = {
      id, project_id, expansion_id: expansion, name, grouping, physical_count: count,
      category_label: 'Druidene', official_asset_id: official, plan_state: 'none',
      in_progress: false, finished_count: 0, count_basis: 'documented', grouping_basis: 'inferred',
      uncertainty: null, current_plan_version_id: null, deleted_at: null,
    };
    return id;
  };
  const merlin = S('Merlin', 'single', 1, aMerlinFront);
  S('The Ancient One', 'single', 1, aAncient);
  const champions = S('Druid Champions', 'group', 3, aChamp);
  S('Druid Mistwalker', 'single', 1, aMist, exMist);

  const link = (subject: Id, assets: Id[]) => {
    const id = newId();
    t.source_link[id] = { id, source_id, target_type: 'subject', target_id: subject, use: 'visual_reference', layer_id: null, deleted_at: null };
    assets.forEach((a) => t.source_link_asset.push({ link_id: id, source_asset_id: a }));
  };
  link(merlin, [aMerlinBack, aRavens]);

  // ---------- Maleplaner ----------
  type M = [string, MaterialRole, string?];
  type Step = { text: string; materials?: M[]; mix?: { label: string; parts: [string, number][] } };
  type El = { kind: ElementKind; name: string; steps: Step[] };

  function plan(subject_id: Id, elements: El[]) {
    const pv = newId();
    t.paint_plan_version[pv] = { id: pv, subject_id, version_number: 1, state: 'approved', origin: 'user', supersedes_id: null, created_at: ts };
    elements.forEach((el, ei) => {
      const eid = newId();
      t.plan_element[eid] = { id: eid, plan_version_id: pv, kind: el.kind, position: ei, name: el.name };
      el.steps.forEach((st, si) => {
        const sid = newId();
        t.plan_step[sid] = { id: sid, element_id: eid, position: si, instruction: st.text, technique_version_id: null, recipe_version_id: null };
        st.materials?.forEach(([key, role, label], mi) => {
          const mid = newId();
          t.step_material[mid] = { id: mid, step_id: sid, position: mi, product_id: products[key]!, role, role_label: label ?? null };
        });
        if (st.mix) {
          const gid = newId();
          t.mix_group[gid] = { id: gid, step_id: sid, label: st.mix.label };
          st.mix.parts.forEach(([key, parts], ci) => t.mix_component.push({ mix_group_id: gid, position: ci, product_id: products[key]!, parts }));
        }
      });
    });
    const s = t.miniature_subject[subject_id]!;
    s.current_plan_version_id = pv;
    s.plan_state = 'approved';
  }

  const grunning: El = {
    kind: 'operation', name: 'Grunning og zenithal',
    steps: [
      { text: 'Grunn hele figuren svart.', materials: [['chaosBlack', 'base']] },
      { text: 'Tørrbørst grått ovenfra og ned, slik at lyset faller fra toppen.', materials: [['white', 'highlight', 'tørrbørste']] },
      { text: 'Lett tørrbørsting med lys beige på de høyeste kantene.', materials: [['wraithbone', 'highlight', 'tørrbørste']] },
    ],
  };

  plan(merlin, [
    grunning,
    { kind: 'part', name: 'Kappe og fjær', steps: [
      { text: 'Tynn base over hele kappen. La grunningen skinne gjennom i fordypningene.', materials: [['caliban', 'base']] },
      { text: 'Wash i fordypningene mellom fjærene.', materials: [['nuln', 'wash']] },
      { text: 'Lag på de øvre halvdelene av hver fjær.', materials: [['warpstone', 'layer']] },
      { text: 'Smale høylys på fjærkantene, mest mot toppen.', materials: [['moot', 'highlight', 'kalde høylys']] },
      { text: 'Glasur over overgangene for å binde fargene sammen.', mix: { label: 'Glasur 1:3', parts: [['glaze', 1], ['warpstone', 3]] } },
    ] },
    { kind: 'part', name: 'Hud', steps: [
      { text: 'Base på ansikt og hender.', materials: [['bugman', 'base']] },
      { text: 'Wash, la tørke helt.', materials: [['reikland', 'wash']] },
      { text: 'Lag på nese, kinnben og knoker.', materials: [['kislev', 'layer']] },
    ] },
    { kind: 'part', name: 'Stav', steps: [
      { text: 'Base på treverket.', materials: [['rhinox', 'base']] },
      { text: 'Wash for dybde.', materials: [['agrax', 'wash']] },
      { text: 'Krystallene: grønn base, deretter lys toppunkt.', materials: [['caliban', 'base'], ['moot', 'highlight']] },
    ] },
    { kind: 'part', name: 'Base', steps: [
      { text: 'Stein i grått, wash, tørrbørst lyst.', materials: [['white', 'base'], ['nuln', 'wash'], ['wraithbone', 'highlight', 'tørrbørste']] },
    ] },
    { kind: 'operation', name: 'Avslutning', steps: [
      { text: 'Mattlakk over hele figuren.' },
    ] },
  ]);

  plan(champions, [
    grunning,
    { kind: 'part', name: 'Rustning', steps: [
      { text: 'Metallbase på alle plater.', materials: [['leadbelcher', 'base']] },
      { text: 'Wash i fugene.', materials: [['nuln', 'wash']] },
    ] },
    { kind: 'part', name: 'Kapper', steps: [
      { text: 'Base, wash og lag som på Merlin, men uten høylys.', materials: [['caliban', 'base'], ['nuln', 'wash'], ['warpstone', 'layer']] },
    ] },
    { kind: 'part', name: 'Hud', steps: [
      { text: 'Base og wash.', materials: [['bugman', 'base'], ['reikland', 'wash']] },
    ] },
  ]);

  return { schema_version: SCHEMA_VERSION, workspace_id: ws, tables: t };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
