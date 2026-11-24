> **Historisk grunnlag, ikke oppdatert.** Opprinnelig dokument fra 8. november 2026 (filnavn: «Paintrest – datamodell.md»), lagt inn uendret 24. november 2026. Løsningen har utviklet seg siden. Koden og brukerens beslutninger i [docs/beslutninger/](../beslutninger/) går foran. Hva som fortsatt ser ut til å gjelde, står i [VURDERING.md](VURDERING.md).

# Paintrest – datamodell v3

Revidert logisk datamodell · 8. november 2026  
Erstatter datamodell v2. Bygger på produktspesifikasjonen v2.0 og tilbakemeldingene på v1 og v2.

Godkjent som logisk modell for agentens handlingsrom og de kanoniske relasjonene. Den beskriver poster og relasjoner, ikke tabeller eller lagringsmotor. Full manuell kontroll, ufullstendige objekter og databaseskjemaet ligger i Paintrest – databaseskjema og arkitektur.md. Agentreglene her gjelder agenten, ikke brukerens egne operasjoner.

# 1. Hva som endres fra v2

Strukturen fra v2 står, inkludert flere forslag per researchoppgave, `SourceAsset`, skillet mellom revisjon og remiks, palettoppføringer, valgfri fremdrift, historiske avvik og versjonsbevisst kontekst.

v3 legger til et systemdefinert handlingsrom for agenten, og to korrigeringer:

- `TaskScope` hører til `ResearchTask`. Det angir arbeidsmål, tillatte operasjoner, eventuelle revisjonsmål og hva som bare kan leses. Agenten kan ikke endre omfanget. Alle skrivinger valideres mot det.
- Godkjente versjoner er uforanderlige. Godkjenning er en transaksjon og krever at grunnversjonen fortsatt er gjeldende. `ChangeRecord` spor hvem som initierte endringen, og hvem som godkjente den.
- Bilder brukt til å identifisere malingsflasker er `ImportImage`. De kan slettes etter validering og blir ikke permanente `SourceAsset`-er. Vanlige kilde- og referansebilder bevares som før.
- Beskyttelse av API-nøkkelen er et produktkrav. Konkret mekanisme er et teknisk valg. Agenten har ingen operasjon som kan lese, endre eller vise hemmeligheten.

# 2. Produktkrav og tekniske antakelser

## Avtalte produktkrav

- Brukeren tar med egen AI-nøkkel i første versjon. Brukes nøkkelen lagret, skal den være kryptert ved lagring og ha begrenset tilgang. Den lagres ikke i planer, kilder, meldinger eller endringshistorikk, og agenten kan ikke lese den ut.
- BoardGameGeek identifiserer spill og utvidelser, henter grunnleggende spillinformasjon og brukes til å opprette lokale poster etter godkjenning. Thing-id brukes til identifikasjon og deduplisering. Vanlig bruk leser de lokale postene. Spill og utvidelser som ikke finnes der, kan legges inn manuelt. BGG er ikke en miniatyrkatalog.
- Agenten arbeider fritt innenfor oppgavens handlingsrom og kan endre egne utkast. Den kan lese eksisterende prosjekter og global kunnskap. Den kan ikke endre godkjente data, utvide egne tillatelser eller godkjenne egne forslag.
- Endring av godkjente data skjer ved en egen godkjenningsoperasjon, utført av brukeren. Hele endringen gjennomføres, eller ingen del av den. Et eldre forslag overskriver ikke en nyere godkjent versjon.
- Agenten foreslår. Ett researcharbeid kan gi flere selvstendige resultater, og noen av dem kan godkjennes mens andre avvises.
- Én originalkilde kan inneholde mange bilder og tekster. Enkeltbilder kan knyttes til ulike figurer, teknikker og oppskrifter, og sammenhengen tilbake til kilden bevares.
- Revisjon og remiks er to operasjoner. Historiske oppskrifter og maleplaner forblir uendret.
- Prosjektpaletten kan uttrykke rolle og hvor et produkt gjelder. Flere metoder kan gjelde prosjektet eller en del av det.
- Fremdrift er valgfri. En figur kan være påbegynt uten avkryssede steg. En gruppe kan ha aggregerte tall uten figur-id-er.
- Et avvik hører til en planversjon. Det som var brukt da noe ble ferdigmalt, kan rekonstrueres. En enkel korrigering i malevisningen starter ikke et nytt researchløp.
- Fortsatt research ser hvilken versjon den tidligere arbeidet med, og kan oppdage at en godkjent versjon er nyere.
- En stor malingsamling kan importeres samlet, også fra bilder, og verifiseres før produktene blir kanoniske. Ukjente navn blir ikke produkter av seg selv. Identifikasjonsbilder kan slettes etterpå.
- Eksakte produktnavn kreves i konkrete oppskrifter og maleplaner. Kildegrunnlag, brukerens beslutning og praktisk erfaring er tre atskilte felt.
- En ordinær researchoppgave sletter ikke godkjente data og gjør ikke masseendringer i dem.

