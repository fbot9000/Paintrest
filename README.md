# Paintrest – prototype v0

Klikkbar første versjon av Paintrest. Den skal gi en følelse av verktøyet, og koden skal kunne bygges videre på.

**Førende dokumenter:** produktspesifikasjon v2.0, datamodell v3 og «Paintrest – databaseskjema og arkitektur». Figma-filen gir visuell retning.

## Kom i gang

```bash
npm install
npm run dev
```

`npm run dev` starter både Paintrest-serveren (port 8787, bare localhost) og Vite på fast port: http://localhost:5173. Slik åpner du appen på iPad på samme nett:

```bash
npm run dev -- --host
```

Bruk så LAN-adressen Vite viser.

```bash
npm test          # kommandolaget: versjoner, avvik, ferdigstilling, BGG-kobling, biblioteket
npm run build     # typesjekk og produksjonsbygg til dist/
```

Ved første start får appen eksempeldata: prosjektet Avalon med fire figurer og ferdige maleplaner for Merlin og Druid Champions. «⋯ → Tilbakestill eksempeldata» setter dataene tilbake. Du må skrive «tilbakestill» for å bekrefte, og serveren tar en sikkerhetskopi først.

## Lagring: datamappen ~/Paintrest

Paintrest-serveren eier dataene. De ligger i en fast mappe på maskinen, ikke i nettleseren. Derfor ser du de samme dataene uansett port, nettleser eller fane.

```
~/Paintrest/
  data.json        prosjektene, med revisjonsnummer
  files/           bildene (files/trash/ for bilder som er fjernet; ingenting slettes)
  backups/         sikkerhetskopier av data.json, de 30 siste beholdes
  master.key, ai_credential.json, search_credential.json   krypterte nøkler
```

- Mappen kan flyttes med `PAINTREST_DATA_DIR=/annen/mappe npm run dev`.
- Første gang serveren finner en tom datamappe og nettleseren har data fra før, tilbyr appen å flytte dem. Kopien i nettleseren blir liggende urørt.
- Nøkler fra den gamle mappen `.paintrest-data/` i prosjektet kopieres til datamappen ved oppstart.
- Øverst til høyre står det hvor dataene er lagret og når. Feiler en lagring, står det der, og appen prøver igjen hvert 5. sekund.
- Hver lagring sier hvilken revisjon den bygger på. Har en annen fane lagret i mellomtiden, avviser serveren lagringen, og appen ber deg laste inn på nytt. Ingenting overskrives i stillhet.
- Sikkerhetskopi tas ved oppstart, omtrent hvert 10. minutt med endringer, før tilbakestilling og når du trykker «Ta sikkerhetskopi nå» under «⋯ → Innstillinger».
- **Gjenoppretting:** stopp appen, kopier ønsket fil fra `backups/` til `data.json`, og start på nytt.
- Uten server (for eksempel den publiserte forhåndsvisningen) lagrer appen i nettleseren (IndexedDB) og sier det i toppfeltet.

## AI-nøkkel (UiB)

Appen virker fullt ut uten AI. Nøkkelen legges inn under «⋯ → Innstillinger: AI, nettsøk og data». Adressen er fylt ut med UiB sin: `https://models.api.uib.no/v1`.

- Nøkkelen sendes én gang fra nettleseren til Paintrest-serveren (`server/`). Serveren krypterer den med AES-256-GCM og lagrer den i `~/Paintrest/ai_credential.json`.
- Hovednøkkelen ligger i `~/Paintrest/master.key`, eller i miljøvariabelen `PAINTREST_MASTER_KEY` (64 heksadesimale tegn). Begge filene har tilgang bare for eieren. Datamappen ligger utenfor prosjektet og kommer aldri med i git.
- Nettleseren får aldri nøkkelen tilbake, bare de fire siste tegnene.
- Bare `server/provider.ts` bruker den dekrypterte nøkkelen, i ett kall om gangen (`GET /models` og `POST /responses`, `Authorization: Bearer …`).
- Den publiserte forhåndsvisningen på claude.ai har ingen server. Der står det at nøkkelen må legges inn i en lokal kjøring.

```bash
npm test   # også serveren: kryptering, at nøkkelen ikke lekker, feilmeldinger
```

## Researchagent

