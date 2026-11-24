# Dataene ligger i en fast datamappe

- **Dato:** 10. november 2026
- **Status:** gjelder til en ekte database er valgt

## Beslutning

Paintrest-serveren eier dataene, i `~/Paintrest`: `data.json` (hele tilstanden, med revisjonsnummer), `files/` (bildene) og `backups/` (de 30 siste kopiene). Da ser du de samme dataene uansett port, nettleser eller fane.

## Følger

- Dette er et filbasert mellomsteg før en ekte database. Valget av database og tilgang fra iPad utenfor maskinen er ikke tatt.
- En lagring som bygger på en gammel revisjon, avvises, og appen ber brukeren laste inn på nytt.
- Bilder slettes aldri. Fjernede bilder flyttes til `files/trash/`.

## Detaljer

Avvik 29 i [AVVIK.md](../AVVIK.md), og «Lagring» i [ARKITEKTUR.md](../ARKITEKTUR.md).
