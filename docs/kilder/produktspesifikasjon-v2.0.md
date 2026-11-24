> **Historisk grunnlag, ikke oppdatert.** Opprinnelig dokument fra 8. november 2026 (filnavn: «Paintrest – hovedkonsept.md»), lagt inn uendret 24. november 2026. Løsningen har utviklet seg siden. Koden og brukerens beslutninger i [docs/beslutninger/](../beslutninger/) går foran. Hva som fortsatt ser ut til å gjelde, står i [VURDERING.md](VURDERING.md).

# Paintrest – produktspesifikasjon v2.0

Konsolidert produktgrunnlag · 8\. november 2026 · Arbeidstittel: Paintrest  
Status: Produktretning for konseptdesign. Dette er ikke en ferdig teknisk kravspesifikasjon, leveranseplan eller MVP-roadmap.

# 1\. Idé og produktløfte

Paintrest er et personlig arbeidsverktøy for miniatyrmaling. Det gjør grundig research, kuraterer referanser og bygger konkrete maleplaner før maling, og gjør både planene og den opparbeidede kunnskapen enkle å finne igjen senere. Spill er prosjekter; hver miniatyr eller malegruppe har sin godkjente oppskrift og relevante referanser.  
Kjerneløfte: Gjør research og planlegging én gang, mal uten å måtte gjøre nye valg ved malebordet, og gjenbruk det som virker i neste prosjekt.

## Føringer vi er enige om

• Visuelt først. Bilder av miniatyrer, referansebilder og konkrete malingprodukter skal være lett tilgjengelige, ikke gjemt bak lange tekstsvar eller skjemaer.  
• AI gjør selvstendig research og foreslår; brukeren kuraterer og godkjenner endelige kreative valg. Samtalen er arbeidsmetoden, strukturerte prosjektdata er resultatet.  
• Researchverkstedet er desktop-first på stor skjerm. Bruk av en ferdig maleplan er iPad-first ved malebordet.  
• Gjenbruk er en grunnverdi: teknikker, oppskrifter, fargekjeder og malingskunnskap er globale og tilgjengelige for alle prosjekter.  
• Eksakte malingsproduktnavn er obligatoriske i konkrete oppskrifter og maleplaner. Fargebetegnelser som «mørkegrønn» kan angi uttrykk og rolle, men aldri erstatte produktidentitet.  
• Minst mulig administrasjon. Ingen krav om egne bilder av hver figur, individ-ID på 25 zombier, stegkvittering eller etterrapporter.  
• Kildegrunnlag, antakelser, godkjente valg og faktisk erfaring må kunne skilles. Agenten skal ikke dikte opp malingnavn, analysere utilgjengelig materiale eller overskrive vedtatte planer i stillhet.

# 2\. To arbeidskontekster og én kunnskapsmodell

## A. Researchverkstedet

Ett AI-assistert researchverksted har to likeverdige kontekster:  
• Prosjektresearch: identifisere et spill og riktig utgave, kartlegge miniaturer, finne referanser, lande palett og utarbeide godkjente planer for hele spillet.  
• Global kunnskapsresearch: undersøke maleteknikker, konkrete fargekombinasjoner, oppskrifter, produkter og kilder uavhengig av et spill.  
Begge bruker samme modell for AI-samtale, kildearbeid, redigerbare resultater og brukerens godkjenning. Forskjellen er hva det ferdige resultatet blir: prosjektdata, en maleplan eller gjenbrukbar global kunnskap.

## B. Painting Mode

Bruksflaten for den ferdige miniatyren/malegruppen. Her skal beslutningene allerede være tatt. Brukeren trenger å se referanser, eksakte malinger, blandinger og trinn – ikke nye AI-alternativer. Ny research under maling er et målrettet unntak når noe er feil eller ikke virker.

## C. Felles data – ikke separate sannheter

Research, prosjektvisning, malingsinventar, kunnskapsbibliotek og Painting Mode leser fra samme strukturerte, oppdaterbare prosjekt- og kunnskapsmodell. Agenten må kunne hente relevant gjeldende kontekst i en ny arbeidsøkt, uten å være avhengig av en lang chatlogg.