## Tekniske antakelser

Disse er forslag til hvordan modellen kan bygges. De er ikke produktkrav.

- At databasen starter tom og bare fylles gjennom bruk.
- At det finnes ett arbeidsrom per bruker, med et `workspaceId` på personlige poster.
- Hvilken krypteringsmekanisme som beskytter nøkkelen, og hvor filer fysisk ligger.
- Valg av databasemotor, skjema og migrasjoner.

Der dokumentet sier at godkjente fakta leses fra Paintrests egne poster, er det et produktkrav. Hvor byte-ene fysisk ligger, er det ikke. At nøkkelen skal være kryptert og utilgjengelig for agenten, er et produktkrav.

# 3. To lag

**Kanoniske poster** er det grensesnittet leser. Formene er faste. Agenten oppretter ikke nye toppnivå-typer fra spill til spill, og skriver ikke disse postene direkte.

**Utkast** er forslagene på en researchoppgave, og kilder som bare forslagene peker på. Agenten kan opprette og endre utkast innenfor handlingsrommet. De er ikke godkjente data.

**Researchoppgaven** er arbeidsminnet. Den kan inneholde mange forslag. Godkjenning, utført av brukeren, er operasjonen som skriver et forslag inn i de kanoniske postene. En ny økt henter godkjente fakta, ikke chatloggen. Samtalen kan forkortes uten at godkjente spill, planer eller oppskrifter forsvinner.

# 4. Nøkkel

`AiCredential` hører til arbeidsrommet og har leverandør, visningsnavn, hemmelighet og standardmodell. Hemmeligheten er kryptert ved lagring. Tilgangen er begrenset til det stedet i applikasjonen som sender kallet til leverandøren.

Agentens operasjoner kan ikke lese ut, endre eller returnere hemmeligheten. Forslag og `ChangeRecord` kan lagre leverandør og modell-id. De kan ikke lagre nøkkelen.

Hvilken kryptering og hvilket nøkkellager som brukes, er et teknisk valg. Beskyttelsen er det ikke.

# 5. Maling, inventar og import

`PaintProduct` er produktidentiteten: produsent, serie, eksakt navn, produkttype (primer, base, layer, shade, contrast, technical, metallic, medium eller other), kjente egenskaper for dekkevne og finish, og alias til matching. Ukjente egenskaper forblir ukjente.

`InventoryEntry` er arbeidsrommets forhold til ett produkt: `owns`, `not_owned` eller `unknown`. `unknown` betyr at eierforholdet ikke er avklart. Statusen kan komme fra manuell registrering, en import eller et registrert kjøp.

`ShoppingNeed` er én rad per produkt, med prioritet `necessary`, `recommended` eller `wishlist`, og hvilke prosjekter behovet kommer fra. Et registrert kjøp setter inventaret til `owns` og lukker behovet.

## Import

`InventoryImport` er én operasjon for mange produkter. Den kan komme fra en liste, fra bilder eller fra en blanding. Dette er en brukeroperasjon, ikke en researchoppgave, og den skriver ikke produkter før brukeren godtar linjene.

`ImportImage` er et midlertidig bilde av flasker, for eksempel et hyllefoto eller et utsnitt. Det er ikke en `SourceAsset`. Linjer kan peke på det mens importen pågår. Brukeren kan godta de identifiserte produktene for ett bilde. Etter validering kan bildet slettes. Slettingen fjerner ikke `PaintProduct` eller `InventoryEntry` som allerede er godtatt. Linjen beholder den identifiserte produktdataen, ikke fotografiet.

