# Arbeidsprosess

Slik jobber agentene på Paintrest, også når flere jobber samtidig. Beslutningen bak: [beslutninger/2026-11-24-arbeidsflyt-oppgavefil-og-push-til-main.md](beslutninger/2026-11-24-arbeidsflyt-oppgavefil-og-push-til-main.md).

Alle pusher rett til `main`. Ingenting stopper kode som ikke virker, så hver agent har ansvar for at `main` alltid går gjennom testene og bygget.

## Kort

1. Hent `main`.
2. Ta en oppgave i [OPPGAVER.md](OPPGAVER.md), og push det før du begynner.
3. Jobb i små commits.
4. Kjør testene og bygget.
5. Oppdater dokumentene.
6. Hent `main` på nytt, sjekk igjen, og push til `main`.

## 1. Hent main

```bash
git fetch origin
git rebase origin/main
```

Har økta fått en egen branch (`claude/…`), kan du jobbe i den lokalt, men du leverer til `main` (steg 6). Arbeid som bare ligger i en branch, finnes ikke for de andre agentene.

## 2. Ta en oppgave

- Ta bare oppgaver med status `ledig`. Ta den øverste ledige i ukeplanen øverst i OPPGAVER.md, i et spor ingen andre jobber i. Står oppgaven ikke i ukeplanen, spør brukeren først.
- Ikke ta en oppgave som berører de samme filene som en oppgave som pågår. Se «Berører».
- Sett status til `pågår (hvem, dato)`. «Hvem» er tittelen på økta, eller lenken til den.
- Commit og push det med en gang, før du begynner på selve arbeidet. Da ser de andre agentene at oppgaven er tatt.
- Avvises pushen, har noen andre endret `main`. Kjør `git pull --rebase origin main`. Har noen tatt den samme oppgaven, la den være og velg en annen.
- Én oppgave om gangen per agent.

## 3. Jobb

- Små commits, som hver for seg går gjennom testene. Commit-meldingen er på norsk, og første linje sier hva som er endret.
- Hold deg til oppgaven. Ser du noe annet som bør gjøres, legg det til i OPPGAVER.md som en ny oppgave.
- Er noe et produktvalg, spør brukeren. Skriv svaret som en beslutning (se steg 5).
- Bryter arbeidet med et prinsipp i del A av [kilder/VURDERING.md](kilder/VURDERING.md), spør brukeren før du gjør det. Kildedokumentene er historisk grunnlag. Bruk dem til å forstå intensjonen, men følg beslutningene når de sier noe annet.
- Ny oppførsel får tester.

## 4. Sjekk

```bash
npm test
npm run build
```

Begge må gå gjennom. `npm run build` gjør også typesjekken.

- Endrer du noe brukeren ser, prøv det i nettleseren. Playwright og Chromium er installert i skymiljøet.
- Si hva som er testet og hvordan. Skymiljøet når ikke UiB, Brave, Tavily og de andre tjenestene. Det som bare er testet mot etterligninger, skal det stå at det er.

## 5. Oppdater dokumentene

Dokumentene oppdateres i samme push som koden. Hvert tema har ett dokument:

| Når | Oppdater |
|---|---|
| En funksjon er ny eller endret | [BRUKERVEILEDNING.md](BRUKERVEILEDNING.md) og [STATUS.md](STATUS.md) |
| En oppgave er ferdig | [OPPGAVER.md](OPPGAVER.md): status `ferdig (dato, commit)` |
| Brukeren bestemmer noe | Ny fil i [beslutninger/](beslutninger/), se malen under |
| Koden avviker fra kildedokumentene | Nytt punkt i [AVVIK.md](AVVIK.md), med neste ledige nummer |
| Noe er antatt om en ekstern tjeneste | «Antakelser» i [AVVIK.md](AVVIK.md) |
| Kodestruktur, lagring eller nøkler endres | [ARKITEKTUR.md](ARKITEKTUR.md) |
| Noe i del A eller C av vurderingen er bygget eller avgjort | «I dag» i [kilder/VURDERING.md](kilder/VURDERING.md) |

Står noe to steder, eller motsier et dokument koden, er dokumentet feil. Rett det.

En beslutning skrives aldri om til å si noe annet. Kommer en ny beslutning, skriv en ny fil, og sett «Status» i den gamle til «erstattet av …».

## 6. Push til main

```bash
git fetch origin
git rebase origin/main
npm test && npm run build    # på nytt hvis noe nytt kom inn fra main
git push origin HEAD:main
```

- Aldri `--force` mot `main`, og aldri skriv om historikk som er pushet.
- Konflikt i OPPGAVER.md eller AVVIK.md: behold begges endringer. Har to oppgaver eller punkter fått samme nummer, gi ditt det neste ledige.
- Avvises pushen til `main` med 403 eller en annen regel, push til din egen branch og si fra til brukeren. Ikke prøv å komme rundt regelen.

## Når du er ferdig

- Sett oppgaven til `ferdig (dato, commit)`.
- Si til brukeren hva som er gjort, hva som er testet, og hva som ikke er testet.
- Skymiljøet får ikke slette brancher på GitHub. Har du pushet en egen branch, si hvilken som kan slettes.

## Maler

### Oppgave

```markdown
### O-<nr> <Tittel>

- **Status:** ledig
- **Avhenger av:** –
- **Berører:** <mapper eller filer>
- **I dag:** <hvordan det er nå>
- **Ferdig når:** <hva som skal være sant når oppgaven er ferdig>
```

### Beslutning

Filnavn: `docs/beslutninger/ÅÅÅÅ-MM-DD-kort-navn.md`.

```markdown
# <Beslutningen i én setning>

- **Dato:** <dag. måned år>
- **Status:** gjelder

## Beslutning

<Hva brukeren har bestemt.>

## Følger

<Hva det betyr for koden og dokumentene. Lenke til punkt i AVVIK.md hvis det finnes.>
```
