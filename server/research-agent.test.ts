import { describe, expect, it } from 'vitest';
import { extract } from './fetch-page.ts';
import type { PageResult } from './fetch-page.ts';
import { isPrivateAddress } from './net-guard.ts';
import { MAX_IMAGE_STEPS, OFFICIAL_STEPS, isRefusal, knowledgeInstructions, normUrl, parseAction, researchInstructions, runResearch, verifyProposals } from './research-agent.ts';
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
        '{"action":"anchor","image_url":null,"description":"Stor demon med pisk","why":"Fant ikke utgiverens bilde"}',
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

  it('gir fase 1 egne steg og bildejakten flere steg enn vanlig research', async () => {
    const events: ResearchEvent[] = [];
    await runResearch({ provider: provider(Array(60).fill('{"action":"search","query":"q"}')), search: fakeSearch, openPage: async () => PAGE },
      { context: {}, messages: [{ role: 'user', content: 'x' }], result_types: [], focus }, (e) => events.push(e));
    const phases = events.flatMap((e) => (e.type === 'phase' ? [e.phase] : []));
    expect(phases).toEqual(['official', 'broad']);
    const firstBroad = events.findIndex((e) => e.type === 'phase' && e.phase === 'broad');
    expect(events.slice(0, firstBroad).filter((e) => e.type === 'search')).toHaveLength(OFFICIAL_STEPS);
    expect(events.filter((e) => e.type === 'search')).toHaveLength(MAX_IMAGE_STEPS);
    expect(events.find((e) => e.type === 'anchor')).toMatchObject({ anchor: { image_url: null } });
  });

  const OFFICIAL: PageResult = {
    url: 'https://publisher.example/avalon/balor', title: 'Balor – Avalon add-on', site: 'publisher.example', author: 'Publisher', language: 'en',
    text: 'Balor, the demon of the mist. Miniatures painted by Studio Nine.',
    images: [{ url: 'https://publisher.example/img/balor-painted.jpg', alt: 'Balor painted', caption: 'Painted by Studio Nine', context: null }],
  };
  const pages = async (url: string) => (url.includes('publisher') ? OFFICIAL : PAGE);

  it('finner et kontrollert anker i fase 1 og bruker det som referanse i fase 2', async () => {
    const noRef = { ...focus, reference_image: null };
    const looks: (string | null)[] = [];
    const events: ResearchEvent[] = [];
    let instructionsSeen: string[] = [];
    const replies = [
      '{"action":"open","url":"https://publisher.example/avalon/balor"}',
      '{"action":"final","message":"for tidlig","proposals":[]}',
      '{"action":"anchor","image_url":"https://elsewhere.example/fake.jpg","page_url":"https://publisher.example/avalon/balor"}',
      '{"action":"anchor","image_url":"https://publisher.example/img/balor-painted.jpg","page_url":"https://publisher.example/avalon/balor","kind":"official","painter":"Studio Nine","description":"Bevinget demon med pisk","why":"Utgiverens produktside"}',
      '{"action":"open","url":"https://example.com/gallery"}',
      '{"action":"look","image_urls":["https://example.com/img/merlin-front.jpg"]}',
      JSON.stringify({ action: 'final', message: 'ferdig', proposals: [{ type: 'reference_selection', payload: { subject: 'M1',
        images: [{ image_url: 'https://example.com/img/merlin-front.jpg', page_url: 'https://example.com/gallery', kind: 'painted', confidence: 'low' }],
        videos: [{ url: 'https://youtu.be/abcdefghijk', why: 'Malevideo' }, { url: 'https://www.youtube.com/watch?v=zzzzzzzzzzz' }, { url: 'https://vimeo.com/1' }] } }] }),
    ];
    let i = 0;
    const prov = { respond: async (_m: unknown, o: { instructions: string }) => { instructionsSeen.push(o.instructions); return { text: replies[i++] ?? '{"action":"final","message":"slutt","proposals":[]}', model: 'm', usage: null, searches: [], citations: [] }; } } as unknown as ResponsesProvider;
    await runResearch({
      provider: prov, search: fakeSearch, openPage: pages,
      lookAtImages: async (_u, _q, ref) => { looks.push(ref); return 'ja'; },
      imageAsDataUrl: async (u) => `data:image/jpeg;base64,${Buffer.from(u).toString('base64')}`,
      videoInfo: async (u) => {
        if (!u.includes('abcdefghijk')) throw new Error('ukjent');
        return { url: 'https://www.youtube.com/watch?v=abcdefghijk', video_id: 'abcdefghijk', title: 'Painting Balor', channel: 'Mini Channel', channel_url: null, thumbnail_url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg' };
      },
    }, { context: {}, messages: [{ role: 'user', content: 'Finn Balor' }], result_types: ['reference_selection'], focus: noRef }, (e) => events.push(e));

    expect(instructionsSeen[0]).toContain('FASE 1 AV 2');
    expect(instructionsSeen.at(-1)).toContain('FASE 2 AV 2');
    expect(instructionsSeen.at(-1)).toContain('Studio Nine');
    expect(looks).toEqual([`data:image/jpeg;base64,${Buffer.from('https://publisher.example/img/balor-painted.jpg').toString('base64')}`]);
    const final = events.at(-1) as Extract<ResearchEvent, { type: 'final' }>;
    const payload = (final.proposals[0] as { payload: { images: Record<string, unknown>[]; anchor: Record<string, unknown>; videos: Record<string, unknown>[] } }).payload;
    expect(payload.anchor).toMatchObject({ image_url: 'https://publisher.example/img/balor-painted.jpg', painter: 'Studio Nine', kind: 'official' });
    expect(payload.images.map((x) => x.image_url)).toEqual(['https://publisher.example/img/balor-painted.jpg', 'https://example.com/img/merlin-front.jpg']);
    expect(payload.images[0]).toMatchObject({ confidence: 'high', kind: 'official' });
    expect(payload.videos).toEqual([{ url: 'https://www.youtube.com/watch?v=abcdefghijk', video_id: 'abcdefghijk', title: 'Painting Balor', channel: 'Mini Channel', thumbnail_url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg', why: 'Malevideo' }]);
    expect(final.warnings.join(' ')).toContain('Fjernet 2 video');
  });

  it('lager et bildeforslag med ankeret selv om agenten ikke foreslår noe', async () => {
    const events: ResearchEvent[] = [];
    await runResearch({
      provider: provider([
        '{"action":"open","url":"https://publisher.example/avalon/balor"}',
        '{"action":"anchor","image_url":"https://publisher.example/img/balor-painted.jpg","page_url":"https://publisher.example/avalon/balor"}',
        '{"action":"final","message":"Fant ingen malte","proposals":[]}',
      ]),
      search: fakeSearch, openPage: pages,
    }, { context: {}, messages: [{ role: 'user', content: 'x' }], result_types: ['reference_selection'], focus }, (e) => events.push(e));
    const final = events.at(-1) as Extract<ResearchEvent, { type: 'final' }>;
    expect(final.proposals).toHaveLength(1);
    expect(final.proposals[0]).toMatchObject({ type: 'reference_selection', payload: { subject: 'M1', images: [{ image_url: 'https://publisher.example/img/balor-painted.jpg' }], videos: [] } });
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

describe('research til biblioteket (bit 7.4)', () => {
  const focus = { kind: 'knowledge' as const, target: 'technique' as const };

  it('har egen instruks, åpner kilder og nedgraderer «vist i kilde» uten åpnet side', async () => {
    const seen: string[] = [];
    const replies = [
      '{"action":"final","message":"Utkast","proposals":[{"type":"technique","evidence":"documented","payload":{"name":"Svamp","steps":[{"title":"Dupp","instruction":"Lite maling","basis":"documented"}],"sources":[{"url":"https://ukjent.example/x","title":"X"}]}}]}',
    ];
    let i = 0;
    const provider = { respond: async (_input: unknown, opts: { instructions?: string }) => {
      seen.push(opts.instructions ?? '');
      return { text: replies[i++] ?? '{"action":"final","message":"slutt","proposals":[]}', model: 'm', usage: null, searches: [], citations: [] };
    } } as unknown as ResponsesProvider;
    const events: ResearchEvent[] = [];
    await runResearch({ provider, search: null, openPage: async () => PAGE },
      { context: {}, messages: [{ role: 'user', content: 'Svamp og oljemaling' }], result_types: ['technique'], focus }, (e) => events.push(e));
    expect(seen[0]).toContain('OPPDRAG: TEKNIKK');
    expect(seen[0]).not.toContain('BILDEJAKT');
    const final = events.find((e) => e.type === 'final') as Extract<ResearchEvent, { type: 'final' }>;
    const p = final.proposals[0] as { evidence: string; payload: { sources: unknown[]; steps: { basis: string }[] } };
    expect(p.payload.sources).toEqual([]);
    expect(p.evidence).toBe('synthesized');
    expect(p.payload.steps[0]!.basis).toBe('synthesized');
    expect(final.warnings.join(' ')).toContain('forslag fra agenten');
  });

  it('beholder «vist i kilde» og sammendrag når siden er åpnet', async () => {
    const events = [] as ResearchEvent[];
    const replies = [
      '{"action":"open","url":"https://example.com/gallery","why":"guide"}',
      '{"action":"final","message":"Utkast","proposals":[{"type":"recipe","evidence":"documented","payload":{"name":"Rust","paints":[{"product":"Ryza Rust"}],"steps":[{"instruction":"Dupp","paints":[1],"basis":"documented"}],"sources":[{"url":"https://example.com/gallery","title":"G"}],"sources_read":[{"url":"https://example.com/gallery","summary":"Viser rust"}]}}]}',
    ];
    await runResearch({ provider: fakeProvider(replies), search: fakeSearch, openPage: async () => PAGE },
      { context: {}, messages: [{ role: 'user', content: 'Rust' }], result_types: ['recipe'], focus: { kind: 'knowledge', target: 'recipe' } }, (e) => events.push(e));
    const final = events.find((e) => e.type === 'final') as Extract<ResearchEvent, { type: 'final' }>;
    const p = final.proposals[0] as { evidence: string; payload: { steps: { basis: string }[]; sources_read: { summary: string }[] } };
    expect(p.evidence).toBe('documented');
    expect(p.payload.steps[0]!.basis).toBe('documented');
    expect(p.payload.sources_read[0]!.summary).toBe('Viser rust');
    expect(final.pages?.map((x) => x.url)).toEqual(['https://example.com/gallery']);
  });

  it('ber om sammenligning, og varianter peker bare på kilder som ble godtatt', async () => {
    const events = [] as ResearchEvent[];
    let instructions = '';
    const replies = [
      '{"action":"open","url":"https://example.com/gallery","why":"guide"}',
      '{"action":"final","message":"ok","proposals":[{"type":"technique","payload":{"name":"Svamp","sources":[{"url":"https://example.com/gallery/","title":"G"},{"url":"https://ukjent.example","title":"U"}],"comparison":{"variants":[{"label":"A","description":"a","sources":["https://example.com/gallery/","https://ukjent.example"],"primary":true}]}}}]}',
    ];
    let i = 0;
    const provider = { respond: async (_input: unknown, opts: { instructions?: string }) => {
      instructions = opts.instructions ?? '';
      return { text: replies[i++] ?? '{"action":"final","message":"slutt","proposals":[]}', model: 'm', usage: null, searches: [], citations: [] };
    } } as unknown as ResponsesProvider;
    await runResearch({ provider, search: fakeSearch, openPage: async () => PAGE },
      { context: {}, messages: [{ role: 'user', content: 'Svamp' }], result_types: ['technique'], focus }, (e) => events.push(e));
    expect(instructions).toContain('"comparison"');
    const final = events.find((e) => e.type === 'final') as Extract<ResearchEvent, { type: 'final' }>;
    const p = final.proposals[0] as { payload: { sources: { url: string }[]; comparison: { variants: { sources: string[] }[] } } };
    expect(p.payload.sources.map((x) => x.url)).toEqual(['https://example.com/gallery']);
    expect(p.payload.comparison.variants[0]!.sources).toEqual(['https://example.com/gallery']);
  });

  it('forbedring har egen instruks', async () => {
    let instructions = '';
    const provider = { respond: async (_i: unknown, opts: { instructions?: string }) => {
      instructions = opts.instructions ?? '';
      return { text: '{"action":"final","message":"ok","proposals":[]}', model: 'm', usage: null, searches: [], citations: [] };
    } } as unknown as ResponsesProvider;
    const events: ResearchEvent[] = [];
    await runResearch({ provider, search: null, openPage: async () => PAGE },
      { context: {}, messages: [{ role: 'user', content: 'For grov' }], result_types: ['technique'], focus: { kind: 'knowledge', target: 'technique', revision: { name: 'Svamp' } } }, (e) => events.push(e));
    expect(instructions).toContain('FORBEDRE TEKNIKKEN «Svamp»');
    expect(instructions).toContain('technique_to_improve');
    expect(events[0]).toEqual({ type: 'status', text: 'Forbedring av Svamp' });
  });
});

describe('videoer og sidedata', () => {
  it('kjenner igjen YouTube-adresser', async () => {
    const { youtubeId } = await import('./fetch-page.ts');
    expect(youtubeId('https://www.youtube.com/watch?v=abcdefghijk&t=10')).toBe('abcdefghijk');
    expect(youtubeId('https://youtu.be/abcdefghijk')).toBe('abcdefghijk');
    expect(youtubeId('https://m.youtube.com/shorts/abcdefghijk')).toBe('abcdefghijk');
    expect(youtubeId('https://www.youtube.com/channel/abc')).toBeNull();
    expect(youtubeId('https://notyoutube.com/watch?v=abcdefghijk')).toBeNull();
  });

  it('leser en YouTube-side gjennom oEmbed', async () => {
    const { fetchPage } = await import('./fetch-page.ts');
    const seen: string[] = [];
    const fetchImpl = (async (u: string) => {
      seen.push(String(u));
      return new Response(JSON.stringify({ title: 'Painting Balor', author_name: 'Mini Channel', thumbnail_url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg' }), { headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const page = await fetchPage('https://youtu.be/abcdefghijk', { fetchImpl, allowLocal: true, oembedBase: 'http://127.0.0.1:1/oembed' });
    expect(seen[0]).toBe('http://127.0.0.1:1/oembed?url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3Dabcdefghijk&format=json');
    expect(page).toMatchObject({ url: 'https://www.youtube.com/watch?v=abcdefghijk', title: 'Painting Balor', author: 'Mini Channel', site: 'youtube.com',
      images: [{ url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg' }], video: { video_id: 'abcdefghijk' } });
  });

  it('henter bilder fra sidedata når siden bygges med skript (kampanjesider)', () => {
    const html = `<html><head><title>Avalon – Gamefound</title></head><body><div id="app"></div>
      <script>window.__STATE__ = {"images":["https:\\/\\/cdn.gamefound.example\\/balor-painted.jpg","https://cdn.gamefound.example/icon-small.png"],"x":"https://cdn.gamefound.example/stretch.webp?w=800"}</script></body></html>`;
    const r = extract('https://gamefound.example/projects/avalon', html);
    expect(r.images.map((i) => i.url)).toEqual(['https://cdn.gamefound.example/balor-painted.jpg', 'https://cdn.gamefound.example/stretch.webp?w=800']);
    expect(r.images[0]!.context).toContain('sidens data');
  });
});

describe('bilder i nettbutikker', () => {
  it('fyller ut størrelsesmaler og viser hvert bilde én gang, i største størrelse', () => {
    const html = `<html><head><title>Deluxe Upgrade Pack</title><meta property="og:image" content="https://cdn.shop.example/files/pack.jpg?v=17"></head><body>
      <img src="https://cdn.shop.example/files/pack_300x.jpg?v=17" alt="Load image into Gallery viewer">
      <img data-src="//cdn.shop.example/files/agents_{width}x.jpg?v=3" data-widths="[180,360]" alt="Load image into Gallery viewer">
      <img src="https://cdn.shop.example/files/agents_360x.jpg?v=3">
      <img src="https://img.example/get?id=1"><img src="https://img.example/get?id=2">
      <img data-src="https://cdn.shop.example/files/x_{size}.jpg"></body></html>`;
    const r = extract('https://shop.example/products/pack', html);
    expect(r.images.map((i) => i.url)).toEqual([
      'https://cdn.shop.example/files/pack.jpg?v=17',
      'https://cdn.shop.example/files/agents_1200x.jpg?v=3',
      'https://img.example/get?id=1',
      'https://img.example/get?id=2',
    ]);
  });
});

describe('innhold, ikke anbefalinger', () => {
  it('tar bare bildene i selve innholdet, og bare hovedbildet på videosider', () => {
    const page = `<html><head><title>Galleri</title></head><body><nav><img src="https://a.example/menu-photo.jpg"></nav>
      <article><p>Malte agenter</p><img src="https://a.example/agents.jpg"></article>
      <aside><img src="https://a.example/other-game.jpg"></aside></body></html>`;
    expect(extract('https://a.example/post', page).images.map((i) => i.url)).toEqual(['https://a.example/agents.jpg']);
    const video = `<html><head><meta property="og:image" content="https://i0.hdslb.example/cover.jpg"><title>视频</title></head><body>
      <img src="https://i0.hdslb.example/rec1.jpg"><img src="https://i0.hdslb.example/rec2.jpg"></body></html>`;
    expect(extract('https://www.bilibili.com/video/BV1x', video).images.map((i) => i.url)).toEqual(['https://i0.hdslb.example/cover.jpg']);
  });
});

describe('bildesøk', () => {
  const focus = { kind: 'images' as const, subject_ref: 'M1', subject_name: 'Agenter', game: 'Dune Imperium', reference_image: null };
  it('leser Brave- og Tavily-svar', async () => {
    const { parseBraveImages, parseTavilyImages } = await import('./search.ts');
    expect(parseBraveImages({ results: [{ title: 'Painted agents', url: 'https://www.reddit.com/r/x/1', source: 'reddit.com',
      thumbnail: { src: 'https://imgs.search.brave.com/abc' }, properties: { url: 'https://i.redd.it/a.jpg' } }, { title: 'x' }] }))
      .toEqual([{ image_url: 'https://i.redd.it/a.jpg', thumbnail_url: 'https://imgs.search.brave.com/abc', page_url: 'https://www.reddit.com/r/x/1', title: 'Painted agents', site: 'reddit.com' }]);
    expect(parseTavilyImages({ results: [{ url: 'https://bgg.example/t', title: 'Thread', images: ['https://cf.bgg.example/1.jpg', { url: 'https://cf.bgg.example/2.jpg', description: 'Agents' }] }] }).map((i) => [i.image_url, i.title]))
      .toEqual([['https://cf.bgg.example/1.jpg', 'Thread'], ['https://cf.bgg.example/2.jpg', 'Agents']]);
  });

  it('søker bilder, ser på miniatyrbildet og foreslår uten å åpne siden', async () => {
    const hit = { image_url: 'https://i.redd.it/agents.jpg', thumbnail_url: 'https://imgs.search.brave.com/t1', page_url: 'https://www.reddit.com/r/dune/1', title: 'Painted my Dune Imperium agents', site: 'reddit.com' };
    const queries: string[] = [];
    const looked: string[][] = [];
    const search = {
      configured: () => true,
      search: async () => [],
      imageSearch: async (q: string) => { queries.push(q); return q.includes('"') ? [] : [hit]; },
    } as unknown as WebSearch;
    const replies = [
      '{"action":"image_search","query":"\\"Dune Imperium\\" agents"}',
      '{"action":"anchor","image_url":"https://i.redd.it/agents.jpg","page_url":"https://www.reddit.com/r/dune/1","kind":"official"}',
      '{"action":"look","image_urls":["https://i.redd.it/agents.jpg"]}',
      JSON.stringify({ action: 'final', message: 'ok', proposals: [{ type: 'reference_selection', payload: { subject: 'M1',
        images: [{ image_url: 'https://i.redd.it/agents.jpg', page_url: 'https://www.reddit.com/r/dune/1', kind: 'painted', confidence: 'high', reason: 'Malt' }] } }] }),
    ];
    let i = 0;
    const prov = { respond: async () => ({ text: replies[i++] ?? '{"action":"final","message":"slutt","proposals":[]}', model: 'm', usage: null, searches: [], citations: [] }) } as unknown as ResponsesProvider;
    const events: ResearchEvent[] = [];
    await runResearch({ provider: prov, search, openPage: async () => { throw new Error('skal ikke åpnes'); },
      lookAtImages: async (urls) => { looked.push(urls); return '1 – ja'; } },
    { context: {}, messages: [{ role: 'user', content: 'x' }], result_types: ['reference_selection'], focus }, (e) => events.push(e));
    expect(queries).toEqual(['"Dune Imperium" agents', 'Dune Imperium agents']);
    expect(looked).toEqual([['https://imgs.search.brave.com/t1']]);
    const final = events.at(-1) as Extract<ResearchEvent, { type: 'final' }>;
    const images = (final.proposals[0] as { payload: { images: Record<string, unknown>[] } }).payload.images;
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ image_url: 'https://i.redd.it/agents.jpg', thumbnail_url: 'https://imgs.search.brave.com/t1', page_url: 'https://www.reddit.com/r/dune/1', site: 'reddit.com' });
    expect(events.some((e) => e.type === 'image_search_done')).toBe(true);
  });
});

describe('brukerens egne bilder', () => {
  it('gir agenten bildene som spor, lar den se på dem, og foreslår dem ikke på nytt', async () => {
    const mine = { image_url: 'https://i.redd.it/mine.jpg', page_url: 'https://www.reddit.com/r/dune/9', title: 'Painted agents by u/brush' };
    const focus = { kind: 'images' as const, subject_ref: 'M1', subject_name: 'Agenter', game: 'Dune Imperium', reference_image: null, user_images: [mine] };
    const seen: string[] = [];
    const looked: string[][] = [];
    const replies = [
      '{"action":"look","image_urls":["https://i.redd.it/mine.jpg"]}',
      '{"action":"anchor","image_url":"https://i.redd.it/mine.jpg","page_url":"https://www.reddit.com/r/dune/9"}',
      JSON.stringify({ action: 'final', message: 'ok', proposals: [{ type: 'reference_selection', payload: { subject: 'M1',
        images: [{ image_url: 'https://i.redd.it/mine.jpg', page_url: 'https://www.reddit.com/r/dune/9' }] } }] }),
    ];
    let i = 0;
    const prov = { respond: async (_m: unknown, o: { instructions: string }) => { seen.push(o.instructions); return { text: replies[i++] ?? '{"action":"final","message":"slutt","proposals":[]}', model: 'm', usage: null, searches: [], citations: [] }; } } as unknown as ResponsesProvider;
    const events: ResearchEvent[] = [];
    await runResearch({ provider: prov, search: fakeSearch, openPage: async () => PAGE, lookAtImages: async (urls) => { looked.push(urls); return 'ja'; } },
      { context: {}, messages: [{ role: 'user', content: 'x' }], result_types: ['reference_selection'], focus }, (e) => events.push(e));
    expect(seen[0]).toContain('Brukeren har allerede funnet dette bildet');
    expect(seen[0]).toContain('https://www.reddit.com/r/dune/9');
    expect(looked).toEqual([['https://i.redd.it/mine.jpg']]);
    expect(events.find((e) => e.type === 'anchor')).toMatchObject({ anchor: { image_url: 'https://i.redd.it/mine.jpg' } });
    const final = events.at(-1) as Extract<ResearchEvent, { type: 'final' }>;
    const images = (final.proposals[0] as { payload: { images: unknown[] } } | undefined)?.payload.images ?? [];
    expect(images).toEqual([]);
  });
});

describe('malingsvalg er brukerens (brukerbeslutning 11.11.2026)', () => {
  it('ingen instruks har en skjult preferanse for malinger brukeren eier', () => {
    const general = researchInstructions({}, ['paint_plan'], 'none');
    const plan = researchInstructions({}, ['paint_plan'], 'none', { kind: 'plan', subject_ref: 'M1', subject_name: 'X', game: 'G', reference_images: [], revision: false });
    const recipe = knowledgeInstructions({}, ['recipe'], 'none', { kind: 'knowledge', target: 'recipe' });
    for (const text of [general, plan, recipe]) expect(text).not.toContain('Foretrekk malinger');
    expect(general).toContain('La ikke eierstatus');
  });

  it('følger valget: bare det jeg har, beste valg, eller begge som to forslag', () => {
    const owned = knowledgeInstructions({}, ['recipe'], 'none', { kind: 'knowledge', target: 'recipe', paints: 'owned' });
    const best = knowledgeInstructions({}, ['recipe'], 'none', { kind: 'knowledge', target: 'recipe', paints: 'best' });
    const both = knowledgeInstructions({}, ['recipe'], 'none', { kind: 'knowledge', target: 'recipe', paints: 'both' });
    expect(owned).toContain('BARE MALINGER BRUKEREN HAR');
    expect(best).toContain('Eierstatus skal ikke påvirke valget');
    expect(both).toContain('Lag TO oppskrift-forslag');
    expect(both).not.toContain('Lag ETT forslag av typen');
    const plan = researchInstructions({}, ['paint_plan'], 'none', { kind: 'plan', subject_ref: 'M1', subject_name: 'X', game: 'G', reference_images: [], revision: false, paints: 'owned' });
    expect(plan).toContain('BARE MALINGER BRUKEREN HAR');
  });

  it('bruker den vanlige tolkningen av korte forespørsler og sier hva den antok', () => {
    const t = knowledgeInstructions({}, ['recipe'], 'none', { kind: 'knowledge', target: 'recipe', paints: 'best' });
    expect(t).toContain('vanlige ildflammer');
    expect(t).toContain('La ikke malingskatalogen');
  });
});

describe('like adresser', () => {
  it('regner ulike YouTube-adresser for samme video som én kilde', () => {
    expect(normUrl('https://youtu.be/abcdefghijk')).toBe(normUrl('https://www.youtube.com/watch?v=abcdefghijk&t=30'));
    const page = { ...PAGE, url: 'https://www.youtube.com/watch?v=abcdefghijk' };
    const opened = new Map([[normUrl(page.url), page]]);
    const r = verifyProposals([{ type: 'technique', evidence: 'documented', payload: { name: 'X', steps: [{ basis: 'documented' }], sources: [{ url: 'https://youtu.be/abcdefghijk', title: 'V' }] } }], opened, new Map());
    const p = r.proposals[0] as { evidence: string; payload: { sources: { opened: boolean }[]; steps: { basis: string }[] } };
    expect(p.payload.sources).toHaveLength(1);
    expect(p.payload.sources[0]!.opened).toBe(true);
    expect(p.payload.steps[0]!.basis).toBe('documented');
  });
});


describe('kilder fra UiB sitt nettsøk og eksempelbilder (bit 7.4)', () => {
  it('leser søketreff (action.sources) og sider UiB åpnet (open_page)', () => {
    const r = parseResponse({ output: [
      { type: 'web_search_call', action: { type: 'search', query: 'fire effect miniature', sources: [{ type: 'url', url: 'https://a.example/fire' }, { type: 'api', name: 'x' } as never] } },
      { type: 'web_search_call', action: { type: 'open_page', url: 'https://b.example/guide' } },
      { type: 'message', content: [{ type: 'output_text', text: '{}' }] },
    ] } as never, 'm');
    expect(r.searches).toEqual(['fire effect miniature']);
    expect(r.search_sources).toEqual([{ url: 'https://a.example/fire', title: 'https://a.example/fire' }]);
    expect(r.hosted_opened).toEqual(['https://b.example/guide']);
  });

  it('godtar sider UiB åpnet som lest, søketreff som sett, og lister det som fjernes', async () => {
    let i = 0;
    const provider = { respond: async () => {
      i++;
      if (i === 1) return { text: '{"action":"final","message":"ok","proposals":[{"type":"technique","evidence":"documented","payload":{"name":"Ild","steps":[{"title":"Rødt","basis":"documented"}],"sources":[{"url":"https://b.example/guide","title":"Guide"},{"url":"https://a.example/fire"},{"url":"https://diktet.example/x"}],"sources_read":[{"url":"https://b.example/guide","summary":"Viser lagdeling"}]}}]}',
        model: 'm', usage: null, searches: ['fire'], citations: [], search_sources: [{ url: 'https://a.example/fire', title: 'Fire' }], hosted_opened: ['https://b.example/guide'] };
      return { text: '{"action":"final","message":"slutt","proposals":[]}', model: 'm', usage: null, searches: [], citations: [] };
    } } as unknown as ResponsesProvider;
    const events: ResearchEvent[] = [];
    await runResearch({ provider, search: null, hostedSearch: 'web_search', openPage: async () => PAGE },
      { context: {}, messages: [{ role: 'user', content: 'Flammer' }], result_types: ['technique'], focus: { kind: 'knowledge', target: 'technique' } }, (e) => events.push(e));
    const final = events.find((e) => e.type === 'final') as Extract<ResearchEvent, { type: 'final' }>;
    const p = final.proposals[0] as { evidence: string; payload: { sources: { url: string; opened: boolean; via?: string }[]; steps: { basis: string }[]; sources_read: { summary: string }[] } };
    expect(p.payload.sources.map((x) => [x.url, x.opened, x.via ?? null])).toEqual([['https://b.example/guide', true, 'uib'], ['https://a.example/fire', false, null]]);
    expect(p.evidence).toBe('documented');
    expect(p.payload.steps[0]!.basis).toBe('documented');
    expect(p.payload.sources_read[0]!.summary).toBe('Viser lagdeling');
    expect(final.warnings.join(' ')).toContain('https://diktet.example/x');
    expect(final.trace.some((t) => t.action === 'open' && t.result === 'Lest via UiB')).toBe(true);
  });

  it('eksempelbilder må komme fra en åpnet side eller et bildesøk', async () => {
    const page = { ...PAGE, url: 'https://blog.example/fire', images: [{ url: 'https://blog.example/fire1.jpg', alt: 'Ild', caption: null, context: null }] };
    const replies = [
      '{"action":"open","url":"https://blog.example/fire","why":"guide"}',
      '{"action":"final","message":"ok","proposals":[{"type":"technique","payload":{"name":"Ild","sources":[{"url":"https://blog.example/fire"}],"images":[{"image_url":"https://blog.example/fire1.jpg","page_url":"https://blog.example/fire","caption":"Ferdig flamme"},{"image_url":"https://gjettet.example/x.jpg","page_url":"https://gjettet.example"}]}}]}',
    ];
    const events: ResearchEvent[] = [];
    await runResearch({ provider: fakeProvider(replies), search: fakeSearch, openPage: async () => page },
      { context: {}, messages: [{ role: 'user', content: 'Ild' }], result_types: ['technique'], focus: { kind: 'knowledge', target: 'technique' } }, (e) => events.push(e));
    const final = events.find((e) => e.type === 'final') as Extract<ResearchEvent, { type: 'final' }>;
    const p = final.proposals[0] as { payload: { images: { image_url: string; caption: string }[] } };
    expect(p.payload.images).toEqual([expect.objectContaining({ image_url: 'https://blog.example/fire1.jpg', caption: 'Ferdig flamme' })]);
    expect(final.warnings.join(' ')).toContain('Fjernet 1 bilde');
  });

  it('sender agenten tilbake én gang hvis den svarer uten å ha lest noe', async () => {
    const seen: string[] = [];
    let i = 0;
    const provider = { respond: async (input: { content: string }[]) => {
      seen.push(String(input.at(-1)?.content ?? ''));
      i++;
      if (i === 1) return { text: '{"action":"final","message":"fra hukommelsen","proposals":[{"type":"technique","payload":{"name":"Ild"}}]}', model: 'm', usage: null, searches: [], citations: [] };
      if (i === 2) return { text: '{"action":"open","url":"https://example.com/gallery"}', model: 'm', usage: null, searches: [], citations: [] };
      return { text: '{"action":"final","message":"lest","proposals":[{"type":"technique","payload":{"name":"Ild","sources":[{"url":"https://example.com/gallery"}]}}]}', model: 'm', usage: null, searches: [], citations: [] };
    } } as unknown as ResponsesProvider;
    const events: ResearchEvent[] = [];
    await runResearch({ provider, search: fakeSearch, openPage: async () => PAGE },
      { context: {}, messages: [{ role: 'user', content: 'Ild' }], result_types: ['technique'], focus: { kind: 'knowledge', target: 'technique' } }, (e) => events.push(e));
    expect(seen[1]).toContain('Du har ikke åpnet noen sider');
    const final = events.find((e) => e.type === 'final') as Extract<ResearchEvent, { type: 'final' }>;
    expect(final.message).toBe('lest');
    expect((final.proposals[0] as { payload: { sources: { opened: boolean }[] } }).payload.sources[0]!.opened).toBe(true);
  });

  it('sier fra når det ikke finnes nettilgang', async () => {
    const events: ResearchEvent[] = [];
    await runResearch({ provider: fakeProvider(['{"action":"final","message":"ok","proposals":[{"type":"technique","payload":{"name":"Ild"}}]}']), search: null, openPage: async () => PAGE },
      { context: {}, messages: [{ role: 'user', content: 'Ild' }], result_types: ['technique'], focus: { kind: 'knowledge', target: 'technique' } }, (e) => events.push(e));
    const final = events.find((e) => e.type === 'final') as Extract<ResearchEvent, { type: 'final' }>;
    expect(final.warnings[0]).toContain('Uten nettsøk');
  });
});

describe('UiB og include-valget', () => {
  it('ber om søketreff, og prøver uten valget hvis UiB avviser det', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { CredentialStore } = await import('./credential-store.ts');
    const { ResponsesProvider } = await import('./provider.ts');
    const { randomBytes } = await import('node:crypto');
    const store = new CredentialStore(mkdtempSync(join(tmpdir(), 'pt-')), randomBytes(32));
    store.save({ label: 'UiB', base_url: 'https://uib.example/v1', api_key: 'hemmelig', default_model: 'm', hosted_search: 'web_search' } as never);
    const bodies: Record<string, unknown>[] = [];
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      bodies.push(body);
      if (body.include) return new Response('{"error":"unknown parameter include"}', { status: 400 });
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: '{}' }] }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const provider = new ResponsesProvider(store, fetchImpl);
    await provider.respond('hei', { hostedSearch: 'web_search' });
    expect(bodies.map((b) => b.include ?? null)).toEqual([['web_search_call.action.sources'], null]);
    // Remembered: the next call does not send it again, and the search tool is still on.
    await provider.respond('hei igjen', { hostedSearch: 'web_search' });
    expect(bodies[2]!.include).toBeUndefined();
    expect(bodies[2]!.tools).toEqual([{ type: 'web_search' }]);
  });
});

describe('research fra bilde', () => {
  const focus = { kind: 'knowledge' as const, target: 'image' as const, paints: 'owned' as const, reference_images: ['data:image/jpeg;base64,AAAA', 'data:image/jpeg;base64,BBBB'] };

  it('sender bildene med forespørselen og ber om oppskrifter og teknikker', async () => {
    const seen: { input: unknown; instructions?: string }[] = [];
    const provider = { respond: async (input: unknown, opts: { instructions?: string }) => {
      seen.push({ input, instructions: opts.instructions });
      return { text: '{"action":"final","message":"ok","proposals":[]}', model: 'm', usage: null, searches: [], citations: [] };
    } } as unknown as ResponsesProvider;
    const events: ResearchEvent[] = [];
    await runResearch({ provider, search: null, openPage: async () => PAGE },
      { context: {}, messages: [{ role: 'user', content: 'Gløden' }], result_types: ['recipe', 'technique'], focus }, (e) => events.push(e));
    const last = (seen[0]!.input as { content: unknown }[]).at(-1)!.content as { type: string }[];
    expect(last.map((c) => c.type)).toEqual(['input_text', 'input_image', 'input_image']);
    expect(seen[0]!.instructions).toContain('FORSLAG FRA BILDE');
    expect(seen[0]!.instructions).toContain('2 bilde(r)');
    expect(seen[0]!.instructions).toContain('BARE MALINGER BRUKEREN HAR');
    expect(seen[0]!.instructions).toContain('{"type": "technique"');
    expect(seen[0]!.instructions).toContain('{"type": "recipe"');
    expect(events[0]).toEqual({ type: 'status', text: 'Research fra bilde · 2 bilder' });
  });

  it('fortsetter uten bildene og sier fra hvis modellen avviser dem', async () => {
    const { UserError } = await import('./credential-store.ts');
    const seen: string[] = [];
    let i = 0;
    const provider = { respond: async (_input: unknown, opts: { instructions?: string }) => {
      i++;
      seen.push(opts.instructions ?? '');
      if (i === 1) throw new UserError('Tjenesten svarte med feil 400: image not supported', 502);
      return { text: '{"action":"final","message":"ok","proposals":[]}', model: 'm', usage: null, searches: [], citations: [] };
    } } as unknown as ResponsesProvider;
    const events: ResearchEvent[] = [];
    await runResearch({ provider, search: null, openPage: async () => PAGE },
      { context: {}, messages: [{ role: 'user', content: 'Gløden' }], result_types: ['recipe', 'technique'], focus }, (e) => events.push(e));
    expect(events.some((e) => e.type === 'tool_error' && e.target === 'bildene dine')).toBe(true);
    expect(seen[1]).toContain('Bildene kunne ikke sendes til modellen');
  });
});

