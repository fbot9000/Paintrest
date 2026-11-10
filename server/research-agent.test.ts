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
  images: [{ url: 'https://example.com/img/merlin-front.jpg', alt: 'Merlin front', caption: null, context: null }], language: 'en',
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

describe('bildejakt', () => {
  const focus = { kind: 'images' as const, subject_ref: 'M1', subject_name: 'Balor', game: 'Avalon', reference_image: 'data:image/jpeg;base64,AAAA' };

  function provider(replies: string[]): ResponsesProvider {
    let i = 0;
    return { respond: async () => ({ text: replies[i++] ?? '{"action":"final","message":"slutt","proposals":[]}', model: 'm', usage: null, searches: [], citations: [] }) } as unknown as ResponsesProvider;
  }

  it('ser på bilder fra åpnede sider, med referanse, og beholder begrunnelse og oversettelse', async () => {
    const looks: { urls: string[]; ref: string | null }[] = [];
    const events: ResearchEvent[] = [];
    await runResearch({
      provider: provider([
        '{"action":"open","url":"https://example.com/gallery"}',
        '{"action":"look","image_urls":["https://example.com/img/merlin-front.jpg","https://elsewhere.example/x.jpg"],"question":"Er dette Balor?"}',
        JSON.stringify({ action: 'final', message: 'Fant ett bilde', proposals: [{ type: 'reference_selection', payload: { subject: 'M1',
          images: [{ image_url: 'https://example.com/img/merlin-front.jpg', page_url: 'https://example.com/gallery', confidence: 'medium', reason: 'Teksten sier «Balor ferdig malt».', original_text: '발로르 도색 완료' }],
          sources_read: [{ url: 'https://example.com/gallery', language: 'ko', summary: 'Koreansk maleblogg om Avalon.', original_excerpt: '아발론' }, { url: 'https://never-opened.example' }] } }] }),
      ]),
      search: fakeSearch, openPage: async () => PAGE,
      lookAtImages: async (urls, _q, ref) => { looks.push({ urls, ref }); return '1 – ja – malt – samme positur'; },
    }, { context: {}, messages: [{ role: 'user', content: 'Finn Balor' }], result_types: ['reference_selection'], focus }, (e) => events.push(e));

    expect(looks).toEqual([{ urls: ['https://example.com/img/merlin-front.jpg'], ref: 'data:image/jpeg;base64,AAAA' }]);
    expect(events.some((e) => e.type === 'look_done')).toBe(true);
    const final = events.at(-1) as Extract<ResearchEvent, { type: 'final' }>;
    const payload = (final.proposals[0] as { payload: { images: Record<string, unknown>[]; sources_read: Record<string, unknown>[] } }).payload;
    expect(payload.images[0]).toMatchObject({ confidence: 'medium', reason: 'Teksten sier «Balor ferdig malt».', original_text: '발로르 도색 완료', page_language: 'en' });
    expect(payload.sources_read).toEqual([{ url: 'https://example.com/gallery', title: 'Druid gallery', site: 'example.com', language: 'ko', summary: 'Koreansk maleblogg om Avalon.', original_excerpt: '아발론' }]);
  });

  it('slår av bildevisning når modellen ikke godtar bilder', async () => {
    const { VisionUnsupportedError } = await import('./provider.ts');
    let calls = 0;
    const events: ResearchEvent[] = [];
    await runResearch({
      provider: provider([
        '{"action":"open","url":"https://example.com/gallery"}',
        '{"action":"look","image_urls":["https://example.com/img/merlin-front.jpg"]}',
        '{"action":"look","image_urls":["https://example.com/img/merlin-front.jpg"]}',
      ]),
      search: fakeSearch, openPage: async () => PAGE,
      lookAtImages: async () => { calls++; throw new VisionUnsupportedError('nei', 502); },
    }, { context: {}, messages: [{ role: 'user', content: 'x' }], result_types: [], focus }, (e) => events.push(e));
    expect(calls).toBe(1);
    expect(events.filter((e) => e.type === 'tool_error' && e.action === 'look')).toHaveLength(1);
  });

  it('gir bildejakt flere steg enn vanlig research', async () => {
    const events: ResearchEvent[] = [];
    await runResearch({ provider: provider(Array(30).fill('{"action":"search","query":"q"}')), search: fakeSearch, openPage: async () => PAGE },
      { context: {}, messages: [{ role: 'user', content: 'x' }], result_types: [], focus }, (e) => events.push(e));
    expect(events.filter((e) => e.type === 'search')).toHaveLength(24);
  });
});