Vanlige kildebilder og referansebilder forblir `SourceAsset` og bevares.

`InventoryImportLine` er én kandidat i importen:

- rått navn, og eventuelt foreslått produsent og serie
- `matchState`: `matched`, `partial` eller `unidentified`
- `matchedProductId` når linjen er koblet til et eksisterende produkt
- peker til et `ImportImage` når den kommer fra et bilde
- `decision`: `pending`, `accepted` eller `rejected`

Ingenting skrives til `PaintProduct` eller `InventoryEntry` mens linjen er `pending`. Brukeren kan godta mange linjer i samme gjennomgang, også samlet per bilde. En godtatt linje som matcher et produkt, oppretter bare `InventoryEntry`. En godtatt linje som skal bli et nytt produkt, gjør det først når brukeren eksplisitt velger å opprette det. Avviste linjer og uidentifiserte navn blir stående som kandidater.

Samme sperre gjelder research. Et forslag kan bære et uavklart produktnavn. Utkast kan lagres. Godkjenning av det forslaget stoppes til navnet er koblet til et produkt eller brukeren oppretter produktet.

# 6. Spill, utvidelser og prosjekt

`Game` er den lokale spillposten: navn, år, utgivere, omslagsbilde som Paintrest har tatt vare på, og opprinnelse. Opprinnelsen er `bgg` med thing-id, eller `manual`.

`Expansion` hører til ett `Game`. Den har navn, år, og opprinnelse `bgg` med thing-id eller `manual`. Den sier ikke om utvidelsen er med i et prosjekt.

`Project` peker på ett `Game`. `ProjectExpansion` kobler prosjektet til de utvidelsene som inngår i dette arbeidet. Samme spillpost kan dermed ha et annet utvalg i et annet prosjekt, uten at utvidelsen selv endres. Grunnspillet følger med prosjektet fordi prosjektet peker på `Game`.

## BoardGameGeek

Et søk gir kandidater med thing-id, primærnavn, årstall, type (`boardgame` eller `boardgameexpansion`) og alternative navn. Finnes thing-id-en allerede på en lokal `Game` eller `Expansion`, brukes den posten. Ellers hentes thing-et.

Godkjenning skriver `Game` og de valgte utvidelsene som lokale rader, og oppretter `ProjectExpansion` for utvidelsene brukeren tar med. Etter dette leser vanlig bruk de lokale radene. Thing-id blir liggende slik at samme spill ikke legges inn dobbelt. Senere endringer brukeren gjør, gjøres i de lokale radene.

Finnes ingen treff brukeren godtar, opprettes `Game` med manuell opprinnelse. En utvidelse som finnes i esken, men ikke kom med fra BGG, blir en manuell `Expansion`. Om den inngår, settes på prosjektet.

# 7. Miniatyrer og fremdrift

`MiniatureSubject` er én rad per figurtype eller malegruppe. `grouping` er `single` eller `group`. `physicalCount` er 1 eller N. Gruppen har ingen barnerader og ingen figur-id. Ingen miniatyr har en BoardGameGeek-id.

Omslagsbildet på `Game` er spillbildet. Figuroppsettet kommer fra research: navn, om like miniatyrer er én gruppe, fysisk antall, hvilken utvidelse de hører til, et fritt kategorinavn, kilder og om antall og gruppering er dokumentert eller utledet. Offisielt figurbilde er en `SourceAsset`. Usikkerhet kan bli stående på posten etter godkjenning.

`planState` er `none`, `draft` eller `approved`. Den sier om maleplanen er klar, og er noe annet enn fysisk fremdrift.

Fysisk fremdrift er valgfri og lagres slik:

- `inProgress` er et eksplisitt merke brukeren setter. Det krever ingen avkrysset del og ingen avkrysset steg. Slik kan én figur være under arbeid før noe er krysset av.
- `finishedCount` er hvor mange fysiske figurer brukeren har markert ferdig, fra 0 til `physicalCount`. For én figur er tallet 0 eller 1.
- `PartProgress` kan huske at en del er krysset av, og hvilken del som var sist åpnet.
- `GroupProgress` er et valgfritt aggregat på en gruppe: planversjon, operasjon eller del, og et antall. Tjuefem zombier kan være grunnet, atten ha fått grunnfarge, og ni være ferdige, uten at noen av dem har en id. Antallet kan ikke overstige `physicalCount`.

