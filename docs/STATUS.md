# Status

Hva som er bygget, hva som er sjekket, og kjente risikoer. Dette er det eneste stedet for status. Hva som skal gjøres, står i [OPPGAVER.md](OPPGAVER.md).

**Sist oppdatert:** 24. november 2026, etter oppryddingen.

## Helse

| Sjekk | Resultat |
|---|---|
| `npm test` | 221 tester i 17 filer går gjennom |
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
| 4 Redigering av maleplanen | Ikke bygget. Beslektet: agentens planforslag kan redigeres før godkjenning, og agenten kan foreslå nye versjoner av en godkjent plan | Du kan ikke redigere en godkjent plan selv. «Lag maleplan» på miniatyrkortet lager en tom versjon 1 |
| 5 Painting Mode | iPad liggende: referanser på 1/3 og plan på 2/3. Felles operasjoner og deler, steg, materialer med eierstatus, blandinger, «Finn fram malingene», avvik, delen ferdig, gruppeteller, «Marker ferdig» og historikk | – |
| 6 Kilder og bilder (delvis) | «Fordel bilder» i prosjektmenyen, og kildelisten i verkstedet | En egen side for kildene |
| 7.0–7.6 Bibliotek | Teknikker og oppskrifter, søk og merkelapper, teknikken som artikkel, verkstedguide for iPad, erfaring, research med agenten og forbedring av teknikker. Se [BIT7-KUNNSKAP.md](BIT7-KUNNSKAP.md) | 7.7 «Bruk i prosjekt». Oppskrifter kan ikke forbedres med agenten. Erfaring knyttes ikke til en miniatyr |
| 8 Simulert agent | Trolig overtatt. Den var planlagt 9. november, før det fantes AI i appen. Nå finnes en ekte agent (raden «Agent og verksted») | – |
| Agent og verksted | Agentpanelet, miniatyrverkstedet, bildejakt i tre faser, kartlegging av spillet og maleplan med AI | – |
| Malingssamlingen | Søk og filtre (eierskap, produsent og type, med typene ink, dry og air), legg til en og en (med «Fyll ut med AI»), rediger, skjul og slett for godt, fjern eksempelmalingene, og import av en liste eller fil med AI | Produktbilder og malekjeder |
| Lagring | Paintrest-serveren og datamappen `~/Paintrest`, med revisjon og sikkerhetskopier. Uten server: IndexedDB i nettleseren. Se [ARKITEKTUR.md](ARKITEKTUR.md) | Ekte database |

## Kjente risikoer

- **AI-delene er ikke testet mot de ekte tjenestene.** Svarformater, nettsøk via UiB, bilder til modellen og søketjenestene er bygget etter dokumentasjon og testet mot etterligninger.
- **Ingen innlogging.** Kjøres appen med `--host`, kan alle på samme nett bruke AI-nøkkelen gjennom serveren, men ikke lese den (avvik 10).
- **Nettvernet er laget for en lokal maskin.** Det beskytter ikke mot DNS-rebinding, og passer ikke for en delt server.
- **Hele tilstanden lagres i én fil.** Samtidige lagringer fra flere faner avvises i stedet for å slås sammen (avvik 29).
- **Avvikene i [AVVIK.md](AVVIK.md) er ikke sjekket ett for ett mot kildedokumentene.** Dokumentene som helhet er vurdert i [kilder/VURDERING.md](kilder/VURDERING.md).
- **En ny planversjon skjuler åpne avvik, avkrysninger og gruppetall i Painting Mode.** Det gjelder versjonene agenten lager. Dataene blir liggende, men vises ikke. Funnet ved å lese koden, ikke prøvd i appen. Rettes i O-1.
- **Agenten oppdager ikke om en godkjent versjon er blitt nyere** mens den jobber. Hva den brukte, lagres (`context_ref`), men leses aldri.
