# Ny planversjon: avvikene kan bakes inn, og fremdriften følger med

- **Dato:** 24. november 2026
- **Status:** gjelder

## Beslutning

Når en maleplan får en ny versjon, enten du redigerer den selv eller agenten lager den:

- Før den nye versjonen lagres, ser du de åpne avvikene fra Painting Mode. Du velger hvilke som skal bli en del av planen. Resten følger med som avvik på den nye versjonen.
- Avkrysninger og gruppetall følger med for de delene som finnes i begge versjonene.

## Bakgrunn

I dag får en ny versjon nye id-er på delene og stegene, og Painting Mode viser bare avvik og fremdrift for gjeldende versjon. Ut fra koden forsvinner da åpne avvik, avkrysninger og gruppetall fra visningen. Dataene blir liggende, men vises ikke. Det bryter med at en godkjent plan aldri endres i stillhet (prinsipp A6 i [kilder/VURDERING.md](../kilder/VURDERING.md)).

## Følger

- Gjelder oppgave O-1 i [OPPGAVER.md](../OPPGAVER.md), og retter også versjonene agenten lager.
- Forseglede avvik og `paint_completion` endres ikke. De hører til versjonen som ble malt.
