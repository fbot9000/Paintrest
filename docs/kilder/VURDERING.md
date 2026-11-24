# Vurdering av kildedokumentene

Gjort 24. november 2026, mot koden på `main` og brukerens beslutninger. «I dag» er oppdatert samme dag, etter at O-1, O-2, O-5, O-13, O-14, O-15 og O-16 var ferdige. Gjelder:

- [produktspesifikasjon-v2.0.md](produktspesifikasjon-v2.0.md) (8. november, filnavn «hovedkonsept»), kalt **spec** under
- [datamodell-v3.md](datamodell-v3.md) (8. november), kalt **datamodell** under
- [databaseskjema-og-arkitektur.md](databaseskjema-og-arkitektur.md) (9. november), kalt **skjema** under

## Hvordan dokumentene brukes

Dokumentene er tidlige tanker. Prosjektet har utviklet seg siden, med nye prioriteringer, funksjoner og behov. De skal ikke ha for mye autoritet, men det viktige i dem skal ikke glemmes. Derfor:

- **Koden og testene** viser hva som finnes.
- **Brukerens beslutninger** ([beslutninger/](../beslutninger/)) går foran dokumentene.
- **Prinsippene i del A** er det viktigste å ta vare på. De er et forslag til brukeren og ikke bekreftet ennå (B-5 i [OPPGAVER.md](../OPPGAVER.md)). Vil du gjøre noe som bryter med et av dem, spør brukeren først.
- **Ønskene i del C** er kandidater, ikke oppgaver. De blir oppgaver først når brukeren sier ja.
- **De tre originaldokumentene oppdateres ikke.** Spec §10 sier at nye avklaringer skal skrives inn i dokumentet. Det gjelder ikke lenger: nye avklaringer blir beslutninger.
- **Denne vurderingen oppdateres.** Når noe i del A eller C er bygget eller avgjort, rettes kolonnen «I dag».

Bitene i [STATUS.md](../STATUS.md) (bit 0–8) står ikke i dokumentene. De kommer fra byggeplanen den første økta laget 9. november. Spec §9 sier tvert imot at det ikke finnes noen «vedtatt MVP-inndeling, utviklingsfaser, implementasjonsrekkefølge».

## A. Prinsipper som fortsatt ser ut til å gjelde

