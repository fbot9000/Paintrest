/**
 * Research loop with web access. The model works in steps and answers each
 * step with one JSON action: search, open a page, or final. The server runs
 * the tools, reports each step as it happens, and at the end checks that
 * every image and source in the proposals came from a page the agent
 * actually opened in this turn. Nothing is written here; the client stores
 * drafts after its own scope check.
 *
 * A JSON action protocol is used instead of native function calling because
 * it only relies on plain text responses, which are confirmed to work against
 * UiB's endpoint for all its model families.
 */
import { UserError } from './credential-store.ts';
import type { PageResult } from './fetch-page.ts';
import { HostedToolError, VisionUnsupportedError } from './provider.ts';
import type { HostedSearch, ResponsesMessage, ResponsesProvider } from './provider.ts';
import type { SearchHit, WebSearch } from './search.ts';

export type ResearchEvent =
  | { type: 'status'; text: string }
  | { type: 'search'; query: string; why: string | null }
  | { type: 'search_done'; query: string; hits: { title: string; url: string }[] }
  | { type: 'open'; url: string; why: string | null }
  | { type: 'open_done'; url: string; title: string; image_count: number }
  | { type: 'look'; count: number; why: string | null }
  | { type: 'look_done'; summary: string }
  | { type: 'tool_error'; action: string; target: string; error: string }
  | { type: 'final'; message: string; proposals: unknown[]; model: string; warnings: string[]; trace: TraceStep[]; pages: PageSeen[] }
  | { type: 'error'; error: string };

/** A page the agent opened in this turn; the client stores it as a draft source. */
export interface PageSeen {
  url: string;
  title: string;
  site: string;
  author: string | null;
  language: string | null;
  image_count: number;
}

export interface TraceStep {
  action: 'search' | 'open' | 'look';
  target: string;
  result: string;
}

export interface ResearchInput {
  context: unknown;
  messages: { role: 'user' | 'assistant'; content: string }[];
  result_types: string[];
  model?: string;
  /** Image hunt for one miniature: a research strategy of its own, more steps and the look tool. */
  focus?: ImageFocus | PlanFocus | KnowledgeFocus | null;
  /** Changes inside the project are applied directly and can be undone (open zone). */
  direct_apply?: boolean;
}

/** Paint plan for one miniature, built from the pictures the user chose. */
export interface PlanFocus {
  kind: 'plan';
  subject_ref: string;
  subject_name: string;
  game: string;
  /** Up to 4 pictures of the miniature (data URLs), shown to the model with the request. */
  reference_images: string[];
  /** True when the miniature already has an approved plan that is opened for revision. */
  revision: boolean;
}

/** Library research (bit 7.4): a technique or a recipe for the user's own library. */
export interface KnowledgeFocus {
  kind: 'knowledge';
  target: 'technique' | 'recipe';
  /** Bit 7.6: improve this technique from the library instead of drafting a new one. */
  revision?: { name: string } | null;
}

export interface ImageFocus {
  kind: 'images';
  subject_ref: string;
  subject_name: string;
  game: string;
  /** A known picture of the miniature (data URL), sent along when the agent looks at candidates. */
  reference_image?: string | null;
}

export interface ResearchDeps {
  provider: ResponsesProvider;
  search: WebSearch | null;
  /** UiB's built-in search tool in the Responses API, or null when switched off. */
  hostedSearch?: HostedSearch | null;
  openPage: (url: string) => Promise<PageResult>;
  /** Shows images to the model and returns its written assessment. */
  lookAtImages?: (imageUrls: string[], question: string, reference: string | null) => Promise<string>;
  signal?: AbortSignal;
}

/** hosted: the model searches through UiB itself; search: Paintrest searches (Tavily/Brave); none: no web. */
export type WebMode = 'hosted' | 'search' | 'none';

export const MAX_TOOL_STEPS = 12;
export const MAX_IMAGE_STEPS = 24;
export const MAX_PLAN_STEPS = 16;
export const MAX_KNOWLEDGE_STEPS = 16;
const MAX_LOOK = 8;
const MAX_MESSAGES = 30;

