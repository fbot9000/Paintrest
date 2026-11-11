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

Ved første start får appen eksempeldata: prosjektet Avalon med fire figurer og maleplaner for Merlin og Druid Champions. Eksempeldataene har ingen malinger: malingssamlingen er din egen (se «Malingssamlingen» under). «⋯ → Tilbakestill eksempeldata» setter dataene tilbake, men beholder malingssamlingen. Du må skrive «tilbakestill» for å bekrefte, og serveren tar en sikkerhetskopi først.

## Malingssamlingen

«Malinger» i toppfeltet viser alle malingene i katalogen og om du har dem («Har», «Har ikke», «Ukjent»). Agenten bruker listen når den lager maleplaner og oppskrifter.

- **Eksempelmalingene fra testdataene** (14 Citadel-malinger og «Grønn glasur fra hylla») vises med et eget varsel og knappen «Fjern eksempelmalingene». De skjules, og eierstatusen fjernes. Planer og oppskrifter som bruker dem, beholder dem. Legger du inn den samme malingen selv senere, tas den skjulte raden i bruk igjen, og planene peker da på din.
- **En og en:** «Legg til maling». Produsent, serie, navn, kode, type, finish, farge og om du har den. Produsent, serie og type blir stående til neste maling. «Fyll ut med AI» fyller inn tomme felt (også en omtrentlig farge), og feltene AI-en fylte inn er merket til du endrer dem. Finnes malingen fra før, sier skjemaet det, og du får ingen dobbel.
- **Rediger og skjul:** trykk på en maling. Eierstatus endres rett i listen. Skjulte malinger kan gjenopprettes.
- **Import av en liste:** «Importer en liste». Lim inn tekst eller last opp en fil (tekst, CSV/TSV, Excel .xlsx, JSON eller HTML). Fra PDF eller e-post: kopier teksten og lim den inn.
  1. AI-en leser listen i deler på opptil 40 linjer, to om gangen, og foreslår hver maling med produsent, serie, navn, kode, type, finish og omtrentlig farge. Du kan stoppe og fortsette.
  2. Felt AI-en har fylt inn selv, og som ikke står i teksten din, er merket. Serveren merker dem også når modellen glemmer det. Hver rad viser linjen den kom fra.
  3. Linjer som verken ble en maling eller ble hoppet over med en grunn, vises som «ikke brukt», og du kan be AI-en lese dem på nytt. Ingenting forsvinner uten at du ser det.
  4. AI-en stiller spørsmål når noe er uklart. Svar med knappene eller med eget svar, eller gi en beskjed («alle Vallejo er Game Color»). AI-en endrer listen, og radene den endret, er markert.
  5. Rett, kryss av og fjern rader selv. Listen viser hva lagringen vil gjøre med hver rad: ny, finnes fra før (tomme felt fylles inn), tas i bruk igjen (skjult) eller dobbel.
  6. «Legg inn i samlingen» lagrer alt i én transaksjon. Rader uten produsent eller med tvil lagres som ubekreftet.
- **Uten AI:** «Les uten AI» tar ett navn per linje, eller et regneark med kolonnenavn (Produsent, Serie, Navn, Kode, Type, Har). Du kan be AI-en om hjelp med resten etterpå.
- Utkastet av importen ligger i nettleseren (localStorage) til du lagrer eller forkaster det. Det tåler at du laster siden på nytt, men følger ikke med til en annen maskin.

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

- Panelet er kompakt. Modell og nettsøk står på én linje, og arbeidskonteksten er brettet sammen. Paintrest sine egne meldinger (lagrede kilder, avviste forslag) viser første linje, og resten får du med ett trykk. Usikkerhet på et forslag ligger bak «Usikkerhet (N)».
- Bildeforslag vises som én rad per miniatyr, med små bilder. Trykk på raden for å velge bilder i verkstedets gjennomgang, eller × for å avvise.

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

## Bildejakt i tre faser

«Let etter bilder med AI» i verkstedet går i tre faser. Paintrest styrer overgangen, og fasen vises mens agenten jobber. Det agenten finner i fase 1, bruker den i fase 2 og 3.

1. **Identifiser figuren (høyst 10 steg).** Navnet i Paintrest er ditt eget og kan være kort, uoffisielt eller på norsk. Agenten finner derfor først:
   - hvilken utgave, utvidelse eller hvilket Kickstarter-tillegg figuren hører til
   - figurens offisielle navn og andre navn: på kortet, i kampanjen, på skulpturen og i oversettelser
   - en beskrivelse av rolle og utseende: positur, våpen, klær og base
   - opptil tre offisielle bilder: helst konseptkunst, gjerne også et bilde av selve miniaturen
   
   Agenten leter i denne rekkefølgen: sider du har merket, utgiveren, Kickstarter eller Gamefound, BoardGameGeek og wikier. Den noterer også maleren kampanjen oppgir. Serveren sjekker at bildene finnes på en side agenten har åpnet eller i et bildesøk, og at kildene er søkt fram eller åpnet.
