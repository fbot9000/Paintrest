# Arkitektur og drift

Hvordan koden er bygd opp, hvor dataene ligger, og hvordan AI-nøkkelen beskyttes.

## Kodestruktur

```
src/domain/types.ts      tabellene fra skjema §6 (snake_case, samme navn)
src/domain/commands.ts   brukerkommandoene: grensesnittet skjermene skriver gjennom
src/domain/views.ts      lesefunksjoner (skjema §9)
src/domain/shopping.ts   handlelisten: hva som står på den, regnet ut fra planene og shopping_need
src/domain/research.ts   kommandoene for agentens oppgaver og forslag
src/domain/plan-versions.ts   hvilke deler og steg som er de samme i to planversjoner, og å bake inn et avvik
src/data/plan-version.ts  skriver en ny planversjon (brukerens og agentens), med avvik og fremdrift
src/data/local-*.ts      v0-implementasjon av kommandolaget (også knowledge- og shopping-commands.ts)
src/data/research-commands.ts   sjekker omfanget og godkjenner forslag (kjører i nettleseren)
src/data/server-persistence.ts  lagring gjennom Paintrest-serveren, med revisjon
src/data/seed.ts         eksempeldata
src/app/runs.ts          agentkjøringene, som fortsetter når du bytter fane eller side
src/features/*           skjermene
src/ui/*                 komponenter og stil
server/                  Paintrest-serveren: datamappen, nøklene, modellkall, nettsøk, sidehenting og agenten
```

Skjermene skriver aldri rett til data. De kaller `Commands`. Senere erstattes `createLocalCommands` med en klient mot applikasjonslaget og PostgreSQL. Typer, kommandogrensesnitt, lesefunksjoner og skjermer kan stå som de er.

Hver kommando kjører som én transaksjon og skriver `change_record` med `initiated_by = user`. Hvis kommandoen feiler, endres ingenting.

Avvik fra dokumentene og antakelser står i [AVVIK.md](AVVIK.md).

## Maleplan: nye versjoner

En godkjent planversjon endres aldri. En endring blir en ny versjon, og den forrige får `state = superseded`. Alle nye versjoner skrives av `writePlanVersion` i `src/data/plan-version.ts`, både når du lagrer «Rediger planen» (`savePlanVersion`) og når et forslag fra agenten godkjennes.

- **Samme del i to versjoner:** delen den ble redigert fra (`from_element_id`), ellers samme type og samme navn. **Samme steg:** steget det ble redigert fra (`from_step_id`), ellers samme instruks i samme del. Regelen står i `matchVersion` i `src/domain/plan-versions.ts`.
- **Det som følger med:** åpne avvik du ikke baker inn (kopieres, med `carried_from_id`), avkrysninger (`part_progress`) og gruppetall (`group_progress`).
- **Det som ikke endres:** den gamle versjonens deler og steg, forseglede avvik og `paint_completion`.
- Detaljene og hva som er antatt, står i avvik 42 i [AVVIK.md](AVVIK.md).

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

## Tester på GitHub

`.github/workflows/tester.yml` kjører `npm ci`, `npm test` og `npm run build` med Node 22 ved hver push til `main`, ved pull requests og når den startes for hånd. Resultatet står ved hver commit på GitHub, og under «Actions».

## Bygg for innebygd forhåndsvisning

Noen verter tillater bare en enkel `#navn` i adressen. Bygg da med minneruting:

```bash
VITE_ROUTER=memory npm run build
```
