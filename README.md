# Paintrest – prototype v0

Klikkbar første versjon av Paintrest. Den skal gi en følelse av verktøyet, og koden skal kunne bygges videre på.

**Førende dokumenter:** produktspesifikasjon v2.0, datamodell v3 og «Paintrest – databaseskjema og arkitektur». Figma-filen gir visuell retning.

## Kom i gang

```bash
npm install
npm run dev
```

Åpne adressen Vite skriver ut. Slik åpner du appen på iPad på samme nett:

```bash
npm run dev -- --host
```

Bruk så LAN-adressen Vite viser.

```bash
npm test          # kommandolaget: versjoner, avvik, ferdigstilling, BGG-kobling
npm run build     # typesjekk og produksjonsbygg til dist/
```

Ved første start får appen eksempeldata: prosjektet Avalon med fire figurer og ferdige maleplaner for Merlin og Druid Champions. «⋯ → Tilbakestill eksempeldata» setter dataene tilbake.

## Dette er med

| Bit | Innhold |
|---|---|
| 0 Grunnmur | Domenetyper fra skjema §6, kommandolag, lokal lagring i IndexedDB, eksempeldata og stil fra Figma |
| 1 Prosjekter og spill | Nytt prosjekt med en gang («Nytt spill N»), endring av navn, år, utgiver og illustrasjon, utvidelser med kobling og løsning, simulert BGG-kobling, sletting og gjenoppretting |
| 2 (delvis) Miniatyrer | Galleri med planstatus og malefremdrift hver for seg, filtre, legge til, redigere og slette |
| 5 Painting Mode | iPad liggende: referanser på 1/3 og plan på 2/3. Felles operasjoner og deler, steg, materialer med eierstatus, blandinger, «Finn fram malingene», avvik, delen ferdig, gruppeteller, «Marker ferdig» og historikk |

Neste: bit 3 (maling og palett), bit 4 (redigering av maleplanen), bit 6 (kilder), bit 7 (kunnskap) og bit 8 (simulert agent).

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
