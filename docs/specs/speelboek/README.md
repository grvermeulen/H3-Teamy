# Speelboek – waterpolo-specifieke trainingsinstructies (concept)

Aanleiding: idee **"Tip-in"** van Henry Turkenburg in de ideeënbus (21 okt 2026,
`Feedback.type = IDEA`, status NEW): _"Actie voor de goal en dan de tip-in."_
De vraag erachter is breder: hoe geven we spelers waterpolo-specifieke
instructie in de app — zowel **tactiek/positiespel** (aanval én verdediging)
als **techniek** (zoals de tip-in)?

Dit document bevat zeven mockups en drie implementatieroutes. De mockups zijn
in de bestaande huisstijl (donker thema, `--accent`, `.card`, `.badge`,
`.ui-btn`, `BottomNav`) en staan in `mockups.html` (open lokaal in een browser;
de stappen van de 4-2 zijn klikbaar).

## Diagram-conventies (waterpolo)

- **Caps**: aanvallende ploeg **wit**, verdedigende ploeg **blauw**; de
  **keeper rood** met het nummer in de kleur van zijn team (wit of blauw,
  afhankelijk van wie aanvalt). Wit/blauw kan per oefening worden omgedraaid.
- **Bal**: geel, iets groter dan een cap zodat hij op een telefoon opvalt.
- **Nummering standaardopstelling** (gezien vanaf de aanval, doel boven):
  **1 = vleugel rechts → 5 = vleugel links, 6 = midvoor**; 2 en 4 op 6 meter,
  3 in het midden. Bij een 4-2 man-meer: 1 paal rechts, 2 hoek rechts,
  3 6m rechts, 4 6m links, 5 hoek links, 6 paal links.
- **Pijlen**: zwemactie wit (gebogen), pass accentkleur gestippeld, schot dik wit.
- Bovenaanzicht van een half bad met 2m-, 5m- en 6m-lijn.

## Mockups

| #   | Scherm                                                            | Bestand                                                             |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| 1   | Speelboek-bibliotheek (nieuw tabblad in `BottomNav`)              | `speelboek-1-bibliotheek.png`                                       |
| 2   | Techniek-kaart: Tip-in                                            | `speelboek-2-tipin.png`                                             |
| 3   | Tactiek-kaart: 4-2 man-meer met rol per positie, stap 2 en stap 4 | `speelboek-3-tactiek-4-2.png`, `speelboek-3b-tactiek-4-2-stap4.png` |
| 4   | Trainer: programma per training                                   | `speelboek-4-trainer-programma.png`                                 |
| 5   | Trainer: nieuwe oefening – keuze van instapweg                    | `speelboek-5-nieuwe-oefening.png`                                   |
| 6   | Trainer: spelsituatie bouwen (editor, stap voor stap)             | `speelboek-6-editor.png`                                            |
| 7   | Trainer: oefening inspreken → AI maakt animatie                   | `speelboek-7-inspreken.png`                                         |

### 1 · Speelboek (spelersweergave)

- Eigen tabblad naast RSVP / Opkomst, zichtbaar voor iedereen die is ingelogd.
- Filterchips: Aanval · Verdediging · Techniek · Keeper; zoeken op positie of situatie.
- Bovenaan: **"Vanavond oefenen we"** – de oefeningen die de trainer aan de
  eerstvolgende training heeft gekoppeld (zie 4). Dit is de haak die spelers
  laat terugkomen: voorbereiding vóór de training, naslag erna.
- Elke kaart heeft een mini-diagram, categorie, positie(s) en het aantal stappen.
  Badges: `Nieuw`, `2× geoefend`.

### 2 · Techniek-kaart (Tip-in)

Vaste opbouw per techniek:

1. Half-bad-diagram (bovenaanzicht, doel boven, 2m/5m/6m-lijnen) met genummerde
   pijlen: zwemactie (wit), pass (gestippeld accent), schot (dik).
2. Drie tot vijf genummerde stappen, één zin per stap.
3. "Let op" – kernpunten én de meest gemaakte fout(en).
4. Optioneel: kort videofragment uit de training (10–20 s).
5. Acties voor de speler: **Ik snap 'm** (afvinken) en **Vraag aan trainer**.
6. Voetnoot: wanneer geoefend, hoeveel spelers hebben afgevinkt.

