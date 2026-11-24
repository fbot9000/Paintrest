# Brukerveiledning

Slik virker Paintrest i dag. Hva som er bygget og ikke, står i [STATUS.md](STATUS.md). Hvordan du starter appen, står i [README](../README.md).

## Spill og illustrasjon: finn bilde og fakta med AI

«✦ Finn bilde og fakta med AI» på siden «Spill og illustrasjon» slår opp spillet på nettet. Agenten finner:
- det offisielle navnet og hvilken utgave det gjelder
- utgivelsesåret og utgiveren
- den offisielle nettsiden (utgiverens side for spillet, ikke BoardGameGeek eller en butikk)
- bildeforslag til illustrasjonen: forsiden av esken eller hovedillustrasjonen

Fremdriften vises under illustrasjonen, med «Stopp». Kjøringen fortsetter om du går til en annen side.

**Ingenting endres før du trykker «Bruk valgte».** Forslagene vises slik:
- **Bildene** med type («Eske», «Illustrasjon» eller «Annet bilde»), hvor sikker agenten er, og en lenke til siden bildet står på. Velg ett, eller «Behold illustrasjonen».
- **Opplysningene** med det som står der nå, og hvor godt de er sjekket:
  - «Står i kilden»: Paintrest fant verdien i teksten på siden agenten åpnet, eller i søketreffet.
  - «Fra kilde, ikke kontrollert»: agenten leste eller fant siden, men verdien sto ikke i teksten Paintrest har.
  - «Ikke sjekket mot kilde»: ingen side bak, bare modellens egen kunnskap.
  - Nettsiden er «Åpnet av agenten» eller «Funnet i søk, ikke åpnet».
- Tomme felt er krysset av. Et felt som har en verdi, erstattes bare når du krysser av for det. Har spillet ingen illustrasjon, er det første bildet av esken valgt.
- «Paintrest sin kontroll» viser det serveren fjernet: bilder som ikke fantes på en åpnet side eller i et bildesøk, kilder agenten ikke hadde sett, og en nettside den verken åpnet eller fant.

Bildet hentes gjennom serveren (det lille bildet fra bildesøket hvis originalsiden stenger) og lagres som illustrasjon. Siden det kom fra, står under opplysningene («Illustrasjonen er fra …»). Laster du opp et eget bilde eller fjerner illustrasjonen, fjernes også kilden.

