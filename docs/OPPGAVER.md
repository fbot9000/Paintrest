# Oppgaver

Hva som skal gjøres, og hvem som gjør det. Hvordan du tar en oppgave og leverer den, står i [PROSESS.md](PROSESS.md).

## Uka 24.–29. november 2026

Satt av brukeren 24. november. Ta den øverste ledige oppgaven i et spor som ingen andre jobber i. Oppgaver som ikke står her, tar du bare etter å ha spurt brukeren.

**Høyst én agent per spor**, altså to samtidig.

### Spor A: maleplanen

Målet er at du kan redigere en godkjent plan selv, og at en ny versjon aldri skjuler avvik eller fremdrift (prinsipp A1 og A6 i [kilder/VURDERING.md](kilder/VURDERING.md)).

1. **O-1** Rediger en godkjent maleplan, og ta med avvik og fremdrift til nye versjoner
2. **O-13** «Planen virker ikke» i Painting Mode (løser også O-9)
3. **O-2** Bruk en teknikk eller oppskrift i et plansteg (7.7)

### Spor B: malinger

1. **O-5** Nye malingstyper: ink, dry og air
2. **O-14** Handleliste
3. **O-15** Produktbilder: agenten finner, du velger
4. **O-16** Malekjeder som oppskrifter
5. **O-18** Handlelisten fra «Finn fram malingene» i Painting Mode, når O-1 er ferdig

### Fredag: test mot de ekte tjenestene

**O-8**, sammen med brukeren, som kjører appen lokalt med UiB-nøkkel. Agenten i spor B lager sjekklisten torsdag, med de nye AI-funksjonene fra begge sporene først.

### Felles filer

Begge sporene endrer trolig `src/domain/types.ts`, `src/data/local-commands.ts` og `src/domain/views.ts`. Ta små commits, og hent `main` ofte.

**Skjemaversjonen** (`SCHEMA_VERSION` i `src/domain/types.ts`, migrering i `src/data/store.ts`) kan bare økes av ett spor om gangen. Skriv i statuslinja til oppgaven at du øker den, og push endringen alene og tidlig.

## Venter på brukeren

Spørsmål og handlinger bare brukeren kan ta. Ingen agent begynner på det som avhenger av dem, før de er besvart.

### B-1 Agentkolonnen: ett åpent spørsmål

