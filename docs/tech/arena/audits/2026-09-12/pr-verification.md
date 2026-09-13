# GTA H3 — controle van de PR-versie

De audit begon op commit `18cee84`. Voor deze PR is de implementatie samengevoegd met
`image` op `a7a2808`, inclusief kaart v3, de brouwerij, nieuwe wapens en voertuigen,
dichtere straten, sprites, boomkruinen, sirenes en vloeiender rijden. De release is
**0.2.3**, met een eigen Nederlandse changelog; de bestaande release 0.2.2 blijft behouden.

De [oorspronkelijke implementatieresultaten](implementation-report.md) beschrijven de
eerder geteste versie. De controles hieronder gelden voor de samengevoegde PR-versie.

## Resultaten

- **1.700 tests geslaagd**, nul mislukt; 28 bestaande tests overgeslagen. Daarvan zijn
  1.046 gerichte arena-tests ook afzonderlijk geslaagd. [Testuitvoer](tests-pr.json).
- **12 PostgreSQL/API-integratietests geslaagd** op de afzonderlijke lokale database.
  [Integratie-uitvoer](authority-pr.json).
- Typecheck en geoptimaliseerde Next-productiebuild geslaagd op **Node 22.23.2**.
  [Buildlog](build-pr.txt).
- `npm run docs:generate` geslaagd; de nieuwe sessieroute staat in de gegenereerde route-overzichten.
- ESLint: nul fouten en twee bestaande waarschuwingen buiten de arena.
- De uiteindelijke PR is afgezonderd van gelijktijdig lokaal werk aan tv/controllerrollen.
  In die aparte checkout zijn `npm ci --legacy-peer-deps --ignore-scripts`, Prisma-generatie
  en de productiebuild opnieuw uitgevoerd; de normale commitcontroles blijven ingeschakeld.
- `npm audit`: **nul bekende kwetsbaarheden** in productie- en ontwikkelafhankelijkheden.
  [Scanresultaat](npm-audit-pr.json).
- Productiebrowser: bestaande aanmelding, releasetour 0.2.3, aanmaken van een kamer,
  hoststatus, lobby inklappen, kaart en sprites, kwaliteitswissel naar Zuinig en Escape
  met focusherstel gecontroleerd. [Desktop](pr-desktop.png), [staand](pr-phone.png),
  [liggend](pr-landscape.png). Dit zijn browserweergaven, geen fysieke telefoontests.
- Het eerdere volledige Ably-potje met hostwissel en opgeslagen resultaat blijft
  bewijs voor de eerdere implementatie; die volledige live-sessie is na het samenvoegen
  niet opnieuw uitgevoerd. De huidige combinatie is gecontroleerd met de database/API-tests,
  browsercontrole en netwerksimulatie hieronder.

## Meting met de uitgebreidere kaart

Vier districten, acht spelers, 300 opwarmticks en 1.800 gemeten ticks per district.
Volledige snapshots en deltasnapshots zijn op dezelfde speltoestanden vergeleken.
De Node-meting omvat CPU en JSON-payloads; geen browser-GPU, Ably/TLS-overhead of thermisch gedrag.

| District   | Hoststap p95 | Lokale voorspelling p95 | Minder snapshotbytes |
| ---------- | -----------: | ----------------------: | -------------------: |
| Rhenen     |     2,061 ms |                0,014 ms |                55,3% |
| Wageningen |     2,051 ms |                0,012 ms |                55,4% |
| Campus     |     1,883 ms |                0,008 ms |                54,7% |
| Bennekom   |     1,916 ms |                0,008 ms |                53,5% |

De zwaarste gemeten hoststap was 63,7 ms in Bennekom; alleen het p95-cijfer zou deze
uitschieter verbergen. De eerdere 61–63% besparing hoorde bij de minder uitgebreide
wereld en is niet de actuele PR-meting.

Vijf gesimuleerde minuten met acht spelers, 10% pakketverlies en 33–167 ms vertraging:
15 Hz actieve input, 2 Hz in rust, maximaal 23 wachtende berichten, host bleef publiceren
en alle positieafwijkingen waren na rust kleiner dan 5 cm. [Ruwe metingen](performance-pr.json).

## Integratiekeuzes en uitrol

- De strikte netwerkvalidatie accepteert de huidige 19 spelersvelden, alle voertuigtypen,
  de nieuwe wapens en biertjesstatus. Een regressietest controleert zowel geldige spelobjecten
  als ongeldige waarden in de toegevoegde velden.
- De grafische optimalisaties behouden de nieuwe sprites, daktexturen, boomlaag en
  bewegingsinterpolatie. Beide rastercaches volgen de gekozen kwaliteit en schermgrootte.
- Vite 8.0.16 is een expliciete ontwikkelafhankelijkheid: `--legacy-peer-deps` verwijderde
  de impliciete Vite-peer bij het bijwerken, waardoor Vitest niet meer kon starten.
  TypeScript blijft vastgezet op 6.0.3.
- Pas de additieve migratie `20260912203500_arena_room_authority` toe vóór de nieuwe app.
  Bestaande potjes moeten opnieuw verbinden met de v2-kanalen. Er zijn geen externe
  databases gemigreerd en er is geen deployment uitgevoerd.
- Uitslagen blijven door de host gerapporteerd. Fysieke iOS/Android-tests met
  achtergrondgedrag, touch en langdurig spelen blijven nodig vóór brede uitrol.
