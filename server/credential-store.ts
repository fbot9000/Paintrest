/**
 * Hemmeligheter-modulen (skjema §5): the only module that reads or writes
 * `ai_credential`. Everything it returns to other modules is the public view,
 * without `secret_ciphertext`. The decrypted key is only handed to a callback
 * (`useSecret`), which the provider module uses for one outbound call.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decrypt, encrypt } from './crypto.ts';

/** Row shape from skjema §6 «Nøkkel», plus `base_url` (see docs/AVVIK.md). */
interface AiCredentialRow {
  id: string;
  workspace_id: string;
  provider: string;
  label: string;
  base_url: string;
  secret_ciphertext: string;
  default_model: string | null;
  created_at: string;
  updated_at: string;
}

export type PublicCredential = Omit<AiCredentialRow, 'secret_ciphertext'> & { key_hint: string };

export interface CredentialInput {
  provider: string;
  label: string;
  base_url: string;
  /** Omitted on update keeps the stored key. */
  api_key?: string;
  default_model: string | null;
}

export class CredentialStore {
  private file: string;
  private masterKey: Buffer;
  private workspaceId: string;

  constructor(dataDir: string, masterKey: Buffer, workspaceId = 'local') {
    this.masterKey = masterKey;
    this.workspaceId = workspaceId;
    mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    this.file = join(dataDir, 'ai_credential.json');
  }

  private read(): AiCredentialRow | null {
    if (!existsSync(this.file)) return null;
    return JSON.parse(readFileSync(this.file, 'utf8')) as AiCredentialRow;
  }

  private write(row: AiCredentialRow | null): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(row), { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  get(): PublicCredential | null {
    const row = this.read();
    if (!row) return null;
    const { secret_ciphertext, ...rest } = row;
    return { ...rest, key_hint: hint(decrypt(this.masterKey, secret_ciphertext)) };
  }

  save(input: CredentialInput): PublicCredential {
    const existing = this.read();
    const key = input.api_key?.trim();
    if (!existing && !key) throw new UserError('Lim inn API-nøkkelen');
    const now = new Date().toISOString();
    const row: AiCredentialRow = {
      id: existing?.id ?? randomUUID(),
      workspace_id: this.workspaceId,
      provider: input.provider,
      label: input.label,
      base_url: input.base_url,
      secret_ciphertext: key ? encrypt(this.masterKey, key) : existing!.secret_ciphertext,
      default_model: input.default_model,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    };
    this.write(row);
    return this.get()!;
  }

  delete(): void {
    this.write(null);
  }

  /** Decrypts the key for exactly one use. Never return or log the value. */
  async useSecret<T>(fn: (secret: string, cred: PublicCredential) => Promise<T>): Promise<T> {
    const row = this.read();
    if (!row) throw new UserError('Ingen API-nøkkel er lagret');
    const pub = this.get()!;
    return fn(decrypt(this.masterKey, row.secret_ciphertext), pub);
  }
}

/** Shows the last four characters only, so the user can tell keys apart. */
function hint(secret: string): string {
  return secret.length <= 8 ? '••••' : `••••${secret.slice(-4)}`;
}

/** An error whose message is safe to show to the user. */
export class UserError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