# 3\. Prosjekter: fra spill til maleklare figurer

## Prosjektoppsett og research

Et spill blir ett prosjekt, med grunnspill og relevante utvidelser. Agenten undersøker og foreslår riktig tittel/utgave, miniaturtyper, antall, kategorier/fraksjoner og offisielle bilder. Brukeren korrigerer og bekrefter. Resultatet blir prosjektets faktiske miniatyrgalleri.  
Deretter arbeider man normalt gjennom størstedelen av researchen i en samlet oppstartsperiode: velger felles visuell retning og prosjektpalett med konkrete malinger, kuraterer referanser og utarbeider maleplaner for alle figurtyper og malegrupper. Oppgavene er fleksible, ikke en tvungen sekvens.  
Referanser hører primært til den miniatyren eller malegruppen de skal brukes på. Felles prosjektpalett gjelder konkrete malingprodukter på tvers; individuelle figurer kan bruke et utvalg eller legge til egne. En overordnet metode/stil vises på prosjektnivå bare hvis den er et faktisk felles grep for hele prosjektet eller en angitt del.

## Ferdig plan og faktisk ferdigmalt er to forskjellige ting

• Planleggingsfremdrift: antall figurtyper/malegrupper med godkjente, anvendbare maleplaner. En gruppe med ti like ulver trenger én plan.  
• Malefremdrift: antall fysisk ferdigmalte miniatyrer / totalt antall. Dette er det dominerende tallet på prosjektsiden når man maler.  
• «Maleklar» betyr at referanser, konkrete malingvalg og nødvendige instrukser er avklart og godkjent av brukeren. Materiell som er bestemt, men ennå ikke kjøpt, skal kunne vises som et separat tilgjengelighetsproblem, ikke blandes med planens kvalitet.  
Prosjektgalleriet er hovedinnholdet på prosjektsiden. Det viser store, gjenkjennelige figurer/grupper med status, og kan filtreres på grunnspill/utvidelse og «under arbeid». Ferdige figurer forblir søkbare i galleriet. Ingen duplisert seksjon for pågående figurer.

## Mange planer, én helhet

Agenten skal kunne arbeide med planleggingen av en hel samling og gjenbruke prosjektvalg og globale oppskrifter. Brukeren må kunne gjennomgå, justere og godkjenne mange forslag effektivt. Hvordan samlet oversikt, massekuratering og usikre planer visualiseres, skal undersøkes i konseptene – ikke forhåndsbestemmes.

# 4\. Researchverkstedet: samhandling og kilder

## Arbeidsmåte og desktop

Research føles som en samarbeidsdialog med AI, men hver oppgave produserer et konkret, redigerbart resultat. Agenten kan selv utforske kilder, bruke allerede godkjente beslutninger og foreslå neste steg. Brukeren kan også søke og navigere manuelt, tilføre egne kilder, stille spørsmål og spisse oppdraget.  
Desktopflaten skal utnytte stor skjerm til samtidig innsyn i oppgaver, strukturerte resultater, kildebelegg og kontekstuell AI-dialog. En tredelt arbeidsflate med fleksible paneler er en designhypotese, ikke låst layout. Gallerier brukes der bilder er sentrale; redigerbare oversikter ved miniatyrkartlegging; oppskriftsvisning ved palett-/maleplanarbeid.  
AI kan utvikle utkast, gjøre nye søk og foreslå konkrete endringer. Den skal ikke uten godkjenning endre bekreftet spillidentitet, katalog, referanseutvalg, prosjektpalett, godkjente maleplaner eller globale kunnskapsartikler. Forslag til revisjon bør være synlig mot gjeldende versjon.

## Kilder og to veier til maleplan

