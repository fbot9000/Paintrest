# Avvik og antakelser i prototypen

## Grunnregler for agentens frihet (brukerbeslutning 10. november 2026)

Agenten skal ha mye frihet. Dokumentene er for strenge på dette punktet. To ting skal likevel alltid gjelde:

1. **Ingen skade på det som ikke hører til oppgaven.** Agenten endrer bare i prosjektet den jobber i. Andre spill, deres miniatyrer, planer og kilder, malingskatalogen og biblioteket (teknikker og oppskrifter) endres ikke. Agenten kan bare foreslå endringer der.
   - **Håndheves av:** `checkScope` (alle forslag), `needsUser` (katalogen) og `sourceBelongsTo`. Den siste sørger for at oversettelser og sammendrag bare legges på kilder som hører til prosjektet.
   - **Unntak:** gjenbrukes en nettside som et annet spill også har lagret, deles kilde-raden. Den kan få en ny lenke og bli markert som lagret, men innholdet endres ikke.
2. **Ingenting skjer i bakgrunnen uten at du ser det.** Agenten kjører bare når du starter den, fra panelet, bildevisningen eller maleplanen. Alt den endrer eller lagrer, vises i panelet:
   - endringer som «Agenten endret …» med Angre
   - forslag som venter på deg
   - nye kilder som «Lagret N sider som kilder …»
   - søk og sider under «Vis hvordan agenten fant dette»



Dokumentene er førende. Denne listen viser hvor prototypen gjør et valg dokumentene ikke tar, eller avviker fra dem. Hvert punkt bør avgjøres før koden mot den ekte databasen skrives.

## Avvik fra skjemaet

