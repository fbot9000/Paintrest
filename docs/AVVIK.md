# Avvik og antakelser i prototypen

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

## Antakelser

- **Klient:** React og TypeScript som webapp med hash-ruting. Det er godkjent av brukeren 9. november 2026.
- **Lagring:** All data ligger lokalt i nettleseren (IndexedDB). Det finnes ingen synkronisering mellom enheter.
- **UiB-API-et:** Adresse, endepunkter og Bearer-autentisering er oppgitt av brukeren. Svarformatet (`data[].id` fra `/models`, og `output[].content[].text` eller `output_text` fra `/responses`) følger OpenAI-konvensjonen. Det er ikke testet mot UiB, fordi nettverket i utviklingsmiljøet blokkerte adressen. Testene bruker en simulert tjeneste.
- **BGG:** Oppslaget er simulert. Navnene og thing-id-ene (9000xx) er oppdiktet.
- **Eksempeldata:** Spillet og kildene er plassholdere hentet fra Figma. Fargene på fargeprøvene er tilnærminger. Malingsnavnene er Citadel-produkter. Det er ikke sjekket om navnene er i produksjon i dag.
- **Skrift:** DM Serif Display, DM Sans og DM Mono, lastet fra Google Fonts. Valget er gjort ut fra skjermbildene i Figma og ikke kontrollert mot filen.

## Ikke bygget ennå

- Redigering av maleplanen (bit 4). «Lag maleplan» lager bare en tom versjon 1.
- Palett, kilder, kunnskap og agentpanel.
- Ny planversjon ved redigering. Det kommer i bit 4, og der blir problemet med fremdrift og avvik på tvers av versjoner synlig.