2. **Malt av andre.** Agenten søker med det offisielle navnet og de andre navnene, ikke bare med ditt. Den leter på flere språk, i blogger, forum, Reddit og BGG, og hos maleren fra kampanjen. Når den bruker «look», viser Paintrest et offisielt bilde av selve miniaturen først som referanse, ellers konseptkunsten. Kandidatene sammenlignes med form og positur, ikke farger. Har miniatyren en illustrasjon, brukes den som referanse i stedet. Agenten går videre med `next_phase`, eller automatisk når det er 8 steg igjen.
3. **Maleguider (de siste 8 stegene).** Agenten finner skrevne guider og malerapporter, og YouTube-videoer, for figuren, fraksjonen eller spillet. Den åpner de beste og noterer malingene de bruker. Guider må være åpnet eller funnet i et søk. Videoer må bekreftes av YouTube (oEmbed) eller søket. Agenten kan ikke se videoene.

Svarer agenten med et ferdig forslag allerede i fase 2, tar Paintrest vare på det og sender agenten videre til maleguidene. De to svarene slås sammen.

**Figuren lagres og brukes videre.** Identifiseringen lagres på miniatyren som et forslag, og panelet sier fra. I Bilder-fanen står den øverst under «Figuren», med navn, andre navn, beskrivelse, offisielle bilder og kilder.
- **«Riktig figur»** bekrefter den. Neste bildejakt hopper da over fase 1 og bruker figuren direkte. Maleplanen og agentpanelet får også navnet og beskrivelsen.
- **«Feil figur»** fjerner den. Agenten får beskjed om å ikke velge den igjen, verken navnet eller bildene.
- Er figuren ikke bekreftet, får neste jakt den med som et forslag å kontrollere.

**«Viser figuren»: hjelp agenten.** Viser en kilde riktig miniatyr, trykker du «Viser figuren?» på den. Det går i kildelisten til høyre, på sidene agenten leser, og på en side du åpner. Kilden lagres, og agenten åpner merkede sider først. Merker du en side mens agenten jobber, får agenten beskjed før neste steg, og panelet viser «Agenten fikk beskjed …». Fjerner du merket, får agenten også vite det.

Bilder-fanen viser figuren øverst. Deretter kommer forslagene, delt i «Offisielle og konsept» og «Malt av andre», så videoene og maleguidene. «Lagre» på en video eller guide lagrer en lenke på miniatyren, uten å laste ned noe. Lagrede guider leser agenten først når den lager maleplan.

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

## Kartlegg spillet

«✦ Kartlegg spillet med AI» på miniatyrlisten gjør jobben én gang for hele spillet, i stedet for at hver bildejakt finner de samme kildene på nytt. Kartleggingen har sin egen oppgave og forstyrrer ikke panelet eller verkstedet. Fremdriften vises øverst på listen, med «Stopp».

1. **Kilder for spillet (høyst 18 steg).** Agenten finner:
   - de offisielle sidene: utgiveren, kampanjen med oppdateringer og tillegg, BoardGameGeek med regelbok og komponentliste, og wikier
   - gallerier og tråder med mange malte figurer, på flere språk
   - maleguider for spillet
   
   Den kan identifisere miniatyrer allerede her.
2. **Hvem er hvem (resten av de 50 stegene).** Agenten identifiserer hver miniatyr (`identify` med `subject`). Den finner også ut hvilke bilder som viser hvilken miniatyr. Når den bruker «look» med `compare_with`, viser Paintrest de offisielle bildene av opptil fire miniatyrer først, merket R1, R2 …, og agenten svarer hvilken kandidat som er hvilken.

**Dette lagres for spillet:**
- **Hvem hver miniatyr er:** som forslag på miniatyren, akkurat som etter en bildejakt. Kortet på listen viser navnet med «?» til du har bekreftet det.
- **Bildeforslag til hver miniatyr:** i Bilder-fanen. Kortet viser «N bildeforslag».
- **Kildene for spillet:** med rolle (Offisiell, Malt, Guide) og hvilke miniatyrer hver side viser. Kildelisten i verkstedet viser dette som «Trolig figuren». Ett trykk gjør det til ditt eget merke, og × sier at siden ikke viser figuren. Ingen av delene foreslås på nytt.

**Miniatyrer som mangler.** Kartleggingen sammenligner listen med komponentlisten, regelboka og kampanjen.
- Figurer fra grunnspillet og utvidelsene i prosjektet som mangler, legges under «Mangler i listen» øverst på miniatyrlisten. Hver figur vises med navn, enkeltfigur eller malegruppe med antall, utvidelse, kilder og det kartleggingen er usikker på.
- Ingenting legges til før du trykker «Legg til» (eller «Legg til alle»). «Avvis» fjerner forslaget.
- En figur du legger til, får med seg identifiseringen (som forslag du bekrefter) og sidene som trolig viser den («Trolig figuren»).
- Figurer fra utvidelser som ikke er i prosjektet, nevnes bare i meldingen.
- Et forslag med samme navn eller offisielle navn som en miniatyr i prosjektet, eller som et forslag som allerede venter, avvises, og panelet sier hvorfor. Det gjelder også forslag fra agentpanelet.