1. **`paint_product.swatch_hex`.** Datamodell v3 §14 sier at malevisningen viser «fargeprøve», men skjemaet har ingen kolonne for det. Prototypen har lagt til et felt som kan være tomt.
2. **Sletting er alltid skjuling.** Skjema §6 åpner for fysisk sletting når objektet ikke har historisk bruk. Prototypen skjuler alltid, slik at «Gjenopprett» virker overalt. Fysisk sletting og en papirkurv må avklares.
3. **Enkeltfigur betyr én figur.** Når `grouping = single`, settes `physical_count` til 1. Dette står i datamodell v3 §7, men ikke i skjemaet.
4. **Forsegling av avvik.** Prototypen følger skjema §6 og §9: «Marker ferdig» låser de åpne avvikene, og de vises ikke lenger. For en malegruppe forsvinner de da også for figurene som gjenstår. Dialogen sier dette rett ut, slik at det kan prøves i praksis.
5. **Avviket `swap_product`.** Datamodellen nevner bytte av produkt, endret blanding, ekstra steg og endret instruks. Prototypen har `swap_product`, `change_instruction`, `extra_step` og `note`. Endret blanding mangler. `kind` er ikke oppregnet i skjemaet.
6. **`openPart` skriver ikke `change_record`.** «Sist åpnede del» er et minne for brukergrensesnittet, ikke en endring av innhold.
7. **Kobling til BGG matcher utvidelser på navn.** En manuell utvidelse med samme navn som en utvidelse fra BGG får thing-id i stedet for at det lages en ny rad.
8. **`ai_credential.base_url`.** Skjemaet har ikke adressen til tjenesten. Prototypen lagrer den på raden, slik at adressen kan endres uten ny kode.
9. **Nøkkelen ligger i en fil, ikke i PostgreSQL.** Raden har samme form som i skjemaet, men ligger i `.paintrest-data/ai_credential.json` til databasen finnes. Hovednøkkelen ligger i en fil ved siden av eller i en miljøvariabel. Hvilket nøkkellager som skal brukes i produksjon, er ikke avgjort (skjema §10).
10. **Ingen innlogging.** Serveren lytter bare på 127.0.0.1. Kjøres Vite med `--host`, kan alle på samme nett nå `/api` gjennom proxyen, og dermed bruke nøkkelen, men ikke lese den.
11. **Bare to resultattyper.** En oppgave får `catalog_subject` og `paint_plan`. `plan_revision` kommer i tillegg når brukeren åpner en plan for revisjon. Skjema §6 lister flere typer for `new_project`, og de legges til når flatene for dem finnes.
12. **Omfanget sjekkes i klienten.** Prosjektdataene ligger i nettleseren, så sjekkene i §7 og godkjenningen i §8 kjører i det lokale kommandolaget (`src/data/research-commands.ts`). Serveren kaller bare modellen og skriver ingenting. Når databasen kommer, flyttes sjekkene dit, med samme regler.
13. **Ekstra felt på forslag og meldinger.** `research_proposal.ref` (F1, F2 …) lar agenten vise til egne utkast. `research_proposal.last_error` viser hvorfor en godkjenning stoppet. `research_message.model_id` viser hvilken modell som svarte.
14. **Én åpen oppgave per prosjekt i panelet.** «Ny oppgave» lukker den åpne og starter en ny.
15. **Kilder lagres først ved godkjenning.** Skjemaet beskriver utkast-kilder med `retention = draft`. Prototypen holder kildene i forslagets nyttelast og oppretter `source`-rader med `retention = kept` først når forslaget godkjennes. En kilde med samme URL gjenbrukes.
16. **Bilder lastes ned ved godkjenning.** Bilder fra nettet hentes gjennom serveren og lagres lokalt som `stored_file`. Den opprinnelige bildeadressen står i `source_asset.locator`, og sidens adresse står i `source.url`.
17. **Testbrytere på serveren.** `PAINTREST_ALLOW_LOCAL_FETCH=1` og `PAINTREST_SEARCH_BASE_URL` brukes bare i tester mot simulerte tjenester. De skal ikke settes ved vanlig bruk.
18. **`source_asset.image_kind`.** Feltet sier hva bildet viser: konseptillustrasjon, offisielt bilde, malt eksempel eller annet. Det finnes ikke i skjemaet.
19. **Ny illustrasjon skjuler ikke den gamle.** Velger du et annet bilde som illustrasjon (`official_asset_id`), lenkes det forrige til miniatyren som referansebilde. Det blir altså ikke borte fra visningen.
20. **Bildesøk fra miniatyren går i samme oppgave som panelet.** «Let med AI» skriver en melding og et `reference_selection`-forslag i prosjektets åpne researchoppgave. Du ser dem derfor også i agentpanelet.
21. **Eldre åpne oppgaver får nye resultattyper.** Skjema §7 sier at systemet setter resultattypene når oppgaven opprettes. Når Paintrest får en ny type, legger systemet den til på åpne prosjektoppgaver i det øyeblikket brukeren starter en runde. Det skrives en `change_record` med `initiated_by = user`. Agenten kan ikke gjøre dette selv.
22. **Kildelag fra bildejakt.** Når du lagrer bilder fra en bildejakt, får siden de kom fra to `source_layer`-rader: `original` med et kort utdrag på kildens språk, og `translation` (nb) med agentens sammendrag. Oversettelsen er laget av modellen og er ikke kontrollert. `source_layer` kom med migreringen til v3.
23. **Bildejakt er et eget oppdrag.** «Let med AI» for en miniatyr har egen instruks, høyst 24 steg i stedet for 12, og handlingen «look». Kandidatene får sikkerhet (`confidence`), begrunnelse på norsk (`reason`) og originaltekst. Feltene ligger i forslagets nyttelast og finnes ikke i skjemaet.
24. **Kilder agenten leser, lagres automatisk som utkast.** Hver side agenten åpner, lagres som `source` med `retention = draft` og `created_by_task_id`, sammen med agentens sammendrag og originalutdrag som kildelag. Utkastene vises som «Funnet av agenten» for alle miniatyrene i spillet, og agenten får dem i `known_sources`. De lenkes ikke kanonisk til noe før du lagrer bilder eller godkjenner et forslag som bruker dem. Da blir de `kept`. Dette følger skjema §6.
25. **Maleplan med palett.** Maleplanoppdraget («Lag maleplan og palett med AI») sender de valgte bildene av miniatyren som `input_image` sammen med forespørselen. Avviser modellen bilder, fortsetter oppdraget uten dem. Godkjenning skriver i én transaksjon:
    - planversjonen, med `paint_plan_version.summary` (ikke i skjemaet)
    - `palette_entry` med `scope_kind = subjects` for miniatyren, der delen står i `note` og rollen i `role_label`, og `content_revision` økes
    - lenker med `use = method` til kildene som ble brukt
    - farge (`swatch_hex`) fra agenten på malinger som opprettes som ubekreftet. Fargen er omtrentlig.
