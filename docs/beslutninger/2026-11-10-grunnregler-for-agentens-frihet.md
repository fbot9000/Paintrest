# Grunnregler for agentens frihet

- **Dato:** 10. november 2026
- **Status:** gjelder

Agenten skal ha mye frihet. Dokumentene er for strenge på dette punktet. To ting skal likevel alltid gjelde:

1. **Ingen skade på det som ikke hører til oppgaven.** Agenten endrer bare i prosjektet den jobber i. Andre spill, deres miniatyrer, planer og kilder, malingskatalogen og biblioteket (teknikker og oppskrifter) endres ikke. Agenten kan bare foreslå endringer der.
   - **Håndheves av:** `checkScope` (alle forslag), `needsUser` (katalogen) og `sourceBelongsTo`. Den siste sørger for at oversettelser og sammendrag bare legges på kilder som hører til prosjektet.
   - **Unntak:** gjenbrukes en nettside som et annet spill også har lagret, deles kilde-raden. Den kan få en ny lenke og bli markert som lagret, men innholdet endres ikke.
2. **Ingenting skjer i bakgrunnen uten at du ser det.** Agenten kjører bare når du starter den, fra panelet, bildevisningen eller maleplanen. Alt den endrer eller lagrer, vises i panelet:
   - endringer som «Agenten endret …» med Angre
   - forslag som venter på deg
   - nye kilder som «Lagret N sider som kilder …»
   - søk og sider under «Vis hvordan agenten fant dette»

Gjelder agenten i appen, ikke agentene som utvikler Paintrest. Reglene for dem står i [CLAUDE.md](../../CLAUDE.md).