«Ikke startet» betyr at figuren verken er merket påbegynt, har avkrysning, har gruppetall eller har `finishedCount` over null. Tilgjengelighet av maling avledes fra inventaret og endrer ikke `planState`.

# 8. Palett og metoder

`PaletteEntry` hører til prosjektet:

- ett `PaintProduct`
- valgfri rolle eller beskrivelse, som «gjennomgående hudtone» eller «zombienes klær»
- valgfritt anvendelsesområde

Tomt anvendelsesområde betyr at oppføringen gjelder prosjektet som helhet. Er det satt, peker det på én av disse: en utvidelse som er med i prosjektet, et kategorinavn, eller et sett med `MiniatureSubject`. Én oppføring har ett slikt område. Det er nok til å si hvor fargen brukes, og det er ikke et regelsystem.

`ProjectMethod` hører til prosjektet og peker på en `TechniqueVersion`. Valgfri beskrivelse og samme type anvendelsesområde som paletten. Et prosjekt kan ha flere metoder. Én av dem kan gjelde alle figurene, en annen bare en fraksjon.

# 9. Maleplan, avvik og det som faktisk ble brukt

`PaintPlanVersion` tilhører ett subject, har versjonsnummer og tilstand `draft`, `approved` eller `superseded`. En godkjent versjon endres ikke. Neste godkjenning lager en ny versjon. Identiteten peker på gjeldende versjon. Den pekeren flyttes bare når godkjenningen er fullført.

Formen er fast. Delnavnene er frie.

- Felles operasjoner og deler bruker samme stegtype. En felles operasjon kan gjelde hele figuren.
- `PlanPart.name` er fri tekst.
- `PlanStep` har instruks, valgfri teknikkversjon og referanser til kilder og enkeltbilder.
- Hvert materiale peker på et `PaintProduct`, med rolle `base`, `shade`, `layer`, `highlight`, `wash`, `glaze`, `mix` eller `other`, og en fri rolleetikett når den trengs.
- En blanding er ett steg med flere produkter og et forhold.
- Bruk av en oppskrift kopierer rollelinjene inn i versjonen og husker `recipeVersionId`. Å peke på en oppskriftsversjon endrer ikke oppskriften.

`LocalDeviation` peker på en planversjon og på del eller steg. Den kan bytte produkt, endre blanding, legge til steg eller endre instruks. Den opprettes av brukeren i malevisningen, uten en ny researchoppgave. Malevisningen leser den godkjente versjonen med avvikene som gjelder den versjonen lagt over.

Avviket skriver ikke tilbake til oppskrift, teknikk eller andre figurer. En `LocalDeviation` som er tatt med i en ferdigstilling, endres ikke etterpå. En senere korrigering er et nytt avvik, eller en ny planversjon hvis arbeidet åpnes for research.

`PaintCompletion` skrives når brukeren markerer en figur ferdig, eller øker `finishedCount` på en gruppe. Den lagrer:

- subjectet
- `planVersionId`
- en frossen kopi av avvikene som gjaldt da
- tallet som ble ferdigstilt i dette steget, og samlet `finishedCount` etterpå

Den godkjente planversjonen er allerede uforanderlig. Den frosne avvikskopien gjør at en senere korrigering ikke skriver om det som ble brukt. For en gruppe, der figurene ikke har id, deles historien på disse postene: de ni første kan høre til versjon 1 med ett avvik, og de neste til en senere versjon. Hvilken fysisk figur som var hvilken, lagres ikke.

# 10. Oppskrift: revisjon og remiks

`Recipe` er identiteten, med stabil id og peker til gjeldende versjon. `RecipeVersion` hører til én oppskrift, har versjonsnummer og tilstand `draft`, `approved` eller `superseded`. En godkjent versjon endres ikke.

Revisjon lager neste `RecipeVersion` på samme `Recipe`. «Mørkeblå kappe» v1 blir v2. Planer som peker på v1, peker fortsatt på v1. Agenten kan bare foreslå en slik revisjon når brukeren har åpnet akkurat den oppskriften for revisjon.

Remiks oppretter en ny `Recipe`. Den har `basedOnRecipeVersionId` mot versjonen den bygger på, og sin egen versjonshistorikk som starter på v1. «Mørkegrønn kappe» er en annen oppskrift enn «Mørkeblå kappe». Pekeren leser originalen. Den skriver ikke til den.