26. **Du kan redigere planforslaget før godkjenning** (`editPlanProposal`): arbeidsmåte, deler, steg, malinger og roller, og palett. Miniatyren forslaget gjelder, kan ikke byttes.
27. **BRUKERBESLUTNING 10. november 2026: agenten får stor frihet inne i prosjektet.** Mens et prosjekt settes opp, kan agenten foreslå å lage, endre, dele, slå sammen og slette miniatyrer (`catalog_change`, ny resultattype). Den kan også foreslå nye versjoner av godkjente maleplaner (`plan_revision`) uten at brukeren først åpner planen som revisjonsmål.
    - **Hva det avviker fra:** Dette erstatter regelen om revisjonsmål i skjema §3 og §7 og datamodell v3 §12, for objekter i arbeidsprosjektet.
    - **Det som står fast:**
      - Alt er forslag som brukeren godkjenner. Det går med ett klikk, og «Godkjenn alle» finnes for forslag som ikke trenger valg.
      - Hvert forslag godkjennes i én transaksjon.
      - En ny planversjon stopper hvis planen er endret siden forslaget ble laget.
      - Sletting skjuler bare, og miniatyren kan gjenopprettes. Deling og sammenslåing lager nye miniatyrer og skjuler originalene.
      - Agenten kan ikke røre noe utenfor arbeidsprosjektet: andre prosjekter, malingskatalogen (nye malinger krever fortsatt brukerens valg) eller biblioteket.
    - **Dokumentene bør oppdateres:** «Paintrest – databaseskjema og arkitektur» §3 og §7, og datamodell v3 §12.
28. **BRUKERBESLUTNING 10. november 2026: agenten endrer direkte, med angre.** Det er tre soner:
    - **Åpen:** alt i arbeidsprosjektet. I runder fra agentpanelet tar Paintrest agentens endringer i bruk med en gang: nye, endrede, delte, sammenslåtte og slettede miniatyrer, og maleplaner der alle malingene finnes i katalogen. Hver runde blir ett endringssett (`agent_change_set`, ny tabell i v4). Endringssettet lagrer før- og etterbildet av hver rad som ble endret, og «Angre» fører alt tilbake samlet. Angre nektes uten å endre noe hvis en rad er endret etterpå. Forslagene ligger igjen som logg (`change_set_id`), og `change_record` skrives som før, med `undo` ved angre.
    - **Ferdig:** ikke i bruk ennå. Brukeren har sagt at ingenting er ferdig foreløpig. Hva som skal gjøre noe ferdig og låst (for eksempel «maleklar», at malingen er i gang, eller at katalogen er ferdig), avgjøres senere.
    - **Globalt:** malingskatalog, bibliotek og andre prosjekter. Agenten foreslår, og brukeren godkjenner.
    
    Bildeutvalg og planer med malinger som ikke finnes i katalogen, er fortsatt forslag. Det samme gjelder runder brukeren starter fra en egen visning (bildejakt og maleplan), der brukeren går gjennom forslaget der.
    
    Dette avviker fra datamodell v3 §3, §12 og §13, og fra skjema §2 og §8, der agenten aldri skriver kanoniske data uten godkjenning. Dokumentene bør oppdateres.
29. **BRUKERBESLUTNING 10. november 2026: dataene ligger i en fast datamappe, `~/Paintrest`.** Paintrest-serveren eier dataene: `data.json` (hele tilstanden, med revisjonsnummer), `files/` (bildene) og `backups/` (de 30 siste kopiene). Nøklene kopieres hit fra `.paintrest-data/`. Dette er et filbasert mellomsteg før en ekte database, og det har tre følger:
    - **Hele tilstanden lagres hver gang.** Skjemaets tabeller og radformat er de samme, så overgangen til SQLite eller PostgreSQL blir en flytting av rader, ikke en ny modell. Valget av database og tilgang fra iPad utenfor maskinen er ikke tatt.
    - **Samtidighet med revisjon, ikke sammenslåing.** En lagring som bygger på en gammel revisjon, avvises (409), og appen ber brukeren laste inn på nytt. Endringer fra den fanen etter konflikten lagres ikke. Skjemaets `content_revision` per rad er uendret.
    - **Bilder slettes aldri.** Fjernede bilder flyttes til `files/trash/`. Skjemaet har ingen regel for opprydding.

## Antakelser