export function researchInstructions(context: unknown, resultTypes: string[], mode: WebMode, anyFocus: ImageFocus | PlanFocus | KnowledgeFocus | null = null, vision = false, imagesAttached = false, direct = false): string {
  if (anyFocus?.kind === 'knowledge') return knowledgeInstructions(context, resultTypes, mode, anyFocus);
  const focus = anyFocus?.kind === 'images' ? anyFocus : null;
  const plan = anyFocus?.kind === 'plan' ? anyFocus : null;
  const maxSteps = focus ? MAX_IMAGE_STEPS : plan ? MAX_PLAN_STEPS : MAX_TOOL_STEPS;
  const sourceRules = `Kildekrav (viktig):
- Påstander om hvilke miniatyrer og hvor mange som finnes, skal bygge på kilder. Oppgi dem i "sources" med eksakt URL.
- Bilder du foreslår, må være fra bildelisten på en side du har åpnet med "open". Bruk eksakt bilde-URL og sidens URL. Ikke gjett eller lag bilde-URL-er.
- Står det ikke i kildene, skriv det i "uncertainty". Bruk "documented" bare når en kilde sier det.`;
  const web = mode === 'hosted'
    ? `Du har nettilgang. Du har et innebygd nettsøk-verktøy (web_search) som du bruker direkte når du trenger det; bruk gjerne engelske søkeord.
I tillegg kan Paintrest åpne sider for deg, slik at du får sidens tekst og en liste over bildene på siden. Du arbeider i steg. Hvert svar fra deg er ETT JSON-objekt:
  {"action": "open", "url": "https://…", "why": "kort grunn"} – Paintrest leser siden og gir deg tekst og bildeliste
  {"action": "final", "message": "…", "proposals": [ … ]}     – ferdig svar til brukeren
Søk med web_search, og åpne deretter de 2–5 mest lovende sidene (utgiverens produktside, regelbok eller komponentliste, BoardGameGeek, malegallerier og maleblogger) med "open".
Du har høyst ${maxSteps} verktøysteg per svar.

${sourceRules}`
    : mode === 'search'
      ? `Du har nettilgang gjennom to verktøy. Du arbeider i steg. Hvert svar fra deg er ETT JSON-objekt:
  {"action": "search", "query": "…", "why": "kort grunn"}   – nettsøk (bruk gjerne engelske søkeord)
  {"action": "open", "url": "https://…", "why": "kort grunn"} – les én side og få tekst og bildeliste
  {"action": "final", "message": "…", "proposals": [ … ]}     – ferdig svar til brukeren
Du får resultatet av hvert verktøy som neste melding. Du har høyst ${maxSteps} verktøysteg per svar. Bruk dem målrettet:
søk først, åpne de 2–5 mest lovende sidene (utgiverens produktside, regelbok eller komponentliste, BoardGameGeek, malegallerier og maleblogger), og avslutt med final.

${sourceRules}`
      : `Du har ikke nettilgang i dette oppsettet. Svar direkte med ett JSON-objekt {"action": "final", "message": "…", "proposals": [ … ]}.
Det du vet fra opplæringen, merkes "synthesized". Ikke foreslå bilder.`;
  const look = vision && mode !== 'none'
    ? `
Du kan også SE på bilder:
  {"action": "look", "image_urls": ["https://…", …], "question": "hva du vil vite", "why": "kort grunn"}
Bildene må være fra bildelisten på en side du har åpnet (høyst ${MAX_LOOK} per gang). Paintrest viser deg bildene${focus?.reference_image ? ', med et kjent bilde av miniatyren først som referanse' : ''}, og du får en vurdering tilbake.
Bruk dette til å avgjøre om et dårlig merket bilde faktisk viser figuren.`
    : '';
  const hunt = focus ? `

OPPDRAG: BILDEJAKT for miniatyren «${focus.subject_name}» (${focus.subject_ref}) fra spillet «${focus.game}».
Slike bilder er vanskelige å finne og ofte dårlig merket. Gjør grundig research, ikke bare ett søk. Arbeid slik:
1. Identitet: finn utgiverens eller Kickstarter-sidens bilde og beskrivelse av figuren (positur, våpen, base, fraksjon, skulptør), og hva spillet og figuren heter på andre språk.
2. Søk bredt og på flere språk. Malere legger ofte ut bilder på koreanske (Naver-blogg, Tistory), japanske, kinesiske, polske, spanske og tyske blogger og forum, og på Reddit og BoardGameGeek. Søk med spillets navn og figurens navn, også translitterert (for eksempel koreansk), sammen med ord som «painted», «도색», «塗装», «malowanie», «pintado».
3. Åpne mange sider (gallerier, malerapporter, Kickstarter-oppdateringer, BGG-bilder). En side som viser hele fraksjonen kan ha figuren uten navn; bruk teksten rundt bildet${vision ? ' og «look»' : ''} for å avgjøre.
4. Foreslå heller for mange enn for få: opptil 20 kandidater, sortert etter sikkerhet. Brukeren ser på bildene og avgjør. Ta med konseptillustrasjon, offisielle bilder og malte eksempler.
5. Oversett: skriv på norsk hvorfor hvert bilde trolig viser figuren, og ta med den korte originalteksten (på kildens språk) som begrunnelsen bygger på.
For hvert bilde i "images" i reference_selection, legg til:
  "confidence": "high|medium|low", "reason": "norsk begrunnelse", "original_text": "kort utdrag på originalspråket eller null"
og legg til i payload:
  "sources_read": [{"url": "https://…", "language": "ko", "summary": "norsk sammendrag av hva siden viser og sier om figuren", "original_excerpt": "kort utdrag på originalspråket"}]
Lag ETT reference_selection-forslag for ${focus.subject_ref}. Lag ikke andre forslagstyper i dette oppdraget.` : '';
  const planTask = plan ? `

OPPDRAG: MALEPLAN for miniatyren «${plan.subject_name}» (${plan.subject_ref}) fra spillet «${plan.game}».
${imagesAttached ? `Brukerens melding har ${plan.reference_images.length} bilde(r) av miniatyren som brukeren har valgt som referanse. Planen skal gjenskape uttrykket i dem.` : 'Du har ingen bilder av miniatyren; bygg på kilder og beskrivelser.'}
Arbeid slik:
1. Analyser uttrykket: hvilke deler og fargesoner figuren har (for eksempel kappe, hud, rustning, våpen, base), hvilke farger, hvor mørk og kontrastrik den er, og eventuelle effekter (glød, OSL, rust).
2. Let etter maleguider for denne figuren eller lignende uttrykk${mode !== 'none' ? ' (åpne known_sources først; koreanske og japanske malere oppgir ofte malingene sine, og agenten må oversette)' : ''}. Bruk det kildene faktisk sier om malinger og metode.
3. Velg en arbeidsmåte som passer (for eksempel svart grunning med zenithal og slapchop, kontrastmaling, eller lagvis med glasur) og begrunn kort.
4. Lag ETT paint_plan-forslag for ${plan.subject_ref}${plan.revision ? ' (ny versjon av den åpnede planen)' : ''}: felles operasjoner først (grunning, zenithal, avslutning), så én del per fargesone. Hvert steg har en konkret instruks og eksakte malinger med produsent, serie og navn, og rolle. Foretrekk malinger med ownership "owns". Mangler brukeren en maling, foreslå den du mener er best, og nevn et eiet alternativ i "uncertainty".
5. Legg i payload:
   "summary": norsk sammendrag av arbeidsmåte og fargevalg (3–6 setninger),
   "palette": [{"product": {"manufacturer": "…", "range": "…", "name": "…", "hex": "#rrggbb"}, "role_label": "kappe – skygge", "part": "Kappe"}] – én rad per maling planen bruker, med omtrentlig farge,
   "sources" og "sources_read" (med norsk sammendrag) for kildene du brukte.
   Gi også "hex" (omtrentlig farge) på hvert "product" i stegene.
Lag ikke andre forslagstyper i dette oppdraget.` : '';
  return `Du er researchagenten i Paintrest, et personlig arbeidsverktøy for miniatyrmaling.
Du hjelper brukeren å kartlegge miniatyrer i brettspillprosjekter, finne referansebilder og lage maleplaner med eksakte malingsprodukter.
Svar alltid på norsk bokmål.

${web}${look}${hunt}${planTask}

Regler for forslag:
- Du arbeider fritt INNE I DETTE PROSJEKTET mens brukeren setter det opp. Du kan lage, endre, dele, slå sammen og slette miniatyrer, og lage nye versjoner av maleplaner, også for det som allerede er godkjent. Ikke be brukeren gjøre endringer manuelt; gjør det selv gjennom "proposals".
${direct ? '- Endringene dine i prosjektet tas i bruk MED EN GANG, og brukeren kan angre hele runden med ett klikk. Si kort i meldingen hva du endret. Bildeutvalg og malinger som ikke finnes i katalogen venter på brukeren.' : '- Forslagene dine godkjennes av brukeren før de tas i bruk.'}
- Du kan ikke endre noe utenfor prosjektet: andre prosjekter, malingskatalogen eller biblioteket.
- Ikke dikt opp malingsnavn. Bruk eksakte produktnavn med produsent. Foretrekk malinger brukeren eier (ownership "owns").
- Miniatyrer i prosjektet refereres med "ref" (M1, M2 …). Bruk aldri andre id-er.
- Tillatte forslagstyper: ${resultTypes.join(', ') || 'ingen'}. Lag ett forslag per maleplan eller per bildeutvalg; samle relaterte katalogendringer (for eksempel en deling) i ett catalog_change-forslag.
- Ikke foreslå nye miniatyrer som allerede finnes i "miniatures" (sammenlign navn); endre dem heller med catalog_change.
- For å endre et eget ventende forslag (your_pending_proposals), sett "update_of" til dets ref.
- Er noe uklart (for eksempel hva gruppene skal hete), gjør et fornuftig valg, si hva du valgte i meldingen, og la brukeren rette i forslaget. Still bare spørsmål når du ikke kan gjøre et rimelig valg.

Forslagsformer i "proposals":
{"type": "catalog_subject", "evidence": "documented|synthesized|unresolved", "uncertainty": [{"path": "physical_count", "reason": "…"}],
 "payload": {"name": "…", "grouping": "single|group", "physical_count": 1, "expansion_name": null, "category_label": null,
  "count_basis": "documented|inferred|null", "grouping_basis": "documented|inferred|null", "note": null,
  "sources": [{"url": "https://…", "title": "…"}]}}
{"type": "catalog_change", "evidence": "documented|synthesized|unresolved", "uncertainty": [],
 "payload": {"note": "hvorfor", "operations": [
   {"op": "update", "subject": "M1", "set": {"name": "…", "grouping": "single|group", "physical_count": 3, "expansion_name": "…|null", "category_label": "…|null"}},
   {"op": "split", "subject": "M2", "into": [{"name": "Agenter – rød", "grouping": "group", "physical_count": 3, "category_label": "Rød fraksjon"}, …]},
   {"op": "merge", "subjects": ["M3", "M4"], "into": {"name": "…", "grouping": "group", "physical_count": 6}},
   {"op": "delete", "subject": "M5"},
   {"op": "create", "fields": {"name": "…", "grouping": "single", "physical_count": 1}}]}}
I "set" og "into" tas bare feltene du vil endre med; resten beholdes.
{"type": "reference_selection", "evidence": "documented", "uncertainty": [],
 "payload": {"subject": "M1", "note": "hvorfor disse bildene", "images": [{"image_url": "https://…", "page_url": "https://…", "caption": "Merlin forfra, malt av …", "kind": "concept_art|official|painted|other"}]}}
{"type": "paint_plan", "evidence": "synthesized", "uncertainty": [],
 "payload": {"subject": "M1", "note": "…", "sources": [], "elements": [
   {"kind": "operation|part", "name": "Grunning", "steps": [{"instruction": "…",
     "materials": [{"product": {"manufacturer": "Citadel", "range": "Base", "name": "Caliban Green"}, "role": "base|shade|layer|highlight|wash|glaze|mix|other", "role_label": null}],
     "mix": null}]}]}}
For reference_selection: velg bilder som viser akkurat denne miniatyren eller figuren tydelig. "kind" er concept_art (konseptillustrasjon eller kunst av figuren), official (utgiverens bilde av miniatyren), painted (malt av en hobbymaler) eller other. Skriv i caption hva bildet viser og hvem som laget eller malte det, når kilden sier det. Ikke ta med bilder av andre figurer, logoer eller esker.
"known_sources" i konteksten er sider som allerede er funnet for dette spillet: "kept" er lagret av brukeren, "found" er lest av agenten tidligere (med norsk sammendrag når det finnes). Ikke søk etter dem på nytt; åpne dem direkte når du trenger tekst eller bilder derfra, og bruk søk til å finne NYE sider.

Kontekst (det du kan lese; endres bare av brukeren):
${JSON.stringify(context)}`;
}

