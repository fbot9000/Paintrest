# Bit 7 Kunnskap: datamodell og byggeplan (utkast)

Status: revidert 11. november 2026 etter tilbakemelding. **7.0–7.4 er bygget**: typer, migrering til v5, kommandoer (`src/data/knowledge-commands.ts`), lesefunksjoner (`src/domain/library.ts`), tester bibliotekets sider for teknikker og oppskrifter, teknikkartikkel, verkstedguide, erfaring og research med agenten (`src/features/library/`, `server/research-agent.ts`). Resten er forslag.

## Grunnlag

Dokumentet bygger på fire kilder. Det står hvilken kilde hvert punkt kommer fra:

- **[Figma]** Siden «Teknikker» i Figma-filen *Paintrest* (node 12:91). Den har ni tidlige skisser, 00–07. Skissene sier selv at innholdet er eksempler.
- **[Kode]** Det som finnes i repoet i dag.
- **[Beslutning]** Brukerens beslutninger 11. november 2026.
- **[Forslag]** Det jeg foreslår. Dette er ikke avgjort.

Produktspesifikasjon v2.0, datamodell v3 og «databaseskjema og arkitektur» har jeg **ikke** sett. Står det noe annet der, må dokumentet rettes.

## Beslutninger 11. november 2026 [Beslutning]

1. **Ikke for rigid.** I første versjon kan oppskrifter endres direkte. Om de skal låses, vurderes senere.
2. **En oppskrift kan være to ting.** Den kan være bare en *fargerekke*, eller en *fremgangsmåte* som viser hvordan fargerekken brukes for å få en bestemt effekt.
3. **Kategorier er fritekst eller merkelapper**, ikke faste valg.

Det samme prinsippet gjelder teknikker [Forslag]:
- Du redigerer direkte.
- «Godkjent» er et merke, ikke en lås.
- Det finnes ingen kontroll som stopper godkjenning.
- Variantene er enkel tekst.

## Hva som allerede er forberedt [Kode]

| Sted | Hva |
|---|---|
| `types.ts` `PlanStep.technique_version_id`, `recipe_version_id` | Plansteg kan peke på en teknikk eller oppskrift. Begge settes alltid til `null` |
| `types.ts` `LinkTargetType` `'technique' \| 'recipe'`, `LinkUse 'method'` | Kilder kan kobles til teknikker og oppskrifter |
| `types.ts` `AreaKind 'new_knowledge'`, `TaskScope.allow_new_knowledge` | En egen type researchoppgave for kunnskap. Brukes ikke |
| `types.ts` `ResultType 'technique' \| 'recipe'` | Agenten kan i prinsippet foreslå teknikker og oppskrifter. Brukes ikke |
| `types.ts` `Evidence`, `Uncertainty` | Dokumentert, syntetisert eller uavklart |
| `docs/AVVIK.md` regel 1 og punkt 28 | Biblioteket er **globalt**. Agenten foreslår bare, og brukeren godkjenner |

## Prinsipper fra skissene [Figma]

1. **Teknikk og oppskrift er to ting.** En teknikk er metoden, med generelle materialer («finporet svamp»). En oppskrift er de konkrete malingene. «Én teknikk kan brukes i mange spill – med ulike fargeoppskrifter.»
2. **Kunnskapen har tre egenskaper:**
   - *kildegrunnlag:* dokumentert eller syntetisert
   - *godkjenning:* forslag eller godkjent
   - *praktisk erfaring:* uprøvd, prøvd eller vellykket
3. **Godkjent betyr «klar til å teste»**, ikke at du har prøvd teknikken selv.
4. **Agenten endrer ikke biblioteket av seg selv.** Research gir et utkast. Erfaringer kan gi et forslag til forbedring.
5. **Kildene følger med**, og agenten skiller mellom det kildene viser og sine egne forslag.

## Datamodell [Forslag]

Navnene følger mønsteret i `types.ts`: snake_case, `workspace_id` på globale rader og `deleted_at` for myk sletting. **Det finnes ingen versjonstabeller.** Du endrer radene direkte. Hver kommando skriver `change_record` som før, så historikken finnes. `SCHEMA_VERSION` går fra 4 til 5, og `migrate` legger til tomme tabeller.

### Teknikk

