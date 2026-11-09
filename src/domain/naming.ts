/**
 * Automatic names (skjema §1): «Nytt spill 1», «Nytt spill 2», …
 * The next number is one higher than the highest number in use among the
 * given names, so the name stays unique among visible objects.
 */
export function nextAutoName(prefix: string, existingNames: Iterable<string>): string {
  const re = new RegExp(`^${escapeRegExp(prefix)} (\\d+)$`);
  let max = 0;
  for (const name of existingNames) {
    const m = re.exec(name.trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix} ${max + 1}`;
}

export function isAutoName(prefix: string, name: string): boolean {
  return new RegExp(`^${escapeRegExp(prefix)} \\d+$`).test(name.trim());
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const AUTO = {
  game: 'Nytt spill',
  expansion: 'Ny utvidelse',
  subject: 'Ny miniatyr',
  product: 'Ny maling',
  part: 'Ny del',
  image: 'Nytt bilde',
} as const;
