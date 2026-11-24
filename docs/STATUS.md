# Status

Hva som er bygget, hva som er sjekket, og kjente risikoer. Dette er det eneste stedet for status. Hva som skal gjøres, står i [OPPGAVER.md](OPPGAVER.md).

**Sist oppdatert:** 24. november 2026, etter O-17 (agentkolonnen).

## Helse

| Sjekk | Resultat |
|---|---|
| `npm test` | 256 tester i 21 filer går gjennom |
| `npm run build` | Typesjekk og bygg går gjennom. Vite varsler om at JavaScript-fila er over 500 kB (741 kB, 214 kB gzip) |
| Ekte tjenester | **Ikke testet.** UiB, Brave, Tavily, YouTube, Kickstarter, Gamefound og Naver er bare testet mot etterligninger, fordi skymiljøet stenger dem ute. Se «Antakelser» i [AVVIK.md](AVVIK.md) |
| BoardGameGeek | Simulert. Navn og id-er er oppdiktet |

## Bygget

Bitene kommer fra byggeplanen den første økta laget 9. november (README i «Prototype v0»). Kildedokumentene har ingen slik plan. Slik virker funksjonene: [BRUKERVEILEDNING.md](BRUKERVEILEDNING.md). Hva kildedokumentene ønsket, men som ikke er bygget, står i del C av [kilder/VURDERING.md](kilder/VURDERING.md).

| Bit | Innhold | Mangler |
|---|---|---|
| 0 Grunnmur | Domenetyper fra skjema §6, kommandolag, eksempeldata og stil fra Figma | – |
| 1 Prosjekter og spill | Nytt prosjekt med en gang («Nytt spill N»), endring av navn, år, utgiver, nettside og illustrasjon, «Finn bilde og fakta med AI», utvidelser med kobling og løsning, simulert BGG-kobling, sletting og gjenoppretting | Ekte BGG-oppslag |
| 2 Miniatyrer (delvis) | Galleri med planstatus og malefremdrift hver for seg, filtre (blant annet grunnspill og «Under arbeid»), legge til, redigere og slette | Byggeplanen fra 9. november sier ikke hva som gjenstår |
| 3 Palett (delvis) | Palett-fanen i verkstedet: malingene per miniatyr, gruppert per del, med rolle | Siden «Palett og prosess» for prosjektet er en plassholder |
| 4 Redigering av maleplanen | «Rediger planen» og «Skriv planen selv» i Maleplan-fanen lagrer en ny versjon. Den forrige blir `superseded` og endres ikke. Før en ny versjon lagres, fra deg eller fra agenten, velger du hvilke åpne avvik som bakes inn. Resten følger med som avvik. Avkrysninger og gruppetall følger med for delene som finnes i begge versjonene (O-1). Prøvd i nettleseren | – |
| 5 Painting Mode | iPad liggende: referanser på 1/3 og plan på 2/3. Felles operasjoner og deler, steg, materialer med eierstatus, blandinger, «Finn fram malingene», avvik, delen ferdig, gruppeteller, «Marker ferdig» og historikk. Avvik fra en del som er fjernet i en ny versjon, står under «Avvik for hele planen». «Planen virker ikke» ber agenten om en ny versjon, som du godkjenner i verkstedet (O-13). Prøvd i nettleseren mot en simulert modell | – |
| 6 Kilder og bilder (delvis) | «Fordel bilder» i prosjektmenyen, og kildelisten i verkstedet | En egen side for kildene |
| 7.0–7.7 Bibliotek | Teknikker og oppskrifter, søk og merkelapper, teknikken som artikkel, verkstedguide for iPad, erfaring, erfaring knyttet til en miniatyr (O-7), research med agenten og forbedring av teknikker og oppskrifter. Et plansteg kan bruke en teknikk og en oppskrift, og Painting Mode lenker til verkstedguiden (7.7, O-2). Se [BIT7-KUNNSKAP.md](BIT7-KUNNSKAP.md) | «Bruk i prosjekt» fra biblioteket (7.7 er bygget fra maleplanen) |
| 8 Simulert agent | Trolig overtatt. Den var planlagt 9. november, før det fantes AI i appen. Nå finnes en ekte agent (raden «Agent og verksted») | – |
| Agent og verksted | Agentkolonnen (Jobber nå, Venter på deg, Samtale) i prosjektet og i verkstedet, miniatyrverkstedet, bildejakt i tre faser, kartlegging av spillet og maleplan med AI. Bildefunn kan dras fra kolonnen til en miniatyr (O-17) | – |
| Malingssamlingen | Søk og filtre (eierskap, produsent og type, med typene ink, dry og air), legg til en og en (med «Fyll ut med AI»), rediger, skjul og slett for godt, fjern eksempelmalingene, import av en liste eller fil med AI, produktbilder (agenten finner, du velger), og malekjeder som oppskrifter, med oppskriftene malingen er med i | – |
| Handleliste | Malinger du ikke har fra godkjente planer, og dem du legger til selv. Prioritet, filter per prosjekt og «Kjøpt». Under «Malinger → Handleliste», og fra «Finn fram malingene» i Painting Mode | – |
| Lagring | Paintrest-serveren og datamappen `~/Paintrest`, med revisjon og sikkerhetskopier. Uten server: IndexedDB i nettleseren. Se [ARKITEKTUR.md](ARKITEKTUR.md) | Ekte database |

## Kjente risikoer

- **AI-delene er ikke testet mot de ekte tjenestene.** Svarformater, nettsøk via UiB, bilder til modellen og søketjenestene er bygget etter dokumentasjon og testet mot etterligninger.
- **Ingen innlogging.** Kjøres appen med `--host`, kan alle på samme nett bruke AI-nøkkelen gjennom serveren, men ikke lese den (avvik 10).
- **Nettvernet er laget for en lokal maskin.** Det beskytter ikke mot DNS-rebinding, og passer ikke for en delt server.
- **Hele tilstanden lagres i én fil.** Samtidige lagringer fra flere faner avvises i stedet for å slås sammen (avvik 29).
- **Avvikene i [AVVIK.md](AVVIK.md) er ikke sjekket ett for ett mot kildedokumentene.** Dokumentene som helhet er vurdert i [kilder/VURDERING.md](kilder/VURDERING.md).
- **En del kjennes igjen mellom to versjoner på navnet når agenten lager versjonen.** Gir agenten en del nytt navn, følger ikke avkrysningen og avvikene med til den delen. Avvikene havner da under «Avvik for hele planen». Agenten er bedt om å beholde navnene, men det er ikke prøvd mot UiB (avvik 42).
- **Agenten oppdager ikke om en godkjent versjon er blitt nyere** mens den jobber. Hva den brukte, lagres (`context_ref`), men leses aldri.
