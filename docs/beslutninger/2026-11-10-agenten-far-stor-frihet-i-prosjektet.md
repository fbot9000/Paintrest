# Agenten får stor frihet inne i prosjektet

- **Dato:** 10. november 2026
- **Status:** gjelder. Utvidet samme dag av [agenten endrer direkte, med angre](2026-11-10-agenten-endrer-direkte-med-angre.md)

## Beslutning

Mens et prosjekt settes opp, kan agenten foreslå å lage, endre, dele, slå sammen og slette miniatyrer (`catalog_change`). Den kan også foreslå nye versjoner av godkjente maleplaner (`plan_revision`) uten at brukeren først åpner planen som revisjonsmål.

## Det som står fast

- Hvert forslag godkjennes i én transaksjon.
- En ny planversjon stopper hvis planen er endret siden forslaget ble laget.
- Sletting skjuler bare. Deling og sammenslåing lager nye miniatyrer og skjuler originalene.
- Agenten kan ikke røre noe utenfor arbeidsprosjektet.

## Detaljer

Avvik 27 i [AVVIK.md](../AVVIK.md). Kildedokumentene bør oppdateres: skjema §3 og §7, og datamodell v3 §12.