/**
 * Library research (bit 7.4, skisse 02–03): find several sources for a technique
 * or a recipe, compare them, and draft one guide. The agent cannot change the
 * library; the user approves the draft (global zone, docs/AVVIK.md punkt 28).
 */
export function knowledgeInstructions(context: unknown, resultTypes: string[], mode: WebMode, focus: KnowledgeFocus): string {
  const steps = MAX_KNOWLEDGE_STEPS;
  const tools = mode === 'hosted'
    ? `Du har et innebygd nettsøk-verktøy (web_search) som du bruker direkte. I tillegg kan Paintrest åpne sider for deg. Hvert svar fra deg er ETT JSON-objekt:
  {"action": "open", "url": "https://…", "why": "kort grunn"} – Paintrest leser siden og gir deg teksten
  {"action": "final", "message": "…", "proposals": [ … ]}     – ferdig svar til brukeren`
    : mode === 'search'
      ? `Du har nettilgang gjennom to verktøy. Hvert svar fra deg er ETT JSON-objekt:
  {"action": "search", "query": "…", "why": "kort grunn"}   – nettsøk (bruk gjerne engelske søkeord)
  {"action": "open", "url": "https://…", "why": "kort grunn"} – les én side
  {"action": "final", "message": "…", "proposals": [ … ]}     – ferdig svar til brukeren`
      : `Du har ikke nettilgang i dette oppsettet. Svar direkte med ett JSON-objekt {"action": "final", "message": "…", "proposals": [ … ]}.
Alt du skriver, bygger da på det du vet fra før. Merk forslaget "synthesized", alle steg med "basis": "synthesized", og si tydelig i meldingen at det ikke er sjekket mot kilder.`;
  const what = focus.revision
    ? `OPPDRAG: FORBEDRE TEKNIKKEN «${focus.revision.name}» i brukerens bibliotek.
Hele teknikken står i "technique_to_improve", sammen med brukerens erfaringer ("experiences") og kildene den bygger på.
- Ta utgangspunkt i det som står der. Behold det som fungerer, og endre det erfaringene og meldingen peker på.
- Les gjerne kildene på nytt, eller finn nye, når erfaringen tyder på at noe mangler eller er feil.
- Lag ETT technique-forslag med HELE den forbedrede teknikken (alle felt og alle steg, også de som ikke endres). Brukeren ser forskjellene før de godtas.
- Skriv i "note" og i meldingen kort hva du endret og hvorfor, med henvisning til erfaringen.
- Navnet skal være det samme med mindre brukeren ber om noe annet.`
    : focus.target === 'technique'
    ? `OPPDRAG: TEKNIKK til brukerens bibliotek.
En teknikk er en metode (for eksempel tørrbørsting, OSL, svamp for tekstur), uavhengig av spill og av bestemte malinger. Materialene er generelle ("finporet svamp", "oljemaling"). Bestemte malingsprodukter hører hjemme i en oppskrift, ikke i teknikken.`
    : `OPPDRAG: OPPSKRIFT til brukerens bibliotek.
En oppskrift er en FARGEREKKE: bestemte malinger i rekkefølge, med produsent, serie og navn. Den kan i tillegg ha STEG som viser hvordan fargerekken brukes for å få en bestemt effekt. Er det bare en fargerekke, la "steps" være tom.
Foretrekk malinger brukeren eier (ownership "owns" i "paints"). Ikke dikt opp malingsnavn. Mangler brukeren en maling, foreslå den du mener er best, og nevn et eiet alternativ i "uncertainty".`;
  const shape = focus.target === 'technique'
    ? `{"type": "technique", "evidence": "documented|synthesized|unresolved", "uncertainty": [{"path": "steps", "reason": "…"}],
 "payload": {"name": "…", "tags": ["tekstur"], "desired_result": "hva teknikken gir", "use_area": "hvor den passer",
  "materials": ["Finporet svamp", "…"], "variants": "A · …\\nB · …", "risk_note": "det man må passe på, for eksempel tørking, ventilasjon og rengjøring",
  "steps": [{"title": "Kort overskrift", "instruction": "Hva du gjør", "basis": "documented|synthesized"}],
  "note": "kort om hva kildene var uenige om",
  "comparison": {"common": "det kildene er enige om", "variants": [{"label": "Svamp for tekstur", "description": "hvordan denne varianten gjøres og hva den gir", "sources": ["https://…"], "primary": true}]},
  "sources": [{"url": "https://…", "title": "…"}],
  "sources_read": [{"url": "https://…", "language": "en", "summary": "norsk sammendrag av hva siden viser og sier", "original_excerpt": "kort utdrag"}]}}`
    : `{"type": "recipe", "evidence": "documented|synthesized|unresolved", "uncertainty": [],
 "payload": {"name": "…", "tags": ["hud"], "effect": "hva oppskriften gir, eller null for en ren fargerekke", "note": null,
  "paints": [{"product": {"manufacturer": "Citadel", "range": "Base", "name": "Rhinox Hide", "hex": "#3d2b23"}, "role": "base|shade|layer|highlight|wash|glaze|mix|other", "note": "for eksempel tynn ut"}],
  "steps": [{"instruction": "Hva du gjør", "paints": [1, 2], "technique": "T1 eller null"}],
  "comparison": {"common": "det kildene er enige om", "variants": [{"label": "…", "description": "…", "sources": ["https://…"], "primary": true}]},
  "sources": [{"url": "https://…", "title": "…"}],
  "sources_read": [{"url": "https://…", "language": "en", "summary": "norsk sammendrag", "original_excerpt": "kort utdrag"}]}}
"paints" i et steg er nummeret i fargerekken (1 er den første). "technique" er ref-en til en teknikk i "library.techniques", eller null.`;
  return `Du er researchagenten i Paintrest, et personlig arbeidsverktøy for miniatyrmaling.
Brukeren har sett noe og vil vite hvordan det gjøres. Du finner flere kilder, sammenligner dem og lager ETT samlet utkast som brukeren kan teste ved malebordet.
Svar alltid på norsk bokmål.

${what}

${tools}
${mode !== 'none' ? `Du har høyst ${steps} verktøysteg per svar.

Arbeid slik:
1. Har brukeren gitt en lenke, åpne den først. Skriv i meldingen hva du faktisk fikk lest. En videoside gir ofte bare tittel og beskrivelse, ikke selve videoen; si fra om det.
2. Finn flere uavhengige kilder: maleblogger, guider, forum (Reddit, Discord-referater), produsentenes egne artikler og produktark, og videoer med beskrivelse. Søk gjerne på engelsk. Åpne 3–6 sider.
3. Sammenlign: hva gjør kildene likt, og hvor er de uenige? Skriv det felles i "comparison.common", og hver ulik fremgangsmåte som en variant i "comparison.variants" med URL-ene til kildene som viser den. Merk én variant som utgangspunkt ("primary": true). Stegene i guiden følger utgangspunktet.
   I "sources_read" skal "summary" si kort hva kilden viser og hva den bidrar med (for eksempel «viser hele metoden i video», «bare produktråd»).
4. Skill mellom det kildene viser og det du selv foreslår: "basis": "documented" bare når en åpnet kilde beskriver steget, ellers "synthesized".
5. Lag ETT forslag av typen ${focus.target}. Lag ikke andre forslagstyper.

Kildekrav:
- Oppgi kildene du bygger på i "sources" med eksakt URL. Bare sider du har søkt fram eller åpnet, blir godtatt.
- Bruk "documented" på forslaget bare når åpnede kilder sier det. Det kildene ikke sier, skriv i "uncertainty".
- Sikkerhet (løsemidler, ventilasjon, tørking) skal stå i "risk_note" når det er relevant.` : ''}

Regler:
- Du kan ikke endre biblioteket, prosjektene eller malingskatalogen. Utkastet ditt lagres først når brukeren godkjenner det.
${focus.revision ? '- Teknikken finnes fra før; du lager et forslag til endring av den, ikke en ny.' : '- Ikke lag et utkast som finnes fra før i "library" (sammenlign navn). Si heller fra i meldingen.'}
- For å endre et eget ventende utkast (your_pending_proposals), sett "update_of" til dets ref.
- Tillatte forslagstyper: ${resultTypes.join(', ') || 'ingen'}.
- Hold teksten kort og praktisk. Steg skal kunne leses ved malebordet.

Forslagsform i "proposals":
${shape}

"known_sources" i konteksten er sider som allerede er funnet for biblioteket. Åpne dem direkte når de er relevante, og bruk søk til å finne NYE sider.

Kontekst (det du kan lese; endres bare av brukeren):
${JSON.stringify(context)}`;
}

