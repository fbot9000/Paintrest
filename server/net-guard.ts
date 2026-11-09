/**
 * Outbound fetches for research go to arbitrary web addresses chosen by a
 * model, so every request is checked: http(s) only, standard ports, and no
 * private, loopback or link-local addresses (also after redirects).
 */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { UserError } from './credential-store.ts';

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v6 = ip.toLowerCase();
  if (v6.startsWith('::ffff:')) return isPrivateAddress(v6.slice(7));
  return v6 === '::1' || v6 === '::' || v6.startsWith('fc') || v6.startsWith('fd') || v6.startsWith('fe8') || v6.startsWith('fe9')
    || v6.startsWith('fea') || v6.startsWith('feb') || v6.startsWith('ff');
}

export async function assertPublicUrl(raw: string, allowLocal = false): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new UserError(`Ugyldig adresse: ${raw.slice(0, 120)}`);
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new UserError('Bare http og https er tillatt');
  if (u.username || u.password) throw new UserError('Adresser med brukernavn er ikke tillatt');
  if (u.port && u.port !== '80' && u.port !== '443' && !allowLocal) throw new UserError('Bare standardporter er tillatt');
  if (allowLocal) return u;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new UserError(`Fant ikke verten ${host}`);
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new UserError('Adressen peker til et privat nett');
  return u;
}

export interface GuardedResponse {
  url: string;
  status: number;
  contentType: string;
  body: Buffer;
}

/** GET with manual redirects (each hop re-checked), a timeout and a size cap. */
export async function guardedGet(raw: string, opts: { maxBytes: number; timeoutMs: number; accept: string; allowLocal?: boolean; fetchImpl?: typeof fetch }): Promise<GuardedResponse> {
  const f = opts.fetchImpl ?? fetch;
  let url = raw;
  for (let hop = 0; hop < 5; hop++) {
    const u = await assertPublicUrl(url, opts.allowLocal);
    const res = await f(u, {
      redirect: 'manual',
      signal: AbortSignal.timeout(opts.timeoutMs),
      headers: {
        Accept: opts.accept,
        'User-Agent': 'Mozilla/5.0 (compatible; PaintrestResearch/0.1; personal research tool)',
        'Accept-Language': 'en,nb;q=0.8',
      },
    }).catch((e: Error) => {
      throw new UserError(e.name === 'TimeoutError' ? `Tidsavbrudd mot ${u.hostname}` : `Kunne ikke nå ${u.hostname}`, 502);
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = new URL(res.headers.get('location')!, u).toString();
      continue;
    }
    const reader = res.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > opts.maxBytes) {
          await reader.cancel();
          throw new UserError(`Svaret fra ${u.hostname} er for stort`, 502);
        }
        chunks.push(value);
      }
    }
    return { url: u.toString(), status: res.status, contentType: res.headers.get('content-type') ?? '', body: Buffer.concat(chunks) };
  }
  throw new UserError('For mange omdirigeringer', 502);
}
