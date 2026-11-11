import { describe, expect, it } from 'vitest';
import { extract } from './fetch-page.ts';
import type { PageResult } from './fetch-page.ts';
import { isPrivateAddress } from './net-guard.ts';
import { GAME_SOURCE_STEPS, GUIDE_STEPS, IDENTIFY_STEPS, MAX_IMAGE_STEPS, isRefusal, knowledgeInstructions, mergeHeld, mergeSurvey, normUrl, parseAction, researchInstructions, runResearch, verifyProposals } from './research-agent.ts';
import type { ResearchEvent, RunHint } from './research-agent.ts';
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

  /** Records the instructions and messages of every model call. */
  function recorder(replies: string[]) {
    const calls: { instructions: string; messages: { role: string; content: unknown }[] }[] = [];
    let i = 0;
    const prov = { respond: async (m: { role: string; content: unknown }[], o: { instructions: string }) => {
      calls.push({ instructions: o.instructions, messages: structuredClone(m) });
      return { text: replies[i++] ?? '{"action":"final","message":"slutt","proposals":[]}', model: 'm', usage: null, searches: [], citations: [] };
    } } as unknown as ResponsesProvider;
    return { prov, calls };
  }

  it('ser på bilder fra åpnede sider, med referanse, og beholder begrunnelse og oversettelse', async () => {
    const looks: { urls: string[]; ref: string | null }[] = [];
    const events: ResearchEvent[] = [];
    await runResearch({
      provider: provider([
        '{"action":"open","url":"https://example.com/gallery"}',
        '{"action":"look","image_urls":["https://example.com/img/merlin-front.jpg","https://elsewhere.example/x.jpg"],"question":"Er dette Balor?"}',
        '{"action":"identify","official_name":null,"images":[],"description":"Stor demon med pisk","why":"Fant ikke utgiverens bilde"}',
        '{"action":"next_phase"}',
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
    expect(final.identity).toMatchObject({ official_name: null, description: 'Stor demon med pisk', images: [] });
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

  it('har tre faser med egne steg: identifisering, malt av andre og maleguider', async () => {
    const events: ResearchEvent[] = [];
    await runResearch({ provider: provider(Array(80).fill('{"action":"search","query":"q"}')), search: fakeSearch, openPage: async () => PAGE },
      { context: {}, messages: [{ role: 'user', content: 'x' }], result_types: [], focus }, (e) => events.push(e));
    const phases = events.flatMap((e) => (e.type === 'phase' ? [e.phase] : []));
    expect(phases).toEqual(['identify', 'painted', 'guides']);
    const at = (p: string) => events.findIndex((e) => e.type === 'phase' && e.phase === p);
    const searchesBetween = (a: number, b: number) => events.slice(a, b).filter((e) => e.type === 'search').length;
    expect(searchesBetween(0, at('painted'))).toBe(IDENTIFY_STEPS);
    expect(searchesBetween(at('guides'), events.length)).toBe(GUIDE_STEPS);
    expect(events.filter((e) => e.type === 'search')).toHaveLength(MAX_IMAGE_STEPS);
    // Nothing was identified, so there is nothing to show or keep.
    expect(events.some((e) => e.type === 'identity')).toBe(false);
    expect((events.at(-1) as Extract<ResearchEvent, { type: 'final' }>).trace.some((t) => t.action === 'identify' && t.target === 'ikke identifisert')).toBe(true);
  });

  const OFFICIAL: PageResult = {
    url: 'https://publisher.example/avalon/balor', title: 'Balor – Avalon add-on', site: 'publisher.example', author: 'Publisher', language: 'en',
    text: 'Balor, the demon of the mist. Miniatures painted by Studio Nine.',
    images: [{ url: 'https://publisher.example/img/balor-painted.jpg', alt: 'Balor painted', caption: 'Painted by Studio Nine', context: null },
      { url: 'https://publisher.example/img/balor-art.jpg', alt: 'Balor concept art', caption: null, context: null }],
  };
  const pages = async (url: string) => (url.includes('publisher') ? OFFICIAL : PAGE);

  it('identifiserer figuren i fase 1, og bruker navn, beskrivelse og bilde i resten av jakten', async () => {
    const noRef = { ...focus, reference_image: null };
    const looks: (string | null)[] = [];
    const events: ResearchEvent[] = [];
    const { prov, calls } = recorder([
      '{"action":"open","url":"https://publisher.example/avalon/balor"}',
      '{"action":"final","message":"for tidlig","proposals":[]}',
      '{"action":"identify","official_name":"Balor","images":[{"image_url":"https://elsewhere.example/fake.jpg","page_url":"https://publisher.example/avalon/balor"}]}',
      JSON.stringify({ action: 'identify', official_name: 'Balor, Demon of the Mist', aliases: ['Balor', 'Mist Demon'], edition: 'Avalon: Myths & Monsters', faction: 'Demoner',
        description: 'Bevinget demon med pisk', painter: 'Studio Nine', confidence: 'high', why: 'Utgiverens produktside',
        images: [{ image_url: 'https://publisher.example/img/balor-art.jpg', page_url: 'https://publisher.example/avalon/balor', kind: 'concept_art' },
          { image_url: 'https://publisher.example/img/balor-painted.jpg', page_url: 'https://publisher.example/avalon/balor', kind: 'official' },
          { image_url: 'https://elsewhere.example/fake.jpg', kind: 'official' }],
        sources: [{ url: 'https://publisher.example/avalon/balor', title: 'Balor' }, { url: 'https://invented.example/' }] }),
      '{"action":"open","url":"https://example.com/gallery"}',
      '{"action":"look","image_urls":["https://example.com/img/merlin-front.jpg"]}',
      '{"action":"next_phase","why":"nok bilder"}',
      '{"action":"search","query":"Balor Demon of the Mist painting guide"}',
      JSON.stringify({ action: 'final', message: 'ferdig', proposals: [{ type: 'reference_selection', payload: { subject: 'M1',
        images: [{ image_url: 'https://example.com/img/merlin-front.jpg', page_url: 'https://example.com/gallery', kind: 'painted', confidence: 'low' }],
        videos: [{ url: 'https://youtu.be/abcdefghijk', why: 'Malevideo' }, { url: 'https://www.youtube.com/watch?v=zzzzzzzzzzz' }, { url: 'https://vimeo.com/1' }],
        guides: [{ url: 'https://example.com/gallery', title: 'Druid gallery', why: 'Viser malingene', paints: ['Citadel Mephiston Red'] },
          { url: 'https://never-seen.example/guide', title: 'Oppdiktet' }] } }] }),
    ]);
    await runResearch({
      provider: prov, search: fakeSearch, openPage: pages,
      lookAtImages: async (_u, _q, ref) => { looks.push(ref); return 'ja'; },
      imageAsDataUrl: async (u) => `data:image/jpeg;base64,${Buffer.from(u).toString('base64')}`,
      videoInfo: async (u) => {
        if (!u.includes('abcdefghijk')) throw new Error('ukjent');
        return { url: 'https://www.youtube.com/watch?v=abcdefghijk', video_id: 'abcdefghijk', title: 'Painting Balor', channel: 'Mini Channel', channel_url: null, thumbnail_url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg' };
      },
    }, { context: {}, messages: [{ role: 'user', content: 'Finn Balor' }], result_types: ['reference_selection'], focus: noRef }, (e) => events.push(e));

    expect(calls[0]!.instructions).toContain('FASE 1 AV 3: IDENTIFISER FIGUREN');
    const phase2 = calls.find((c) => c.instructions.includes('FASE 2 AV 3'))!.instructions;
    expect(phase2).toContain('Offisielt navn: Balor, Demon of the Mist (også kalt: Balor, Mist Demon)');
    expect(phase2).toContain('Bevinget demon med pisk');
    expect(phase2).toContain('Studio Nine');
    expect(phase2).toContain('«Avalon Balor, Demon of the Mist painted»');
    expect(calls.at(-1)!.instructions).toContain('FASE 3 AV 3: MALEGUIDER');
    // «look» compares with the miniature itself (the official photo), not the concept art.
    expect(looks).toEqual([`data:image/jpeg;base64,${Buffer.from('https://publisher.example/img/balor-painted.jpg').toString('base64')}`]);
    expect(events.find((e) => e.type === 'identity')).toMatchObject({ identity: { official_name: 'Balor, Demon of the Mist' } });
    const final = events.at(-1) as Extract<ResearchEvent, { type: 'final' }>;
    expect(final.identity).toMatchObject({
      official_name: 'Balor, Demon of the Mist', aliases: ['Balor', 'Mist Demon'], edition: 'Avalon: Myths & Monsters', painter: 'Studio Nine', confidence: 'high',
      images: [{ image_url: 'https://publisher.example/img/balor-art.jpg', kind: 'concept_art', site: 'publisher.example' }, { image_url: 'https://publisher.example/img/balor-painted.jpg', kind: 'official' }],
      sources: [{ url: 'https://publisher.example/avalon/balor', title: 'Balor – Avalon add-on' }],
    });
    expect(final.identity!.images).toHaveLength(2);
    const payload = (final.proposals[0] as { payload: { images: Record<string, unknown>[]; videos: Record<string, unknown>[]; guides: Record<string, unknown>[] } }).payload;
    expect(payload.images.map((x) => x.image_url)).toEqual(['https://publisher.example/img/balor-art.jpg', 'https://publisher.example/img/balor-painted.jpg', 'https://example.com/img/merlin-front.jpg']);
    expect(payload.images[0]).toMatchObject({ confidence: 'high', kind: 'concept_art' });
    expect(payload.videos).toEqual([{ url: 'https://www.youtube.com/watch?v=abcdefghijk', video_id: 'abcdefghijk', title: 'Painting Balor', channel: 'Mini Channel', thumbnail_url: 'https://i.ytimg.com/vi/abcdefghijk/hqdefault.jpg', why: 'Malevideo' }]);
    expect(payload.guides).toEqual([{ url: 'https://example.com/gallery', title: 'Druid gallery', site: 'example.com', read: true, why: 'Viser malingene', paints: ['Citadel Mephiston Red'], language: 'en' }]);
    expect(final.warnings.join(' ')).toContain('Fjernet 2 video');
    expect(final.warnings.join(' ')).toContain('Fjernet 1 maleguide');
  });

  it('lager et bildeforslag med de offisielle bildene selv om agenten ikke foreslår noe', async () => {
    const events: ResearchEvent[] = [];
    await runResearch({
      provider: provider([
        '{"action":"open","url":"https://publisher.example/avalon/balor"}',
        '{"action":"anchor","image_url":"https://publisher.example/img/balor-painted.jpg","page_url":"https://publisher.example/avalon/balor"}',
        '{"action":"final","message":"Fant ingen malte","proposals":[]}',
        '{"action":"final","message":"Fant ingen guider","proposals":[]}',
      ]),
      search: fakeSearch, openPage: pages,
    }, { context: {}, messages: [{ role: 'user', content: 'x' }], result_types: ['reference_selection'], focus }, (e) => events.push(e));
    const final = events.at(-1) as Extract<ResearchEvent, { type: 'final' }>;
    expect(final.message).toBe('Fant ingen guider');
    expect(final.proposals).toHaveLength(1);
    expect(final.proposals[0]).toMatchObject({ type: 'reference_selection', payload: { subject: 'M1', images: [{ image_url: 'https://publisher.example/img/balor-painted.jpg' }], videos: [], guides: [] } });
  });

  it('tar vare på svaret fra fase 2 og slår det sammen med svaret etter maleguidene', async () => {
    const events: ResearchEvent[] = [];
    await runResearch({
      provider: provider([
        '{"action":"identify","official_name":"Balor","images":[]}',
        '{"action":"open","url":"https://example.com/gallery"}',
        JSON.stringify({ action: 'final', message: 'Fant ett bilde', proposals: [{ type: 'reference_selection', payload: { subject: 'M1',
          images: [{ image_url: 'https://example.com/img/merlin-front.jpg', page_url: 'https://example.com/gallery', confidence: 'high' }] } }] }),
        JSON.stringify({ action: 'final', message: 'Og en guide', proposals: [{ type: 'reference_selection', payload: { subject: 'M1', images: [],
          guides: [{ url: 'https://example.com/gallery', title: 'Druid gallery' }] } }] }),
      ]),
      search: fakeSearch, openPage: async () => PAGE,
    }, { context: {}, messages: [{ role: 'user', content: 'x' }], result_types: ['reference_selection'], focus }, (e) => events.push(e));
    expect(events.flatMap((e) => (e.type === 'phase' ? [e.phase] : []))).toEqual(['identify', 'painted', 'guides']);
    const final = events.at(-1) as Extract<ResearchEvent, { type: 'final' }>;
    const payload = (final.proposals[0] as { payload: { images: Record<string, unknown>[]; guides: Record<string, unknown>[] } }).payload;
    expect(payload.images.map((x) => x.image_url)).toEqual(['https://example.com/img/merlin-front.jpg']);
    expect(payload.guides.map((x) => x.url)).toEqual(['https://example.com/gallery']);
    expect(mergeHeld([], [{ type: 'reference_selection', payload: { images: [1] } }])).toHaveLength(1);
  });

  it('beholder et forslag med bare videoer (før ble det fjernet sammen med bildene)', async () => {
    const events: ResearchEvent[] = [];
    await runResearch({
      provider: provider([
        '{"action":"identify","official_name":null,"images":[]}',
        '{"action":"next_phase"}',
        JSON.stringify({ action: 'final', message: 'Bare en video', proposals: [{ type: 'reference_selection', payload: { subject: 'M1', images: [],
          videos: [{ url: 'https://youtu.be/abcdefghijk', why: 'Malevideo' }] } }] }),
      ]),
      search: fakeSearch, openPage: async () => PAGE,
      videoInfo: async () => ({ url: 'https://www.youtube.com/watch?v=abcdefghijk', video_id: 'abcdefghijk', title: 'Painting Balor', channel: 'C', channel_url: null, thumbnail_url: null }),
    }, { context: {}, messages: [{ role: 'user', content: 'x' }], result_types: ['reference_selection'], focus }, (e) => events.push(e));
    const final = events.at(-1) as Extract<ResearchEvent, { type: 'final' }>;
    expect(final.proposals).toHaveLength(1);
    expect(final.proposals[0]).toMatchObject({ type: 'reference_selection', payload: { images: [], videos: [{ video_id: 'abcdefghijk', why: 'Malevideo' }], guides: [] } });
  });

  const KNOWN = {
    official_name: 'Balor, Demon of the Mist', aliases: ['Balor'], edition: 'Myths & Monsters', faction: null, description: 'Bevinget demon med pisk',
    images: [{ image_url: 'https://publisher.example/img/balor-painted.jpg', page_url: 'https://publisher.example/avalon/balor', page_title: 'Balor', site: 'publisher.example', kind: 'official' as const, thumbnail_url: null }],
    painter: 'Studio Nine', confidence: 'high' as const, why: 'Utgiverens side', sources: [{ url: 'https://publisher.example/avalon/balor', title: 'Balor' }],
  };

  it('hopper over fase 1 når brukeren har bekreftet figuren, og sammenligner med bildet', async () => {
    const looks: (string | null)[] = [];
    const events: ResearchEvent[] = [];
    const { prov, calls } = recorder([
      '{"action":"open","url":"https://example.com/gallery"}',
      '{"action":"look","image_urls":["https://example.com/img/merlin-front.jpg"]}',
      '{"action":"identify","official_name":"Noe annet"}',
      '{"action":"next_phase"}',
      JSON.stringify({ action: 'final', message: 'ok', proposals: [{ type: 'reference_selection', payload: { subject: 'M1',
        images: [{ image_url: 'https://example.com/img/merlin-front.jpg', page_url: 'https://example.com/gallery' }] } }] }),
    ]);
    await runResearch({
      provider: prov, search: fakeSearch, openPage: async () => PAGE,
      lookAtImages: async (_u, _q, ref) => { looks.push(ref); return 'ja'; },
      imageAsDataUrl: async (u) => `data:image/jpeg;base64,${Buffer.from(u).toString('base64')}`,
    }, { context: {}, messages: [{ role: 'user', content: 'x' }], result_types: ['reference_selection'],
      focus: { ...focus, reference_image: null, identity: { ...KNOWN, status: 'confirmed' } } }, (e) => events.push(e));
    expect(events.flatMap((e) => (e.type === 'phase' ? [e.phase] : []))).toEqual(['painted', 'guides']);
    expect(calls[0]!.instructions).toContain('FASE 2 AV 3');
    expect(calls[0]!.instructions).toContain('Figuren er identifisert (bekreftet av brukeren)');
    expect(calls[0]!.instructions).not.toContain('FASE 1 AV 3');
    expect(looks).toEqual([`data:image/jpeg;base64,${Buffer.from('https://publisher.example/img/balor-painted.jpg').toString('base64')}`]);
    // «identify» after phase 1 is refused, and nothing new is reported as found.
    expect(JSON.stringify(calls[3]!.messages)).toContain('Figuren er allerede identifisert');
    const final = events.at(-1) as Extract<ResearchEvent, { type: 'final' }>;
    expect(final.identity).toBeNull();
    const images = (final.proposals[0] as { payload: { images: Record<string, unknown>[] } }).payload.images;
    expect(images.map((x) => x.image_url)).toEqual(['https://publisher.example/img/balor-painted.jpg', 'https://example.com/img/merlin-front.jpg']);
  });

  it('kontrollerer en foreslått figur i fase 1, og velger ikke en avvist figur igjen', async () => {
    const events: ResearchEvent[] = [];
    const { prov, calls } = recorder([
      '{"action":"identify","official_name":"Merlin","images":[]}',
      '{"action":"identify","official_name":"Balor, Demon of the Mist","images":[{"image_url":"https://publisher.example/img/balor-painted.jpg"},{"image_url":"https://rejected.example/merlin.jpg"}]}',
    ]);
    await runResearch({ provider: prov, search: fakeSearch, openPage: async () => PAGE },
      { context: {}, messages: [{ role: 'user', content: 'x' }], result_types: ['reference_selection'],
        focus: { ...focus, identity: { ...KNOWN, status: 'proposed' }, rejected: [{ official_name: 'Merlin', image_urls: ['https://rejected.example/merlin.jpg'] }] } },
      (e) => events.push(e));
    expect(calls[0]!.instructions).toContain('En tidligere jakt foreslo dette, men brukeren har ikke bekreftet det');
    expect(calls[0]!.instructions).toContain('Brukeren har sagt at dette IKKE er figuren');
    expect(JSON.stringify(calls[1]!.messages)).toContain('«Merlin» ikke er figuren');
    // The picture from the earlier identification counts as seen; the rejected one is left out.
    expect(events.find((e) => e.type === 'identity')).toMatchObject({ identity: { official_name: 'Balor, Demon of the Mist',
      images: [{ image_url: 'https://publisher.example/img/balor-painted.jpg' }] } });
    expect((events.find((e) => e.type === 'identity') as Extract<ResearchEvent, { type: 'identity' }>).identity.images).toHaveLength(1);
  });

  it('åpner merkede sider først, og gir agenten nye merker mens den jobber', async () => {
    const events: ResearchEvent[] = [];
    const queue: RunHint[][] = [[], [{ kind: 'tagged_source', url: 'https://www.reddit.com/r/avalon/balor', title: 'My Balor' }], [], [{ kind: 'untagged_source', url: 'https://example.com/gallery', title: 'Druid gallery' }]];
    const { prov, calls } = recorder([
      '{"action":"open","url":"https://example.com/gallery"}',
      '{"action":"search","query":"Balor"}',
      '{"action":"identify","official_name":"Balor","sources":[{"url":"https://www.reddit.com/r/avalon/balor","title":"My Balor"}]}',
    ]);
    await runResearch({ provider: prov, search: fakeSearch, openPage: async () => PAGE, takeHints: () => queue.shift() ?? [] },
      { context: {}, messages: [{ role: 'user', content: 'x' }], result_types: ['reference_selection'],
        focus: { ...focus, tagged_sources: [{ url: 'https://example.com/gallery', title: 'Druid gallery', summary: 'Galleri med Balor' }] } },
      (e) => events.push(e));
    expect(calls[0]!.instructions).toContain('Brukeren har merket denne siden som at de viser figuren');
    expect(calls[0]!.instructions).toContain('https://example.com/gallery — Druid gallery (Galleri med Balor)');
    expect(calls[0]!.instructions).toContain('Åpne dem FØRST');
    // The tag arrives with the next step: in the messages and in the rebuilt instructions.
    expect(JSON.stringify(calls[1]!.messages)).toContain('Brukeren har nå merket denne siden som at den viser figuren: https://www.reddit.com/r/avalon/balor');
    expect(JSON.stringify(calls[1]!.messages)).toContain('(My Balor). Åpne den med');
    expect(calls[1]!.instructions).toContain('https://www.reddit.com/r/avalon/balor — My Balor');
    expect(JSON.stringify(calls[3]!.messages)).toContain('Brukeren har fjernet merket fra https://example.com/gallery');
    expect(calls[3]!.instructions).not.toContain('https://example.com/gallery — Druid gallery');
    expect(events.filter((e) => e.type === 'hint').map((e) => (e as { text: string }).text)).toEqual([
      'Agenten fikk beskjed: «My Balor» viser figuren', 'Agenten fikk beskjed: «Druid gallery» viser ikke figuren']);
    // A tagged page counts as found, so it can be a source of the identification.
    expect(events.find((e) => e.type === 'identity')).toMatchObject({ identity: { sources: [{ url: 'https://www.reddit.com/r/avalon/balor' }] } });
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
    expect(events.find((e) => e.type === 'identity')).toMatchObject({ identity: { images: [{ image_url: 'https://i.redd.it/mine.jpg' }] } });
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

describe('kartlegging av hele spillet (brukerønske 11.11.2026)', () => {
  const GALLERY: PageResult = {
    url: 'https://forum.example/avalon-painted', title: 'My painted Avalon set', site: 'forum.example', author: 'Painter Pete', language: 'en',
    text: 'All the heroes of Avalon, painted. Merlin, Morgana and the druids.',
    images: [{ url: 'https://forum.example/img/merlin.jpg', alt: 'Merlin', caption: null, context: 'Merlin with his staff' },
      { url: 'https://forum.example/img/morgana.jpg', alt: 'Morgana', caption: null, context: 'Morgana' },
      { url: 'https://forum.example/img/group.jpg', alt: 'All of them', caption: null, context: null }],
  };
  const KS: PageResult = {
    url: 'https://www.kickstarter.com/projects/x/avalon', title: 'Avalon – Kickstarter', site: 'kickstarter.com', author: null, language: 'en',
    text: 'Meet the heroes: Merlin the Archmage and Morgana le Fay. Concept art below.',
    images: [{ url: 'https://ks.example/merlin-art.jpg', alt: 'Merlin concept art', caption: null, context: null },
      { url: 'https://ks.example/morgana-art.jpg', alt: 'Morgana concept art', caption: null, context: null }],
  };
  const pageOf = async (url: string) => (url.includes('kickstarter') ? KS : GALLERY);
  const game = {
    kind: 'game' as const, game: 'Avalon',
    miniatures: [
      { ref: 'M1', name: 'Merlin', images: 0 },
      { ref: 'M2', name: 'Heksa', images: 1, rejected: [{ official_name: 'Nimue', image_urls: [] }] },
      { ref: 'M3', name: 'Druide', images: 2, identity: { status: 'confirmed' as const, official_name: 'Druid of the Fen', aliases: [], edition: null, faction: null, description: 'Druide',
        images: [{ image_url: 'https://pub.example/druid.jpg', page_url: 'https://pub.example/druid', page_title: 'Druid', site: 'pub.example', kind: 'official' as const, thumbnail_url: null }],
        painter: null, confidence: 'high' as const, why: null, sources: [] } },
    ],
  };

  function recorder(replies: string[]) {
    const calls: { instructions: string; messages: unknown[] }[] = [];
    let i = 0;
    const prov = { respond: async (m: unknown[], o: { instructions: string }) => {
      calls.push({ instructions: o.instructions, messages: structuredClone(m) });
      return { text: replies[i++] ?? '{"action":"final","message":"slutt","proposals":[]}', model: 'm', usage: null, searches: [], citations: [] };
    } } as unknown as ResponsesProvider;
    return { prov, calls };
  }

  it('finner kilder for spillet, finner ut hvem som er hvem, og sammenligner med flere referanser', async () => {
    const looks: { urls: string[]; refs: { label: string; image: string }[] | undefined }[] = [];
    const events: ResearchEvent[] = [];
    const { prov, calls } = recorder([
      '{"action":"open","url":"https://www.kickstarter.com/projects/x/avalon"}',
      '{"action":"identify","subject":"M1","official_name":"Merlin the Archmage","images":[{"image_url":"https://ks.example/merlin-art.jpg","kind":"concept_art"}]}',
      '{"action":"identify","subject":"M3","official_name":"Noe annet"}',
      '{"action":"next_phase"}',
      '{"action":"open","url":"https://forum.example/avalon-painted"}',
      '{"action":"identify","subject":"M2","official_name":"Nimue"}',
      '{"action":"identify","subject":"M2","official_name":"Morgana le Fay","images":[{"image_url":"https://ks.example/morgana-art.jpg","kind":"concept_art"}]}',
      '{"action":"identify","subject":"M9","official_name":"x"}',
      '{"action":"look","image_urls":["https://forum.example/img/merlin.jpg","https://forum.example/img/morgana.jpg"],"compare_with":["M1","M2","M3","M9"],"question":"Hvem er hvem?"}',
      JSON.stringify({ action: 'final', message: 'Fant Merlin og Morgana.', proposals: [
        { type: 'reference_selection', payload: { subject: 'M1', images: [{ image_url: 'https://forum.example/img/merlin.jpg', page_url: 'https://forum.example/avalon-painted', kind: 'painted', confidence: 'high', reason: 'R1' }] } },
        { type: 'reference_selection', payload: { subject: 'M2', images: [{ image_url: 'https://forum.example/img/morgana.jpg', page_url: 'https://forum.example/avalon-painted', kind: 'painted', confidence: 'medium' }],
          guides: [{ url: 'https://forum.example/avalon-painted', title: 'My painted Avalon set', paints: ['Citadel Naggaroth Night'] }] } },
        { type: 'reference_selection', payload: { subject: 'M7', images: [{ image_url: 'https://forum.example/img/group.jpg', page_url: 'https://forum.example/avalon-painted' }] } },
      ], game_sources: [
        { url: 'https://www.kickstarter.com/projects/x/avalon', title: 'KS', role: 'official', shows: ['M1', 'M2', 'M9'], summary: 'Kampanjen med konseptkunst av heltene.' },
        { url: 'https://forum.example/avalon-painted', role: 'painted', shows: ['M1', 'M2'] },
        { url: 'https://forum.example/avalon-painted', role: 'painted', shows: ['M3'] },
        { url: 'https://www.reddit.com/r/avalon/never-seen', role: 'painted', shows: ['M1'] },
        { url: 'https://forum.example/avalon-painted#x', role: 'weird' },
      ] }),
    ]);
    await runResearch({
      provider: prov, search: fakeSearch, openPage: pageOf,
      lookAtImages: async (urls, _q, _ref, refs) => { looks.push({ urls, refs }); return '1 – R1 – malt; 2 – R2 – malt'; },
      imageAsDataUrl: async (u) => `data:${u}`,
    }, { context: {}, messages: [{ role: 'user', content: 'Kartlegg' }], result_types: ['reference_selection'], focus: game }, (e) => events.push(e));

    expect(events.flatMap((e) => (e.type === 'phase' ? [e.phase] : []))).toEqual(['sources', 'match']);
    expect(calls[0]!.instructions).toContain('OPPDRAG: KARTLEGG SPILLET «Avalon»');
    expect(calls[0]!.instructions).toContain('FASE 1 AV 2: KILDER FOR SPILLET');
    expect(calls[0]!.instructions).toContain('- M3 «Druide»: bekreftet av brukeren som «Druid of the Fen»');
    expect(calls[0]!.instructions).toContain('IKKE: Nimue');
    expect(calls.at(-1)!.instructions).toContain('FASE 2 AV 2: HVEM ER HVEM');
    expect(calls.at(-1)!.instructions).toContain('- M1 «Merlin»: identifisert i denne kjøringen som «Merlin the Archmage»');
    const said = JSON.stringify(calls.map((c) => c.messages));
    expect(said).toContain('M3 er allerede bekreftet av brukeren');
    expect(said).toContain('«Nimue» ikke er M2');
    expect(said).toContain('må være en av miniatyrene: M1, M2, M3');
    // «look» gets the official pictures of the miniatures asked about, labelled; unknown refs are ignored.
    expect(looks).toHaveLength(1);
    expect(looks[0]!.refs).toEqual([
      { label: 'M1 «Merlin the Archmage»', image: 'data:https://ks.example/merlin-art.jpg' },
      { label: 'M2 «Morgana le Fay»', image: 'data:https://ks.example/morgana-art.jpg' },
      { label: 'M3 «Druid of the Fen»', image: 'data:https://pub.example/druid.jpg' },
    ]);
    expect(events.filter((e) => e.type === 'identity').map((e) => (e as { subject_ref?: string }).subject_ref)).toEqual(['M1', 'M2']);

    const final = events.at(-1) as Extract<ResearchEvent, { type: 'final' }>;
    expect(final.identities!.map((x) => [x.subject_ref, x.identity.official_name])).toEqual([['M1', 'Merlin the Archmage'], ['M2', 'Morgana le Fay']]);
    // One proposal per miniature; the official picture goes first; a miniature outside the project is left out.
    const bySubject = Object.fromEntries((final.proposals as { payload: { subject: string; images: { image_url: string }[]; guides: { url: string }[] } }[]).map((p) => [p.payload.subject, p.payload]));
    expect(Object.keys(bySubject).sort()).toEqual(['M1', 'M2']);
    expect(bySubject.M1!.images.map((i) => i.image_url)).toEqual(['https://ks.example/merlin-art.jpg', 'https://forum.example/img/merlin.jpg']);
    expect(bySubject.M2!.guides.map((g) => g.url)).toEqual(['https://forum.example/avalon-painted']);
    // Sources for the game: only pages seen in this run; roles from the list; «shows» only the project's miniatures; one per page.
    expect(final.game_sources).toEqual([
      { url: 'https://www.kickstarter.com/projects/x/avalon', title: 'Avalon – Kickstarter', role: 'official', shows: ['M1', 'M2'], summary: 'Kampanjen med konseptkunst av heltene.', read: true },
      { url: 'https://forum.example/avalon-painted', title: 'My painted Avalon set', role: 'painted', shows: ['M1', 'M2', 'M3'], summary: null, read: true },
    ]);
    expect(final.warnings.join(' ')).toContain('Fjernet 1 kilde(r) for spillet');
  });

  it('foreslår miniatyrer som mangler, med kontrollert identifisering, og nye nøkler kan brukes i «shows»', async () => {
    const events: ResearchEvent[] = [];
    const { prov, calls } = recorder([
      '{"action":"open","url":"https://www.kickstarter.com/projects/x/avalon"}',
      '{"action":"next_phase"}',
      JSON.stringify({ action: 'final', message: 'Fant én som mangler.', proposals: [
        { type: 'catalog_subject', evidence: 'documented', payload: { key: 'N1', name: 'Morgana le Fay', grouping: 'single', physical_count: 1, expansion_name: null,
          sources: [{ url: 'https://www.kickstarter.com/projects/x/avalon', title: 'KS' }],
          identity: { official_name: 'Morgana le Fay', description: 'Heks i mørk kappe', images: [
            { image_url: 'https://ks.example/morgana-art.jpg', page_url: 'https://www.kickstarter.com/projects/x/avalon', kind: 'concept_art' },
            { image_url: 'https://invented.example/morgana.jpg', kind: 'official' }] } } },
        { type: 'catalog_subject', payload: { key: 'X1', name: 'Oppdiktet', identity: { images: [{ image_url: 'https://invented.example/x.jpg' }] } } },
      ], game_sources: [{ url: 'https://www.kickstarter.com/projects/x/avalon', role: 'official', shows: ['M1', 'N1', 'N7'] }] }),
    ]);
    await runResearch({ provider: prov, search: fakeSearch, openPage: pageOf },
      { context: {}, messages: [{ role: 'user', content: 'x' }], result_types: ['reference_selection', 'catalog_subject'], focus: game }, (e) => events.push(e));
    expect(calls[0]!.instructions).toContain('finn figurer i spillet som MANGLER i prosjektet');
    expect(calls.at(-1)!.instructions).toContain('"key": "N1"');
    const final = events.at(-1) as Extract<ResearchEvent, { type: 'final' }>;
    const [morgana, invented] = final.proposals as { payload: Record<string, unknown> }[];
    expect(morgana!.payload).toMatchObject({ key: 'N1', name: 'Morgana le Fay', identity: { official_name: 'Morgana le Fay', images: [{ image_url: 'https://ks.example/morgana-art.jpg' }] } });
    expect((morgana!.payload.identity as { images: unknown[] }).images).toHaveLength(1);
    // A key outside N1 … is removed, and an identification with nothing that holds is left out.
    expect(invented!.payload.key).toBeUndefined();
    expect(invented!.payload.identity).toBeUndefined();
    expect(final.game_sources![0]!.shows).toEqual(['M1', 'N1']);
    // A missing miniature from an earlier answer is kept when the final answer has none by that name.
    expect(mergeSurvey([], [{ type: 'catalog_subject', payload: { name: 'Morgana' } }])).toHaveLength(1);
    expect(mergeSurvey([{ type: 'catalog_subject', payload: { name: 'morgana ' } }], [{ type: 'catalog_subject', payload: { name: 'Morgana' } }])).toHaveLength(1);
  });

  it('gir fase 1 egne steg, og tar vare på et tidlig svar', async () => {
    const events: ResearchEvent[] = [];
    await runResearch({ provider: recorder([
      ...Array(GAME_SOURCE_STEPS).fill('{"action":"search","query":"avalon miniatures"}'),
      '{"action":"search","query":"for mange"}',
      '{"action":"identify","subject":"M1","official_name":"Merlin the Archmage"}',
    ]).prov, search: fakeSearch, openPage: pageOf }, { context: {}, messages: [{ role: 'user', content: 'x' }], result_types: ['reference_selection'], focus: game }, (e) => events.push(e));
    const at = events.findIndex((e) => e.type === 'phase' && e.phase === 'match');
    expect(events.slice(0, at).filter((e) => e.type === 'search')).toHaveLength(GAME_SOURCE_STEPS);

    const early: ResearchEvent[] = [];
    await runResearch({ provider: recorder([
      '{"action":"open","url":"https://forum.example/avalon-painted"}',
      JSON.stringify({ action: 'final', message: 'Tidlig', proposals: [{ type: 'reference_selection', payload: { subject: 'M1', images: [{ image_url: 'https://forum.example/img/merlin.jpg', page_url: 'https://forum.example/avalon-painted' }] } }],
        game_sources: [{ url: 'https://forum.example/avalon-painted', role: 'painted', shows: ['M1'] }] }),
      JSON.stringify({ action: 'final', message: 'Ferdig', proposals: [{ type: 'reference_selection', payload: { subject: 'M2', images: [{ image_url: 'https://forum.example/img/morgana.jpg', page_url: 'https://forum.example/avalon-painted' }] } }] }),
    ]).prov, search: fakeSearch, openPage: pageOf }, { context: {}, messages: [{ role: 'user', content: 'x' }], result_types: ['reference_selection'], focus: game }, (e) => early.push(e));
    const final = early.at(-1) as Extract<ResearchEvent, { type: 'final' }>;
    expect(final.message).toBe('Ferdig');
    expect((final.proposals as { payload: { subject: string } }[]).map((p) => p.payload.subject).sort()).toEqual(['M1', 'M2']);
    expect(final.game_sources!.map((g) => g.shows)).toEqual([['M1']]);
  });

  it('flere referanser i «look» vises først, merket, før kandidatene', async () => {
    const { lookAtImages } = await import('./vision.ts');
    let sent: { content: { type: string; text?: string; image_url?: string }[] }[] = [];
    const prov = { respond: async (m: typeof sent) => { sent = m; return { text: '1 – R2', model: 'm', usage: null }; } } as unknown as ResponsesProvider;
    await lookAtImages(prov, async () => ({ type: 'image/png', body: Buffer.from('x') }), ['https://a.example/1.png'], 'Hvem er hvem?', null, undefined,
      [{ label: 'M1 «Merlin»', image: 'data:image/png;base64,AAA' }, { label: 'M2 «Morgana»', image: 'data:image/png;base64,BBB' }]);
    const c = sent[0]!.content;
    expect(c[0]!.text).toContain('R1 = M1 «Merlin», R2 = M2 «Morgana»');
    expect(c.slice(1).map((x) => x.image_url)).toEqual(['data:image/png;base64,AAA', 'data:image/png;base64,BBB', 'data:image/png;base64,eA==']);
  });
});

describe('fakta og illustrasjon for spillet (brukerønske 11.11.2026)', () => {
  const focus = { kind: 'game_info' as const, game: 'Zombicide', year: null, publishers: [], website: null, expansions: ['Washington Z.C.'], known_pages: [] };
  const PUB: PageResult = {
    url: 'https://www.cmon.com/product/zombicide-2nd-edition', title: 'Zombicide: 2nd Edition – CMON', site: 'cmon.com', author: null,
    text: 'Zombicide: 2nd Edition. Published by CMON Global Limited in 2021. Designers: …', language: 'en',
    images: [{ url: 'https://www.cmon.com/img/zombicide-box.png', alt: 'Zombicide 2nd Edition box', caption: null, context: null },
      { url: 'https://www.cmon.com/img/logo.png', alt: 'CMON logo', caption: null, context: null }],
  };
  const boxHit = { image_url: 'https://cf.geekdo-images.com/box2e.jpg', thumbnail_url: 'https://imgs.search.brave.com/b1', page_url: 'https://boardgamegeek.com/boardgame/337784', title: 'Zombicide 2nd Edition', site: 'boardgamegeek.com' };
  const search = {
    configured: () => true,
    search: async () => [{ title: 'Zombicide: 2nd Edition | BoardGameGeek', url: 'https://boardgamegeek.com/boardgame/337784', snippet: 'Zombicide: 2nd Edition (2021) CMON Global Limited' }],
    imageSearch: async () => [boxHit],
  } as unknown as WebSearch;

  function provider(replies: string[], seen: string[] = [], instr: string[] = []) {
    let i = 0;
    return { respond: async (input: { content: unknown }[], opts: { instructions?: string }) => {
      seen.push(String(input.at(-1)?.content ?? ''));
      instr.push(opts.instructions ?? '');
      return { text: replies[i++] ?? '{"action":"final","message":"slutt","game":null}', model: 'm', usage: null, searches: [], citations: [] };
    } } as unknown as ResponsesProvider;
  }
  const answer = (game: Record<string, unknown>, message = 'Fant Zombicide 2. utgave') => JSON.stringify({ action: 'final', message, game });

  it('har egen instruks, søker, åpner og sjekker hver opplysning mot sidene', async () => {
    const instr: string[] = [];
    const events: ResearchEvent[] = [];
    await runResearch({ provider: provider([
      '{"action":"search","query":"Zombicide board game publisher"}',
      '{"action":"image_search","query":"Zombicide 2nd edition box"}',
      '{"action":"open","url":"https://www.cmon.com/product/zombicide-2nd-edition"}',
      answer({
        official_name: 'Zombicide: 2nd Edition',
        year_published: { value: 2021, source: 'https://www.cmon.com/product/zombicide-2nd-edition' },
        publishers: { value: ['CMON'], source: 'https://boardgamegeek.com/boardgame/337784' },
        website: { url: 'https://www.cmon.com/product/zombicide-2nd-edition', why: 'Utgiverens produktside' },
        images: [
          { image_url: 'https://cf.geekdo-images.com/box2e.jpg', page_url: 'https://boardgamegeek.com/boardgame/337784', kind: 'box_art', confidence: 'medium' },
          { image_url: 'https://www.cmon.com/img/zombicide-box.png', page_url: 'https://www.cmon.com/product/zombicide-2nd-edition', kind: 'box', confidence: 'high', caption: 'Esken forfra' },
          { image_url: 'https://www.cmon.com/img/zombicide-box.png', kind: 'box' },
          { image_url: 'https://diktet.example/box.jpg', page_url: 'https://diktet.example', kind: 'box' },
        ],
        sources: [{ url: 'https://diktet.example/om' }],
        uncertainty: null,
      }),
    ], [], instr), search, openPage: async () => PUB }, { context: {}, messages: [{ role: 'user', content: 'Finn fakta' }], result_types: [], focus }, (e) => events.push(e));

    expect(instr[0]).toContain('OPPDRAG: FAKTA OG ILLUSTRASJON for brettspillet «Zombicide»');
    expect(instr[0]).toContain('utvidelser i prosjektet: Washington Z.C.');
    expect(instr[0]).toContain('"image_search"');
    expect(events[0]).toEqual({ type: 'status', text: 'Fakta og illustrasjon for Zombicide' });
    const final = events.at(-1) as Extract<ResearchEvent, { type: 'final' }>;
    const info = final.game_info!;
    expect(info.official_name).toBe('Zombicide: 2nd Edition');
    // The year is in the text of the page Paintrest opened; the publisher in the search hit's snippet.
    expect(info.year_published).toEqual({ value: 2021, source: { url: PUB.url, title: PUB.title }, basis: 'checked' });
    expect(info.publishers).toMatchObject({ value: ['CMON'], basis: 'checked', source: { url: 'https://boardgamegeek.com/boardgame/337784' } });
    expect(info.website).toMatchObject({ url: PUB.url, basis: 'read', why: 'Utgiverens produktside' });
    // From the opened page and the image search; the invented one is removed, the repeat is not counted.
    expect(info.images.map((i) => [i.image_url, i.kind, i.confidence])).toEqual([
      ['https://www.cmon.com/img/zombicide-box.png', 'box', 'high'],
      ['https://cf.geekdo-images.com/box2e.jpg', 'box', 'medium'],
    ]);
    expect(info.images[1]).toMatchObject({ thumbnail_url: 'https://imgs.search.brave.com/b1', site: 'boardgamegeek.com' });
    expect(final.warnings.join(' ')).toContain('Fjernet 1 bilde');
    expect(final.warnings.join(' ')).toContain('https://diktet.example/om');
    expect(info.sources.map((x) => [x.url, x.opened])).toEqual([[PUB.url, true], ['https://boardgamegeek.com/boardgame/337784', false]]);
    expect(final.proposals).toEqual([]);
  });

  it('skiller mellom sjekket, fra kilde og fra modellens egen kunnskap', async () => {
    const { verifyGameInfo } = await import('./research-agent.ts');
    const opened = new Map([[normUrl(PUB.url), PUB]]);
    const searched = new Map([[normUrl('https://en.wikipedia.org/wiki/Zombicide'), { title: 'Zombicide - Wikipedia', url: 'https://en.wikipedia.org/wiki/Zombicide', snippet: 'cooperative game' }]]);
    const hosted = new Set([normUrl('https://uib.example/read')]);
    const r = verifyGameInfo({
      year_published: { value: '2012', source: 'https://www.cmon.com/product/zombicide-2nd-edition' },
      publishers: { value: 'Guillotine Games', source: 'https://uib.example/read' },
      website: 'https://en.wikipedia.org/wiki/Zombicide',
    }, opened, searched, new Map(), hosted);
    // The page was opened, but 2012 is not in its text: from a source, not checked.
    expect(r.info!.year_published).toMatchObject({ value: 2012, basis: 'source' });
    // Read by UiB: Paintrest has no text to check.
    expect(r.info!.publishers).toMatchObject({ value: ['Guillotine Games'], basis: 'source' });
    expect(r.info!.website).toMatchObject({ url: 'https://en.wikipedia.org/wiki/Zombicide', basis: 'found' });

    const none = verifyGameInfo({ year_published: { value: 2012, source: null }, publishers: { value: ['CMON'], source: 'https://aldri.example/' },
      website: { url: 'https://aldri.example/' }, images: [{ image_url: 'https://aldri.example/a.jpg' }] }, new Map(), new Map());
    expect(none.info).toMatchObject({ year_published: { value: 2012, source: null, basis: 'model' }, publishers: { value: ['CMON'], source: null, basis: 'model' }, website: null, images: [] });
    expect(none.warnings.join(' ')).toMatch(/Fjernet kilden for utgiveren.*Fjernet nettsiden https:\/\/aldri\.example\/.*Fjernet 1 bilde/);
    expect(verifyGameInfo({ year_published: { value: 1066 } }, new Map(), new Map()).info!.year_published).toBeNull();
    // Search snippets can carry HTML entities.
    const amp = new Map([[normUrl('https://bgg.example/a'), { title: 'Avalon', url: 'https://bgg.example/a', snippet: 'Indie Boards &amp; Cards (2012)' }]]);
    expect(verifyGameInfo({ publishers: { value: ['Indie Boards & Cards'], source: 'https://bgg.example/a' } }, new Map(), amp).info!.publishers!.basis).toBe('checked');
    expect(verifyGameInfo(null, new Map(), new Map()).info).toBeNull();
  });

  it('ber agenten åpne en nettside den ikke har sett, før den godtas', async () => {
    const seen: string[] = [];
    const events: ResearchEvent[] = [];
    const opened: string[] = [];
    const site = { website: { url: 'https://www.cmon.com/product/zombicide-2nd-edition' } };
    const bgg: PageResult = { ...PUB, url: 'https://boardgamegeek.com/boardgame/337784', title: 'BGG', site: 'boardgamegeek.com' };
    await runResearch({ provider: provider([
      '{"action":"open","url":"https://boardgamegeek.com/boardgame/337784"}',
      answer(site),
      '{"action":"open","url":"https://www.cmon.com/product/zombicide-2nd-edition"}',
      answer(site),
    ], seen), search, openPage: async (u) => { opened.push(u); return u.includes('cmon') ? PUB : bgg; } },
    { context: {}, messages: [{ role: 'user', content: 'x' }], result_types: [], focus }, (e) => events.push(e));
    expect(seen[2]).toContain('Nettsiden https://www.cmon.com/product/zombicide-2nd-edition har du verken åpnet eller fått i et søk');
    expect(opened).toEqual(['https://boardgamegeek.com/boardgame/337784', 'https://www.cmon.com/product/zombicide-2nd-edition']);
    const final = events.at(-1) as Extract<ResearchEvent, { type: 'final' }>;
    expect(final.game_info!.website).toMatchObject({ basis: 'read' });
  });

  it('sender agenten tilbake én gang hvis den svarer uten å ha lest noe, og åpner kjente sider først', async () => {
    const seen: string[] = [];
    const instr: string[] = [];
    await runResearch({ provider: provider([answer({ year_published: { value: 2012 } }), answer({ year_published: { value: 2012 } })], seen, instr), search, openPage: async () => PUB },
      { context: {}, messages: [{ role: 'user', content: 'x' }], result_types: [],
        focus: { ...focus, website: 'https://www.cmon.com/', known_pages: [{ url: 'https://www.cmon.com/zombicide', title: 'Zombicide hos CMON' }] } }, () => {});
    expect(seen[1]).toContain('Du har ikke åpnet noen sider ennå. Åpne utgiverens side');
    expect(seen).toHaveLength(2);
    expect(instr[0]).toContain('https://www.cmon.com/zombicide — Zombicide hos CMON');
    expect(instr[0]).toContain('Brukeren har lagret https://www.cmon.com/ som nettside');
  });

  it('uten nettilgang: ingen bilder, ingenting sjekket, og det sies tydelig', async () => {
    const instr: string[] = [];
    const events: ResearchEvent[] = [];
    await runResearch({ provider: provider([answer({ year_published: { value: 2012, source: null }, website: { url: 'https://www.cmon.com/' },
      images: [{ image_url: 'https://www.cmon.com/box.png', page_url: 'https://www.cmon.com/' }] })], [], instr), search: null, openPage: async () => PUB },
    { context: {}, messages: [{ role: 'user', content: 'x' }], result_types: [], focus }, (e) => events.push(e));
    expect(instr[0]).toContain('Du har ikke nettilgang');
    const final = events.at(-1) as Extract<ResearchEvent, { type: 'final' }>;
    expect(final.warnings[0]).toContain('Uten nettsøk');
    expect(final.game_info).toMatchObject({ year_published: { basis: 'model' }, website: null, images: [] });
  });
});
