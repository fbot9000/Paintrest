import type { BggCandidate, Commands, LinkBggResult, SubjectPatch } from '../domain/commands';
import { CommandError } from '../domain/commands';
import { newId, now } from '../domain/ids';
import { AUTO, isAutoName, nextAutoName } from '../domain/naming';
import type {
  Id, LocalDeviation, MiniatureSubject,
} from '../domain/types';
import { currentPlanVersion, liveExpansionsOfGame } from '../domain/views';
import type { Store } from './store';
import { buildSampleData } from './seed';
import { attachImages, downloadImages, setCover, sourceFor } from './images-tx';
import { must, record } from './tx-helpers';
import { createKnowledgeCommands } from './knowledge-commands';

function normaliseSubject(s: MiniatureSubject): void {
  if (!Number.isInteger(s.physical_count) || s.physical_count < 1) {
    throw new CommandError('Antall fysiske figurer må være minst 1');
  }
  // PROTOTYPE: datamodell v3 §7 says a single figure has physicalCount 1.
  if (s.grouping === 'single') s.physical_count = 1;
  if (s.finished_count > s.physical_count) s.finished_count = s.physical_count;
}

export function createLocalCommands(store: Store, deps: { fetchImage?: (url: string) => Promise<Blob> } = {}): Commands {
  const tx = store.transaction.bind(store);
  const blobs = store.persistence;
  const urlCache = new Map<Id, string>();

  async function storeFile(ws: Id, purpose: 'cover' | 'source_asset', file: Blob) {
    const id = newId();
    await blobs.putBlob(id, file);
    return {
      id,
      workspace_id: ws,
      purpose,
      storage_key: id,
      media_type: file.type || 'application/octet-stream',
      byte_size: file.size,
      created_at: now(),
      deleted_at: null,
    };
  }

  const commands: Commands = {
    ...createKnowledgeCommands(store),

    // ---------- Prosjekt ----------
    async createProject(input) {
      return tx((t, ws) => {
        const taken = Object.values(t.game).filter((g) => !g.deleted_at).map((g) => g.primary_name);
        const name = input?.name?.trim() || nextAutoName(AUTO.game, taken);
        const game_id = newId();
        const project_id = newId();
        const ts = now();
        t.game[game_id] = {
          id: game_id, workspace_id: ws, origin: 'manual', bgg_thing_id: null,
          primary_name: name, year_published: null, publishers: [], cover_file_id: null,
          created_at: ts, deleted_at: null,
        };
        t.project[project_id] = {
          id: project_id, workspace_id: ws, game_id, content_revision: 0, created_at: ts, deleted_at: null,
        };
        record(t, ws, { target_type: 'game', target_id: game_id, action: 'create' });
        record(t, ws, { target_type: 'project', target_id: project_id, action: 'create' });
        return { project_id, game_id };
      });
    },

    async deleteProject(project_id) {
      // PROTOTYPE: always soft delete so «restore» works; see docs/AVVIK.md.
      tx((t, ws) => {
        const p = must(t.project[project_id], 'Prosjektet');
        p.deleted_at = now();
        record(t, ws, { target_type: 'project', target_id: project_id, action: 'delete' });
      });
    },

    async restoreProject(project_id) {
      tx((t, ws) => {
        const p = must(t.project[project_id], 'Prosjektet');
        p.deleted_at = null;
        const g = t.game[p.game_id];
        if (g) g.deleted_at = null;
        record(t, ws, { target_type: 'project', target_id: project_id, action: 'restore' });
      });
    },

    async updateGame(game_id, patch) {
      tx((t, ws) => {
        const g = must(t.game[game_id], 'Spillet');
        if (patch.primary_name !== undefined) {
          const name = patch.primary_name.trim();
          if (!name) throw new CommandError('Navnet kan ikke være tomt');
          g.primary_name = name;
        }
        if (patch.year_published !== undefined) g.year_published = patch.year_published;
        if (patch.publishers !== undefined) g.publishers = patch.publishers.map((p) => p.trim()).filter(Boolean);
        record(t, ws, { target_type: 'game', target_id: game_id, action: 'update' });
      });
    },

    async setGameCover(game_id, file) {
      const ws = store.snapshot.workspace_id;
      const sf = file ? await storeFile(ws, 'cover', file) : null;
      tx((t) => {
        const g = must(t.game[game_id], 'Spillet');
        const old = g.cover_file_id ? t.stored_file[g.cover_file_id] : undefined;
        if (old) old.deleted_at = now();
        if (sf) t.stored_file[sf.id] = sf;
        g.cover_file_id = sf?.id ?? null;
        record(t, ws, { target_type: 'game', target_id: game_id, action: 'update' });
      });
    },

    async linkBgg(game_id, c: BggCandidate, opts): Promise<LinkBggResult> {
      return tx((t, ws) => {
        const g = must(t.game[game_id], 'Spillet');
        const other = Object.values(t.game).find(
          (x) => x.id !== game_id && !x.deleted_at && x.bgg_thing_id === c.thing_id,
        );
        // skjema §10: the user is told and decides; nothing is written.
        if (other) return { status: 'duplicate', other_game_id: other.id, other_name: other.primary_name };

        const replace = !!opts?.replace;
        g.bgg_thing_id = c.thing_id;
        g.origin = 'bgg';
        if (replace || isAutoName(AUTO.game, g.primary_name)) g.primary_name = c.primary_name;
        if (replace || g.year_published == null) g.year_published = c.year_published;
        if (replace || g.publishers.length === 0) g.publishers = [...c.publishers];

        for (const ex of c.expansions) {
          if (!opts?.expansion_thing_ids?.includes(ex.thing_id)) continue;
          let row = Object.values(t.expansion).find((e) => e.game_id === game_id && e.bgg_thing_id === ex.thing_id)
            // A manual expansion with the same name is the same box: link it instead of duplicating.
            ?? Object.values(t.expansion).find((e) => e.game_id === game_id && e.bgg_thing_id === null
              && e.name.trim().toLowerCase() === ex.name.trim().toLowerCase());
          if (row && row.bgg_thing_id === null) {
            row.bgg_thing_id = ex.thing_id;
            record(t, ws, { target_type: 'expansion', target_id: row.id, action: 'link_bgg' });
          }
          if (!row) {
            row = {
              id: newId(), game_id, origin: 'bgg', bgg_thing_id: ex.thing_id,
              name: ex.name, year_published: ex.year_published, deleted_at: null,
            };
            t.expansion[row.id] = row;
            record(t, ws, { target_type: 'expansion', target_id: row.id, action: 'create' });
          }
          row.deleted_at = null;
          const pid = opts.project_id;
          if (pid && !t.project_expansion.some((pe) => pe.project_id === pid && pe.expansion_id === row!.id)) {
            t.project_expansion.push({ project_id: pid, expansion_id: row.id });
          }
        }
        record(t, ws, { target_type: 'game', target_id: game_id, action: 'link_bgg' });
        return { status: 'linked' };
      });
    },

    async unlinkBgg(game_id) {
      tx((t, ws) => {
        const g = must(t.game[game_id], 'Spillet');
        g.bgg_thing_id = null;
        g.origin = 'manual';
        record(t, ws, { target_type: 'game', target_id: game_id, action: 'update' });
      });
    },

    async createExpansion(game_id, input) {
      return tx((t, ws) => {
        must(t.game[game_id], 'Spillet');
        const taken = liveExpansionsOfGame(t, game_id).map((e) => e.name);
        const id = newId();
        t.expansion[id] = {
          id, game_id, origin: 'manual', bgg_thing_id: null,
          name: input?.name?.trim() || nextAutoName(AUTO.expansion, taken),
          year_published: null, deleted_at: null,
        };
        record(t, ws, { target_type: 'expansion', target_id: id, action: 'create' });
        const pid = input?.attach_to_project_id;
        if (pid) {
          t.project_expansion.push({ project_id: pid, expansion_id: id });
          record(t, ws, { target_type: 'project_expansion', target_id: id, action: 'attach' });
        }
        return id;
      });
    },

    async updateExpansion(expansion_id, patch) {
      tx((t, ws) => {
        const e = must(t.expansion[expansion_id], 'Utvidelsen');
        if (patch.name !== undefined) {
          if (!patch.name.trim()) throw new CommandError('Navnet kan ikke være tomt');
          e.name = patch.name.trim();
        }
        if (patch.year_published !== undefined) e.year_published = patch.year_published;
        record(t, ws, { target_type: 'expansion', target_id: expansion_id, action: 'update' });
      });
    },

    async deleteExpansion(expansion_id) {
      tx((t, ws) => {
        must(t.expansion[expansion_id], 'Utvidelsen').deleted_at = now();
        record(t, ws, { target_type: 'expansion', target_id: expansion_id, action: 'delete' });
      });
    },

    async restoreExpansion(expansion_id) {
      tx((t, ws) => {
        must(t.expansion[expansion_id], 'Utvidelsen').deleted_at = null;
        record(t, ws, { target_type: 'expansion', target_id: expansion_id, action: 'restore' });
      });
    },

    async attachExpansion(project_id, expansion_id) {
      tx((t, ws) => {
        const p = must(t.project[project_id], 'Prosjektet');
        const e = must(t.expansion[expansion_id], 'Utvidelsen');
        // skjema §6: the expansion must belong to the project's game.
        if (e.game_id !== p.game_id) throw new CommandError('Utvidelsen hører til et annet spill');
        if (t.project_expansion.some((pe) => pe.project_id === project_id && pe.expansion_id === expansion_id)) return;
        t.project_expansion.push({ project_id, expansion_id });
        record(t, ws, { target_type: 'project_expansion', target_id: expansion_id, action: 'attach' });
      });
    },

    async detachExpansion(project_id, expansion_id) {
      tx((t, ws) => {
        t.project_expansion = t.project_expansion.filter(
          (pe) => !(pe.project_id === project_id && pe.expansion_id === expansion_id),
        );
        record(t, ws, { target_type: 'project_expansion', target_id: expansion_id, action: 'detach' });
      });
    },

    // ---------- Miniatyrer ----------
    async createSubject(project_id, input?: SubjectPatch) {
      return tx((t, ws) => {
        must(t.project[project_id], 'Prosjektet');
        const taken = Object.values(t.miniature_subject)
          .filter((s) => s.project_id === project_id && !s.deleted_at)
          .map((s) => s.name);
        const id = newId();
        const s: MiniatureSubject = {
          id, project_id,
          expansion_id: input?.expansion_id ?? null,
          name: input?.name?.trim() || nextAutoName(AUTO.subject, taken),
          grouping: input?.grouping ?? 'single',
          physical_count: input?.physical_count ?? 1,
          category_label: input?.category_label ?? null,
          official_asset_id: null,
          plan_state: 'none',
          in_progress: false,
          finished_count: 0,
          count_basis: null,
          grouping_basis: null,
          uncertainty: null,
          current_plan_version_id: null,
          deleted_at: null,
        };
        normaliseSubject(s);
        t.miniature_subject[id] = s;
        record(t, ws, { target_type: 'miniature_subject', target_id: id, action: 'create' });
        return id;
      });
    },

    async updateSubject(subject_id, patch) {
      tx((t, ws) => {
        const s = must(t.miniature_subject[subject_id], 'Miniatyren');
        if (patch.name !== undefined) {
          if (!patch.name.trim()) throw new CommandError('Navnet kan ikke være tomt');
          s.name = patch.name.trim();
        }
        if (patch.grouping !== undefined) s.grouping = patch.grouping;
        if (patch.physical_count !== undefined) s.physical_count = patch.physical_count;
        if (patch.expansion_id !== undefined) s.expansion_id = patch.expansion_id;
        if (patch.category_label !== undefined) s.category_label = patch.category_label?.trim() || null;
        normaliseSubject(s);
        record(t, ws, { target_type: 'miniature_subject', target_id: subject_id, action: 'update' });
      });
    },

    async deleteSubject(subject_id) {
      tx((t, ws) => {
        must(t.miniature_subject[subject_id], 'Miniatyren').deleted_at = now();
        record(t, ws, { target_type: 'miniature_subject', target_id: subject_id, action: 'delete' });
      });
    },

    async restoreSubject(subject_id) {
      tx((t, ws) => {
        must(t.miniature_subject[subject_id], 'Miniatyren').deleted_at = null;
        record(t, ws, { target_type: 'miniature_subject', target_id: subject_id, action: 'restore' });
      });
    },

    async setSubjectImage(subject_id, file, filename) {
      const ws = store.snapshot.workspace_id;
      const sf = file ? await storeFile(ws, 'source_asset', file) : null;
      tx((t) => {
        const s = must(t.miniature_subject[subject_id], 'Miniatyren');
        if (!sf) {
          s.official_asset_id = null;
        } else {
          // skjema §6 Kilder: a manual upload is a kept source with one asset.
          const taken = Object.values(t.source).filter((x) => !x.deleted_at).map((x) => x.title);
          const source_id = newId();
          const asset_id = newId();
          t.stored_file[sf.id] = sf;
          t.source[source_id] = {
            id: source_id, workspace_id: ws, kind: 'image',
            title: filename?.trim() || nextAutoName(AUTO.image, taken),
            creator: null, url: null, locator: null, analysis_state: 'stored', retention: 'kept',
            created_by_task_id: null, created_at: now(), deleted_at: null,
          };
          t.source_asset[asset_id] = {
            id: asset_id, source_id, position: 0, locator: null, caption: null, file_id: sf.id, deleted_at: null,
          };
          s.official_asset_id = asset_id;
          record(t, ws, { target_type: 'source', target_id: source_id, action: 'create' });
        }
        record(t, ws, { target_type: 'miniature_subject', target_id: subject_id, action: 'update' });
      });
    },

    async addSubjectImages(subject_id, files) {
      if (!files.length) return;
      const ws = store.snapshot.workspace_id;
      const stored: (typeof files[number] & { sf: Awaited<ReturnType<typeof storeFile>> })[] = [];
      for (const f of files) stored.push({ ...f, sf: await storeFile(ws, 'source_asset', f.blob) });
      tx((t) => {
        const s = must(t.miniature_subject[subject_id], 'Miniatyren');
        if (s.deleted_at) throw new CommandError('Miniatyren er slettet');
        for (const f of stored) {
          const taken = Object.values(t.source).filter((x) => !x.deleted_at).map((x) => x.title);
          const source_id = newId();
          const asset_id = newId();
          const link_id = newId();
          t.stored_file[f.sf.id] = f.sf;
          t.source[source_id] = {
            id: source_id, workspace_id: ws, kind: 'image', title: f.title?.trim() || nextAutoName(AUTO.image, taken),
            creator: null, url: f.page_url ?? null, locator: null, analysis_state: 'stored', retention: 'kept',
            created_by_task_id: null, created_at: now(), deleted_at: null,
          };
          t.source_asset[asset_id] = { id: asset_id, source_id, position: 0, locator: null, caption: null, file_id: f.sf.id, deleted_at: null };
          t.source_link[link_id] = { id: link_id, source_id, target_type: 'subject', target_id: subject_id, use: 'visual_reference', layer_id: null, deleted_at: null };
          if (!s.official_asset_id) s.official_asset_id = asset_id;
          record(t, ws, { target_type: 'source', target_id: source_id, action: 'create' });
          record(t, ws, { target_type: 'source_link', target_id: link_id, action: 'attach' });
        }
        record(t, ws, { target_type: 'miniature_subject', target_id: subject_id, action: 'update' });
      });
    },

    async attachWebImages(subject_id, images, cover_image_url) {
      if (!images.length) throw new CommandError('Velg minst ett bilde');
      const files = await downloadImages(store, deps.fetchImage, images);
      tx((t, ws) => {
        const assets = attachImages(t, ws, subject_id, images, files, null, (tt, id, a) => record(t, ws, { target_type: tt, target_id: id, action: a }));
        if (cover_image_url && assets[cover_image_url]) {
          setCover(t, subject_id, assets[cover_image_url]!, (tt, id, a) => record(t, ws, { target_type: tt, target_id: id, action: a }));
          record(t, ws, { target_type: 'miniature_subject', target_id: subject_id, action: 'update' });
        }
      });
    },

    async saveVideoSource(subject_id, video) {
      if (!/^https:\/\/(www\.)?youtube\.com\/watch\?v=/.test(video.url)) throw new CommandError('Bare YouTube-videoer kan lagres her');
      tx((t, ws) => {
        const s = must(t.miniature_subject[subject_id], 'Miniatyren');
        if (s.deleted_at) throw new CommandError('Miniatyren er slettet');
        const log = (tt: Parameters<typeof record>[2]['target_type'], id: Id, a: Parameters<typeof record>[2]['action']) => record(t, ws, { target_type: tt, target_id: id, action: a });
        const source_id = sourceFor(t, ws, { url: video.url, title: video.title, creator: video.channel, kind: 'video' }, null, log);
        t.source[source_id]!.kind = 'video';
        const linked = Object.values(t.source_link).some((l) => !l.deleted_at && l.source_id === source_id && l.target_type === 'subject' && l.target_id === subject_id);
        if (linked) return;
        const id = newId();
        t.source_link[id] = { id, source_id, target_type: 'subject', target_id: subject_id, use: 'method', layer_id: null, deleted_at: null };
        log('source_link', id, 'attach');
      });
    },

    async setSubjectCover(subject_id, asset_id) {
      tx((t, ws) => {
        must(t.miniature_subject[subject_id], 'Miniatyren');
        if (asset_id && (!t.source_asset[asset_id] || t.source_asset[asset_id]!.deleted_at)) throw new CommandError('Bildet finnes ikke');
        setCover(t, subject_id, asset_id, (tt, id, a) => record(t, ws, { target_type: tt, target_id: id, action: a }));
        record(t, ws, { target_type: 'miniature_subject', target_id: subject_id, action: 'update' });
      });
    },

    async detachSubjectImage(subject_id, asset_id) {
      tx((t, ws) => {
        const s = must(t.miniature_subject[subject_id], 'Miniatyren');
        const links = Object.values(t.source_link).filter((l) => !l.deleted_at && l.target_type === 'subject' && l.target_id === subject_id && l.use === 'visual_reference');
        for (const l of links) {
          const before = t.source_link_asset.filter((x) => x.link_id === l.id);
          if (!before.some((x) => x.source_asset_id === asset_id)) continue;
          t.source_link_asset = t.source_link_asset.filter((x) => !(x.link_id === l.id && x.source_asset_id === asset_id));
          // A link without assets would show the whole source, so it is removed too.
          if (before.length === 1) l.deleted_at = now();
          record(t, ws, { target_type: 'source_link', target_id: l.id, action: 'detach' });
        }
        if (s.official_asset_id === asset_id) {
          s.official_asset_id = null;
          record(t, ws, { target_type: 'miniature_subject', target_id: subject_id, action: 'update' });
        }
      });
    },

    // ---------- Palett ----------
    async addPaletteEntry(subject_id, product_id, input) {
      return tx((t, ws) => {
        const s = must(t.miniature_subject[subject_id], 'Miniatyren');
        must(t.paint_product[product_id], 'Malingen');
        const id = newId();
        t.palette_entry[id] = {
          id, project_id: s.project_id, product_id, role_label: input?.role_label?.trim() || null, note: input?.part?.trim() || null,
          scope_kind: 'subjects', expansion_id: null, category_label: null, deleted_at: null,
        };
        t.palette_entry_subject.push({ palette_entry_id: id, subject_id });
        const p = t.project[s.project_id];
        if (p) p.content_revision++;
        record(t, ws, { target_type: 'palette_entry', target_id: id, action: 'create' });
        return id;
      });
    },

    async updatePaletteEntry(entry_id, patch) {
      tx((t, ws) => {
        const e = must(t.palette_entry[entry_id], 'Palettraden');
        if (patch.role_label !== undefined) e.role_label = patch.role_label?.trim() || null;
        if (patch.part !== undefined) e.note = patch.part?.trim() || null;
        const p = t.project[e.project_id];
        if (p) p.content_revision++;
        record(t, ws, { target_type: 'palette_entry', target_id: entry_id, action: 'update' });
      });
    },

    async removePaletteEntry(entry_id) {
      tx((t, ws) => {
        const e = must(t.palette_entry[entry_id], 'Palettraden');
        e.deleted_at = now();
        const p = t.project[e.project_id];
        if (p) p.content_revision++;
        record(t, ws, { target_type: 'palette_entry', target_id: entry_id, action: 'delete' });
      });
    },

    // ---------- Katalog ----------
    async createProduct(input) {
      return tx((t, ws) => {
        const taken = Object.values(t.paint_product).filter((p) => !p.deleted_at).map((p) => p.name);
        const id = newId();
        t.paint_product[id] = {
          id, workspace_id: ws,
          manufacturer: input?.manufacturer?.trim() || null,
          range_name: input?.range_name?.trim() || null,
          name: input?.name?.trim() || nextAutoName(AUTO.product, taken),
          product_kind: input?.product_kind ?? 'other',
          coverage: null, finish: null,
          identity_status: 'unconfirmed',
          swatch_hex: input?.swatch_hex ?? null,
          created_at: now(), deleted_at: null,
        };
        if (input?.owns) {
          t.inventory_entry.push({ workspace_id: ws, product_id: id, ownership: 'owns', ownership_source: 'manual', updated_at: now() });
        }
        record(t, ws, { target_type: 'paint_product', target_id: id, action: 'create' });
        return id;
      });
    },

    async setOwnership(product_id, ownership) {
      tx((t, ws) => {
        must(t.paint_product[product_id], 'Malingen');
        const e = t.inventory_entry.find((x) => x.product_id === product_id && x.workspace_id === ws);
        if (e) {
          e.ownership = ownership;
          e.ownership_source = 'manual';
          e.updated_at = now();
        } else {
          t.inventory_entry.push({ workspace_id: ws, product_id, ownership, ownership_source: 'manual', updated_at: now() });
        }
        record(t, ws, { target_type: 'inventory_entry', target_id: product_id, action: 'update' });
      });
    },

    // ---------- Plan og malevisning ----------
    async createEmptyPlan(subject_id) {
      return tx((t, ws) => {
        const s = must(t.miniature_subject[subject_id], 'Miniatyren');
        if (s.current_plan_version_id) throw new CommandError('Miniatyren har allerede en maleplan');
        const id = newId();
        t.paint_plan_version[id] = {
          id, subject_id, version_number: 1, state: 'approved', origin: 'user',
          supersedes_id: null, created_at: now(),
        };
        s.current_plan_version_id = id;
        s.plan_state = 'approved';
        record(t, ws, { target_type: 'paint_plan', target_id: subject_id, action: 'new_version', to_version_id: id });
        return id;
      });
    },

    async setInProgress(subject_id, in_progress) {
      tx((t, ws) => {
        must(t.miniature_subject[subject_id], 'Miniatyren').in_progress = in_progress;
        record(t, ws, { target_type: 'miniature_subject', target_id: subject_id, action: 'progress' });
      });
    },

    async setPartDone(subject_id, element_id, done) {
      tx((t, ws) => {
        const p = t.part_progress.find((x) => x.subject_id === subject_id && x.element_id === element_id);
        if (p) p.done = done;
        else t.part_progress.push({ subject_id, element_id, done, last_opened_at: null });
        // Ticking a part is a sign of work; it does not finish the figure.
        const s = must(t.miniature_subject[subject_id], 'Miniatyren');
        if (done && s.finished_count < s.physical_count) s.in_progress = true;
        record(t, ws, { target_type: 'part_progress', target_id: element_id, action: 'progress' });
      });
    },

    async openPart(subject_id, element_id) {
      // UI memory only; not a content change, so no change_record.
      tx((t) => {
        const ts = now();
        const p = t.part_progress.find((x) => x.subject_id === subject_id && x.element_id === element_id);
        if (p) p.last_opened_at = ts;
        else t.part_progress.push({ subject_id, element_id, done: false, last_opened_at: ts });
      });
    },

    async setGroupProgress(subject_id, element_id, count) {
      tx((t, ws) => {
        const s = must(t.miniature_subject[subject_id], 'Miniatyren');
        if (s.grouping !== 'group') throw new CommandError('Gruppetall gjelder bare malegrupper');
        const pv = currentPlanVersion(t, subject_id);
        if (!pv) throw new CommandError('Miniatyren har ingen maleplan');
        const c = Math.max(0, Math.min(s.physical_count, Math.round(count)));
        let row = Object.values(t.group_progress).find(
          (g) => g.subject_id === subject_id && g.plan_version_id === pv.id && g.element_id === element_id,
        );
        if (!row) {
          row = { id: newId(), subject_id, plan_version_id: pv.id, element_id, count: c };
          t.group_progress[row.id] = row;
        }
        row.count = c;
        if (c > 0 && s.finished_count < s.physical_count) s.in_progress = true;
        record(t, ws, { target_type: 'group_progress', target_id: row.id, action: 'progress' });
      });
    },

    async addDeviation(plan_version_id, input) {
      return tx((t, ws) => {
        must(t.paint_plan_version[plan_version_id], 'Planversjonen');
        if (input.kind === 'swap_product' && !input.payload.to_product_id) {
          throw new CommandError('Velg malingen som skal brukes i stedet');
        }
        if (input.kind !== 'swap_product' && !input.payload.text?.trim()) {
          throw new CommandError('Skriv hva som er endret');
        }
        const id = newId();
        t.local_deviation[id] = {
          id, plan_version_id,
          element_id: input.element_id, step_id: input.step_id,
          kind: input.kind, payload: { ...input.payload },
          created_at: now(), sealed_at: null,
        };
        record(t, ws, { target_type: 'local_deviation', target_id: id, action: 'deviation' });
        return id;
      });
    },

    async deleteDeviation(deviation_id) {
      tx((t, ws) => {
        const d = must(t.local_deviation[deviation_id], 'Avviket');
        // skjema §6: a sealed deviation is history and cannot change.
        if (d.sealed_at) throw new CommandError('Avviket er med i en ferdigstilling og kan ikke endres');
        delete t.local_deviation[deviation_id];
        record(t, ws, { target_type: 'local_deviation', target_id: deviation_id, action: 'delete' });
      });
    },

    async markFinished(subject_id, quantity) {
      return tx((t, ws) => {
        const s = must(t.miniature_subject[subject_id], 'Miniatyren');
        const pv = currentPlanVersion(t, subject_id);
        if (!pv) throw new CommandError('Miniatyren har ingen maleplan å ferdigstille mot');
        const left = s.physical_count - s.finished_count;
        const q = Math.round(quantity);
        if (q < 1 || q > left) throw new CommandError(`Du kan markere mellom 1 og ${left} som ferdig`);

        const ts = now();
        const open: LocalDeviation[] = Object.values(t.local_deviation).filter(
          (d) => d.plan_version_id === pv.id && !d.sealed_at,
        );
        const id = newId();
        s.finished_count += q;
        t.paint_completion[id] = {
          id, subject_id, plan_version_id: pv.id,
          deviation_snapshot: structuredClone(open),
          quantity: q, finished_count_after: s.finished_count, created_at: ts,
        };
        // skjema §6: same transaction seals the copied deviations.
        for (const d of open) t.local_deviation[d.id]!.sealed_at = ts;
        if (s.finished_count >= s.physical_count) s.in_progress = false;
        record(t, ws, { target_type: 'paint_completion', target_id: id, action: 'completion', to_version_id: pv.id });
        return id;
      });
    },

    // ---------- Filer ----------
    async getFileUrl(file_id) {
      const cached = urlCache.get(file_id);
      if (cached) return cached;
      const f = store.getTables().stored_file[file_id];
      if (!f || f.deleted_at) return null;
      const blob = await blobs.getBlob(f.storage_key);
      if (!blob) return null;
      const url = URL.createObjectURL(blob);
      urlCache.set(file_id, url);
      return url;
    },

    async resetToSampleData() {
      // Snapshot of the data folder first, so even this can be undone from backups/.
      await blobs.backup?.('before-reset');
      const state = await buildSampleData(blobs);
      urlCache.forEach((u) => URL.revokeObjectURL(u));
      urlCache.clear();
      store.replace(state);
    },
  };
  return commands;
}
