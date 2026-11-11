# Bit 7 Kunnskap: datamodell og byggeplan (utkast)

Status: **forslag til diskusjon**, 11. november 2026. Ingenting her er bygget ennå.

## Grunnlag

Dokumentet bygger på tre kilder. Det står hvilken kilde hvert punkt kommer fra:

- **[Figma]** Siden «Teknikker» i Figma-filen *Paintrest* (node 12:91). Den har ni tidlige skisser, 00–07. Skissene sier selv at innholdet er eksempler: «Visninger er eksempler – teknikkdata er ikke researchet her».
- **[Kode]** Det som finnes i repoet i dag.
- **[Forslag]** Det jeg foreslår. Dette er ikke avgjort.

Produktspesifikasjon v2.0, datamodell v3 og «databaseskjema og arkitektur» har jeg **ikke** sett. Står det noe annet der, gjelder de. Da må dokumentet rettes.

## Hva som allerede er forberedt [Kode]

| Sted | Hva |
|---|---|
| `types.ts` `PlanStep.technique_version_id`, `recipe_version_id` | Plansteg kan peke på en teknikk- eller oppskriftsversjon. Begge settes alltid til `null` |
| `types.ts` `LinkTargetType` `'technique' \| 'recipe'`, `LinkUse 'method'` | Kilder kan kobles til teknikker og oppskrifter |
| `types.ts` `AreaKind 'new_knowledge'`, `TaskScope.allow_new_knowledge` | En egen type researchoppgave for kunnskap. Brukes ikke |
| `types.ts` `ResultType 'technique' \| 'recipe'` | Agenten kan i prinsippet foreslå teknikker og oppskrifter. Brukes ikke |
| `types.ts` `Evidence`, `Uncertainty` | Dokumentert, syntetisert eller uavklart. Brukes allerede på forslag |
| `docs/AVVIK.md` regel 1 og punkt 28 | Biblioteket er **globalt**. Agenten foreslår bare, og brukeren godkjenner |

Tabellene for selve teknikkene og oppskriftene finnes ikke.

## Prinsipper fra skissene [Figma]

1. **Teknikk og oppskrift er to ting.** En teknikk er metoden, med generelle materialer («finporet svamp», «oljemaling»). En oppskrift er de konkrete malingsproduktene. «Én teknikk kan brukes i mange spill – med ulike fargeoppskrifter.» «Eksakte malingsprodukter velges i en konkret fargeoppskrift når det trengs.»
2. **Kunnskapen har tre egenskaper, ikke én status:**
   - *kildegrunnlag:* dokumentert eller syntetisert
   - *godkjenning:* forslag eller godkjent
   - *praktisk erfaring:* uprøvd, prøvd eller vellykket
3. **Godkjent betyr «klar til å teste»**, ikke at du har prøvd teknikken selv.
4. **Ingenting godkjennes av seg selv.** Research gir et redigerbart utkast. Erfaringer kan føre til et forslag om revisjon, men «dagens godkjente versjon endres ikke automatisk».
5. **Kildene følger med.** Agenten skal skille mellom det kildene faktisk viser og sine egne forslag, og dokumentere hva den faktisk fikk lest eller sett.
6. **Biblioteket er globalt**, på tvers av alle spillprosjekter.

## Datamodell [Forslag]

Navnene følger mønsteret i `types.ts`: snake_case, `workspace_id` på globale rader og `deleted_at` for myk sletting. Versjoneringen følger `PaintPlanVersion`. `SCHEMA_VERSION` går fra 4 til 5, og `migrate` legger til tomme tabeller.

### Teknikk

```ts
export type TechniqueCategory = 'material' | 'light_effect' | 'method';   // filtrene i skisse 01

export interface Technique {
  id: Id;
  workspace_id: Id;
  name: string;                       // «Tekstur med svamp og oljemaling»
  category: TechniqueCategory | null;
  current_version_id: Id | null;      // siste godkjente versjon, ellers null
  draft_version_id: Id | null;        // utkastet som redigeres nå, høyst ett
  created_at: Timestamp;
  deleted_at: Timestamp | null;
}

export type KnowledgeVersionState = 'draft' | 'approved' | 'superseded';

export interface TechniqueVersion {
  id: Id;
  technique_id: Id;
  version_number: number;
  state: KnowledgeVersionState;       // egenskapen «godkjenning»
  origin: VersionOrigin;              // 'user' | 'proposal'
  supersedes_id: Id | null;
  desired_result: string;             // «Ønsket resultat»
  use_area: string | null;            // «Bruksområde»
  risk_note: string | null;           // «Verifiser tørking, håndtering og rengjøring …»
  evidence: Evidence;                 // egenskapen «kildegrunnlag», for versjonen samlet
  uncertainty: Uncertainty[];
  created_at: Timestamp;
  approved_at: Timestamp | null;
}

export type TechniqueMaterialKind = 'tool' | 'paint_type' | 'surface' | 'cleaning' | 'other';

export interface TechniqueMaterial {   // «Dette trenger du». Generelt, ikke paint_product
  id: Id;
  version_id: Id;
  position: number;
  kind: TechniqueMaterialKind;
  label: string;                      // «Finporet svamp»
  note: string | null;
}

export interface TechniqueVariant {    // «A · Svamp for tekstur», «B · Svamp for overganger»
  id: Id;
  version_id: Id;
  position: number;
  label: string;
  description: string;
  is_primary: boolean;                // «Utgangspunkt» eller «Alternativ»
}

export interface TechniqueStep {
  id: Id;
  version_id: Id;
  variant_id: Id | null;              // null betyr felles steg for alle variantene
  position: number;
  title: string;                      // «Prøv svampen»
  instruction: string;                // «Ta lite maling og test ønsket avtrykk.»
  basis: 'documented' | 'synthesized';// kilden viser det, eller agenten foreslår det
}
```

