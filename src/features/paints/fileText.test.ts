import { describe, expect, it } from 'vitest';
import { htmlToText, xlsxToText } from './fileText';

/** A minimal zip writer: deflated entries (method 8) unless `stored` is set. */
async function zip(files: Record<string, string>, stored = false): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const local: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const raw = enc.encode(text);
    const data = stored ? raw : new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    const n = enc.encode(name);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true); head.setUint16(8, stored ? 0 : 8, true);
    head.setUint32(18, data.length, true); head.setUint32(22, raw.length, true); head.setUint16(26, n.length, true);
    local.push(new Uint8Array(head.buffer), n, data);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(10, stored ? 0 : 8, true);
    c.setUint32(20, data.length, true); c.setUint32(24, raw.length, true); c.setUint16(28, n.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), n);
    offset += 30 + n.length + data.length;
  }
  const cdSize = central.reduce((s, x) => s + x.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, Object.keys(files).length, true); end.setUint16(10, Object.keys(files).length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const parts = [...local, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((s, x) => s + x.length, 0));
  let p = 0;
  for (const x of parts) { out.set(x, p); p += x.length; }
  return out;
}

const WORKBOOK = {
  'xl/workbook.xml': '<workbook><sheets><sheet name="Vallejo &amp; co" sheetId="2" r:id="rId2"/><sheet name="Citadel" sheetId="1" r:id="rId1"/></sheets></workbook>',
  'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="/xl/worksheets/sheet2.xml"/></Relationships>',
  'xl/sharedStrings.xml': '<sst><si><t>Navn</t></si><si><t>Kode</t></si><si><r><t>Bugman</t></r><r><t xml:space="preserve">&apos;s Glow</t></r></si><si><t>Black</t></si></sst>',
  'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="C2" s="1"/></row></sheetData></worksheet>',
  'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="3"><c r="A3" t="s"><v>3</v></c><c r="C3"><v>70.95</v></c><c r="D3" t="inlineStr"><is><t>matt</t></is></c></row></sheetData></worksheet>',
};

describe('regneark (.xlsx)', () => {
  it('leser arkene i rekkefølge, med navn, delte tekster og tomme kolonner', async () => {
    const text = await xlsxToText(await zip(WORKBOOK));
    expect(text).toBe('# Ark: Vallejo & co\nNavn\tKode\nBlack\t\t70.95\tmatt\n\n# Ark: Citadel\nNavn\nBugman\'s Glow');
  });

  it('leser ukomprimerte filer, og arkfilene når arbeidsboken mangler', async () => {
    const { 'xl/workbook.xml': _w, 'xl/_rels/workbook.xml.rels': _r, ...rest } = WORKBOOK;
    void _w; void _r;
    const text = await xlsxToText(await zip(rest, true));
    expect(text.split('\n\n')[0]).toBe('# Ark: Ark 1\nNavn\nBugman\'s Glow');
  });

  it('sier fra om en fil som ikke er et regneark', async () => {
    await expect(xlsxToText(new TextEncoder().encode('ikke en zip'))).rejects.toThrow(/ikke en gyldig/);
  });
});

describe('HTML', () => {
  it('gjør en ordrebekreftelse om til linjer', () => {
    expect(htmlToText('<html><style>x{}</style><table><tr><td>Nuln Oil</td><td>59,-</td></tr><tr><td>Black &amp; White</td></tr></table><p>Takk!</p></html>'))
      .toBe('Nuln Oil\t59,-\nBlack & White\nTakk!');
  });
});