• En god artikkel eller blogg kan inneholde mange bilder, en eller flere figurer og en faktisk oppskrift. Bevar alt som én kilde med koblinger til de bildene og stegene som velges.  
• Et godt bilde uten oppskrift er også verdifullt. Agenten kan utvikle et eget konkret oppskriftsforslag med hjelp av prosjektpalett, inventar, tidligere oppskrifter og teknikkbibliotek. Den skal ikke påstå å kjenne produktene fotografen faktisk brukte.  
• Kilder kan være bilder, blogger, forum, guider, videoer og relevante bokutdrag. Internasjonal research og oversettelse av utenlandske artikler er sentralt; original, oversatt lesekopi og strukturert metodeutdrag holdes adskilt.  
• Ikke alle videoer trenger analyse. Det skal være enkelt å lagre en interessant video og senere velge «trekk ut metode» eller «lag oppskrift». At videoen har thumbnail betyr ikke at agenten har sett innholdet.  
Begge løpene ender i samme godkjennbare maleplan: referanser, eksakte malingsprodukter og konkrete teknikker/steg der det er relevant. Researchverkstedet beholder kilder og metodegrunnlag; Painting Mode viser primært beslutningene.

## Kontekst og kontroll

Agenten bruker aktivt prosjektets gjeldende fakta, godkjente valg, aktuelle referanser, globale oppskrifter og kjent eierstatus for malinger. Den kan følge spor og tilpasse research etter hva brukeren har beholdt eller avvist, men må ikke gjøre lokale vurderinger til universelle preferanser.  
Utestående forslag, godkjente beslutninger, originalkilder og tidligere utgaver holdes adskilt. En godkjenning oppdaterer de relevante prosjekt-/miniatyrdataene direkte uten kopiering fra chat.

# 5\. Maleplan og Painting Mode

## Figurens plan

Maleplanen er figurbundet og har felles operasjoner (grunning/zenithal og eventuelt avslutning) og fleksible deler (kappe, hår, hud, rustning, stav, base osv.) med ordnede steg innen hver del. Ingen obligatorisk kronologisk vei gjennom hele figuren. Hver del kan bruke malinger, blandinger, teknikker, oppskrifter og relevante referansebilder.  
Ledende iPad-konsept: liggende skjerm med omtrent én tredel fast referanse-/concept-art-område og to tredeler maleplan. Standardvisning er oversikt over alle deler; valg av del åpner relevante steg. Brukeren skal raskt kunne bytte mellom deler og zoome eller skifte referansebilde. Eksakte produktnavn vises i detaljene, sammen med den informasjonen som trengs for å male.

## Fremdrift uten loggføring

• Brukeren kan frivillig markere steg eller deler ferdige, men ingen stegkvittering er påkrevd.  
• En miniatyr markeres ferdig manuelt; den godkjente planversjonen dokumenterer hva som ble gjort, med registrerte avvik som unntak.  
• Malegrupper med identiske figurer har én plan og én teller for fysisk ferdige figurer (f.eks. 9/25 zombier). Valgfrie aggregerte stegtellere og en løs fargefordelingsplan gir mulighet for batcharbeid uten å spore enkeltfigurer.  
• «Finn fram malingene» viser én deduplisert liste med eksakte produkter for hele planen eller valgte deler/steg. Dette er ikke et pakkesystem for reiser eller en utstyrsliste.

## Revisjon og historikk

Et enkelt avvik kan korrigeres direkte under maling (bytte maling, blanding, ekstra steg osv.). En plan som faktisk ikke fungerer kan åpnes for målrettet research og ny godkjent versjon. Ingen godkjent maleplan endres automatisk når global oppskrift, palett eller teknikk forbedres; forslag til oppdatering må bekreftes. Planen som faktisk ble brukt, bevares for senere gjenfinning.

# 6\. Global kunnskapsbase for alle prosjekter

Tre grunnleggende kunnskapstyper er avtalt. Kilder og praktiske erfaringer knyttes til disse, og konkrete maleplaner anvender dem i prosjekt.

## A. Teknikker – hvordan man arbeider

Generelle, gjenbrukbare metoder som slapchop, glazing, OSL, pelsstruktur eller svamp/oljemaling. En kuratert teknikk har en gjennomarbeidet guide med visuelle eksempler, relevante materialkrav, stegene i praksis, variasjoner, feilkilder og kildene bak. Samme kunnskap kan vises som kort verkstedguide på iPad. Teknikker kan være nyttige med mange ulike malinger.  
En inspirerende video eller bokreferanse kan starte et prosjektuavhengig researchoppdrag: agenten leter etter flere relevante kilder, sammenstiller og foreslår én komplett teknikkguide. Brukeren godkjenner den før publisering i eget bibliotek. Etter utprøving kan metoden forbedres uten å måtte produsere en egen logg.