**Nettsiden** står også under utgiver, og kan skrives inn for hånd («cmon.com/zombicide» får https://). Skriv «—» for å fjerne den. Agentene får nettsiden i prosjektets kontekst. Sider kartleggingen har merket som offisielle, åpner oppslaget først.

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
    - Uten forslag vises den gjeldende planen, med versjonsnummer og antall åpne avvik.
    - **«Rediger planen»** gjør den godkjente planen om til et utkast du redigerer på samme måte som et forslag. «Lagre som versjon N» lagrer en ny versjon. Den forrige versjonen blir liggende uendret. «Avbryt» lagrer ingenting. Har planen fått en ny versjon mens du redigerte, kan du ikke lagre.
    - **«Skriv planen selv»** står ved siden av «Lag maleplan med AI» når miniatyren ikke har noen plan. Malingene velger du fra katalogen.
    - **Åpne avvik:** Har du endret noe i Painting Mode (byttet maling, endret instruks, ekstra steg, merknad), ser du avvikene øverst før en ny versjon lagres, både når du redigerer selv og når du godkjenner et forslag fra agenten. Kryss av for dem som skal bli en del av planen. Et byttet produkt byttes i steget, en endret instruks erstatter teksten, et ekstra steg legges til etter steget, og en merknad skrives på slutten av steget. Du ser det i utkastet og kan rette det. Fjerner du haken før du har endret noe annet, blir utkastet som før. Finner Paintrest ikke steget, står det, og du skriver det inn selv.
    - Avvikene du ikke krysser av for, følger med til den nye versjonen. Avkrysninger («Delen er ferdig») og gruppetall følger med for delene som finnes i begge versjonene. En del du har gitt nytt navn i «Rediger planen», er fortsatt samme del.
    - Hører et avvik til en del som ikke finnes i den nye versjonen, står det i Painting Mode under «Avvik for hele planen».
    - Ferdigstillinger («Marker ferdig») og avvikene som ble lagret med dem, endres aldri.
  - **Palett:** malingene miniatyren males med, gruppert per del. Du kan legge til malinger, endre rolle og del, og fjerne rader.
- **Bildekolonnen kan skjules** med ‹ øverst. Da står bare små bilder igjen, og valget huskes. «I planen» vises bare i Maleplan-fanen.
- **Høyre: agenten og kildene.** I Maleplan-fanen vises kildene kort, og de planen bygger på står først. Her ser du hva agenten gjør akkurat nå, med «Stopp», og resultatet når den er ferdig. Under ligger alle kildene for spillet, både lagrede og funnet av agenten, med språk og norsk sammendrag. Trykk på en kilde for å hente bilder fra den. I Bilder-fanen merker du med «Viser figuren?» kilder som viser miniatyren. De står da først, og agenten åpner dem først.
- **Forrige og neste** øverst flytter deg mellom miniatyrene i prosjektet og beholder fanen du står på.
- **Agenten fortsetter mens du gjør noe annet.** Du kan bytte fane eller gå tilbake til galleriet. Miniatyrkortet viser «Agenten jobber …». Kjøringen lever i nettleserfanen, så laster du siden på nytt, stopper den.
- **På iPad** ligger agent og kilder bak knappen «Agent og kilder».

Alle sider agenten leser, lagres automatisk som kilder for spillet («Funnet av agenten»). Da slipper agenten å finne dem på nytt.

## Researchagent

Panelet til høyre i hvert prosjekt. Det bruker nøkkelen og standardmodellen fra innstillingene.

- Panelet er kompakt. Modell og nettsøk står på én linje, og arbeidskonteksten er brettet sammen. Paintrest sine egne meldinger (lagrede kilder, avviste forslag) viser første linje, og resten får du med ett trykk. Usikkerhet på et forslag ligger bak «Usikkerhet (N)».
- Bildeforslag vises som én rad per miniatyr, med små bilder. Trykk på raden for å velge bilder i verkstedets gjennomgang, eller × for å avvise.

- Agenten leser prosjektet, miniatyrene, maleplanene og malingene dine. Den kan lage nye miniatyrer (`catalog_subject`), endre miniatyrer (`catalog_change`), lage maleplaner (`paint_plan`) og foreslå bilder (`reference_selection`).
- Agenten kan også foreslå en ny versjon av en godkjent plan (`plan_revision`), uten at du åpner planen for revisjon først (brukerbeslutning 10. november 2026, avvik 27 i [AVVIK.md](AVVIK.md)).
- Hvert forslag godkjennes for seg i én transaksjon. Maling som ikke finnes i katalogen, må du koble til et produkt eller opprette som ubekreftet før planen kan godkjennes. Er planen endret siden forslaget ble laget, stopper godkjenningen.
- Inne i prosjektet **endrer agenten direkte** når du skriver i panelet. Den kan lage, endre, dele, slå sammen og slette miniatyrer, og lage maleplaner med malinger som finnes i katalogen. En ny versjon av en plan med åpne avvik venter likevel på deg, slik at du velger hvilke avvik som skal bakes inn. Panelet viser «Agenten endret: …» med **Angre**, som fører hele runden tilbake. Har du endret det samme etterpå, sier angre fra i stedet for å overskrive.
- Bildeutvalg og planer med malinger som ikke finnes i katalogen, venter på deg som forslag. «Godkjenn alle» godkjenner dem som ikke trenger valg.
- Agenten kan ikke endre noe utenfor prosjektet. Forslag som prøver, avvises før de lagres, og panelet sier hvorfor.

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

## Research på nettet

Agenten bruker først **nettsøket som er bygget inn i UiB sitt API** (OpenAIs `web_search`-verktøy i Responses API). Det står på som standard under «⋯ → AI og nettsøk», og «Test nettsøk via UiB» viser om det virker for modellen din. Avviser UiB verktøyet, går agenten automatisk over til **Tavily** eller **Brave Search** hvis du har lagt inn en nøkkel, ellers svarer den uten nettsøk. Sidene og bildene leses uansett av Paintrest-serveren, uten nøkkel. Da kan agenten:

- søke på nettet og lese sider (serveren henter dem og trekker ut tekst og bilder)
- foreslå **miniatyrer med kilder** (`catalog_subject` med `sources`)
- foreslå **referansebilder** (`reference_selection`) som du krysser av for. Bildene lagres som kilder med lenke tilbake til siden, og vises i Painting Mode med «Åpne kilden ↗».

Panelet viser hvert søk og hver side mens agenten jobber, og du kan stoppe den. Under svaret kan du se hvordan agenten fant det. Serveren fjerner bilder og kilder agenten ikke faktisk har åpnet, og sier fra i panelet.

## Malingssamlingen

«Malinger» i toppfeltet viser alle malingene i katalogen og om du har dem («Har», «Har ikke», «Ukjent»). Agenten bruker listen når den lager maleplaner og oppskrifter.

- **Filtre:** eierskap, produsent og type. Typene er grunning, base, layer, shade / wash, contrast / speedpaint, teknisk / effekt, metallisk, ink, dry, air, medium / lakk og annet. Filteret for produsent og type vises når samlingen har mer enn én. Søket finner også typen («airbrush», «dry»).

- **Eksempelmalingene fra testdataene** (14 Citadel-malinger og «Grønn glasur fra hylla») vises med et eget varsel og knappen «Fjern eksempelmalingene». De skjules, og eierstatusen fjernes. Planer og oppskrifter som bruker dem, beholder dem. Legger du inn den samme malingen selv senere, tas den skjulte raden i bruk igjen, og planene peker da på din.
- **En og en:** «Legg til maling». Produsent, serie, navn, kode, type, finish, farge og om du har den. Produsent, serie og type blir stående til neste maling. «Fyll ut med AI» fyller inn tomme felt (også en omtrentlig farge), og feltene AI-en fylte inn er merket til du endrer dem. Finnes malingen fra før, sier skjemaet det, og du får ingen dobbel.
- **Produktbilde:** trykk på en maling. «Finn med AI» lar agenten lete etter bilder av flasken hos produsenten eller en butikk. Du ser bildene, hvor de kommer fra og hvor sikker agenten er, og velger ett med «Bruk bildet». Ingenting lagres før du velger. Du kan også laste opp et bilde selv, eller fjerne det. Bildet vises i samlingen, på handlelisten og ved malingsnavnet der malingen brukes (Painting Mode, oppskrifter og agentens forslag). Kilden lagres med lenke.
- **Oppskrifter og malekjeder:** trykk på en maling. Du ser hvilke oppskrifter i biblioteket den er med i, og hvilken rolle den har der. «Lag malekjede med AI» ber agenten om en fargerekke med shade, base, layer og høylys rundt malingen. Velg først «Bare det jeg har» eller «Beste valg». Du kommer til researchen i biblioteket, der utkastet vises. Det blir en oppskrift først når du trykker «Lagre i biblioteket».
- **Rediger, skjul og slett:** trykk på en maling. Eierstatus endres rett i listen. Skjulte malinger kan gjenopprettes eller slettes for godt. Før en sletting viser appen hvilke planer, oppskrifter og paletter som mister malingen (stegene blir stående), og serveren tar en sikkerhetskopi av datamappen først.
- **Import av en liste:** «Importer en liste». Lim inn tekst eller last opp en fil (tekst, CSV/TSV, Excel .xlsx, JSON eller HTML). Fra PDF eller e-post: kopier teksten og lim den inn.
  1. AI-en leser listen i deler på opptil 40 linjer, to om gangen, og foreslår hver maling med produsent, serie, navn, kode, type, finish og omtrentlig farge. Du kan stoppe og fortsette.
  2. Felt AI-en har fylt inn selv, og som ikke står i teksten din, er merket. Serveren merker dem også når modellen glemmer det. Hver rad viser linjen den kom fra.
  3. Linjer som verken ble en maling eller ble hoppet over med en grunn, vises som «ikke brukt», og du kan be AI-en lese dem på nytt. Ingenting forsvinner uten at du ser det.
  4. AI-en stiller spørsmål når noe er uklart. Svar med knappene eller med eget svar, eller gi en beskjed («alle Vallejo er Game Color»). AI-en endrer listen, og radene den endret, er markert.
  5. Rett, kryss av og fjern rader selv. Listen viser hva lagringen vil gjøre med hver rad: ny, finnes fra før (tomme felt fylles inn), tas i bruk igjen (skjult) eller dobbel.
  6. «Legg inn i samlingen» lagrer alt i én transaksjon. Rader uten produsent eller med tvil lagres som ubekreftet.
- **Uten AI:** «Les uten AI» tar ett navn per linje, eller et regneark med kolonnenavn (Produsent, Serie, Navn, Kode, Type, Har). Du kan be AI-en om hjelp med resten etterpå.
- Utkastet av importen ligger i nettleseren (localStorage) til du lagrer eller forkaster det. Det tåler at du laster siden på nytt, men følger ikke med til en annen maskin.

## Handlelisten

«Handleliste» øverst i malingssamlingen. Listen har én rad per maling, sortert etter prioritet: nødvendig, anbefalt og ønskeliste.

- **Fra planene:** Malinger du ikke har, eller ikke vet om du har, og som den godkjente maleplanen til en miniatyr bruker, står på listen som «nødvendig». Raden sier hvilke miniatyrer som trenger den. Ferdigmalte miniatyrer teller ikke. Når du har malingen, eller ingen plan bruker den lenger, forsvinner den fra listen.
- **Legg til selv:** «Legg til maling». Velg en maling fra samlingen, prioritet og eventuelt et prosjekt. Finnes den ikke i samlingen, legg den inn der først, gjerne som «Har ikke».
- **Prioritet:** endres på raden, også for malinger fra planene.
- **Filter per prosjekt:** vises når listen har malinger fra et prosjekt.
- **«Kjøpt»** setter malingen som din, og tar den av listen. **«Fjern»** finnes bare for malinger du har lagt til selv og som ingen plan trenger.

## Research til biblioteket

«Bibliotek → Research» (eller «Research ny teknikk» og «Research ny oppskrift»). Beskriv hva du vil lære, og legg eventuelt ved en lenke. Agenten bruker samme nøkkel og nettsøk som i prosjektene.

- Agenten leser biblioteket og malingskatalogen, ikke prosjektene. Den søker, åpner sider og lager et utkast.
- «Fra bilde»: legg ved 1–4 bilder (for eksempel en malt figur du liker), og få forslag til oppskrifter og teknikker. Velg «Bare det jeg har» for å bruke malinger du har.
- For oppskrifter velger du malinger: «Begge» (to utkast: med malinger du har, og beste valg), «Bare det jeg har» eller «Beste valg». Agenten velger aldri ut fra hva du eier uten at du har bedt om det.
- Utkastet viser hver kilde, om agenten faktisk leste den, og hva den bidro med. En lenke du la ved, men som ikke kunne leses, vises med grunnen.
- Er kildene uenige, vises fremgangsmåtene side om side. Du velger hvilken som er utgangspunktet.
- Hvert steg er merket «Vist i kilde» eller «Forslag fra agenten».
- «Lagre og foreslå forbedring» (etter en erfaring) og «Forbedre med agenten» (på en teknikk) gir et forslag til endring. Du ser hva som endres, med «Nå» og «Forslag», før du tar det i bruk. Har du endret teknikken i mellomtiden, må agenten lage et nytt forslag.
- Ingenting lagres i biblioteket før du trykker «Lagre i biblioteket». Da lagres det som utkast, og du kan endre alt etterpå. Malinger som ikke finnes i katalogen, kobler du til et produkt eller legger til som ubekreftet.