```ts
export type KnowledgeStatus = 'draft' | 'approved';   // egenskapen «godkjenning». Et merke, ikke en lås

export interface Technique {
  id: Id;
  workspace_id: Id;
  name: string;                       // «Tekstur med svamp og oljemaling»
  tags: string[];                     // fritt: «tekstur», «lys og effekter» …
  status: KnowledgeStatus;
  desired_result: string | null;      // «Ønsket resultat»
  use_area: string | null;            // «Bruksområde»
  materials: string[];                // «Dette trenger du»: «Finporet svamp», «Oljemaling» …
  variants: string | null;            // fritekst: «A · Svamp for tekstur …  B · Svamp for overganger …»
  risk_note: string | null;           // «Verifiser tørking, håndtering og rengjøring …»
  evidence: Evidence | null;          // egenskapen «kildegrunnlag». null = ikke vurdert
  uncertainty: Uncertainty[];
  created_at: Timestamp;
  updated_at: Timestamp;
  deleted_at: Timestamp | null;
}

export interface TechniqueStep {
  id: Id;
  technique_id: Id;
  position: number;
  title: string;                      // «Prøv svampen»
  instruction: string;                // «Ta lite maling og test ønsket avtrykk.»
  basis: StepBasis | null;            // 'documented' | 'synthesized'. null = ikke vurdert
}
```

- Materialer og varianter er fritekst. Da blir de enkle å redigere, og det er lett å legge til struktur senere.
- Du kan endre en godkjent teknikk direkte, og den forblir godkjent. Merket kan settes tilbake til utkast for hånd.

### Erfaring

```ts
export interface TechniqueExperience {
  id: Id;
  technique_id: Id;
  outcome: 'worked' | 'needs_adjustment';   // «Fungerte fint» eller «Trenger justering»
  note: string | null;                      // «Svampen ga for grov struktur.»
  subject_id: Id | null;                    // valgfritt: på hvilken miniatyr
  created_at: Timestamp;
  deleted_at: Timestamp | null;
}
```

Egenskapen «praktisk erfaring» **regnes ut** i `views.ts` og lagres ikke:
- ingen erfaringer gir *uprøvd*
- minst én erfaring gir *prøvd*
- minst én `worked` gir *vellykket*

### Oppskrift: fargerekke, eventuelt med fremgangsmåte

En oppskrift er alltid en **fargerekke**, altså malinger i rekkefølge. Den kan i tillegg ha en **fremgangsmåte** med steg som bruker fargerekken for å få en bestemt effekt. Har oppskriften ingen steg, er den bare en fargerekke. Ett skjema dekker begge tilfellene, så du trenger ikke velge type.

```ts
export interface Recipe {
  id: Id;
  workspace_id: Id;
  name: string;                       // «Varm rust over mørkt metall»
  tags: string[];
  status: KnowledgeStatus;
  effect: string | null;              // hva oppskriften gir. Tom for en ren fargerekke
  note: string | null;
  evidence: Evidence | null;
  uncertainty: Uncertainty[];
  created_at: Timestamp;
  updated_at: Timestamp;
  deleted_at: Timestamp | null;
}

export interface RecipePaint {        // fargerekken
  id: Id;
  recipe_id: Id;
  position: number;
  product_id: Id;                     // paint_product
  role: MaterialRole | null;          // base, shade, layer, highlight … Valgfritt
  note: string | null;
}

export interface RecipeStep {         // fremgangsmåten. Valgfri
  id: Id;
  recipe_id: Id;
  position: number;
  instruction: string;
  paint_ids: Id[];                    // hvilke malinger i fargerekken steget bruker
  technique_id: Id | null;            // «bruk teknikken X her»
}
```

- Malinger som ikke finnes i katalogen, kan legges inn som ubekreftede produkter (`identity_status: 'unconfirmed'`), slik katalogen allerede tillater. Det stopper ikke lagring.
- **Avvik som må føres i AVVIK.md:** `plan_step.technique_version_id` og `recipe_version_id` peker i første versjon på selve teknikken eller oppskriften, fordi det ikke finnes versjoner. Kolonnenavnene beholdes, slik at versjoner kan innføres senere uten å endre maleplanene.

### Kilder

Ingen nye tabeller og ingen nye felt. `source_link` får `target_type: 'technique' | 'recipe'`, `use: 'method'` og `target_id` lik teknikken eller oppskriften. Kildene vises med den statusen de har (`analysis_state`). Det finnes ingen egen kontroll som må gjøres før godkjenning.

### Research og handlingsrom

| Felt | Global research |
|---|---|
| `task_scope.area_kind` | `'new_knowledge'` |
| `task_scope.work_project_id` | `null` |
| `task_scope.allow_new_knowledge` | `true` |
| `task_result_type` | `'technique'` og/eller `'recipe'` |

Agenten skriver ikke direkte i biblioteket (AVVIK punkt 28, sonen *Globalt*). Den lager forslag.
- **Godkjenner du et forslag til ny teknikk eller oppskrift,** opprettes den med statusen `draft`. Deretter redigerer du fritt.
- **Godkjenner du et forslag til endring av en eksisterende teknikk eller oppskrift,** skrives endringen rett inn. Er raden endret etter at forslaget ble laget, stopper godkjenningen (`updated_at`), slik som for maleplaner.