**Begrunnelse:**

- Utkast lagres som egne rader (`state: 'draft'`), ikke bare som `research_proposal`. Skisse 04 viser et utkast som redigeres og lagres automatisk over tid. Maleplanen har ikke `draft` på versjonen i dag, så dette blir et nytt avvik som må føres i AVVIK.md.
- Den godkjente versjonen er låst. Skal den endres, lages en ny utkastversjon med `supersedes_id`. Det følger prinsipp 4.
- `basis` på hvert steg viser forskjellen mellom det kildene viser og det agenten foreslår (prinsipp 5).

### Erfaring

```ts
export type ExperienceOutcome = 'worked' | 'needs_adjustment';

export interface TechniqueExperience {
  id: Id;
  technique_id: Id;
  version_id: Id;                     // hvilken versjon som ble prøvd
  outcome: ExperienceOutcome;         // «Fungerte fint» eller «Trenger justering»
  note: string | null;                // «Svampen ga for grov struktur.»
  subject_id: Id | null;              // valgfritt: på hvilken miniatyr
  created_at: Timestamp;
  deleted_at: Timestamp | null;
}
```

Egenskapen «praktisk erfaring» **regnes ut** og lagres ikke. Den regnes ut i `views.ts`:
- ingen erfaringer gir *uprøvd*
- minst én erfaring gir *prøvd*
- minst én `worked` gir *vellykket*

Det hindrer at status og erfaring blir uenige.

### Oppskrift: malinger som fungerer sammen

Skissene har «Oppskrifter» i menyen, men **ingen skjerm** for dem. Dette er derfor mest usikkert.

```ts
export interface Recipe {
  id: Id;
  workspace_id: Id;
  name: string;                       // for eksempel «Varm rust over mørkt metall»
  current_version_id: Id | null;
  draft_version_id: Id | null;
  created_at: Timestamp;
  deleted_at: Timestamp | null;
}

export interface RecipeVersion {
  id: Id;
  recipe_id: Id;
  version_number: number;
  state: KnowledgeVersionState;
  origin: VersionOrigin;
  supersedes_id: Id | null;
  purpose: string;                    // hva kombinasjonen gir
  evidence: Evidence;
  uncertainty: Uncertainty[];
  created_at: Timestamp;
  approved_at: Timestamp | null;
}

export interface RecipeStep {
  id: Id;
  version_id: Id;
  position: number;
  instruction: string;
  technique_version_id: Id | null;    // «bruk teknikken X her»
}

export interface RecipeComponent {    // samme form som StepMaterial og MixComponent
  id: Id;
  step_id: Id;
  position: number;
  product_id: Id;                     // paint_product: konkrete malinger
  role: MaterialRole;
  parts: number | null;               // for blandinger
  note: string | null;
}
```

- Oppskriften bruker `paint_product` og `MaterialRole`. Da gjelder den samme regelen som for maleplaner: malinger som ikke finnes i katalogen, må kobles eller opprettes som ubekreftet (`needsUser`) før oppskriften kan godkjennes.
- En oppskrift kan bruke flere teknikker, én per steg. En teknikk kan inngå i mange oppskrifter.

### Kilder

Ingen nye tabeller. `source_link` får `target_type: 'technique' | 'recipe'`, og `target_id` peker på **versjonen**. Da følger kildegrunnlaget versjonen som ble godkjent. Ett nytt felt:

```ts
// på SourceLink, PROTOTYPE
verified_at?: Timestamp | null;       // brukeren har kontrollert kilden
```

Skisse 04 har statusen «Kilder må kontrolleres» og knappen «Kontroller kilder først →». Forslaget er at en versjon ikke kan godkjennes før alle `method`-kilder er kontrollert, med mindre brukeren bevisst godkjenner likevel.

### Research og handlingsrom

