# Paintrest

Paintrest er et verktøy for å planlegge og male miniatyrer til brettspill: prosjekter per spill, maleplaner og Painting Mode for iPad, en malingssamling, et bibliotek med teknikker og oppskrifter, og en researchagent som finner bilder, kilder og maleguider.

Dette er en klikkbar prototype. Den skal gi en følelse av verktøyet, og koden skal kunne bygges videre på.

**Agenter:** les [CLAUDE.md](CLAUDE.md) før du gjør noe.

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
npm test          # kommandolaget, agentens forslag og kontroller, malingsimporten, biblioteket og serveren
npm run build     # typesjekk og produksjonsbygg til dist/
```

Ved første start får appen eksempeldata: prosjektet Avalon med fire figurer og maleplaner for Merlin og Druid Champions, et tomt prosjekt («Nytt spill 1») og én eksempelteknikk i biblioteket. Eksempeldataene har ingen malinger: malingssamlingen er din egen (se «Malingssamlingen» i [brukerveiledningen](docs/BRUKERVEILEDNING.md)). «⋯ → Tilbakestill eksempeldata» setter dataene tilbake, men beholder malingssamlingen. Du må skrive «tilbakestill» for å bekrefte, og serveren tar en sikkerhetskopi først.

Dataene ligger i `~/Paintrest`, og AI-nøkkelen legges inn under «⋯ → Innstillinger». Se [ARKITEKTUR.md](docs/ARKITEKTUR.md).

## Dokumentene

Hvert tema har ett dokument. Står noe to steder, er det en feil.

| Dokument | Hva det svarer på |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Reglene alle agenter følger |
| [docs/PROSESS.md](docs/PROSESS.md) | Hvordan vi jobber: oppgaver, commits, testing og push |
| [docs/OPPGAVER.md](docs/OPPGAVER.md) | Hva som skal gjøres, og hvem som gjør det |
| [docs/STATUS.md](docs/STATUS.md) | Hva som er bygget, hva som er sjekket, og kjente risikoer |
| [docs/beslutninger/](docs/beslutninger/) | Brukerens beslutninger, én fil per beslutning |
| [docs/kilder/](docs/kilder/README.md) | Det opprinnelige grunnlaget (produktspesifikasjon, datamodell og databaseskjema), og en vurdering av hva som fortsatt gjelder. Historisk grunnlag, ikke fasit |
| [docs/AVVIK.md](docs/AVVIK.md) | Hvor prototypen avviker fra kildedokumentene, og antakelser som ikke er bekreftet |
| [docs/BRUKERVEILEDNING.md](docs/BRUKERVEILEDNING.md) | Slik virker appen |
| [docs/ARKITEKTUR.md](docs/ARKITEKTUR.md) | Kodestruktur, lagring og AI-nøkkel |
| [docs/BIT7-KUNNSKAP.md](docs/BIT7-KUNNSKAP.md) | Datamodellen for biblioteket, og byggeplanen for bit 7 (ferdig til og med 7.6) |