Skissene fra 18. november: [Paintrest – agenten på miniatyrsiden (skisse)](https://www.figma.com/design/Pyf2kdZuiqWqHIq3bzRDGV?node-id=24-2), siden «Skisser», fem tavler.

1. ~~Skal verkstedet få samme agentkolonne, slik tavle D viser?~~ **Ja** ([beslutningen](beslutninger/2026-11-24-agentkolonne-i-verkstedet.md)).
2. **Åpent:** Skal nye miniatyrer fra chatten vente på «Legg til», slik de gjør fra kartleggingen?

I tillegg: skal siden «Komponenter» i Figma-fila slettes, eller skal skissene kobles til den?

### B-2 Slett de gamle branchene på GitHub

**Ferdig** 24. november 2026. Bare `main` står igjen.

### B-3 Prioriter oppgavene

**Ferdig** 24. november 2026. Se «Uka 24.–29. november» over.

### B-4 Legg kildedokumentene i repoet

**Ferdig** 24. november 2026. Dokumentene ligger i [kilder/](kilder/README.md), med en vurdering i [kilder/VURDERING.md](kilder/VURDERING.md).

### B-5 Bekreft prinsippene fra kildedokumentene

Del A i [kilder/VURDERING.md](kilder/VURDERING.md) har 13 prinsipper fra de opprinnelige dokumentene som ser ut til å gjelde fortsatt. Si hvilke som skal gjelde, endres eller strykes. De du bekrefter, skrives som en beslutning. Til da er de et forslag.

## Oppgaver

Status er `ledig`, `pågår (hvem, dato)` eller `ferdig (dato, commit)`. «Berører» viser hvilke deler av koden oppgaven trolig endrer, slik at to agenter ikke tar oppgaver som kolliderer.

### O-1 Rediger en godkjent maleplan, og ta med avvik og fremdrift til nye versjoner (bit 4)

- **Status:** ferdig (24. november 2026, a7aced5 og 5ef819a)
- **Avhenger av:** –
- **Berører:** `src/features/workspace/` (Maleplan-fanen), `src/features/painting/`, `src/data/local-commands.ts`, `src/data/research-commands.ts` (godkjenning av planversjoner), `src/domain/commands.ts`, `src/domain/views.ts`
- **I dag:**
  - Du kan redigere agentens planforslag før godkjenning, og agenten kan foreslå nye versjoner. Du kan ikke redigere en godkjent plan selv. «Lag maleplan» på miniatyrkortet lager bare en tom versjon 1.
  - En ny versjon får nye id-er på deler og steg. Painting Mode viser bare avvik og gruppetall for gjeldende versjon, og avkrysninger på de gamle delene. Ut fra koden forsvinner derfor åpne avvik, avkrysninger og gruppetall fra visningen (`research-commands.ts`, `views.ts`). Ikke prøvd i appen.
- **Ferdig når:**
  - Du kan endre en godkjent plan og få en ny versjon. Den forrige blir `superseded` og endres ikke (skjema §6 «Maleplan»).
  - Ved hver ny versjon, fra deg eller fra agenten, ser du de åpne avvikene og velger hvilke som skal bakes inn i planen. Resten følger med som avvik. Avkrysninger og gruppetall følger med for delene som finnes i begge versjonene ([beslutningen](beslutninger/2026-11-24-ny-planversjon-avvik-og-fremdrift.md)).
  - Hvordan en del kjennes igjen mellom to versjoner, står i ARKITEKTUR eller AVVIK.
  - Forseglede avvik og `paint_completion` er urørt.
  - Tester dekker dette, og flyten er prøvd i nettleseren.

### O-2 Bruk en teknikk eller oppskrift i et plansteg (7.7)

- **Status:** ledig
- **Avhenger av:** O-1
- **Berører:** Maleplan-fanen, `src/features/painting/`, `src/features/library/`
- **I dag:** `plan_step.technique_version_id` og `recipe_version_id` er alltid `null`.
- **Ferdig når:** et plansteg kan peke på en teknikk eller oppskrift, og Painting Mode lenker til verkstedguiden. Se 7.7 i [BIT7-KUNNSKAP.md](BIT7-KUNNSKAP.md).

### O-3 Palett og prosess for prosjektet (bit 3)

- **Status:** ledig
- **Avhenger av:** hva siden skal inneholde. Kildedokumentene ønsket palett med omfang og metoder for prosjektet (C10 i [kilder/VURDERING.md](kilder/VURDERING.md))
- **Berører:** `src/features/projects/`, ruten `palett` i `src/app/App.tsx`
- **I dag:** siden er en plassholder («snart»). Paletten per miniatyr finnes i verkstedet.

### O-4 Egen side for kildene (resten av bit 6)

- **Status:** ledig
- **Avhenger av:** O-17 (kildelisten i verkstedet flytter inn i Bilder-fanen)
- **Berører:** `src/features/images/`, `src/features/workspace/`
- **I dag:** «Fordel bilder» og kildelisten i verkstedet finnes.

### O-5 Nye malingstyper: ink, dry og air

- **Status:** ferdig (24. november 2026, c7e4225)
- **Avhenger av:** –
- **Berører:** `src/domain/types.ts` (`ProductKind`), `src/domain/paints.ts`, `src/features/paints/`, `server/paint-import.ts`
- **I dag:** typene er primer, base, layer, shade, contrast, technical, metallic, medium og other. AI-importen legger ink og dry under other (avvik 37).
- **Ferdig når:** `ink`, `dry` og `air` finnes som typer i skjemaet for malinger, i filtrene og i AI-importen. Wash blir værende under shade. Malinger som er lagt inn fra før, beholder typen sin. Avvik 37 er oppdatert ([beslutningen](beslutninger/2026-11-24-malingstyper-ink-dry-air.md)).

### O-6 Forbedre oppskrifter med agenten

- **Status:** ledig
- **Avhenger av:** –
- **Berører:** `src/features/library/`, `src/data/research-commands.ts`, `server/research-agent.ts`
- **I dag:** bare teknikker kan forbedres (7.6).

### O-7 Knytt en erfaring til en miniatyr

- **Status:** ledig
- **Avhenger av:** –
- **Berører:** `src/features/library/ExperienceDialog.tsx`
- **I dag:** feltet `subject_id` finnes på `technique_experience`, men skjermen bruker det ikke.

### O-8 Test mot de ekte tjenestene

- **Status:** ledig. Planlagt fredag 27. november, med brukeren
- **Avhenger av:** at brukeren kjører appen lokalt med UiB-nøkkel. Skymiljøet når ikke tjenestene
- **Berører:** `docs/AVVIK.md` («Antakelser»), `docs/STATUS.md`, og koden der svarene ikke stemmer
- **Ferdig når:**
  - En sjekkliste brukeren kan følge, ligger i `docs/`. De nye AI-funksjonene fra uka står først.
  - UiB (tekst, nettsøk, bilder), Brave, Tavily, YouTube oEmbed, Kickstarter, Gamefound og Naver er prøvd.
  - Resultatet står i AVVIK og STATUS.

### O-9 Ubrukt kode i agentpanelet

- **Status:** pågår, sammen med O-13 (spor A: maleplanen, 24. november 2026)
- **Avhenger av:** –
- **Berører:** `src/features/agent/AgentPanel.tsx`
- **I dag:** `revisePlan` og `suggestPlan` blir aldri kalt. `revisePlan` åpner planen som revisjonsmål og ber agenten om en ny versjon, nesten det O-13 trenger. Fjern det som ikke blir brukt.

### O-10 Del opp JavaScript-fila

- **Status:** ledig
- **Avhenger av:** –
- **Berører:** `vite.config.ts`, `src/app/App.tsx`
- **I dag:** fila er 741 kB, og Vite varsler over 500 kB.

### O-11 Sjekk punktene i AVVIK mot kildedokumentene

- **Status:** ledig
- **Avhenger av:** –
- **Berører:** `docs/AVVIK.md`
- **I dag:** dokumentene som helhet er vurdert i [kilder/VURDERING.md](kilder/VURDERING.md). Punktene i AVVIK er ikke sjekket ett for ett, og flere er skrevet av agenter som ikke hadde dokumentene.
- **Ferdig når:** hvert punkt viser til riktig avsnitt i dokumentene, eller er rettet eller fjernet. Mest nyttig før arbeidet mot en ekte database begynner.

### O-12 Tester og bygg på GitHub ved hver push til main

- **Status:** ledig
- **Avhenger av:** –
- **Berører:** `.github/workflows/`
- **Ferdig når:** GitHub kjører `npm test` og `npm run build` ved hver push til `main`, og en rød `main` er synlig.

### O-13 «Planen virker ikke» i Painting Mode

- **Status:** pågår (spor A: maleplanen, 24. november 2026)
- **Avhenger av:** O-1 (begge endrer Painting Mode og planversjonene)
- **Berører:** `src/features/painting/`, `src/features/agent/AgentPanel.tsx`, `src/features/workspace/`
- **I dag:** finnes ikke. Kildedokumentene ønsket det (C2 i [kilder/VURDERING.md](kilder/VURDERING.md), spec §5, datamodell §14).
- **Ferdig når:** fra en plan i Painting Mode kan du si at planen ikke virker og hva som er galt. Agenten lager et forslag til ny versjon av akkurat den planen. Gjeldende versjon og ferdigstillinger står til du godkjenner. Den nye versjonen følger [beslutningen om avvik og fremdrift](beslutninger/2026-11-24-ny-planversjon-avvik-og-fremdrift.md). `revisePlan` og `suggestPlan` er tatt i bruk eller fjernet (O-9).

### O-14 Handleliste

- **Status:** ferdig (24. november 2026, 195c7d9), unntatt knappen i Painting Mode, som er flyttet til O-18. Skjemaversjonen er 6
- **Avhenger av:** –
- **Berører:** `src/domain/types.ts` og `src/data/store.ts` (ny tabell, ny skjemaversjon), `src/data/local-commands.ts`, `src/domain/views.ts`, `src/features/paints/`, `src/app/App.tsx`
- **I dag:** finnes ikke (C3 i [kilder/VURDERING.md](kilder/VURDERING.md)).
- **Ferdig når** ([beslutningen](beslutninger/2026-11-24-handleliste-fra-planene-og-manuelt.md)):
  - Malinger du ikke eier, og som står i godkjente maleplaner, står på listen som «nødvendig».
  - Du kan legge til selv og endre prioriteten: nødvendig, anbefalt eller ønskeliste.
  - Listen har én rad per maling, og kan filtreres per prosjekt.
  - «Kjøpt» setter malingen som eid.
  - En knapp i «Finn fram malingene» i Painting Mode venter til O-1 er ferdig, fordi begge endrer Painting Mode.

### O-18 Handlelisten fra «Finn fram malingene» i Painting Mode

- **Status:** ledig. Venter på O-1
- **Avhenger av:** O-1 og O-14
- **Berører:** `src/features/painting/`
- **I dag:** handlelisten finnes under «Malinger → Handleliste», men ikke i Painting Mode.
- **Ferdig når:** «Finn fram malingene» har en knapp som setter malinger du ikke har, på handlelisten, eller viser dem der.

### O-15 Produktbilder: agenten finner, du velger

- **Status:** ferdig (24. november 2026, 4043274). Nye valgfrie felt på `paint_product`, ingen ny skjemaversjon
- **Avhenger av:** O-5 (samme filer)
- **Berører:** `src/features/paints/`, `server/research-agent.ts`, `src/domain/types.ts` (felt for bildet)
- **Ferdig når:** fra en maling kan du be agenten finne et produktbilde hos produsenten eller en butikk. Du velger før noe lagres. Bildet vises i samlingen og der malingen brukes, og kilden lagres med lenke ([beslutningen](beslutninger/2026-11-24-produktbilder-agenten-finner-du-velger.md)).

### O-16 Malekjeder som oppskrifter

- **Status:** ferdig (24. november 2026, 40684a2)
- **Avhenger av:** O-5 (typene brukes i forslagene)
- **Berører:** `src/features/paints/`, `src/features/library/`, `src/data/research-commands.ts`, `server/research-agent.ts`
- **I dag:** oppskrifter i biblioteket er fargerekker med roller. Research til biblioteket kan lage dem, men ikke med utgangspunkt i én maling (C7 i [kilder/VURDERING.md](kilder/VURDERING.md)).
- **Ferdig når** ([beslutningen](beslutninger/2026-11-24-malekjeder-er-oppskrifter.md)):
  - Fra en maling i samlingen kan du be agenten om en malekjede (shade, base, layer, highlight).
  - Du velger «Bare det jeg har» eller «Beste valg».
  - Forslaget lagres som oppskrift i biblioteket når du lagrer.
  - Malingen viser hvilke oppskrifter den inngår i.

### O-17 Agentkolonnen på miniatyrsiden og i verkstedet

- **Status:** ledig. Ikke med denne uka
- **Avhenger av:** svar på spørsmål 2 i B-1
- **Berører:** `src/features/miniatures/`, `src/features/agent/`, `src/features/workspace/`
- **Ferdig når:** miniatyrsiden og verkstedet har agentkolonnen fra skissene (tavle A–D), og kildelisten i verkstedet ligger i Bilder-fanen ([beslutningen](beslutninger/2026-11-24-agentkolonne-i-verkstedet.md)).

## Senere

- Ekte database i stedet for `data.json`. Valget er ikke tatt (avvik 29).
- Ekte BGG-oppslag.
- Innlogging og nettvern for en delt server.
- Resten av ønskene i del C av [kilder/VURDERING.md](kilder/VURDERING.md): «maleklar» (C4), import av malinger fra bilder (C5), remiks av oppskrifter (C6), løft til biblioteket (C8), uttrekk fra video (C9), versjonsbevisst kontekst (C11), godkjenning av mange planer (C12) og alternativer til malinger du ikke har (C14).