| Felt | Global teknikkresearch |
|---|---|
| `task_scope.area_kind` | `'new_knowledge'` |
| `task_scope.work_project_id` | `null` |
| `task_scope.allow_new_knowledge` | `true` |
| `task_result_type` | `'technique'` og/eller `'recipe'` |
| `task_revision_target.target_type` | utvides med `'technique' \| 'recipe'`, for «Foreslå forbedring» i skisse 07 |

Biblioteket er sonen **Globalt** i AVVIK punkt 28. Agenten skriver derfor aldri direkte i biblioteket, men lager alltid forslag. `checkScope` må:

- godta `technique` og `recipe` bare når `allow_new_knowledge` er sann
- avvise alle prosjektendringer i en `new_knowledge`-oppgave

### Tabeller som legges til i `Tables`

`technique`, `technique_version`, `technique_material`, `technique_variant`, `technique_step`, `technique_experience`, `recipe`, `recipe_version`, `recipe_step`, `recipe_component`.

## Byggeplan [Forslag]

Hver bit kan leveres for seg og testes med `npm test` og `npm run build`. Rekkefølgen gir noe brukbart tidlig, før AI kommer inn.

| Bit | Innhold | Skisse | Avhenger av |
|---|---|---|---|
| **7.0 Grunnmur** | Typene over, migrering v4→v5, kommandoer (`createTechnique`, `updateTechniqueDraft`, `approveTechniqueVersion`, `startTechniqueRevision`, `recordExperience`, `deleteTechnique`/`restoreTechnique`) og lesefunksjoner (`libraryTechniques`, `techniqueDetail`, de tre egenskapene). Tester for transaksjoner, låst godkjent versjon og utregnet erfaring. Ingen skjerm | – | – |
| **7.1 Bibliotek** | Ny rute `/bibliotek/teknikker` med søk, filtre og kort med de tre egenskapene. «Ny teknikk» lages manuelt. Utkastet redigeres og lagres automatisk. Godkjenning. Ett eksempel i `seed.ts`, tydelig merket som eksempel | 01, 04 (uten agent) | 7.0 |
| **7.2 Guide og erfaring** | Teknikkartikkel, kort verkstedguide for iPad liggende og valgfri erfaring | 05, 06, 07 | 7.1 |
| **7.3 Global research** | Startskjerm (idé, valgfri kilde, oppdrag), oppgave med `new_knowledge`, `checkScope` for global sone, instruksjoner til agenten for teknikkresearch i `server/research-agent.ts`, forslagstypen `technique` | 02 | 7.1 |
| **7.4 Kildearbeid og syntese** | Kildeinspektør, kildekontroll (`verified_at`), sammenligning av varianter og «Lag teknikkguide →», som gjør et godkjent forslag om til et utkast | 03, 04 | 7.3 |
| **7.5 Revisjon** | «Foreslå forbedring» fra en erfaring gir et revisjonsforslag mot den godkjente versjonen. Det stopper hvis versjonen er endret siden, slik som for maleplaner | 07 | 7.2, 7.4 |
| **7.6 Oppskrifter** | Datamodell, skjermer og research for malinger som fungerer sammen, med kobling til katalogen | **mangler skisse** | 7.0, helst bit 3 |
| **7.7 Bruk i prosjekt** | «Bruk i prosjekt →» legger et steg med `technique_version_id` inn i en maleplan. Painting Mode lenker til verkstedguiden | 05 | **bit 4** (redigering av maleplanen) |

**Hovednavigasjon:** Skissene har *Prosjekter · Research · Bibliotek · Malinger* øverst. Appen har bare logo og en ⋯-meny. 7.1 kan legge til «Bibliotek» øverst uten å bygge om resten. Full navigasjon bør avgjøres sammen med «Interface direction»-siden i Figma.

## Åpne spørsmål

1. **Oppskrifter:** Skal «malinger som fungerer sammen» være oppskrifter slik som over, eller noe eget, for eksempel par og kombinasjoner av malinger uten steg? Det trengs skisser før 7.6.
2. **Utkast som rader:** Er det greit at kunnskap har `draft` som versjonsstatus, når maleplanen bruker forslag? Hvis ikke, må redigering i skisse 04 skje i forslaget.
3. **Kategorier:** Er «Materialer · Lys og effekter · Metoder» faste kategorier, eller bør det være fritekst eller merkelapper? «Egne erfaringer» er tolket som et filter på erfaring, ikke en kategori.
4. **Kildekontroll:** Skal godkjenning stoppes når kilder ikke er kontrollert, eller bare varsle?
5. **Variantenes steg:** Holder det med felles steg og et valgfritt `variant_id`, eller trenger hver variant egne materialer?
6. **Dokumentene:** Hva sier spesifikasjon v2.0 og datamodell v3 om teknikk og oppskrift? Dette forslaget bør sjekkes mot dem før 7.0.