describe('sidelesing for bildejakt', () => {
  it('tar med tekst rundt bildet og gjetter språk', async () => {
    const { extract, rewriteForReading } = await import('./fetch-page.ts');
    const html = `<html><body><div class="se-main"><div class="se-component se-text"><p>이번에는 발로르를 도색했습니다.</p></div>
      <div class="se-component se-image"><img data-lazy-src="https://postfiles.example/balor.jpg" alt=""></div>
      <div class="se-component se-text"><p>베이스는 이끼로 꾸몄어요. 아발론 리븐 베일 미니어처 도색 완료 후기입니다. 정말 재미있었습니다 다음에는 다른 미니어처도 칠할 예정입니다.</p></div></div></body></html>`;
    const r = extract('https://m.blog.naver.com/painter/223', html);
    expect(r.language).toBe('ko');
    expect(r.images[0]!.context).toContain('발로르를 도색했습니다');
    expect(r.images[0]!.context).toContain('베이스는 이끼로');
    expect(rewriteForReading('https://blog.naver.com/painter/223456')).toBe('https://m.blog.naver.com/painter/223456');
    expect(rewriteForReading('https://blog.naver.com/PostView.naver?blogId=p&logNo=9')).toBe('https://m.blog.naver.com/p/9');
  });
});

describe('maleplan-oppdrag', () => {
  const focus = { kind: 'plan' as const, subject_ref: 'M1', subject_name: 'Balor', game: 'Avalon', reference_images: ['data:image/jpeg;base64,AAAA', 'data:image/jpeg;base64,BBBB'], revision: false };

  it('sender bildene med forespørselen og har egen instruks', async () => {
    const seen: { input: unknown; instructions?: string }[] = [];
    const provider = { respond: async (input: unknown, opts: { instructions?: string }) => {
      seen.push({ input, instructions: opts.instructions });
      return { text: '{"action":"final","message":"ok","proposals":[]}', model: 'm', usage: null, searches: [], citations: [] };
    } } as unknown as ResponsesProvider;
    await runResearch({ provider, search: null, openPage: async () => PAGE },
      { context: {}, messages: [{ role: 'user', content: 'Lag maleplan' }], result_types: ['paint_plan'], focus }, () => {});
    const last = (seen[0]!.input as { content: unknown }[]).at(-1)!.content as { type: string }[];
    expect(last.map((c) => c.type)).toEqual(['input_text', 'input_image', 'input_image']);
    expect(seen[0]!.instructions).toContain('OPPDRAG: MALEPLAN');
    expect(seen[0]!.instructions).toContain('"palette"');
  });

  it('fortsetter uten bildene hvis modellen avviser dem', async () => {
    const { UserError } = await import('./credential-store.ts');
    let i = 0;
    const inputs: unknown[] = [];
    const provider = { respond: async (input: unknown) => {
      inputs.push(input);
      if (i++ === 0) throw new UserError('Tjenesten svarte med feil 400: image input not supported', 502);
      return { text: '{"action":"final","message":"ok","proposals":[]}', model: 'm', usage: null, searches: [], citations: [] };
    } } as unknown as ResponsesProvider;
    const events: ResearchEvent[] = [];
    await runResearch({ provider, search: null, openPage: async () => PAGE },
      { context: {}, messages: [{ role: 'user', content: 'Lag maleplan' }], result_types: ['paint_plan'], focus }, (e) => events.push(e));
    expect(typeof ((inputs[1] as { content: unknown }[]).at(-1)!.content)).toBe('string');
    expect(events.some((e) => e.type === 'tool_error' && e.action === 'look')).toBe(true);
    expect(events.at(-1)?.type).toBe('final');
  });
});