type Action =
  | { action: 'search'; query: string; why: string | null }
  | { action: 'open'; url: string; why: string | null }
  | { action: 'look'; image_urls: string[]; question: string; why: string | null }
  | { action: 'final'; message: string; proposals: unknown[] };

/** Finds the JSON action in a reply, also inside a code fence or surrounding prose. */
export function parseAction(text: string): Action | null {
  const candidates: string[] = [];
  for (const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) if (m[1]) candidates.push(m[1]);
  candidates.push(text);
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(text.slice(first, last + 1));
  for (const c of candidates) {
    let v: Record<string, unknown>;
    try { v = JSON.parse(c.trim()); } catch { continue; }
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const why = typeof v.why === 'string' ? v.why : null;
    if (v.action === 'search' && typeof v.query === 'string') return { action: 'search', query: v.query, why };
    if (v.action === 'open' && typeof v.url === 'string') return { action: 'open', url: v.url, why };
    if (v.action === 'look' && Array.isArray(v.image_urls)) {
      return { action: 'look', image_urls: v.image_urls.filter((x): x is string => typeof x === 'string'), question: typeof v.question === 'string' ? v.question : '', why };
    }
    if (v.action === 'final' || 'message' in v || 'proposals' in v) {
      return { action: 'final', message: typeof v.message === 'string' ? v.message : '', proposals: Array.isArray(v.proposals) ? v.proposals : [] };
    }
  }
  return null;
}

