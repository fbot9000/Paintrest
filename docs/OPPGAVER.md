# Oppgaver

Hva som skal gjøres, og hvem som gjør det. Hvordan du tar en oppgave og leverer den, står i [PROSESS.md](PROSESS.md).

**Rekkefølgen er ikke satt ennå.** Brukeren prioriterer. Til da: spør brukeren før du tar en oppgave.

## Venter på brukeren

Spørsmål og handlinger bare brukeren kan ta. Ingen agent begynner på det som avhenger av dem, før de er besvart.

### B-1 Agentkolonnen på miniatyrsiden: to åpne spørsmål

Økta «Research-agent miniatyr-søk» lagde skisser 18. november: [Paintrest – agenten på miniatyrsiden (skisse)](https://www.figma.com/design/Pyf2kdZuiqWqHIq3bzRDGV?node-id=24-2), siden «Skisser», fem tavler. Den venter på svar før den bygger noe:

1. Skal verkstedet få samme agentkolonne, slik tavle D viser?
2. Skal nye miniatyrer fra chatten vente på «Legg til», slik de gjør fra kartleggingen?

I tillegg: skal siden «Komponenter» i Figma-fila slettes, eller skal skissene kobles til den?

### B-2 Slett de gamle branchene på GitHub

**Ferdig** 24. november 2026. Bare `main` står igjen.

### B-3 Prioriter oppgavene under

Sett rekkefølgen, eller si hvilke som skal gjøres denne uka. Si også hvilke ønsker fra del C i [kilder/VURDERING.md](kilder/VURDERING.md) som skal bli oppgaver.

### B-4 Legg kildedokumentene i repoet

**Ferdig** 24. november 2026. Dokumentene ligger i [kilder/](kilder/README.md), med en vurdering i [kilder/VURDERING.md](kilder/VURDERING.md).

### B-5 Bekreft prinsippene fra kildedokumentene

Del A i [kilder/VURDERING.md](kilder/VURDERING.md) har 13 prinsipper fra de opprinnelige dokumentene som ser ut til å gjelde fortsatt. Si hvilke som skal gjelde, endres eller strykes. De du bekrefter, skrives som en beslutning. Til da er de et forslag.

## Oppgaver

Status er `ledig`, `pågår (hvem, dato)` eller `ferdig (dato, commit)`. «Berører» viser hvilke deler av koden oppgaven trolig endrer, slik at to agenter ikke tar oppgaver som kolliderer.

### O-1 Rediger en godkjent maleplan (bit 4)

- **Status:** ledig
- **Avhenger av:** –
- **Berører:** `src/features/workspace/` (Maleplan-fanen), `src/features/painting/`, `src/data/local-commands.ts`, `src/domain/commands.ts`
- **I dag:** du kan redigere agentens planforslag før godkjenning, og agenten kan foreslå nye versjoner. Du kan ikke redigere en godkjent plan selv. «Lag maleplan» på miniatyrkortet lager bare en tom versjon 1.
- **Ferdig når:** du kan endre en godkjent plan og få en ny versjon. Det er avgjort og testet hvordan malefremdrift og avvik følger med til en ny versjon. Det gjelder også versjoner agenten lager.

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
- **Avhenger av:** svaret på B-1 (skissene flytter kildelisten i verkstedet)
- **Berører:** `src/features/images/`, `src/features/workspace/`
- **I dag:** «Fordel bilder» og kildelisten i verkstedet finnes.

### O-5 Malingstyper og malekjeder

- **Status:** ledig
- **Avhenger av:** at brukeren avgjør om `product_kind` skal utvides (for eksempel `ink`, `dry`, `air`). Se avvik 37
- **Berører:** `src/domain/paints.ts`, `src/features/paints/`, `server/paint-import.ts`
- **Ferdig når:** malingene kan ha produktbilder, og appen foreslår malekjeder (base, layer, highlight, shade, effekter).

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

- **Status:** ledig
- **Avhenger av:** en lokal kjøring med nøkler. Skymiljøet når ikke tjenestene
- **Berører:** `docs/AVVIK.md` («Antakelser»), `docs/STATUS.md`, og koden der svarene ikke stemmer
- **Ferdig når:** UiB (tekst, nettsøk, bilder), Brave, Tavily, YouTube oEmbed, Kickstarter, Gamefound og Naver er prøvd, og resultatet står i AVVIK og STATUS.

### O-9 Ubrukt kode i agentpanelet

- **Status:** ledig
- **Avhenger av:** –
- **Berører:** `src/features/agent/AgentPanel.tsx`
- **I dag:** `revisePlan` og `suggestPlan` blir aldri kalt. Fjern dem, eller ta dem i bruk.

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

## Senere

- Ekte database i stedet for `data.json`. Valget er ikke tatt (avvik 29).
- Ekte BGG-oppslag.
- Innlogging og nettvern for en delt server.
