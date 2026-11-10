import { describe, expect, it } from 'vitest';
import { extract } from './fetch-page.ts';
import type { PageResult } from './fetch-page.ts';
import { isPrivateAddress } from './net-guard.ts';
import { isRefusal, parseAction, runResearch } from './research-agent.ts';
import type { ResearchEvent } from './research-agent.ts';
import { HostedToolError, hostedSearchOf, parseResponse } from './provider.ts';
import type { ResponsesProvider } from './provider.ts';
import { parseBrave, parseTavily } from './search.ts';
import type { WebSearch } from './search.ts';

const PAGE: PageResult = {
  url: 'https://example.com/gallery', title: 'Druid gallery', site: 'example.com', author: 'Painter Pete', text: 'Merlin painted.',
  images: [{ url: 'https://example.com/img/merlin-front.jpg', alt: 'Merlin front', caption: null }],
};

function fakeProvider(replies: string[]): ResponsesProvider {
  let i = 0;
  return { respond: async () => ({ text: replies[i++] ?? '{"action":"final","message":"slutt","proposals":[]}', model: 'test-model', usage: null }) } as unknown as ResponsesProvider;
}

const fakeSearch = {
  configured: () => true,
  search: async () => [{ title: 'Druid gallery', url: 'https://example.com/gallery', snippet: 'Merlin' }],
} as unknown as WebSearch;

async function run(replies: string[]) {
  const events: ResearchEvent[] = [];
  await runResearch(
    { provider: fakeProvider(replies), search: fakeSearch, openPage: async () => PAGE },
    { context: {}, messages: [{ role: 'user', content: 'Finn bilder av Merlin' }], result_types: ['reference_selection'] },
    (e) => events.push(e),
  );
  return events;
}

describe('agentløkke', () => {
  it('søker, åpner og godtar bare bilder fra åpnede sider', async () => {
    const events = await run([
      '{"action":"search","query":"Merlin druid miniature painted"}',
      '```json\n{"action":"open","url":"https://example.com/gallery"}\n```',
      JSON.stringify({ action: 'final', message: 'Fant bilder', proposals: [{ type: 'reference_selection', payload: { subject: 'M1', images: [
        { image_url: 'https://example.com/img/merlin-front.jpg', page_url: 'https://example.com/gallery' },
        { image_url: 'https://invented.example/fake.jpg', page_url: 'https://example.com/gallery' },
      ] } }] }),
    ]);
    expect(events.map((e) => e.type)).toEqual(['status', 'search', 'search_done', 'open', 'open_done', 'final']);
    const final = events.at(-1) as Extract<ResearchEvent, { type: 'final' }>;
    const imgs = (final.proposals[0] as { payload: { images: { image_url: string; creator: string }[] } }).payload.images;
    expect(imgs).toHaveLength(1);
    expect(imgs[0]).toMatchObject({ image_url: 'https://example.com/img/merlin-front.jpg', creator: 'Painter Pete' });
    expect(final.warnings.join(' ')).toMatch(/Fjernet 1 bilde/);
    expect(final.trace).toHaveLength(2);
  });

  it('nedgraderer «dokumentert» uten åpnet kilde og fjerner ukjente kilder', async () => {
    const events = await run([JSON.stringify({ action: 'final', message: 'x', proposals: [{ type: 'catalog_subject', evidence: 'documented', payload: { name: 'Ulv', sources: [{ url: 'https://not-visited.example/' }] } }] })]);
    const final = events.at(-1) as Extract<ResearchEvent, { type: 'final' }>;
    const p = final.proposals[0] as { evidence: string; payload: { sources: unknown[] } };
    expect(p.evidence).toBe('synthesized');
    expect(p.payload.sources).toEqual([]);
  });

  it('stopper etter maks antall steg og ber om final', async () => {
    const events = await run(Array(13).fill('{"action":"search","query":"x"}'));
    expect(events.filter((e) => e.type === 'search')).toHaveLength(12);
    expect(events.at(-1)?.type).toBe('final');
  });

  it('tolker handlinger', () => {
    expect(parseAction('Jeg søker nå: {"action":"search","query":"a"}')).toMatchObject({ action: 'search', query: 'a' });
    expect(parseAction('{"message":"hei","proposals":[]}')).toMatchObject({ action: 'final', message: 'hei' });
    expect(parseAction('bare tekst')).toBeNull();
  });
});