export async function runResearch(deps: ResearchDeps, input: ResearchInput, emit: (e: ResearchEvent) => void): Promise<void> {
  const history = input.messages
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-MAX_MESSAGES);
  if (!history.length || history.at(-1)!.role !== 'user') throw new UserError('Siste melding må være fra brukeren');

  let mode: WebMode = deps.hostedSearch ? 'hosted' : deps.search?.configured() ? 'search' : 'none';
  const focus = input.focus?.kind === 'images' ? input.focus : null;
  const plan = input.focus?.kind === 'plan' ? input.focus : null;
  const knowledge = input.focus?.kind === 'knowledge' ? input.focus : null;
  // Library research has no use for looking at images.
  let vision = !!deps.lookAtImages && !knowledge;
  // The plan request carries the chosen pictures as input_image; dropped if the model refuses images.
  let imagesAttached = !!plan?.reference_images.length;
  const maxSteps = focus ? MAX_IMAGE_STEPS : plan ? MAX_PLAN_STEPS : knowledge ? MAX_KNOWLEDGE_STEPS : MAX_TOOL_STEPS;
  const build = () => researchInstructions(input.context, input.result_types, mode, input.focus ?? null, vision, imagesAttached, !!input.direct_apply && !input.focus);
  const withImages = (): ResponsesMessage[] => {
    if (!imagesAttached || !plan) return history;
    const last = history.at(-1)!;
    return [...history.slice(0, -1), {
      role: 'user',
      content: [{ type: 'input_text', text: last.content }, ...plan.reference_images.slice(0, 4).map((u) => ({ type: 'input_image' as const, image_url: u }))],
    }];
  };
  let instructions = build();
  const work: { role: 'user' | 'assistant'; content: string }[] = [];
  const opened = new Map<string, PageResult>();
  const searched = new Map<string, SearchHit>();
  const trace: TraceStep[] = [];
  let steps = 0;
  let nudged = false;
  let model = input.model ?? '';

  emit({ type: 'status', text: knowledge ? (knowledge.revision ? `Forbedring av ${knowledge.revision.name}` : knowledge.target === 'technique' ? 'Research: teknikk' : 'Research: oppskrift') : plan ? `Maleplan for ${plan.subject_name}${imagesAttached ? ` · ${plan.reference_images.length} bilder` : ''}` : focus ? `Bildejakt for ${focus.subject_name}` : mode === 'hosted' ? 'Agenten søker via UiB' : mode === 'search' ? 'Agenten planlegger søket' : 'Agenten svarer uten nettilgang' });

  for (let round = 0; round < maxSteps + 4; round++) {
    if (deps.signal?.aborted) throw new UserError('Avbrutt');
    let out;
    try {
      out = await deps.provider.respond([...withImages(), ...work], {
        model: input.model, instructions, timeoutMs: 180_000, hostedSearch: mode === 'hosted' ? deps.hostedSearch : null,
      });
    } catch (e) {
      if (imagesAttached && e instanceof UserError && !(e instanceof HostedToolError) && /feil (400|415|422)/i.test(e.message)) {
        imagesAttached = false;
        vision = false;
        instructions = build();
        emit({ type: 'tool_error', action: 'look', target: 'bildene av miniatyren', error: `Modellen godtok ikke bilder (${e.message}). Fortsetter uten bildene.` });
        trace.push({ action: 'look', target: 'bildene av miniatyren', result: 'Ikke støttet, fortsatte uten bilder' });
        round--;
        continue;
      }
      if (!(e instanceof HostedToolError) || mode !== 'hosted') throw e;
      // UiB rejected the built-in search: fall back to Paintrest's search, or none.
      mode = deps.search?.configured() ? 'search' : 'none';
      instructions = build();
      emit({ type: 'tool_error', action: 'search', target: 'UiB nettsøk', error: `${e.message} Fortsetter ${mode === 'search' ? 'med Tavily/Brave' : 'uten nettsøk'}.` });
      trace.push({ action: 'search', target: 'UiB nettsøk', result: 'Ikke støttet, byttet modus' });
      round--;
      continue;
    }
    model = out.model;
    // Hosted search happens inside the response; report it as steps and count the cited pages as found.
    for (const q of out.searches ?? []) {
      emit({ type: 'search', query: q, why: 'via UiB' });
      trace.push({ action: 'search', target: q, result: 'via UiB' });
    }
    for (const c of out.citations ?? []) searched.set(normUrl(c.url), { title: c.title, url: c.url, snippet: '' });
    if (out.searches?.length || out.citations?.length) {
      emit({ type: 'search_done', query: (out.searches ?? []).join(' · ') || 'UiB nettsøk', hits: out.citations ?? [] });
    }
    const action = parseAction(out.text);
    work.push({ role: 'assistant', content: out.text });

    if (!action) {
      // One retry: models sometimes answer in prose or refuse once and comply when reminded of the format.
      if (!nudged) {
        nudged = true;
        work.push({ role: 'user', content: 'Svaret ditt var ikke ett JSON-objekt. Dette er en vanlig research-oppgave om miniatyrmaling. Svar med ett JSON-objekt: {"action": "open", …} eller {"action": "final", "message": "…", "proposals": [ … ]}.' });
        continue;
      }
      const last = trace.at(-1);
      const where = last ? ` Siste steg før svaret: ${last.action === 'open' ? 'leste' : 'søkte'} ${last.target}.` : ' Det skjedde før agenten hadde søkt eller lest noe.';
      const warning = isRefusal(out.text)
        ? `Modellen ${model} avslo forespørselen og svarte: «${out.text.trim().slice(0, 160)}».${where} Prøv igjen, omformuler, eller velg en annen standardmodell under AI og nettsøk.`
        : `Svaret var ikke i forventet format, så eventuelle forslag ble ikke lest inn.${where}`;
      emit(finalEvent(isRefusal(out.text) ? 'Agenten fikk ikke svar fra modellen denne gangen.' : out.text.trim(), [], model, [warning], trace, opened));
      return;
    }
    if (action.action === 'final') {
      const checked = verifyProposals(action.proposals, opened, searched);
      emit(finalEvent(action.message, checked.proposals, model, checked.warnings, trace, opened));
      return;
    }
    const allowed = action.action === 'look'
      ? vision && mode !== 'none'
      : mode === 'search' || (mode === 'hosted' && action.action === 'open');
    if (!allowed || steps >= maxSteps) {
      work.push({ role: 'user', content: mode === 'none'
        ? 'Nettilgang er ikke tilgjengelig. Svar nå med {"action": "final", …}.'
        : steps >= maxSteps
          ? `Du har brukt alle ${maxSteps} verktøystegene. Svar nå med {"action": "final", …} basert på det du har funnet.`
          : action.action === 'look'
            ? 'Bildevisning er ikke tilgjengelig. Vurder bildene ut fra teksten rundt dem, og fortsett med open eller final.'
            : 'Bruk det innebygde web_search-verktøyet til å søke. Svar med {"action": "open", …} eller {"action": "final", …}.' });
      continue;
    }
    steps++;

    if (action.action === 'look') {
      // Only images from pages opened in this turn: the model cannot make Paintrest fetch arbitrary files.
      const known = new Set([...opened.values()].flatMap((pg) => pg.images.map((i) => normUrl(i.url))));
      const urls = [...new Set(action.image_urls.map(normUrl))].filter((u) => known.has(u)).slice(0, MAX_LOOK);
      if (!urls.length) {
        work.push({ role: 'user', content: 'Ingen av bilde-URL-ene finnes på sidene du har åpnet. Bruk eksakte URL-er fra bildelistene.' });
        continue;
      }
      emit({ type: 'look', count: urls.length, why: action.why });
      try {
        const verdict = await deps.lookAtImages!(urls, action.question || `Viser bildene ${focus?.subject_name ?? 'figuren'}?`, focus?.reference_image ?? plan?.reference_images[0] ?? null);
        emit({ type: 'look_done', summary: verdict.slice(0, 300) });
        trace.push({ action: 'look', target: `${urls.length} bilder`, result: verdict.slice(0, 160) });
        work.push({ role: 'user', content: `Vurdering av bildene:\n${verdict}` });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (e instanceof VisionUnsupportedError) {
          vision = false;
          instructions = build();
        }
        emit({ type: 'tool_error', action: 'look', target: `${urls.length} bilder`, error: msg });
        trace.push({ action: 'look', target: `${urls.length} bilder`, result: `Feil: ${msg}` });
        work.push({ role: 'user', content: `Kunne ikke vise bildene: ${msg}${vision ? '' : ' Bildevisning er slått av for resten av oppdraget; bruk teksten rundt bildene.'}` });
      }
      continue;
    }

    if (action.action === 'search') {
      emit({ type: 'search', query: action.query, why: action.why });
      try {
        const hits = await deps.search!.search(action.query);
        hits.forEach((h) => searched.set(normUrl(h.url), h));
        emit({ type: 'search_done', query: action.query, hits: hits.map((h) => ({ title: h.title, url: h.url })) });
        trace.push({ action: 'search', target: action.query, result: `${hits.length} treff` });
        work.push({ role: 'user', content: `Søkeresultater for «${action.query}»:\n${hits.map((h, i) => `${i + 1}. ${h.title}\n   ${h.url}\n   ${h.snippet}`).join('\n') || 'Ingen treff.'}` });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        emit({ type: 'tool_error', action: 'search', target: action.query, error: msg });
        trace.push({ action: 'search', target: action.query, result: `Feil: ${msg}` });
        work.push({ role: 'user', content: `Søket feilet: ${msg}` });
      }
    } else {
      emit({ type: 'open', url: action.url, why: action.why });
      try {
        const page = await deps.openPage(action.url);
        opened.set(normUrl(page.url), page);
        opened.set(normUrl(action.url), page);
        emit({ type: 'open_done', url: page.url, title: page.title, image_count: page.images.length });
        trace.push({ action: 'open', target: page.url, result: `${page.title} · ${page.images.length} bilder` });
        work.push({ role: 'user', content: formatPage(page) });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        emit({ type: 'tool_error', action: 'open', target: action.url, error: msg });
        trace.push({ action: 'open', target: action.url, result: `Feil: ${msg}` });
        work.push({ role: 'user', content: `Kunne ikke åpne ${action.url}: ${msg}` });
      }
    }
  }
  emit(finalEvent('Agenten ble ikke ferdig innen grensen for antall steg.', [], model, [], trace, opened));
}