| # | Prinsipp | Kilde | I dag |
|---|---|---|---|
| A1 | **Appen kan brukes fullt ut uten AI.** Brukeren har full kontroll over egne data. | skjema §1, §11 | Gjelder. Siden 24. november kan du også redigere en godkjent maleplan selv (O-1) |
| A2 | **Brukeren tar de endelige kreative valgene, og ingenting skjer i det skjulte.** | spec §1, §4 | Gjelder i en ny form: agenten endrer direkte i prosjektet, men alt vises og kan angres ([beslutningen](../beslutninger/2026-11-10-agenten-endrer-direkte-med-angre.md)). Biblioteket, katalogen og andre prosjekter endres bare med brukerens godkjenning |
| A3 | **Eksakte malingsprodukter i konkrete oppskrifter og maleplaner.** En fargebetegnelse erstatter aldri produktet. | spec §1, datamodell §2, §13 | Gjelder: en plan med maling som ikke finnes i katalogen, kan ikke godkjennes før malingen er koblet eller opprettet som ubekreftet |
| A4 | **Skill kildegrunnlag, antakelser, godkjente valg og erfaring.** Tre felt, ikke ett statusfelt. | spec §1, §6 | Gjelder i biblioteket (`evidence`, status, erfaring) og i research («Vist i kilde» eller «Forslag fra agenten») |
| A5 | **Agenten dikter ikke opp.** Den finner ikke på malingnavn, og later ikke som den har sett noe den ikke har tilgang til. Et miniatyrbilde av en video betyr ikke at agenten har sett videoen. | spec §1, §4 | Gjelder: serveren fjerner kilder og bilder agenten ikke har åpnet eller funnet i et søk, og instruksen sier at agenten ikke kan se videoene |
| A6 | **En godkjent plan endres aldri i stillhet, og planen som ble brukt, bevares.** | spec §5, datamodell §9 | Gjelder: planer har versjoner, en ny versjon stopper hvis planen er endret i mellomtiden, og «Marker ferdig» lagrer avvikene som gjaldt (`deviation_snapshot`) |
| A7 | **Planfremdrift og malefremdrift er to ting.** | spec §3 | Gjelder: galleriet viser dem hver for seg |
| A8 | **Minst mulig administrasjon.** Ingen obligatoriske egne bilder, ingen id per figur i en gruppe, ingen stegkvittering. | spec §1, §5, §9 | Gjelder: grupper har én teller, og avkrysning er frivillig |
| A9 | **Gjenbruk er en grunnverdi.** Teknikker og oppskrifter er globale og tilgjengelige for alle prosjekter. | spec §1, §6 | Gjelder: biblioteket er globalt |
| A10 | **Research på stor skjerm, maling på iPad.** Painting Mode viser beslutningene, ikke nye AI-valg. | spec §1, §2, §5 | Gjelder: verkstedet bruker hele skjermen, og Painting Mode er laget for iPad liggende |
| A11 | **API-nøkkelen er kryptert, og agenten kan aldri lese den.** | datamodell §2, §4, skjema §5, §10 | Gjelder: AES-256-GCM, og bare `server/provider.ts` bruker den dekrypterte nøkkelen |
| A12 | **Endringer har historikk.** `change_record` skrives i samme transaksjon som endringen. | skjema §2, §5 | Gjelder |
| A13 | **Nye objekter kan være ufullstendige, med automatisk navn.** | skjema §1 | Gjelder: «Nytt spill 1», ny teknikk og ny oppskrift opprettes tomme |

## B. Overtatt av senere beslutninger

| Dokumentene sier | Kilde | Gjelder nå |
|---|---|---|
| Agenten skriver bare utkast. Alt blir kanonisk først når brukeren godkjenner. | datamodell §3, §12, §13, skjema §2, §8 | Agenten endrer direkte i prosjektet, med angre ([beslutningen](../beslutninger/2026-11-10-agenten-endrer-direkte-med-angre.md)) |
| Agenten kan bare foreslå en ny versjon av et objekt brukeren har åpnet som revisjonsmål. | datamodell §10, §12, skjema §3, §7 | Ikke inne i prosjektet ([beslutningen](../beslutninger/2026-11-10-agenten-far-stor-frihet-i-prosjektet.md)) |
| Teknikker og oppskrifter har versjoner, og en godkjent versjon endres ikke. | datamodell §10, skjema §6 «Kunnskap» | Ingen versjoner, og «godkjent» er et merke ([beslutningen](../beslutninger/2026-11-11-biblioteket-er-ikke-last.md)) |
| PostgreSQL bak et applikasjonslag. | skjema §4, §6 | En fast datamappe som mellomsteg ([beslutningen](../beslutninger/2026-11-10-fast-datamappe.md)) |
| Ingen valgt klientteknologi. | skjema §11 | React og TypeScript ([beslutningen](../beslutninger/2026-11-09-klient-react-og-typescript.md)) |
| Agenten bruker aktivt kjent eierstatus for malinger. | spec §4 | Eierstatus styrer ikke valget i det skjulte. Du velger selv ([beslutningen](../beslutninger/2026-11-11-du-velger-malingene-selv.md)) |
| Nye avklaringer skrives inn i spesifikasjonen. | spec §10 | Nye avklaringer blir beslutninger ([beslutningen](../beslutninger/2026-11-24-kildedokumentene-er-historisk-grunnlag.md)) |

## C. Ønsket i dokumentene, men ikke bygget

Kandidater, ikke oppgaver. «Ikke i koden» betyr at begrepet ikke finnes i `src/` eller `server/`.