describe('sidelesing', () => {
  it('henter tittel, forfatter, tekst og bilder med absolutte URL-er', () => {
    const html = `<html><head><title>T</title><meta property="og:image" content="/og.jpg"><meta name="author" content="Ann"></head>
      <body><nav>meny</nav><article><h1>Merlin</h1><p>Malt med slapchop.</p>
      <figure><img src="img/a.jpg" alt="Merlin forfra"><figcaption>Forfra</figcaption></figure>
      <img src="/logo.png" alt="logo"><img srcset="s.jpg 300w, l.jpg 1200w" alt="stor"></article><script>x()</script></body></html>`;
    const r = extract('https://site.example/post/1', html);
    expect(r.author).toBe('Ann');
    expect(r.text).toContain('Malt med slapchop.');
    expect(r.text).not.toContain('x()');
    expect(r.images.map((i) => i.url)).toEqual([
      'https://site.example/og.jpg', 'https://site.example/post/img/a.jpg', 'https://site.example/post/l.jpg',
    ]);
    expect(r.images[1]!.caption).toBe('Forfra');
  });
});

describe('nettvern og søkesvar', () => {
  it('kjenner igjen private adresser', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.10', '172.20.0.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1']) expect(isPrivateAddress(ip)).toBe(true);
    for (const ip of ['8.8.8.8', '151.101.1.69', '2606:4700::1111']) expect(isPrivateAddress(ip)).toBe(false);
  });

  it('leser Tavily- og Brave-svar', () => {
    expect(parseTavily({ results: [{ title: 'A', url: 'https://a', content: 'x' }] })).toEqual([{ title: 'A', url: 'https://a', snippet: 'x' }]);
    expect(parseBrave({ web: { results: [{ title: 'B', url: 'https://b', description: '<b>y</b>' }] } })).toEqual([{ title: 'B', url: 'https://b', snippet: 'y' }]);
  });
});