Panelet til høyre i hvert prosjekt. Det bruker nøkkelen og standardmodellen fra innstillingene.

- Agenten leser prosjektet, miniatyrene, maleplanene og malingene dine. Den lager **utkast**: nye miniatyrer (`catalog_subject`) og maleplaner (`paint_plan`).
- En godkjent plan kan agenten bare foreslå ny versjon av når du har trykket «Revider planen med agenten» på miniatyren. Det åpner planen som revisjonsmål (`plan_revision`).
- Hvert forslag godkjennes for seg i én transaksjon. Maling som ikke finnes i katalogen, må du koble til et produkt eller opprette som ubekreftet før planen kan godkjennes. Er planen endret siden forslaget ble laget, stopper godkjenningen.
- Inne i prosjektet **endrer agenten direkte** når du skriver i panelet. Den kan lage, endre, dele, slå sammen og slette miniatyrer, og lage maleplaner med malinger som finnes i katalogen. Panelet viser «Agenten endret: …» med **Angre**, som fører hele runden tilbake. Har du endret det samme etterpå, sier angre fra i stedet for å overskrive.
- Bildeutvalg og planer med malinger som ikke finnes i katalogen, venter på deg som forslag. «Godkjenn alle» godkjenner dem som ikke trenger valg.
- Agenten kan ikke endre noe utenfor prosjektet. Forslag som prøver, avvises før de lagres, og panelet sier hvorfor.

## Research til biblioteket

«Bibliotek → Research» (eller «Research ny teknikk» og «Research ny oppskrift»). Beskriv hva du vil lære, og legg eventuelt ved en lenke. Agenten bruker samme nøkkel og nettsøk som i prosjektene.

- Agenten leser biblioteket og malingskatalogen, ikke prosjektene. Den søker, åpner sider og lager et utkast.
- For oppskrifter velger du malinger: «Begge» (to utkast: med malinger du har, og beste valg), «Bare det jeg har» eller «Beste valg». Agenten velger aldri ut fra hva du eier uten at du har bedt om det.
- Utkastet viser hver kilde, om agenten faktisk leste den, og hva den bidro med. En lenke du la ved, men som ikke kunne leses, vises med grunnen.
- Er kildene uenige, vises fremgangsmåtene side om side. Du velger hvilken som er utgangspunktet.
- Hvert steg er merket «Vist i kilde» eller «Forslag fra agenten».
- «Lagre og foreslå forbedring» (etter en erfaring) og «Forbedre med agenten» (på en teknikk) gir et forslag til endring. Du ser hva som endres, med «Nå» og «Forslag», før du tar det i bruk. Har du endret teknikken i mellomtiden, må agenten lage et nytt forslag.
- Ingenting lagres i biblioteket før du trykker «Lagre i biblioteket». Da lagres det som utkast, og du kan endre alt etterpå. Malinger som ikke finnes i katalogen, kobler du til et produkt eller legger til som ubekreftet.

## Research på nettet

Agenten bruker først **nettsøket som er bygget inn i UiB sitt API** (OpenAIs `web_search`-verktøy i Responses API). Det står på som standard under «⋯ → AI og nettsøk», og «Test nettsøk via UiB» viser om det virker for modellen din. Avviser UiB verktøyet, går agenten automatisk over til **Tavily** eller **Brave Search** hvis du har lagt inn en nøkkel, ellers svarer den uten nettsøk. Sidene og bildene leses uansett av Paintrest-serveren, uten nøkkel. Da kan agenten:

- søke på nettet og lese sider (serveren henter dem og trekker ut tekst og bilder)
- foreslå **miniatyrer med kilder** (`catalog_subject` med `sources`)
- foreslå **referansebilder** (`reference_selection`) som du krysser av for. Bildene lagres som kilder med lenke tilbake til siden, og vises i Painting Mode med «Åpne kilden ↗».

Panelet viser hvert søk og hver side mens agenten jobber, og du kan stoppe den. Under svaret kan du se hvordan agenten fant det. Serveren fjerner bilder og kilder agenten ikke faktisk har åpnet, og sier fra i panelet.

## Bildejakt i to faser

«Let etter bilder med AI» i verkstedet går i to faser. Paintrest styrer overgangen, og fasen vises mens agenten jobber.