### 3 · Tactiek-kaart (4-2 man-meer)

- Zelfde diagram, maar met een **stepper**: posities van aanval én verdediging
  verschuiven per stap, zodat je ziet waaróm een gat ontstaat.
- **Rol per positie**: onder elke stap staat voor alle zes posities in één zin
  wat die speler doet. De positie van de ingelogde speler (uit zijn profiel,
  of gekozen) is uitgelicht – dit maakt een teamtactiek persoonlijk en is het
  sterkste argument voor een app in plaats van een PDF.
- Knop **Verdediging-weergave** toont dezelfde situatie vanuit de zone
  (5 tegen 6) – aanval en verdediging zijn elkaars tegenhanger en delen één
  diagramdefinitie.
- "Speel animatie" interpoleert tussen de stappen (0:30–0:60).

### 4 · Trainer: programma per training

- Haakt in op de bestaande trainingspagina (`/trainer/attendance/[date]`):
  naast de opkomst komt een **programma** met blokken en duur, waarin
  oefeningen uit het speelboek worden gekoppeld.
- **Stuur naar WhatsApp-groep** hergebruikt de WaAPI-integratie: een linkje
  met "Vanavond: Tip-in, 4-2 man-meer".
- Na de training: hoeveel spelers hebben afgevinkt, welke vragen staan open.

### 5 · Trainer: nieuwe oefening (keuze)

Vier instapwegen, van laag naar hoog in moeite voor de trainer:

- **Inspreken of beschrijven** → AI maakt stappen, rollen en animatie (zie 7).
- **Foto van het whiteboard** → AI zet posities en pijlen om in een bewerkbare
  animatie (zelfde vision-pipeline als `reportExtractProvider.ts`).
- **Zelf bouwen** → editor met standaardopstelling (zie 6).
- **Uit de ideeënbus** – open ideeën met thema "techniek/tactiek" direct
  omzetten naar een concept-oefening; Henry's Tip-in is het eerste voorbeeld.

Alle wegen komen uit in dezelfde editor (6), zodat een AI-resultaat altijd
nog bijgesteld kan worden voordat het in het speelboek verschijnt.

### 6 · Trainer: spelsituatie bouwen (editor)

Flow, zoals de animatie op de tactiek-kaart loopt:

1. **Standaardopstelling by default**: 1 t/m 6 in wit, zone + keeper in blauw/rood,
   bal bij 3. Wit/blauw omwisselen met één tik.
2. **Spelers verschuiven** (slepen), **toevoegen / verwijderen** (bijv. man-meer:
   één verdediger weg), en **actie / pass / schot** tekenen door speler aan te
   tikken en te slepen.
3. Per geselecteerde speler een korte **rol in deze stap** invullen; dit wordt
   de tekst onder "Rol per positie" op de spelerskaart.
4. Titel + uitleg van de stap, **Stap opslaan**. De volgende stap start met de
   eindposities van de vorige (grijze ghost-pijl toont wat er net gebeurde).
5. **+ Stap** herhalen tot de oefening klaar is; **Afspelen** toont de
   interpolatie; **Opslaan** rondt de oefening af (categorie, posities, niveau,
   optionele tegenhanger).

### 7 · Trainer: oefening inspreken (AI)

- Microfoon of tekstveld; spraak → tekst (Whisper via de AI Gateway of de
  Web Speech API van de browser).
- De AI (structured output met Zod-schema, via `src/lib/ai/client.ts`) levert
  `DrillStep[]` inclusief `frame` (posities/pijlen op basis van de
  standaardopstelling) en `roleNotes`. Herkende posities worden in de
  transcriptie gemarkeerd; niet-genoemde posities krijgen "wil je een rol
  toevoegen?".
- Resultaat direct als animatie bekijken, of **Aanpassen in editor** (6).
- Evaluatie: Braintrust-eval met 10–15 ingesproken oefeningen van de trainers,
  score op juiste posities, volgorde en pijl-types.

## Hoe faciliteren we dit? Drie routes