describe('innebygd nettsøk via UiB', () => {
  it('leser sitater og søk fra Responses-svaret', () => {
    const r = parseResponse({
      model: 'gpt-x',
      output: [
        { type: 'web_search_call', action: { type: 'search', query: 'zombicide core box miniatures' } },
        { type: 'message', content: [{ type: 'output_text', text: 'Svar', annotations: [
          { type: 'url_citation', url: 'https://a.example/x', title: 'A' },
          { type: 'url_citation', url_citation: { url: 'https://b.example/y', title: 'B' } },
          { type: 'url_citation', url: 'https://a.example/x', title: 'A' },
        ] }] },
      ],
    }, 'fallback');
    expect(r.searches).toEqual(['zombicide core box miniatures']);
    expect(r.citations).toEqual([{ url: 'https://a.example/x', title: 'A' }, { url: 'https://b.example/y', title: 'B' }]);
    expect(hostedSearchOf(undefined)).toBe('web_search');
    expect(hostedSearchOf('off')).toBeNull();
  });

  it('bruker UiB-søk og Paintrest-åpning, og regner sitater som søketreff', async () => {
    const calls: unknown[] = [];
    let i = 0;
    const provider = {
      respond: async (_input: unknown, opts: { hostedSearch?: string | null }) => {
        calls.push(opts.hostedSearch);
        i++;
        if (i === 1) return { text: '{"action":"open","url":"https://example.com/gallery"}', model: 'm', usage: null, searches: ['druid miniatures'], citations: [{ url: 'https://cited.example/rules', title: 'Rules' }] };
        return { text: JSON.stringify({ action: 'final', message: 'ok', proposals: [{ type: 'catalog_subject', evidence: 'documented', payload: { name: 'Ulv', sources: [{ url: 'https://cited.example/rules' }] } }] }), model: 'm', usage: null, searches: [], citations: [] };
      },
    } as unknown as ResponsesProvider;
    const events: ResearchEvent[] = [];
    await runResearch({ provider, search: null, hostedSearch: 'web_search', openPage: async () => PAGE },
      { context: {}, messages: [{ role: 'user', content: 'Finn ulver' }], result_types: ['catalog_subject'] }, (e) => events.push(e));
    expect(calls).toEqual(['web_search', 'web_search']);
    expect(events.map((e) => e.type)).toEqual(['status', 'search', 'search_done', 'open', 'open_done', 'final']);
    const final = events.at(-1) as Extract<ResearchEvent, { type: 'final' }>;
    // Cited but not opened: kept as a source, but "documented" needs an opened page.
    const p = final.proposals[0] as { evidence: string; payload: { sources: { url: string; opened: boolean }[] } };
    expect(p.payload.sources).toEqual([{ url: 'https://cited.example/rules', title: 'Rules', author: null, opened: false }]);
    expect(p.evidence).toBe('synthesized');
  });

  it('faller tilbake til Tavily/Brave når UiB avviser verktøyet', async () => {
    let i = 0;
    const seen: unknown[] = [];
    const provider = {
      respond: async (_input: unknown, opts: { hostedSearch?: string | null; instructions?: string }) => {
        seen.push(opts.hostedSearch ?? null);
        i++;
        if (i === 1) throw new HostedToolError('UiB godtok ikke nettsøkverktøyet', 502);
        if (i === 2) return { text: '{"action":"search","query":"q"}', model: 'm', usage: null, searches: [], citations: [] };
        return { text: '{"action":"final","message":"ok","proposals":[]}', model: 'm', usage: null, searches: [], citations: [] };
      },
    } as unknown as ResponsesProvider;
    const events: ResearchEvent[] = [];
    await runResearch({ provider, search: fakeSearch, hostedSearch: 'web_search', openPage: async () => PAGE },
      { context: {}, messages: [{ role: 'user', content: 'x' }], result_types: [] }, (e) => events.push(e));
    expect(seen).toEqual(['web_search', null, null]);
    expect(events.some((e) => e.type === 'tool_error' && e.target === 'UiB nettsøk')).toBe(true);
    expect(events.some((e) => e.type === 'search' && e.query === 'q')).toBe(true);
    expect(events.at(-1)?.type).toBe('final');
  });
});

describe('avslag fra modellen', () => {
  it('prøver én gang til og forklarer et vedvarende avslag', async () => {
    const events = await run(["I'm sorry, but I cannot assist with that request.", "I'm sorry, but I cannot assist with that request."]);
    const final = events.at(-1) as Extract<ResearchEvent, { type: 'final' }>;
    expect(final.message).toBe('Agenten fikk ikke svar fra modellen denne gangen.');
    expect(final.warnings[0]).toMatch(/avslo forespørselen/);
    expect(final.warnings[0]).toMatch(/før agenten hadde søkt/);
  });

  it('fortsetter når modellen følger formatet etter påminnelse', async () => {
    const events = await run(["I'm sorry, but I cannot assist with that request.", '{"action":"final","message":"ok","proposals":[]}']);
    expect((events.at(-1) as Extract<ResearchEvent, { type: 'final' }>).message).toBe('ok');
  });

  it('kjenner igjen avslag', () => {
    expect(isRefusal("I'm sorry, but I cannot assist with that request.")).toBe(true);
    expect(isRefusal('Beklager, men jeg kan ikke hjelpe med det.')).toBe(true);
    expect(isRefusal('Her er miniatyrene i esken.')).toBe(false);
  });
});