## B. Oppskrifter og fargekjeder – hva som faktisk males med

En oppskrift beskriver et konkret, gjenbrukbart visuelt resultat: hudtone, grønn kappe, rust, pels eller flammer, med eksakte produktnavn, fargeroller, blandinger, relevante teknikker, referansebilder og steg der de trengs. En «fargekjede» (shade/base/layer/highlight og andre mulige roller) er en oppskrift eller del av en oppskrift – ikke et separat hovedbibliotek. Et produkt kan være base i én kjede og highlight i en annen.  
Oppskrifter kan gjenbrukes direkte eller remikses til ny farge uten å overskrive originalen. Agenten kan starte fra én konkret maling som eies og finne gode shades/highlights, eller fra et ønsket uttrykk og finne passende konkrete produkter. Kunnskap om samspill må baseres på dokumenterte kombinasjoner og praktisk erfaring, ikke bare digital RGB-likhet.

## C. Malingsprodukter og personlig inventar

Global produktkatalog og brukerens inventar er forskjellige ting. Produktet identifiseres entydig med eksakt navn, produsent/serie og relevante egenskaper når de er kjent. Inventaret angir «eier», «eier ikke» eller «ukjent». Ukjent betyr ikke mangler.  
Stor eksisterende samling bør kunne registreres effektivt gjennom søk, flervalg, serievis registrering eller import av en eksisterende liste der produktmatching kan verifiseres. Gradvis oppbygging må også være mulig. Det er ingen krav om milliliterregnskap eller obligatorisk fotografering av hver flaske.  
Når en oppskrift bruker produkter som ikke finnes i inventaret, kan agenten foreslå relevante alternativer med begrunnelse og hensyn til dekkevne, transparens, finish og bruksmetode. Handlelisten samler reelle mangler én gang per produkt, med prioritet «nødvendig», «anbefalt» eller «ønskeliste». Den kan filtreres per prosjekt; kjøp registreres som eiet.

## Kunnskapsutvinning, kuratering og kvalitet

Agenten skal kunne finne generelt anvendelige metoder og konkrete oppskrifter begravd inne i figurbundne guider, produsentressurser, videoer og brukerens malebøker. Én Zombicide-guide kan gi en flammeoppskrift og en separat OSL-teknikk. Flere kilder kan inngå i én kuratert artikkel, uten duplikater eller tap av originalt opphav.  
Kvalitet har tre uavhengige dimensjoner, som ikke skal blandes til ett statusfelt:  
• Kildegrunnlag: dokumentert i originalkilde, syntetisert/tilpasset av AI, eller uavklart.  
• Brukerens beslutning: forslag til vurdering eller godkjent for bibliotek/prosjekt.  
• Praktisk erfaring: uprøvd, brukt og eventuelt eksplisitt bekreftet vellykket eller justeringsbehov. En ferdigmalt miniatyr beviser ikke automatisk at alle metodene fungerte perfekt.  
Enkel godkjenning og valgfri erfaringsmerking er tilstrekkelig; brukeren skal ikke bli bibliotekar. Når en teknikk eller oppskrift virker godt, kan den løftes fra prosjektet inn i det globale biblioteket etter godkjenning, slik at senere prosjekter slipper samme research.  
Originalkilde, sidetall/bilde/videotidspunkt og kjente begrensninger bevares der mulig. Ikke baser funksjonalitet på at agenten får tilgang til lukkede apper, DRM-beskyttede bøker eller utilgjengelige videoer. Fysiske malebøker kan bidra med relevante skannede/avfotograferte utdrag innenfor tilgang og rettigheter.

# 7\. Oversikt over sentrale data og relasjoner