function formatPage(p: PageResult): string {
  return `Side: ${p.title} (${p.site})
URL: ${p.url}
${p.language ? `Språk: ${p.language}\n` : ''}${p.author ? `Forfatter/nettsted: ${p.author}\n` : ''}Tekst:
${p.text || '(ingen lesbar tekst)'}

Bilder på siden (bruk eksakt URL hvis du foreslår eller vil se på et bilde):
${p.images.map((i) => `- ${i.url}${i.alt ? ` — alt: ${i.alt}` : ''}${i.caption ? ` — bildetekst: ${i.caption}` : ''}${i.context ? ` — tekst rundt: ${i.context}` : ''}`).join('\n') || '(ingen bilder funnet)'}`;
}

/** Typical refusal phrasings (English and Norwegian). */
export function isRefusal(text: string): boolean {
  return /^\s*(i'?m sorry|sorry,|i can(no|')t (assist|help)|i am unable|i'?m unable|beklager, men jeg kan ikke|jeg kan ikke hjelpe)/i.test(text.trim())
    && text.trim().length < 400;
}

export function normUrl(u: string): string {
  try {
    const x = new URL(u);
    x.hash = '';
    return x.toString().replace(/\/$/, '');
  } catch {
    return u.trim();
  }
}

/**
 * Keeps only images that appeared on a page opened in this turn and sources
 * that were opened or returned by search. Downgrades "documented" when
 * nothing was opened. Everything removed is reported as a warning.
 */