1. **Offisielt anker (høyst 10 steg).** Agenten leter hos utgiveren (nettside og nettbutikk), på Kickstarter- eller Gamefound-kampanjen (også oppdateringer og tillegg) og på BoardGameGeek. Den velger det beste offisielle bildet av figuren: helst offisielt malt, ellers render, ellers konseptkunst. Den noterer også maleren kampanjen oppgir. Serveren sjekker at bildet finnes på en side agenten har åpnet. Finner agenten ikke noe, går jakten videre uten anker og sier det.
2. **Bredt søk (resten av de 30 stegene).** Agenten leter etter malte versjoner: maleren fra kampanjen, blogger og forum på flere språk, Reddit og BGG. Når den bruker «look», viser Paintrest ankeret først som referanse, slik at kandidatene sammenlignes med det (form og positur, ikke farger). Har miniatyren allerede en illustrasjon, brukes den som referanse i stedet.
3. **Malevideoer.** Agenten foreslår YouTube-videoer, men kan ikke se dem. Paintrest henter tittel, kanal og miniatyrbilde fra YouTube (oEmbed). Videoer som verken YouTube eller søket bekrefter, fjernes. «Lagre som kilde» lagrer en lenke på miniatyren, uten å laste ned noe.

Bilder-fanen viser ankeret øverst, deretter forslagene delt i «Offisielle bilder og konseptkunst» og «Malt av andre», og så videoene.

**Lim inn fra Google Bilder.** Feltet øverst i Bilder-fanen tar imot det du kopierer fra Google Bilder eller andre steder. Du kan også lime inn hvor som helst i fanen.
- **Kopiert bilde** («Kopier bilde» i nettleseren): lagres med en gang. Det virker også for bilder fra Instagram og Facebook, der Paintrest ikke kan hente bildet selv.
- **Lenke fra Google Bilder** (lenken til et treff, `google.com/imgres?…`): Paintrest leser ut bildet og siden det står på. Bildet legges under «Limt inn», allerede valgt. Trykk «Lagre».
- **Bildelenke** («Kopier bildeadresse»): som over, uten side.
- **Lenke til en side:** åpner sidens bilder, slik som en kilde.
- **Agenten bygger på det du har funnet.** Bildene du har lagret eller limt inn, sendes med når du trykker «Let etter flere». Agenten ser på dem for å vite hvordan figuren ser ut, bruker sidene og titlene som spor for å finne flere, og foreslår dem ikke på nytt.

**Bildesøk.** Med en nøkkel for Brave Search (eller Tavily) under «⋯ → Innstillinger» får agenten et bildesøk, slik du bruker Google Bilder. Det virker også når UiB-søket brukes til vanlig nettsøk.
- Agenten søker bredt og kort («dune imperium painted minis»), ser på bildene i bunker og foreslår dem som viser figuren, uten å åpne sidene. Mange av de beste kildene (Reddit, BoardGameGeek, Etsy, Instagram) stenger Paintrest ute, men bildene deres finnes i bildesøket.
- Brave gir et lite bilde fra sin egen server ved siden av originalen. Stenger originalsiden, vises og lagres det lille bildet.
- Søk med anførselstegn som gir null treff, prøves på nytt uten.
- Brave anbefales: det har et eget bildesøk. Tavily gir bare bildene fra sidene det fant med et vanlig søk.

Når agenten leser en side, tas bare bildene i selve innholdet med (artikkel eller hovedinnhold). På videosider som bilibili tas bare videoens eget bilde med, ikke anbefalte videoer.

Sider som bygges med skript (typisk kampanjesider), har ofte bildene i sidedata i stedet for i HTML. Har en side færre enn fire synlige bilder, leser Paintrest også bildeadresser fra kildekoden.

## Miniatyrverkstedet

Trykk på bildet eller navnet på et miniatyrkort. Da åpnes verkstedet for miniatyren, som bruker hele skjermen:

- **Venstre: bildene av miniatyren.** Bildet du har valgt vises stort, og du kan zoome. Her gjør du et bilde til illustrasjon, fjerner bilder, åpner kilden og krysser av for hvilke bilder (høyst 4) maleplanen skal bygge på.
- **Midten: faner.**
  - **Bilder:**
    - «Let etter bilder med AI» starter en bildejakt på flere språk.
    - Bilder fra sidene agenten leser, dukker opp underveis, og du kan velge med en gang.
    - Agentens forslag kommer med sikkerhet, norsk begrunnelse og originaltekst.
    - Du kan også velge en kilde i høyre kolonne og hente bilder fra den uten AI, eller laste opp et bilde.
    - Kryss av, velg én illustrasjon og trykk «Lagre».
  - **Maleplan:**
    - «Lag maleplan med AI» bruker bildene du har krysset av. Agenten foreslår arbeidsmåte, deler og steg med eksakte malinger, og en palett.
    - Planen leses som tekst: sammendrag, en rad med fargene i paletten, en oversikt over delene (trykk for å hoppe) og stegene med malingene som små merker. Eierskap vises bare når noe mangler.
    - Et forslag har en statuslinje øverst med «Godkjenn», «Rediger alt» og «Forkast». For en ny versjon står det hva som er endret, nye og endrede steg er markert, og du kan bytte til den gjeldende versjonen.
    - Du redigerer ett steg om gangen med «Rediger» (vises når du holder over steget), eller alt med «Rediger alt». Navn, flytting og sletting av deler ligger i «⋯»-menyen.
    - Paletten fra forslaget legges i Palett-fanen når du godkjenner, og redigeres der.
    - Uten forslag vises den gjeldende planen.
  - **Palett:** malingene miniatyren males med, gruppert per del. Du kan legge til malinger, endre rolle og del, og fjerne rader.
- **Bildekolonnen kan skjules** med ‹ øverst. Da står bare små bilder igjen, og valget huskes. «I planen» vises bare i Maleplan-fanen.
- **Høyre: agenten og kildene.** I Maleplan-fanen vises kildene kort, og de planen bygger på står først. Her ser du hva agenten gjør akkurat nå, med «Stopp», og resultatet når den er ferdig. Under ligger alle kildene for spillet, både lagrede og funnet av agenten, med språk og norsk sammendrag. Trykk på en kilde for å hente bilder fra den.
- **Forrige og neste** øverst flytter deg mellom miniatyrene i prosjektet og beholder fanen du står på.
- **Agenten fortsetter mens du gjør noe annet.** Du kan bytte fane eller gå tilbake til galleriet. Miniatyrkortet viser «Agenten jobber …». Kjøringen lever i nettleserfanen, så laster du siden på nytt, stopper den.
- **På iPad** ligger agent og kilder bak knappen «Agent og kilder».

Alle sider agenten leser, lagres automatisk som kilder for spillet («Funnet av agenten»). Da slipper agenten å finne dem på nytt.

## Dette er med

| Bit | Innhold |
|---|---|
| 0 Grunnmur | Domenetyper fra skjema §6, kommandolag, lokal lagring i IndexedDB, eksempeldata og stil fra Figma |
| 1 Prosjekter og spill | Nytt prosjekt med en gang («Nytt spill N»), endring av navn, år, utgiver og illustrasjon, utvidelser med kobling og løsning, simulert BGG-kobling, sletting og gjenoppretting |
| 2 (delvis) Miniatyrer | Galleri med planstatus og malefremdrift hver for seg, filtre, legge til, redigere og slette |
| 5 Painting Mode | iPad liggende: referanser på 1/3 og plan på 2/3. Felles operasjoner og deler, steg, materialer med eierstatus, blandinger, «Finn fram malingene», avvik, delen ferdig, gruppeteller, «Marker ferdig» og historikk |
| 7.0–7.6 Bibliotek | Teknikker og oppskrifter (fargerekke med valgfri fremgangsmåte) i datamodellen. «Bibliotek» i toppfeltet: søk, merkelapper og redigering av teknikker og oppskrifter, som lagres når du forlater et felt. Teknikken som artikkel, verkstedguide for iPad og registrering av erfaring. Research med agenten gir utkast til teknikker og oppskrifter, som du godkjenner inn i biblioteket. Se [docs/BIT7-KUNNSKAP.md](docs/BIT7-KUNNSKAP.md) |

Neste: bit 3 (maling og palett), bit 4 (redigering av maleplanen), bit 6 (kilder), bit 7.7 (bruk i prosjekt, etter bit 4) og bit 8 (simulert agent).

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