• Spillprosjekt → utgave, grunnspill/utvidelser, felles palett/metode, miniatyrtyper/grupper og prosjektfremdrift.  
• Miniatyrtype/gruppe → navn, antall fysiske figurer, offisielt bilde, valgte referanser, godkjente versjonerte maleplaner, fremdrift og avvik.  
• Maleplan → felles operasjoner, deler og steg; valgte oppskriftsversjoner, malingprodukter, blandinger, teknikker og referanser.  
• Global teknikk → prosess, materialer, variasjoner, bilder og kilder, koblinger til oppskrifter og brukshistorikk.  
• Global oppskrift/fargekjede → konkrete produkter og roller, steg, teknikker, kilder, varianter og bruk i flere planer.  
• Malingsprodukt → entydig produktidentitet og egenskaper; inventarstatus for brukeren, relasjoner til oppskrifter og alternative produkter.  
• Kilde → ett sammenhengende originalobjekt med bilder/tekst/video/oversettelse, og koblinger til prosjekt, miniatyr, teknikk og oppskrift uten unødvendige kopier.  
• Researchoppgave → kontekst, AI-funn, utkast, godkjente endringer og relevant beslutnings-/kildehistorikk.  
Dette er en logisk informasjonsmodell, ikke et vedtak om database, kodearkitektur eller implementasjon. Den logiske datamodellen, med BoardGameGeek som avtalt spillkilde og systemdefinert handlingsrom for agenten, ligger i Paintrest – datamodell.md (v3).

# 8\. Hva konseptskissene skal hjelpe oss å avklare

• Hvordan desktop-researchverkstedet kombinerer oppgaveoversikt, AI-dialog, originalkilder og redigerbart arbeidsresultat uten å bli en lang chat.  
• Hvordan AI kan planlegge en hel samling og brukeren raskt kan vurdere mange planer, finne usikkerheter og godkjenne dem som «maleklare».  
• Hvordan samme researchflate håndterer både prosjektoppgaver og prosjektuavhengig teknikk-/oppskriftsresearch.  
• Hvordan en kilde med mange bilder og metode blir et brukbart resultat, og hvordan rent visuelle referanser kan få en egen konkret oppskrift.  
• Hvordan malingsinventar og fargekjeder lar brukeren starte fra én eksakt eiet maling og finne gode shade/base/layer/highlight-kombinasjoner.  
• Hvordan iPad-flaten viser en ferdig maleplan med relevante bilder og eksakte produkter, med ett enkelt løp for et faktisk avvik.  
Designene kan teste forskjellige løsninger. Tredelt desktoplayout og 1/3–2/3 iPad-visning er gode utgangspunkt, ikke ufravikelige pixelmål.

# 9\. Avgrensninger og bevisst åpne spørsmål

## Avklart ut av normalflyten

• Ingen obligatoriske egenfotografier, dagbøker, detaljert steglogging eller individuell sporing av identiske batchfigurer.  
• Ingen separat reise-/pakkefunksjon, verktøysjekkliste, gamification eller forslag til nye miniatyrer basert på hvilke malinger som er funnet frem.  
• Ingen automatisk publisering av AI-funn som godkjente referanser, oppskrifter eller teknikker; ingen stilltiende overskriving av godkjente planer.

## Bevisst ikke avgjort nå

• Ingen vedtatt MVP-inndeling, utviklingsfaser, implementasjonsrekkefølge, budsjett, teknisk plattform eller AI-arkitektur.  
• Endelig navigasjon, detaljlayout, responsiv tilpasning, spesifikke statusetiketter, agentens ressursgrenser og hvordan mange planer godkjennes – skal vurderes i konseptarbeidet.  
• Hvilke produktkataloger, merke/serier, video-/boktilganger og importmetoder som teknisk kan støttes, krever senere verifisering.  
• Ingen ferdig bestemt visuell identitet eller endelig produktnavn utover arbeidstittelen Paintrest.

# 10\. Arbeidsregel videre

Denne v2.0 er det konsoliderte grunnlaget. Nye avklaringer skal oppdatere relevant avsnitt direkte, ikke legges til som nye, overlappende tillegg. Skill eksplisitt mellom bekreftede beslutninger, designhypoteser og tekniske/produktmessige åpne spørsmål. Designbriefen for første konseptskisser ligger i et eget, vesentlig kortere dokument. Den logiske datamodellen v3 ligger i Paintrest – datamodell.md. Forslag til databaseskjema og applikasjonsarkitektur ligger i Paintrest – databaseskjema og arkitektur.md.  