En teknikk har tilsvarende identitet og versjoner, `Technique` og `TechniqueVersion`. Remiks er definert for oppskrifter. En ny teknikk i en researchoppgave blir en ny identitet. En eksisterende teknikk endres bare når den er åpnet for revisjon.

Begge kunnskapstypene har tre felt på versjonen: `evidence` (`documented`, `synthesized`, `unresolved`), `decision` (`proposed`, `approved`) og `experience` (`untried`, `used`, `succeeded`, `needs_adjustment`). `decision` settes av godkjenningen, ikke av agenten. En fargekjede er rollelinjene i en oppskriftsversjon, ikke et eget bibliotek.

# 11. Kilder og medieelementer

`Source` er hele originalen: blogg, artikkel, forumtråd, video, bokutdrag eller guide, med skaper, url og stedfesting. `analysisState` er `stored` eller `extracted`. En lagret video er ikke behandlet som sett innhold før tilstanden sier at den er trukket ut.

`SourceAsset` er ett medieelement inne i kilden, som ett av tolv bilder. Det har rekkefølge, stedfesting i kilden (bildeindeks, sidetall eller tidsstempel) og en valgfri bildetekst. Filen Paintrest tar vare på, hører til dette elementet. Hvordan filen lagres, er en teknisk antakelse. Disse bildene er kilder og referanser, og bevares. De er noe annet enn `ImportImage`.

`SourceLayer` er originaltekst, oversettelse eller strukturert utdrag. Laget kan peke på de `SourceAsset`-ene det hører sammen med, slik at en oversatt passasje fortsatt henger sammen med bildene ved siden av den.

`SourceLink` kobler kilden til prosjekt, figur, teknikk, oppskrift eller steg, med bruk `evidence`, `visual_reference` eller `method`. Lenken kan avgrenses til bestemte assets og ett tekstlag. Da kan ravnene på Merlin bruke tre bilder fra en guide, mens en annen figur bruker to andre, og begge peker tilbake på samme `Source`.

En kilde som bare et utkast peker på, følger utkastet. Den blir en kanonisk kobling når forslaget som bruker den, godkjennes. Et avvist forslag gir ikke lenker fra godkjente figurer, oppskrifter eller teknikker.

Dette er relasjonene som trengs for å rekonstruere en illustrert guide. Det er ikke en dokumentmotor.

# 12. Handlingsrom

Hver `ResearchTask` får et `TaskScope` når brukeren åpner oppgaven. Applikasjonen setter det ut fra handlingen brukeren valgte. Agenten har ingen operasjon som leser ut nøkkelen, endrer `TaskScope` eller legger til revisjonsmål.

Omfanget har fire deler:

- **Arbeidsmål.** Objektene oppgaven kan opprette og redigere utkast for. For et nytt spill er det det nye prosjektet. For en ny teknikk er det en ny teknikkidentitet. Utkastene er forslag på oppgaven, ikke godkjente poster.
- **Tillatte operasjoner.** Et lukket sett med typede operasjoner for denne oppgavetypen. Agenten kaller disse. Den har ikke generell skrivetilgang til databasen.
- **Revisjonsmål.** Eksisterende objekter brukeren eksplisitt har åpnet for et endringsforslag. Hvert mål har type, id og grunnversjon. Listen er tom til brukeren åpner ett bestemt objekt. Ett åpnet objekt åpner ikke søskenobjekter.
- **Lesing.** Eksisterende prosjekter, bibliotek og inventar kan leses. En leseoperasjon returnerer data. Den gir ikke et håndtak som kan skrive.

Eksemplene følger av dette:

- Et nytt spill kan få fritt utviklede utkast for identitet, katalog, referanser, palett, metoder og maleplaner. Agenten kan lese andre prosjekter og global kunnskap. Den kan ikke endre dem.
- Research på en ny teknikk kan opprette og redigere teknikkutkast. Den kan ikke endre eksisterende teknikker.
- Ber brukeren om revisjon av én oppskrift eller én maleplan, kan agenten foreslå en ny versjon av akkurat det objektet, med den oppgitte grunnversjonen. Forslaget skriver ikke den godkjente versjonen.