`checkScope` godtar `technique` og `recipe` bare når `allow_new_knowledge` er sann, og avviser prosjektendringer i en `new_knowledge`-oppgave.

### Tabeller som legges til i `Tables`

`technique`, `technique_step`, `technique_experience`, `recipe`, `recipe_paint`, `recipe_step`.

## Byggeplan [Forslag]

| Bit | Innhold | Skisse | Avhenger av |
|---|---|---|---|
| **7.0 Grunnmur** ✓ | Typene over, migrering v4→v5, kommandoer (`createTechnique`, `updateTechnique`, `setTechniqueStatus`, `setTechniqueSteps`, `deleteTechnique`/`restoreTechnique`, `recordExperience`/`deleteExperience`, og det samme for oppskrifter med `setRecipePaints` og `setRecipeSteps`) og lesefunksjoner (`libraryTechniques`, `libraryRecipes`, `libraryTags`, `techniqueDetail`, `recipeDetail`, `practicalExperience`). Tester i `knowledge-commands.test.ts`. Ingen skjerm | – | – |
| **7.1 Bibliotek: teknikker** ✓ | «Bibliotek» i toppfeltet. `/bibliotek/teknikker` med søk, filter på merkelapper og egne erfaringer, og kort med de tre egenskapene. `/bibliotek/teknikker/:id`: alle felt lagres når du forlater dem, steg kan legges til, flyttes og fjernes, godkjenning kan slås av og på, og teknikken kan slettes og gjenopprettes. Ett eksempel i `seed.ts`, merket som eksempel. Uten bilder, agent og erfaringsregistrering (kommer senere) | 01, 04 | 7.0 |
| **7.2 Bibliotek: oppskrifter** ✓ | `/bibliotek/oppskrifter` med søk (også på malingsnavn) og filter. `/bibliotek/oppskrifter/:id`: effekt, merkelapper, fargerekke (søk i katalogen, eller legg til en ny ubekreftet maling, med rolle og merknad), valgfrie steg som velger malinger fra fargerekken og kan peke på en teknikk, og notat. Teknikksiden viser hvilke oppskrifter som bruker teknikken. To eksempler i `seed.ts` | ingen skisse. Enkel første versjon | 7.0 |
| **7.3 Guide og erfaring** ✓ | En teknikk åpnes som artikkel (`/bibliotek/teknikker/:id`), og «Rediger» går til `…/rediger`. Verkstedguide i fullskjerm (`…/verksted`) med materialer, forbehold og steg du kan krysse av (ikke lagret), og knappene «Må justeres» og «Dette fungerte». Erfaring med utfall og merknad kan registreres fra artikkelen og guiden, og fjernes. «Foreslå forbedring» (7.6) og «Bruk i prosjekt» (7.7) er ikke med | 05, 06, 07 | 7.1 |
| **7.4 Global research** ✓ | `/bibliotek/research`: velg teknikk eller oppskrift, beskriv idéen og legg eventuelt ved en kilde. `/bibliotek/research/:id`: fremdrift, samtale og utkast. Oppgaven har `area_kind = new_knowledge`, ingen arbeidsprosjekt og én resultattype. Agenten får biblioteket, malingskatalogen og tidligere bibliotekkilder, men ikke prosjektene. Egen instruks på serveren (`knowledgeInstructions`). «Lagre i biblioteket» lager teknikken eller oppskriften som utkast, med kilder (`use = method`). Ukjente malinger må kobles eller opprettes som ubekreftet | 02 | 7.1, 7.2 |
| **7.5 Kildearbeid og syntese** | Kildeinspektør og sammenligning av varianter side om side. Delvis med i 7.4: utkastet viser kilder (åpnet eller bare sett i søk), varianter, «Vist i kilde» eller «Forslag fra agenten» per steg, og uavklarte punkter | 03 | 7.4 |
| **7.6 Forbedring fra erfaring** | «Foreslå forbedring» gir agenten erfaringen, og agenten lager et endringsforslag | 07 | 7.3, 7.4 |
| **7.7 Bruk i prosjekt** | Legg en teknikk eller oppskrift inn i et plansteg. Painting Mode lenker til verkstedguiden | 05 | **bit 4** (redigering av maleplanen) |

**Navigasjon:** Skissene har *Prosjekter · Research · Bibliotek · Malinger* øverst. 7.1 legger til «Bibliotek» øverst uten å bygge om resten.

## Vurderes senere

- Låsing og versjoner av teknikker og oppskrifter, hvis direkte endring viser seg å være et problem.
- Struktur på materialer og varianter, hvis friteksten blir for løs.
- Om godkjenning bør advare når kildene ikke er sjekket.