| # | Ønske | Kilde | I dag |
|---|---|---|---|
| C1 | **Rediger en godkjent maleplan selv, og få en ny versjon.** Grunnkravet om full manuell kontroll (A1). | skjema §1, §6 «Maleplan» | Bygget 24. november (O-1) |
| C2 | **«Planen virker ikke» i Painting Mode** åpner målrettet research for én plan. | spec §5, datamodell §14 | Bygget 24. november (O-13). Se avvik 44 |
| C3 | **Handleliste** med prioritet (nødvendig, anbefalt, ønskeliste). Et kjøp registreres som eid. | spec §6C, datamodell §5, skjema `shopping_need` | Bygget 24. november (O-14). Knappen i Painting Mode gjenstår (O-18) |
| C4 | **«Maleklar»:** referanser, malinger og instrukser er avklart. Maling som ikke er kjøpt, vises som et eget tilgjengelighetsproblem. | spec §3 | Ikke i koden. Sonen «Ferdig» venter på en beslutning (avvik 28) |
| C5 | **Import av malinger fra bilder** (hyllefoto), der bildene kan slettes etterpå. | spec §6C, datamodell §5 | Bare tekst og filer (CSV, xlsx, JSON, HTML) |
| C6 | **Remiks av en oppskrift** til en ny farge uten å endre originalen. | spec §6B, datamodell §10 | Ikke i koden |
| C7 | **Start fra én maling du eier** og finn shade, layer og highlight. | spec §6B, §8 | Bygget 24. november (O-16). Agenten lager et utkast til oppskrift fra én maling |
| C8 | **Løft en teknikk eller oppskrift fra et prosjekt inn i biblioteket**, og hent metoder ut av figurbundne guider. | spec §6 | Prosjektoppgaver kan ikke foreslå bibliotekinnhold |
| C9 | **Lagre en video nå, og «trekk ut metode» eller «lag oppskrift» senere.** | spec §4 | Videoer lagres som lenker, men det finnes ingen uttrekking |
| C10 | **Prosjektpalett med omfang** (prosjekt, utvidelse, kategori) og **metoder for prosjektet.** | spec §3, datamodell §8 | Bare palett per miniatyr. `project_method` finnes bare som type. Oppgave O-3 |
| C11 | **Agenten ser om en godkjent versjon er nyere** enn den den jobbet med. | datamodell §2, §13 «Kontekst» | Halvveis: `context_ref` skrives, men leses aldri |
| C12 | **Gjennomgå og godkjenne mange planer effektivt.** | spec §3, §8 | Delvis: «Godkjenn alle» i agentpanelet, og gjennomgang av bildeforslag etter kartleggingen |
| C13 | **Ekte BoardGameGeek-oppslag.** | datamodell §6, skjema §10 | Simulert |
| C14 | **Alternativer til malinger du ikke har**, med begrunnelse (dekkevne, finish, bruk). | spec §6C | Ikke sjekket |

## D. Antakelser i dokumentene som ikke gjelder prototypen

- **Fysisk sletting når objektet ikke har historisk bruk** (skjema §6 «Sletting»). Prototypen skjuler alltid, unntatt malinger (avvik 2).
- **Applikasjonslaget er eneste skrivesti, og klientene har ingen databasetilgang** (skjema §4). I prototypen kjører kommandolaget i nettleseren, og serveren lagrer hele tilstanden (avvik 12 og 29).
- Resten av forskjellene på feltnivå står i [AVVIK.md](../AVVIK.md). Punktene der er ikke sjekket ett for ett mot dokumentene.

## E. Det dokumentene selv lot stå åpent

Spec §9 lot dette stå åpent, og det er fortsatt åpent: rekkefølge og faser, endelig navigasjon, hvordan mange planer godkjennes, agentens ressursgrenser, hvilke produktkataloger og importmetoder som kan støttes, og visuell identitet.