Vil brukeren at samme oppgave også skal revidere et annet objekt, er det en ny eksplisitt brukerhandling som legger det objektet til som revisjonsmål. Agenten kan ikke gjøre det selv.

## Operasjoner

Agenten kan, når omfanget tillater det, opprette et forslag, endre et eget forslag som fortsatt er `pending`, og lese kanoniske poster. Den kan ikke godkjenne, avvise, slette godkjente poster, gjenopprette en tidligere versjon, masseoppdatere, eller skrive inventar, fullføringer og avvik. De siste tre er brukerhandlinger i importen og malevisningen.

Applikasjonslaget sjekker hver skriveoperasjon før den utføres. Operasjonen avvises når den treffer et objekt utenfor arbeidsmålet, når den treffer en godkjent versjon, eller når typen ikke står i oppgavens operasjonssett. Et avvist kall endrer ingenting.

## Indirekte endringer

Et forslag kan peke på noe det har lest, uten å endre det. Godkjenning kontrollerer alle referansene i nyttelasten:

- Nye poster må høre til oppgavens arbeidsmål, eller være en ny versjon av et åpnet revisjonsmål.
- En peker til en eksisterende oppskriftsversjon, teknikkversjon, kilde eller et produkt er en lesereferanse. Den oppretter ikke en endring i det objektet.
- En ny `SourceLink` kan bare festes på poster forslaget selv skriver, ikke på en godkjent figur, oppskrift eller teknikk utenfor omfanget.
- Et katalogforslag kan ikke bære subject-id fra et annet prosjekt. En palettoppføring kan ikke peke på et annet prosjekts figurer.
- Inneholder nyttelasten en endring av et objekt utenfor arbeidsmål og revisjonsmål, avvises hele forslaget. Ingen del av det skrives.

Lesetilgang til biblioteket er dermed ikke skrivetilgang til biblioteket.

# 13. Research, godkjenning og historikk

`ResearchTask` har omfanget fra avsnitt 12, valgfritt prosjekt og subject, samtale, kontekst og mange forslag. Oppgaven kan stå åpen mens noen forslag er godkjent og andre venter.

`ResearchProposal` hører til én oppgave og har:

- resultattype: `game_identity`, `catalog_subject`, `palette_entry`, `project_method`, `reference_selection`, `paint_plan`, `technique`, `recipe` eller `plan_revision`
- nyttelast som må validere mot den typen
- `evidence` og en usikkerhetsliste med sti og grunn
- `decision`: `pending`, `approved` eller `rejected`
- leverandør og modell-id
- `baseVersionId` når forslaget er en revisjon

Én guide kan dermed gi fire forslag i samme oppgave: en flammeoppskrift, en OSL-teknikk, et utvalg referansebilder og en fargekjede. Kartlegging av mange figurer er ett forslag per figur. Mange maleplaner er ett forslag per plan. De kan gjennomgås samlet. Agenten kan fritt omarbeide forslag som fortsatt er `pending` og som ligger innenfor handlingsrommet.

## Hva som blir kanonisk

Brukeren kan kuratere nyttelasten før godkjenning. Deretter godkjenner eller avviser brukeren et utvalg. Agenten kan ikke sette `decision`. Avviste forslag skriver ingenting kanonisk. Forslag som fortsatt er `pending`, blir stående på oppgaven.

Hvert godtatt forslag godkjennes i én transaksjon. Enten skrives alle postene for det forslaget, og gjeldende versjonspeker flyttes, eller så skrives ingenting. Ett forslag som feiler, ruller ikke tilbake andre forslag brukeren godtok i samme gjennomgang. De har hver sin transaksjon.

Før skrivingen sjekker godkjenningen handlingsrommet på nytt, inkludert at ingen referanse endrer objekter utenfor omfanget. For en revisjon må `baseVersionId` fortsatt være den gjeldende godkjente versjonen. Er en nyere versjon godkjent i mellomtiden, stoppes forslaget, og den nyere versjonen blir stående. Brukeren kan be om et nytt forslag mot den nye grunnversjonen.

Godkjenning av ett forslag skriver bare dets poster:

- `game_identity` skriver `Game`, `Expansion` og `ProjectExpansion` én gang
- `catalog_subject` skriver ett `MiniatureSubject` på oppgavens prosjekt
- `palette_entry` skriver én `PaletteEntry` på oppgavens prosjekt
- `project_method` skriver én `ProjectMethod` på oppgavens prosjekt
- `reference_selection` skriver `SourceLink` til de assetene brukeren beholdt, festet på poster innenfor arbeidsmålet
- `paint_plan` skriver en ny `PaintPlanVersion`. Forrige godkjente versjon blir stående som historikk
- `technique` og `recipe` skriver en ny identitet, eller neste versjon når identiteten er et åpnet revisjonsmål og forslaget er en revisjon. En remiks er en ny identitet med lesereferanse til grunnversjonen
- `plan_revision` skriver neste planversjon for det åpnede subjectet og rører ikke `PaintCompletion` som peker på den forrige

Godkjenning stoppes for det ene forslaget hvis et materiale mangler produkt-id. Tidligere godkjente versjoner skrives ikke over. En ordinær oppgave har ingen operasjon for sletting eller masseendring av godkjente poster.

## Historikk og gjenoppretting

`ChangeRecord` skrives i samme transaksjon som den kanoniske endringen. Den har mål, fra-versjon, til-versjon, tidspunkt, hvem som initierte, og hvem som godkjente. Research har agenten og oppgaven som initiativtaker, og brukeren som den som godkjente. Handlinger i malevisningen og importen har brukeren som initiativtaker.

En transaksjon som feiler, etterlater forrige godkjente versjon som gjeldende. Brukeren kan senere peke en identitet tilbake til en eldre godkjent versjon. Det sletter ikke den nyere versjonen, og det skrives et `ChangeRecord`. Agenten kan ikke gjenopprette.

## Kontekst

`ContextRef` hører til oppgaven og peker på det agenten faktisk brukte: type, id og revisjon. Revisjonen er en versjons-id for oppskrift, teknikk og maleplan. For palett og metoder er den prosjektets innholdsrevisjon, som øker når en `PaletteEntry` eller `ProjectMethod` endres.

Når arbeidet fortsetter, sammenlignes revisjonen med gjeldende godkjente versjon. Er de like, brukes den. Er de ulike, er referansen utdatert: agenten får se både versjonen den arbeidet med, og den som gjelder nå. Den utdaterte referansen oppdateres ikke i stillhet, og samtalen er ikke prosjektets sannhet. Å se en nyere versjon gir ikke skrivetilgang til den.

# 14. Hva flatene leser

Malevisningen leser godkjente poster:

- prosjekt, subject, grouping, `physicalCount`, `inProgress` og `finishedCount`
- gjeldende godkjente planversjon, med avvik som hører til den versjonen og ennå ikke er frosset i en annen ferdigstilling
- deler og steg, med produsent, serie, eksakt navn og fargeprøve
- referansebilder via `SourceLink` og `SourceAsset`, med attribusjon til `Source`
- inventarflagg per produkt
- en deduplisert produktliste for hele planen eller valgte deler
- sist åpnede del
- for en gruppe, eventuelle `GroupProgress`-tall

«Registrer avvik» er en brukerhandling og skriver en ny `LocalDeviation`. «Marker ferdig» øker `finishedCount` og skriver `PaintCompletion`. «Planen virker ikke» er en brukerhandling som åpner et revisjonsmål for den ene planen og et `plan_revision`-forslag. Gjeldende versjon og tidligere ferdigstillinger blir stående til en ny versjon er godkjent.

Prosjektsiden leser spill, `ProjectExpansion`, palettoppføringer, metoder og subjects. Den viser planstatus og fysisk fremdrift hver for seg. Research viser oppgaven, handlingsrommet og forslagene, med status per forslag. Biblioteket viser teknikk- og oppskriftsversjoner der `decision` er `approved`. Malingssiden leser produkt, inventar og oppskriftsroller der produktet inngår.

# 15. Utenfor modellen

Ingen figur-id for like miniatyrer, ingen milliliter, ingen obligatoriske egne foto, ingen dagbok og ingen reise- eller pakkeliste. Ingen automatisk publisering fra chat til godkjent bibliotek. Ingen henting fra BoardGameGeek for å vise et spill som allerede er lagret. Ingen dokumentmotor og ingen regelmotor for palett og metoder. Valg av databasemotor, og valg av konkret krypteringsmekanisme for nøkkelen, er ikke en del av denne modellen.