**Gjennomgang.** Mens kartleggingen pågår, viser kortene «Identifisert» etter hvert som agenten finner ut hvem miniatyrene er. Etterpå viser kort uten eget bilde det beste forslaget, merket «Forslag». «Gå gjennom forslag» (øverst på listen og i kartleggingens oppsummering) åpner verkstedet i gjennomgang:
- Én miniatyr om gangen, i listens rekkefølge. En linje øverst viser hvor langt du er kommet og hva som venter: bildeforslag, en figur å bekrefte, og sider merket «Trolig figuren».
- Bildene agenten er sikker på (offisielle bilder og forslag med høy sikkerhet), er forhåndsvalgt. Mangler miniatyren illustrasjon, foreslås det første av dem som illustrasjon. Fjern det som ikke stemmer.
- «Lagre og neste» lagrer og går videre. «Hopp over» går videre uten å lagre. «Avslutt» går ut av gjennomgangen.
- Miniatyrer med bildeforslag eller en figur som skal bekreftes, er med. Sider merket «Trolig figuren» vises, men holder ikke en miniatyr i gjennomgangen alene.

**Senere kjøringer bygger på kartleggingen:**
- Bildejakten for en miniatyr åpner sidene merket «Trolig figuren» tidlig.
- Maleplanen får maleguidene for spillet.
- Alle agenter ser i `known_sources` hvilken rolle hver side har, og hvilke miniatyrer den viser.
- Kjører du kartleggingen på nytt, åpner agenten sidene den kjenner, i stedet for å søke dem fram igjen.

## Fordel bildene

«Fordel bilder» i prosjektmenyen (og knappen på miniatyrlisten etter en kartlegging) samler alle bildene agenten har funnet for spillet på ett sted. Det gjelder funn fra kartleggingen, bildejakter og agentpanelet.
- **Til venstre «Funn»:** hvert bilde én gang, med agentens gjetning og hvor sikker den er. Bildene agenten tror på, står først. «Usikre» og «Brukt» er brettet sammen. ⤢ viser bildet stort med begrunnelsen og kilden.
- **Til høyre «Miniatyrene»:** antall bilder per miniatyr, og ✓ og ✗ for en identifisering som venter. Miniatyrene agenten tror bildet hører til, er stiplet.
- **Slik legger du på bilder:**
  - Dra et bilde (eller flere valgte) til en miniatyr.
  - Trykk «→ navn» for å legge bildet der agenten tror det hører hjemme.
  - Trykk på bilder, og velg miniatyr i linjen nederst. Det virker også på iPad.
- **Illustrasjon:** Mangler miniatyren illustrasjon, blir første bilde illustrasjon.
- **Forkast og angre:** × forkaster et bilde. Alt kan angres fra meldingen nederst til venstre.
- **Gruppebilder:** Et bilde som er lagt på én miniatyr, flyttes til «Brukt». Derfra kan det dras til flere, og «→ navn» tilbyr de andre miniaturene agenten gjettet.
- **Forslagene følger med:** Bildeforslagene lukkes ikke når du legger på ett bilde. Et forslag lukkes av seg selv når alle bildene i det er brukt eller forkastet, og det har verken videoer eller maleguider. Det samme gjelder når du lagrer i Bilder-fanen i verkstedet.

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
- **Høyre: agenten og kildene.** I Maleplan-fanen vises kildene kort, og de planen bygger på står først. Her ser du hva agenten gjør akkurat nå, med «Stopp», og resultatet når den er ferdig. Under ligger alle kildene for spillet, både lagrede og funnet av agenten, med språk og norsk sammendrag. Trykk på en kilde for å hente bilder fra den. I Bilder-fanen merker du med «Viser figuren?» kilder som viser miniatyren. De står da først, og agenten åpner dem først.
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
| Malingssamlingen | «Malinger» i toppfeltet: samlingen med søk og filtre, legg til en og en (med «Fyll ut med AI»), rediger og skjul, fjern eksempelmalingene, og AI-assistert import av en liste eller fil med spørsmål og svar. Se «Malingssamlingen» over |
| 7.0–7.6 Bibliotek | Teknikker og oppskrifter (fargerekke med valgfri fremgangsmåte) i datamodellen. «Bibliotek» i toppfeltet: søk, merkelapper og redigering av teknikker og oppskrifter, som lagres når du forlater et felt. Teknikken som artikkel, verkstedguide for iPad og registrering av erfaring. Research med agenten gir utkast til teknikker og oppskrifter, som du godkjenner inn i biblioteket. Se [docs/BIT7-KUNNSKAP.md](docs/BIT7-KUNNSKAP.md) |

Neste: produktbilder og malekjeder (base, layer, highlight, shade, effekter) for malingene, bit 3 (palett), bit 4 (redigering av maleplanen), bit 6 (kilder), bit 7.7 (bruk i prosjekt, etter bit 4) og bit 8 (simulert agent).

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
