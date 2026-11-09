/**
 * Encryption at rest for the AI key (datamodell v3 §4, skjema §10).
 * AES-256-GCM with a random 12-byte IV per value. The master key comes from
 * PAINTREST_MASTER_KEY (64 hex chars) or a file created on first use with
 * owner-only permissions. Which key store to use in production is still open.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const VERSION = 'v1';

export function loadOrCreateMasterKey(dataDir: string): Buffer {
  const fromEnv = process.env.PAINTREST_MASTER_KEY;
  if (fromEnv) {
    if (!/^[0-9a-fA-F]{64}$/.test(fromEnv)) throw new Error('PAINTREST_MASTER_KEY må være 64 heksadesimale tegn');
    return Buffer.from(fromEnv, 'hex');
  }
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = join(dataDir, 'master.key');
  if (!existsSync(file)) {
    writeFileSync(file, randomBytes(32).toString('hex'), { mode: 0o600 });
  }
  chmodSync(file, 0o600);
  const hex = readFileSync(file, 'utf8').trim();
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error(`Ugyldig hovednøkkel i ${file}`);
  return Buffer.from(hex, 'hex');
}

export function encrypt(masterKey: Buffer, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', masterKey, iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), data.toString('base64')].join(':');
}

export function decrypt(masterKey: Buffer, ciphertext: string): string {
  const [version, iv, tag, data] = ciphertext.split(':');
  if (version !== VERSION || !iv || !tag || !data) throw new Error('Ukjent format på kryptert verdi');
  const decipher = createDecipheriv('aes-256-gcm', masterKey, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