- **Klient:** React og TypeScript som webapp med hash-ruting. Det er godkjent av brukeren 9. november 2026.
- **Lagring:** Med serveren ligger dataene i `~/Paintrest` (se avvik 29). Uten serveren ligger de i nettleseren (IndexedDB). Det finnes ingen synkronisering mellom maskiner.
- **UiB-API-et:** Adresse, endepunkter og Bearer-autentisering er oppgitt av brukeren. Svarformatet (`data[].id` fra `/models`, og `output[].content[].text` eller `output_text` fra `/responses`) følger OpenAI-konvensjonen. Det er ikke testet mot UiB, fordi nettverket i utviklingsmiljøet blokkerte adressen. Testene bruker en simulert tjeneste.
- **Agentens svarformat:** Modellen blir bedt om å svare med ett JSON-objekt. Formatet er ikke lagt inn som `text.format`/`json_schema`, fordi det er ukjent om alle modellene hos UiB støtter det. Svar som ikke kan tolkes, vises som vanlig tekst, og eventuelle forslag i dem leses ikke inn.
- **Nettsøk via UiB er ubekreftet.** Agenten sender `tools: [{"type": "web_search"}]` til UiB og leser `web_search_call` og `url_citation` fra svaret, som i OpenAIs Responses API. Det er ikke bekreftet at UiB sender verktøyet videre, eller for hvilke modeller. Svarer UiB med feil 400, 422 eller 501 når verktøyet er med, går agenten over til Tavily eller Brave, eller videre uten nettsøk. Panelet sier fra når det skjer. Sitater fra UiB-søket regnes som søketreff. «Dokumentert» og bilder krever fortsatt at agenten har åpnet siden gjennom Paintrest.
- **`ai_credential.hosted_search`.** Feltet sier om nettsøk via UiB er på (`web_search`, `web_search_preview` eller `off`). Det finnes ikke i skjemaet, og det er på som standard.
- **Verktøy gjennom JSON-handlinger, ikke funksjonskall.** Agenten svarer med `search`, `open` eller `final` som JSON i hvert steg, med høyst 12 verktøysteg per svar. Det krever bare vanlige tekstsvar, og de virker hos UiB. Det er ikke testet om UiB støtter funksjonskall i Responses API.
- **Serveren sjekker kildene.** Bilder i et forslag må finnes i bildelisten på en side agenten åpnet i samme runde. Kilder må være søkt fram eller åpnet. Det som ikke stemmer, fjernes og meldes i panelet. «Dokumentert» uten en åpnet kilde nedgraderes.
- **Nettvern.** Sider og bilder hentes av serveren på brukerens maskin. Bare http og https på standardporter er tillatt, private nett blokkeres, og hver omdirigering sjekkes på nytt. Det er ikke beskyttet mot DNS-rebinding mellom oppslag og tilkobling. Det er godt nok for et lokalt verktøy, men ikke for en delt server.
- **Agenten ser på bildene (`look`), ubekreftet hos UiB.** Paintrest henter bildene og sender dem som `input_image` (data-URL) til modellen, sammen med miniatyrens nåværende illustrasjon som referanse når den finnes. Det følger OpenAIs Responses API. Om UiB sender bilder videre, og for hvilke modeller, er ikke bekreftet. Avviser UiB det, fortsetter agenten uten å se på bildene og bruker teksten rundt dem. Bare bilder fra sider agenten har åpnet, kan vises, høyst 8 om gangen.
- **Naver-blogger leses gjennom mobilvisningen** (`m.blog.naver.com`), fordi den vanlige visningen legger innlegget i en ramme. Det er ikke testet mot Naver, fordi utviklingsmiljøet blokkerer adressen.
- **Opphavsrett.** Bilder som lagres, er for personlig bruk som referanse. Kilden og bildeadressen lagres sammen med bildet.
- **Søketjenestene:** Endepunktene er hentet fra dokumentasjonen til Tavily (`POST /search`, Bearer) og Brave (`GET /res/v1/web/search`, `X-Subscription-Token`). De er ikke testet mot de ekte tjenestene, fordi utviklingsmiljøet blokkerte all utgående trafikk. Prisene (Tavily: 1 000 gratis kreditter i måneden, Brave: kreditt på 5 dollar i måneden og kredittkort) er sjekket mot oppslag 9. november 2026.
- **BGG:** Oppslaget er simulert. Navnene og thing-id-ene (9000xx) er oppdiktet.
- **Eksempeldata:** Spillet og kildene er plassholdere hentet fra Figma. Fargene på fargeprøvene er tilnærminger. Malingsnavnene er Citadel-produkter. Det er ikke sjekket om navnene er i produksjon i dag.
- **Skrift:** DM Serif Display, DM Sans og DM Mono, lastet fra Google Fonts. Valget er gjort ut fra skjermbildene i Figma og ikke kontrollert mot filen.

## Ikke bygget ennå

- Redigering av maleplanen (bit 4). «Lag maleplan» lager bare en tom versjon 1.
- Palett, kilder og kunnskap. Agenten kan foreløpig ikke foreslå referanser, teknikker eller oppskrifter.
- Ny planversjon ved redigering. Det kommer i bit 4, og der blir problemet med fremdrift og avvik på tvers av versjoner synlig.
