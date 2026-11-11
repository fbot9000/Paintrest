# Paintrest – prototype v0

Klikkbar første versjon av Paintrest. Den skal gi en følelse av verktøyet, og koden skal kunne bygges videre på.

**Førende dokumenter:** produktspesifikasjon v2.0, datamodell v3 og «Paintrest – databaseskjema og arkitektur». Figma-filen gir visuell retning.

## Kom i gang

```bash
npm install
npm run dev
```

`npm run dev` starter både Paintrest-serveren (port 8787, bare localhost) og Vite. Åpne adressen Vite skriver ut. Slik åpner du appen på iPad på samme nett:

```bash
npm run dev -- --host
```

Bruk så LAN-adressen Vite viser.

```bash
npm test          # kommandolaget: versjoner, avvik, ferdigstilling, BGG-kobling, biblioteket
npm run build     # typesjekk og produksjonsbygg til dist/
```

Ved første start får appen eksempeldata: prosjektet Avalon med fire figurer og ferdige maleplaner for Merlin og Druid Champions. «⋯ → Tilbakestill eksempeldata» setter dataene tilbake.

## AI-nøkkel (UiB)

Appen virker fullt ut uten AI. Nøkkelen legges inn under «⋯ → AI-nøkkel». Adressen er fylt ut med UiB sin: `https://models.api.uib.no/v1`.

- Nøkkelen sendes én gang fra nettleseren til Paintrest-serveren (`server/`). Serveren krypterer den med AES-256-GCM og lagrer den i `.paintrest-data/ai_credential.json`.
- Hovednøkkelen ligger i `.paintrest-data/master.key`, eller i miljøvariabelen `PAINTREST_MASTER_KEY` (64 heksadesimale tegn). Begge filene har tilgang bare for eieren, og mappen er utelatt fra git.
- Nettleseren får aldri nøkkelen tilbake, bare de fire siste tegnene.
- Bare `server/provider.ts` bruker den dekrypterte nøkkelen, i ett kall om gangen (`GET /models` og `POST /responses`, `Authorization: Bearer …`).
- Den publiserte forhåndsvisningen på claude.ai har ingen server. Der står det at nøkkelen må legges inn i en lokal kjøring.

```bash
npm test   # også serveren: kryptering, at nøkkelen ikke lekker, feilmeldinger
```

## Researchagent

Panelet til høyre i hvert prosjekt. Det bruker nøkkelen og standardmodellen fra «AI-nøkkel».

- Agenten leser prosjektet, miniatyrene, maleplanene og malingene dine. Den lager **utkast**: nye miniatyrer (`catalog_subject`) og maleplaner (`paint_plan`).
- En godkjent plan kan agenten bare foreslå ny versjon av når du har trykket «Revider planen med agenten» på miniatyren. Det åpner planen som revisjonsmål (`plan_revision`).
- Hvert forslag godkjennes for seg i én transaksjon. Maling som ikke finnes i katalogen, må du koble til et produkt eller opprette som ubekreftet før planen kan godkjennes. Er planen endret siden forslaget ble laget, stopper godkjenningen.
- Inne i prosjektet **endrer agenten direkte** når du skriver i panelet. Den kan lage, endre, dele, slå sammen og slette miniatyrer, og lage maleplaner med malinger som finnes i katalogen. Panelet viser «Agenten endret: …» med **Angre**, som fører hele runden tilbake. Har du endret det samme etterpå, sier angre fra i stedet for å overskrive.
- Bildeutvalg og planer med malinger som ikke finnes i katalogen, venter på deg som forslag. «Godkjenn alle» godkjenner dem som ikke trenger valg.
- Agenten kan ikke endre noe utenfor prosjektet. Forslag som prøver, avvises før de lagres, og panelet sier hvorfor.

## Research på nettet

Agenten bruker først **nettsøket som er bygget inn i UiB sitt API** (OpenAIs `web_search`-verktøy i Responses API). Det står på som standard under «⋯ → AI og nettsøk», og «Test nettsøk via UiB» viser om det virker for modellen din. Avviser UiB verktøyet, går agenten automatisk over til **Tavily** eller **Brave Search** hvis du har lagt inn en nøkkel, ellers svarer den uten nettsøk. Sidene og bildene leses uansett av Paintrest-serveren, uten nøkkel. Da kan agenten:

- søke på nettet og lese sider (serveren henter dem og trekker ut tekst og bilder)
- foreslå **miniatyrer med kilder** (`catalog_subject` med `sources`)
- foreslå **referansebilder** (`reference_selection`) som du krysser av for. Bildene lagres som kilder med lenke tilbake til siden, og vises i Painting Mode med «Åpne kilden ↗».

Panelet viser hvert søk og hver side mens agenten jobber, og du kan stoppe den. Under svaret kan du se hvordan agenten fant det. Serveren fjerner bilder og kilder agenten ikke faktisk har åpnet, og sier fra i panelet.

## Bilder på miniatyrene

Trykk på bildet på et miniatyrkort. Da åpnes «Bilder for …»:

- **Lagret på miniatyren:** her velger du hvilket bilde som er illustrasjonen, fjerner bilder eller åpner kilden.
- **Let med AI (bildejakt):** agenten finner først ut hvordan figuren ser ut og hva den heter på andre språk. Så søker den bredt, også på koreanske, japanske og kinesiske malerblogger, og bruker opptil 24 steg. Den kan se på bildene og sammenligne dem med miniatyrens nåværende illustrasjon. Hver kandidat får sikkerhet («Trolig riktig», «Mulig», «Usikker»), en norsk begrunnelse og originalteksten. «Kilder agenten leste» viser et norsk sammendrag av hver side. Du ser hvert steg mens agenten jobber.
- **Fra lagrede kilder:** du åpner en side som er lagret for spillet, og velger bilder direkte, uten AI. Samme kilde kan gi bilder til mange miniatyrer.
- **Last opp:** ditt eget bilde.

Kryss av for bildene du vil beholde, velg ett som «Illustrasjon» og trykk «Lagre». Bildene lastes ned og lagres med kilde. En kilde eller et bilde som er lagret fra før, gjenbrukes.

## Maleplan og palett per miniatyr

Når bildene er på plass, trykker du «Neste: maleplan →» i bildevisningen, eller «✦ Lag maleplan og palett med AI» på miniatyrkortet.

1. Velg opptil 4 av miniatyrens bilder. Agenten ser på dem.
2. «Lag maleplan med AI»: agenten analyserer fargesoner og uttrykk og leter etter maleguider. Kildene du allerede har funnet for spillet, leses først. Den foreslår arbeidsmåte, felles operasjoner og deler med steg og eksakte malinger, og en palett for miniatyren. Malinger du eier, foretrekkes.
3. Rediger fritt: arbeidsmåte, delnavn og rekkefølge, instruksjoner, malinger og roller. Du kan legge til eller fjerne steg, deler og palettrader. Malinger som ikke finnes i katalogen, kobler du til et produkt eller oppretter som ubekreftet, også alle på én gang.
4. «Godkjenn maleplanen» skriver planen (eller en ny versjon av den) og paletten. Painting Mode viser arbeidsmåte og palett øverst.

Alle sider agenten leser, lagres automatisk som kilder for spillet («Funnet av agenten»). Da slipper agenten å finne dem på nytt, og du kan hente bilder fra dem under «Fra lagrede kilder».

## Dette er med

| Bit | Innhold |
|---|---|
| 0 Grunnmur | Domenetyper fra skjema §6, kommandolag, lokal lagring i IndexedDB, eksempeldata og stil fra Figma |
| 1 Prosjekter og spill | Nytt prosjekt med en gang («Nytt spill N»), endring av navn, år, utgiver og illustrasjon, utvidelser med kobling og løsning, simulert BGG-kobling, sletting og gjenoppretting |
| 2 (delvis) Miniatyrer | Galleri med planstatus og malefremdrift hver for seg, filtre, legge til, redigere og slette |
| 5 Painting Mode | iPad liggende: referanser på 1/3 og plan på 2/3. Felles operasjoner og deler, steg, materialer med eierstatus, blandinger, «Finn fram malingene», avvik, delen ferdig, gruppeteller, «Marker ferdig» og historikk |
| 7.0–7.3 Bibliotek | Teknikker og oppskrifter (fargerekke med valgfri fremgangsmåte) i datamodellen. «Bibliotek» i toppfeltet: søk, merkelapper og redigering av teknikker og oppskrifter, som lagres når du forlater et felt. Teknikken som artikkel, verkstedguide for iPad og registrering av erfaring. Se [docs/BIT7-KUNNSKAP.md](docs/BIT7-KUNNSKAP.md) |

Neste: bit 3 (maling og palett), bit 4 (redigering av maleplanen), bit 6 (kilder), bit 7.4 og videre (research i biblioteket) og bit 8 (simulert agent).

## Arkitektur

```
src/domain/types.ts      tabellene fra skjema §6 (snake_case, samme navn)
src/domain/commands.ts   brukerkommandoene: grensesnittet skjermene skriver gjennom
src/domain/views.ts      lesefunksjoner (skjema §9)
src/data/local-*.ts      v0-implementasjon mot lokal lagring
src/data/seed.ts         eksempeldata
src/features/*           skjermene
src/ui/*                 komponenter og stil
```

Skjermene skriver aldri rett til data. De kaller `Commands`. Senere erstattes `createLocalCommands` med en klient mot applikasjonslaget og PostgreSQL. Typer, kommandogrensesnitt, lesefunksjoner og skjermer kan stå som de er.

Hver kommando kjører som én transaksjon og skriver `change_record` med `initiated_by = user`. Hvis kommandoen feiler, endres ingenting.

Avvik fra dokumentene og antakelser står i [docs/AVVIK.md](docs/AVVIK.md).

## Bygg for innebygd forhåndsvisning

Noen verter tillater bare en enkel `#navn` i adressen. Bygg da med minneruting:

```bash
VITE_ROUTER=memory npm run build
```
