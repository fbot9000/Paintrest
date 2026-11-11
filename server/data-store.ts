/**
 * Paintrest's data on disk, in one fixed folder (default ~/Paintrest):
 *   data.json   all tables, with a revision number (written atomically)
 *   files/      images and other files, one file per id (+ .type with the media type)
 *   backups/    snapshots of data.json: at start-up and at most once a minute on change; 30 kept
 * The browser loads and saves through this; the port the web app runs on does not matter.
 * A step towards the database the schema describes (skjema §4); the API can stay the same.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UserError } from './credential-store.ts';

export interface StoredData {
  revision: number;
  saved_at: string;
  /** The client's DbState, stored as is. */
  state: unknown;
}

const BACKUP_EVERY_MS = 10 * 60_000;
const KEEP_BACKUPS = 30;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class DataStore {
  readonly dir: string;
  private file: string;
  private filesDir: string;
  private backupsDir: string;
  private lastBackup = 0;
  private seq = 0;

  constructor(dir: string) {
    this.dir = dir;
    this.file = join(dir, 'data.json');
    this.filesDir = join(dir, 'files');
    this.backupsDir = join(dir, 'backups');
    for (const d of [dir, this.filesDir, join(this.filesDir, 'trash'), this.backupsDir]) mkdirSync(d, { recursive: true, mode: 0o700 });
    // A snapshot at every start, so a bad session can always be rolled back.
    if (existsSync(this.file)) this.backup('start');
  }

  read(): StoredData | null {
    if (!existsSync(this.file)) return null;
    return JSON.parse(readFileSync(this.file, 'utf8')) as StoredData;
  }

  /** Saves when `baseRevision` is the current revision; otherwise someone else saved first. */
  write(baseRevision: number, state: unknown): StoredData {
    const current = this.read();
    const currentRevision = current?.revision ?? 0;
    if (baseRevision !== currentRevision) {
      throw new ConflictError(`Dataene er endret et annet sted (revisjon ${currentRevision}, du hadde ${baseRevision}).`, currentRevision);
    }
    const next: StoredData = { revision: currentRevision + 1, saved_at: new Date().toISOString(), state };
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(next));
    renameSync(tmp, this.file);
    if (Date.now() - this.lastBackup > BACKUP_EVERY_MS) this.backup('auto');
    return next;
  }

  /** Copies data.json to backups/ and prunes old snapshots. Returns the backup file name. */
  backup(reason: 'start' | 'auto' | 'manual' | 'before-reset'): string | null {
    if (!existsSync(this.file)) return null;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    // A sequence number keeps names unique (and sorted) within the same millisecond.
    const name = `data-${stamp}-${String(++this.seq).padStart(4, '0')}-${reason}.json`;
    copyFileSync(this.file, join(this.backupsDir, name));
    this.lastBackup = Date.now();
    const all = readdirSync(this.backupsDir).filter((f) => f.startsWith('data-') && f.endsWith('.json')).sort();
    for (const old of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) unlinkSync(join(this.backupsDir, old));
    return name;
  }

  info() {
    const d = this.read();
    const backups = readdirSync(this.backupsDir).filter((f) => f.endsWith('.json')).sort();
    const files = readdirSync(this.filesDir).filter((f) => ID.test(f));
    return {
      data_dir: this.dir,
      revision: d?.revision ?? 0,
      saved_at: d?.saved_at ?? null,
      backups: backups.length,
      latest_backup: backups.at(-1) ?? null,
      files: files.length,
      bytes: existsSync(this.file) ? statSync(this.file).size : 0,
    };
  }

  putFile(id: string, type: string, body: Buffer): void {
    const path = this.filePath(id);
    writeFileSync(`${path}.tmp`, body);
    renameSync(`${path}.tmp`, path);
    writeFileSync(`${path}.type`, type.slice(0, 100));
  }

  getFile(id: string): { type: string; body: Buffer } | null {
    const path = this.filePath(id);
    if (!existsSync(path)) return null;
    const type = existsSync(`${path}.type`) ? readFileSync(`${path}.type`, 'utf8') : 'application/octet-stream';
    return { type, body: readFileSync(path) };
  }

  /** Files are moved to files/trash, never deleted, so a backup can always find its images. */
  trashFile(id: string): void {
    const path = this.filePath(id);
    if (!existsSync(path)) return;
    renameSync(path, join(this.filesDir, 'trash', id));
    if (existsSync(`${path}.type`)) renameSync(`${path}.type`, join(this.filesDir, 'trash', `${id}.type`));
  }

  private filePath(id: string): string {
    if (!ID.test(id)) throw new UserError('Ugyldig fil-id');
    return join(this.filesDir, id.toLowerCase());
  }
}

export class ConflictError extends UserError {
  readonly revision: number;
  constructor(message: string, revision: number) {
    super(message, 409);
    this.revision = revision;
  }
}

/**
 * One-time move of the encrypted keys from the old folder (.paintrest-data in
 * the project) to the data folder, so everything lives in one place.
 * Copies, does not delete; existing files in the new folder are never overwritten.
 */
export function moveKeysFrom(oldDir: string, newDir: string): string[] {
  const moved: string[] = [];
  if (!existsSync(oldDir) || oldDir === newDir) return moved;
  const oldKey = join(oldDir, 'master.key');
  const newKey = join(newDir, 'master.key');
  // The credentials only decrypt with the master key they were made with.
  if (existsSync(newKey) && existsSync(oldKey) && readFileSync(newKey, 'utf8').trim() !== readFileSync(oldKey, 'utf8').trim()) return moved;
  for (const f of ['master.key', 'ai_credential.json', 'search_credential.json']) {
    const from = join(oldDir, f);
    const to = join(newDir, f);
    if (existsSync(from) && !existsSync(to)) {
      copyFileSync(from, to);
      moved.push(f);
    }
  }
  return moved;
}