export function verifyProposals(proposals: unknown[], opened: Map<string, PageResult>, searched: Map<string, SearchHit>) {
  const warnings: string[] = [];
  const out: unknown[] = [];
  for (const raw of proposals) {
    if (!raw || typeof raw !== 'object') continue;
    const p = structuredClone(raw) as Record<string, unknown> & { payload?: Record<string, unknown> };
    const payload = (p.payload ?? {}) as Record<string, unknown>;

    if (Array.isArray(payload.sources)) {
      const before = payload.sources.length;
      payload.sources = payload.sources.flatMap((s: Record<string, unknown>) => {
        const url = typeof s?.url === 'string' ? normUrl(s.url) : '';
        const page = opened.get(url);
        const hit = searched.get(url);
        if (!page && !hit) return [];
        return [{ url: page?.url ?? hit!.url, title: page?.title ?? hit!.title, author: page?.author ?? null, opened: !!page }];
      });
      if ((payload.sources as unknown[]).length < before) warnings.push(`Fjernet ${before - (payload.sources as unknown[]).length} kilde(r) som agenten ikke hadde søkt fram eller åpnet.`);
      if (p.evidence === 'documented' && !(payload.sources as { opened: boolean }[]).some((s) => s.opened)) {
        p.evidence = 'synthesized';
        warnings.push('Et forslag var merket «dokumentert» uten en åpnet kilde, og er endret til «foreslått av AI».');
      }
    } else if (p.evidence === 'documented' && p.type !== 'reference_selection') {
      p.evidence = 'synthesized';
    }

    if ((p.type === 'technique' || p.type === 'recipe') && payload.comparison && typeof payload.comparison === 'object') {
      // Variants may only point to the sources that were kept, by their canonical URL.
      const kept = new Map(((payload.sources as { url: string }[] | undefined) ?? []).map((x) => [normUrl(x.url), x.url]));
      const c = payload.comparison as { variants?: { sources?: unknown }[] };
      for (const v of Array.isArray(c.variants) ? c.variants : []) {
        if (!v || typeof v !== 'object') continue;
        const list = Array.isArray(v.sources) ? v.sources : [];
        v.sources = list.flatMap((u) => (typeof u === 'string' && kept.has(normUrl(u)) ? [kept.get(normUrl(u))!] : []));
      }
    }

    if ((p.type === 'technique' || p.type === 'recipe') && Array.isArray(payload.steps)) {
      // «Vist i kilde» needs at least one opened page behind the draft.
      const anyOpened = Array.isArray(payload.sources) && (payload.sources as { opened: boolean }[]).some((x) => x.opened);
      if (!anyOpened) {
        let changed = 0;
        for (const st of payload.steps as Record<string, unknown>[]) {
          if (st && st.basis === 'documented') { st.basis = 'synthesized'; changed++; }
        }
        if (changed) warnings.push(`${changed} steg var merket «vist i kilde» uten en åpnet kilde, og er endret til «forslag fra agenten».`);
      }
    }

    if ((p.type === 'paint_plan' || p.type === 'technique' || p.type === 'recipe') && Array.isArray(payload.sources_read)) {
      payload.sources_read = payload.sources_read.flatMap((x: Record<string, unknown>) => {
        const page = typeof x?.url === 'string' ? opened.get(normUrl(x.url)) : undefined;
        if (!page) return [];
        return [{ url: page.url, title: page.title, site: page.site, language: typeof x.language === 'string' ? x.language.slice(0, 12) : page.language,
          summary: typeof x.summary === 'string' ? x.summary.slice(0, 800) : null, original_excerpt: typeof x.original_excerpt === 'string' ? x.original_excerpt.slice(0, 600) : null }];
      });
    }

    if (p.type === 'reference_selection') {
      const imgs = Array.isArray(payload.images) ? payload.images : [];
      const kept = imgs.flatMap((i: Record<string, unknown>) => {
        const imageUrl = typeof i?.image_url === 'string' ? normUrl(i.image_url) : '';
        let page = typeof i?.page_url === 'string' ? opened.get(normUrl(i.page_url)) : undefined;
        if (!page || !page.images.some((x) => normUrl(x.url) === imageUrl)) {
          page = [...opened.values()].find((pg) => pg.images.some((x) => normUrl(x.url) === imageUrl));
        }
        if (!page) return [];
        const img = page.images.find((x) => normUrl(x.url) === imageUrl)!;
        return [{
          image_url: img.url, page_url: page.url, page_title: page.title, site: page.site,
          creator: page.author, caption: typeof i.caption === 'string' && i.caption.trim() ? i.caption.trim() : img.caption ?? img.alt ?? null,
          kind: ['concept_art', 'official', 'painted', 'other'].includes(i.kind as string) ? i.kind : null,
          confidence: ['high', 'medium', 'low'].includes(i.confidence as string) ? i.confidence : null,
          reason: typeof i.reason === 'string' ? i.reason.slice(0, 600) : null,
          original_text: typeof i.original_text === 'string' ? i.original_text.slice(0, 400) : (img.context ?? null),
          page_language: page.language,
        }];
      });
      if (kept.length < imgs.length) warnings.push(`Fjernet ${imgs.length - kept.length} bilde(r) som ikke fantes på en side agenten åpnet.`);
      if (!kept.length) continue;
      const order = { high: 0, medium: 1, low: 2 } as Record<string, number>;
      kept.sort((a, b) => (order[a.confidence as string] ?? 3) - (order[b.confidence as string] ?? 3));
      payload.images = kept;
      payload.sources_read = (Array.isArray(payload.sources_read) ? payload.sources_read : []).flatMap((x: Record<string, unknown>) => {
        const page = typeof x?.url === 'string' ? opened.get(normUrl(x.url)) : undefined;
        if (!page) return [];
        return [{
          url: page.url, title: page.title, site: page.site,
          language: typeof x.language === 'string' ? x.language.slice(0, 12) : page.language,
          summary: typeof x.summary === 'string' ? x.summary.slice(0, 800) : null,
          original_excerpt: typeof x.original_excerpt === 'string' ? x.original_excerpt.slice(0, 600) : null,
        }];
      });
      p.evidence = 'documented';
    }
    p.payload = payload;
    out.push(p);
  }
  return { proposals: out, warnings };
}

function finalEvent(message: string, proposals: unknown[], model: string, warnings: string[], trace: TraceStep[], opened: Map<string, PageResult>): ResearchEvent {
  const pages = new Map<string, PageSeen>();
  for (const p of opened.values()) {
    pages.set(p.url, { url: p.url, title: p.title, site: p.site, author: p.author, language: p.language, image_count: p.images.length });
  }
  return { type: 'final', message: message || 'Agenten ga et tomt svar.', proposals, model, warnings, trace, pages: [...pages.values()] };
}