|                 | Route A · Statisch speelboek                                                                    | Route B · Speelboek + trainingsprogramma                                                                       | Route C · AI-ondersteund maken                                       |
| --------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Inhoud          | Oefeningen als JSON/TS in de repo (`src/content/speelboek/*.ts`), diagram als declaratieve data | `Drill`-model in Postgres, trainer-editor, koppeling aan `TrainingSession`                                     | Idem B, plus AI-extractie van whiteboard-foto's en tekst             |
| Spelersfuncties | Bibliotheek, detail, stepper, rol per positie                                                   | + afvinken, vragen, "vanavond oefenen we"                                                                      | + AI-samenvatting per positie                                        |
| Trainerfuncties | Geen (wij voeren in)                                                                            | Programma, delen via WhatsApp, editor (6)                                                                      | + inspreken/beschrijven (7) en whiteboard-foto                       |
| Nieuwe infra    | Geen; één SVG-renderer (`src/lib/speelboek/diagram.ts`)                                         | Migratie (`Drill`, `DrillStep`, `TrainingProgramItem`, `DrillAck`), API onder `/api/speelboek/**`, drag-editor | Spraak→tekst, structured-output-prompt + Zod-schema, Braintrust-eval |
| Inschatting     | 1 sprint                                                                                        | 2–3 sprints                                                                                                    | +1 sprint na B                                                       |

Aanbeveling: **start met A** (met een datamodel dat al op B is voorbereid) en
vul het speelboek met 6–8 oefeningen die de trainers nu al gebruiken, inclusief
Henry's Tip-in. Daarmee is de waarde direct zichtbaar en leren we of spelers
het openen. Route B pas als "vanavond oefenen we" een expliciete wens wordt;
route C zodra trainers vaker dan wekelijks nieuwe oefeningen willen toevoegen.

## Datamodel (voorstel, geschikt voor A en B)

```ts
type Drill = {
  id: string;                       // "tip-in"
  title: string;                    // "Tip-in"
  category: "AANVAL" | "VERDEDIGING" | "TECHNIEK" | "KEEPER";
  positions: Position[];            // ["VLEUGEL", "MIDVOOR"]
  level: "BASIS" | "GEMIDDELD" | "GEVORDERD";
  counterpartId?: string;           // "zone-5-6-m" bij "4-2-man-meer"
  steps: DrillStep[];
  keyPoints: string[];              // "Let op"
  commonMistakes: string[];
  videoUrl?: string;
  sourceFeedbackId?: string;        // koppeling naar de ideeënbus
};

type DrillStep = {
  title: string;
  text: string;
  frame: DiagramFrame;              // posities + pijlen voor deze stap
  roleNotes: Partial<Record<PositionNumber, string>>; // rol per positie (1–6) in deze stap
};

type PositionNumber = 1 | 2 | 3 | 4 | 5 | 6; // 1 rechts → 5 links, 6 midvoor

type DiagramFrame = {
  attackColor: "WHITE" | "BLUE";    // verdediging krijgt de andere kleur, keeper rood
  players: { id: string; team: "OFF" | "DEF" | "GK"; x: number; y: number; number?: PositionNumber }[];
  arrows: { kind: "MOVE" | "PASS" | "SHOT"; playerId: string; to: [number, number]; via?: [number, number] }[];
  ball?: string;                    // player id
};

const STANDARD_LINEUP: DiagramFrame = /* 1–6 wit, 6 verdedigers blauw, keeper rood, bal bij 3 */;
```

Het diagram is dus **data, geen afbeelding**: één renderer tekent het als SVG
(thumbnail, detail, animatie) en dezelfde data wordt door de editor (6)
bewerkt en door de AI (7) gegenereerd. `STANDARD_LINEUP` is het startpunt van
elke nieuwe oefening; een nieuwe stap kopieert de eindposities van de vorige.

## Open vragen voor Henry en de trainers

- Welke 6–8 oefeningen/tactieken zijn nu het belangrijkst om vast te leggen?
- Speelt H3 doorgaans in wit of blauw? (bepaalt de standaardkleur van de aanval)
- Willen trainers video's opnemen tijdens de training, of alleen diagrammen?
- Is afvinken ("ik snap 'm") gewenst, of voelt dat als controle?
