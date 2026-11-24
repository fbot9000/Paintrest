# Arbeidsflyt: oppgavefil og push rett til main

- **Dato:** 24. november 2026
- **Status:** gjelder

## Beslutning

Flere agenter jobber på Paintrest samtidig. Oppgavene står i [OPPGAVER.md](../OPPGAVER.md). Agentene pusher direkte til `main` etter at testene og bygget går gjennom lokalt.

## Vurderte alternativer

- GitHub-issues og PR til `main`, med tester i CI før sammenslåing (anbefalt av Claude: issues kolliderer ikke, og ingenting kommer inn i `main` uten kontroll).
- Oppgavefil og PR til `main`.

## Følger

- Ingenting stopper kode før den havner i `main`. Hver agent må selv kjøre testene og bygget før push.
- Når to agenter endrer samme fil, kommer konflikten fram når den siste henter `main` før push.
- Hvordan dette gjøres, står i [PROSESS.md](../PROSESS.md).
