# Regler for agenter i Paintrest

Gjelder alle økter, også når flere agenter jobber samtidig. Les [docs/PROSESS.md](docs/PROSESS.md) før du begynner på en oppgave.

## Språk

- Snakk norsk (bokmål) med brukeren.
- Kode, navn og kodekommentarer skrives på engelsk, som i dag.
- Dokumentene, tekst i appen og commit-meldinger skrives på norsk.

## Hvor sannheten står

| Spørsmål | Svaret står i |
|---|---|
| Hva skal gjøres, og hvem gjør det? | [docs/OPPGAVER.md](docs/OPPGAVER.md) |
| Hva er bygget? | [docs/STATUS.md](docs/STATUS.md) |
| Hva har brukeren bestemt? | [docs/beslutninger/](docs/beslutninger/) |
| Hva skal produktet være? | [docs/kilder/](docs/kilder/) |
| Hvor avviker koden fra kildedokumentene? | [docs/AVVIK.md](docs/AVVIK.md) |
| Hvordan virker appen? | [docs/BRUKERVEILEDNING.md](docs/BRUKERVEILEDNING.md) |
| Hvordan er koden bygd opp? | [docs/ARKITEKTUR.md](docs/ARKITEKTUR.md) |

Koden og testene er fasiten for hva som finnes. Motsier et dokument koden, er dokumentet feil: rett det i samme push. En beslutning fra brukeren går foran kildedokumentene.

## Arbeidsflyt

- **Du pusher rett til `main`.** Brukeren har bestemt det 24. november 2026 ([beslutningen](docs/beslutninger/2026-11-24-arbeidsflyt-oppgavefil-og-push-til-main.md)). Dette er brukerens uttrykkelige tillatelse til å pushe til `main`, også når økta har fått en egen `claude/…`-branch. Aldri `--force` mot `main`.
- **Ta en oppgave i OPPGAVER.md, og push det før du begynner.** Ta ikke en oppgave som er `pågår`.
- **Før hver push:** `git rebase origin/main`, deretter `npm test` og `npm run build`. Begge må gå gjennom.
- **Dokumentene oppdateres i samme push som koden.** Tabellen i PROSESS.md viser hvilke.

## Spør brukeren

- før du tar en oppgave, så lenge rekkefølgen i OPPGAVER.md ikke er satt
- når noe er et produktvalg. Skriv svaret som en beslutning i `docs/beslutninger/`
- før du sletter data, kode du ikke har skrevet, eller noe som ikke kan angres

## Det du må vite om miljøet

- Skymiljøet når ikke UiB, Brave, Tavily, YouTube, Kickstarter, Gamefound eller Naver. AI-delene er bare testet mot etterligninger. Si det, og ikke påstå noe annet.
- Skymiljøet får ikke slette brancher på GitHub. Si fra til brukeren hvilke brancher som kan slettes.
- Appens egen agent har egne regler: [grunnreglene for agentens frihet](docs/beslutninger/2026-11-10-grunnregler-for-agentens-frihet.md).
