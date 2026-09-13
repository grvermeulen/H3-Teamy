# GTA H3 — Slice 2: tv, controllers en dynamisch splitscreen

Datum: 13 september 2026. Opdracht: plan uitwerken en volledig uitvoeren.
Bron: ontwerp §10.2, met de servergestuurde kamerrechten uit de audit van 12 september als uitgangspunt.

## Doel en gebruikersflow

Een teamlid kiest Speler, Controller of Scherm + controller. Speler houdt het eigen spelbeeld.
Controller toont twee sticks, actieknoppen, gezondheid, wapen, verbinding en wedstrijdstatus,
zonder kaart, sprites of simulatie te laden. Scherm + controller toont het gezamenlijke beeld
met de eigen bediening eroverheen en kan via schermspiegeling naar de tv.

Op `/arena/scherm` kan een tv zonder account een kamer openen of met een code aansluiten.
De lobby toont een grote code en QR-link naar `/arena/controller?code=…`. De telefoon logt
zo nodig in en sluit als echte speler aan. HDMI en tabcasting worden in de bediening uitgelegd;
er wordt geen afzonderlijk castprotocol gebouwd. Een standaardgamepad bestuurt één ingelogde
speler per browser; een anoniem scherm krijgt daardoor geen spelersidentiteit.

## Ontwerpbeslissingen

- Kamerleden krijgen een servergeregistreerde rol en apparaatklasse. Er zijn maximaal acht
  spelers/controllerleden en twee schermen. Schermen tellen niet mee in de spelerscapaciteit,
  de simulatieseats, het startrooster of de ranglijst.
- Schermtoegang gebruikt een willekeurig HttpOnly-cookie, waarvan alleen de hash in de
  lidmaatschapsrij staat. Een kamercode opent uitsluitend schermtoegang; het cookie bewijst
  eigendom bij verlengen, verlaten, starten en resultaten versturen. Speler-API's blijven
  uitsluitend sessies accepteren. Alle publieke schermmutaties krijgen origincontroles en
  bestaande globale/IP-limieten; kamers en schermen verlopen vanzelf.
- Servergestuurde hostkeuze: zichtbaar scherm/hybride, desktopspeler, mobiele speler.
  Controllers zijn niet hostgeschikt, omdat zij geen kaart of simulatie laden. Zonder geschikte
  host blijft de kamer tijdelijk wachten. Verbergen/vertrek geeft de lease vrij. Een gezonde
  host blijft actief; bij de volgende verkiezing krijgt een geladen scherm voorrang.
  Zo ontvangt een nieuw scherm eerst de bestaande toestand. Epochkanalen scheiden autoriteit.
- Een scherm gebruikt dezelfde hostsimulatie, snapshots, scoreteller en wedstrijdklok.
  Een observer zonder voorspelling ontvangt snapshots voor schermen en controllers.
  Hostwissels behouden seats, posities, score en wedstrijdfase. De bestaande eigen-spelerloop
  krijgt alleen de rolfilters en de optionele gezamenlijke renderer.
- Splitscreen clustert op stabiele speler-ID's en een begrensde groepsomvang (circa 120 m),
  met hysterese en zoom binnen een veilige binnenruimte van het vlak. Eén groep vult het scherm;
  twee groepen delen het met een lijn loodrecht op hun onderlinge wereldrichting; drie/vier
  groepen krijgen een 2×2-indeling, vijf tot acht een passend raster. Camera's en vlakken
  bewegen exponentieel; bij een andere vlakindeling schakelen vlakken samen om zonder gaten
  en vervagen de scheidingen. Rasterzoom blijft op bestaande zoomniveaus,
  terwijl compositieschaling de overgang verzacht. Reduced motion schakelt beweging uit.
- Kaarttegels voor alle zichtbare groepen en alle spelers in de hostsimulatie blijven resident.
  De rastercache wordt gedeeld en krijgt één budget per frame, niet acht onafhankelijke caches.
- Wake Lock wordt opnieuw aangevraagd na terugkeer naar de tab; vertrek ruimt het op.
  Onbeschikbare browserfuncties blokkeren spelen niet. Focusverlies en gamepadontkoppeling
  leveren direct neutrale invoer op. Haptiek gebruikt de bestaande arenahelper.
- QR-codes gebruiken `qrcode.react`; geen externe QR-dienst en geen nieuwe generieke
  gamepadbibliotheek. De bestaande invoer-, snapshot-, kaart- en cameramodules worden hergebruikt.

## Uitvoering en acceptatie

- [x] 1. Protocol, database en migratie: rollen, anonieme schermleden, capaciteit en hostprioriteit.
      Bewijs: echte PostgreSQL-tests voor acht spelers plus scherm, ongeoorloofde leden, races,
      controlleruitsluiting, hostwissel en uitslagen zonder schermresultaat.
- [x] 2. Scherm-API: openen, aansluiten, heartbeat, leave, tokens, start en resultaat.
      Bewijs: geen wildcardrechten, geen invoerpublicatie door schermen, geen toegang tot andere
      kamers of accounts, verlopen toegang geweigerd, origin- en rate-limitcontroles.
- [x] 3. Observer en controllerinvoer: valide hostdata, verlies/herstel van keyframes,
      begrensde verzendfrequentie, status en haptiek; geen wereldlader in de controllerflow.
- [x] 4. Splitscreen: pure geometrie, vloeiende compositie, labels en gedeeld rasterbudget.
      Bewijs: 1–8 spelers, ketenvorming, stabiele indeling, twee diagonale groepen, herenigen,
      dode spelers, resize en reduced motion.
- [x] 5. Schermruntime en hybride integratie: dezelfde simulatie en wedstrijdklok,
      hostmigratie, meerdere tegelcentra, geen fictieve schermspeler.
- [x] 6. Nederlandse UI: rolkeuze, schermpagina, controllerpagina, code/QR, lobby,
      verbinding, start/herstart, verlaten, Wake Lock, gamepads en instructies.
- [x] 7. Release/documentatie: versie en dezelfde changelogsleutel, API/technische docs,
      overzicht van browserverificatie en eventuele hardwarebeperkingen.
- [x] 8. Verificatie en opschoning: productiebuild, typecheck, lint, volledige tests,
      geïsoleerde PostgreSQL-integratie, browsersmoke met tv + twee controllertelefoons,
      dependency/securityscan en review van alleen de wijzigingen van deze opdracht.

## Werkmap en oplevering

De werkmap bevat eerdere wijzigingen en reeds in de bestanden opgeloste indexconflicten.
Die worden behouden. De uitgangssituatie staat in `.cache/slice2-baseline.patch` en een lokale
bronkopie in de tijdelijke map. Deze opdracht voegt het implementatieplan, de werkende slice
en verificatiebewijs toe. Productiemigraties en fysieke AirPlay/Chromecast-tests worden niet
als uitgevoerd gerapporteerd zonder werkelijk bewijs.

## Geraadpleegde bronnen

- Bestaande code: `arenaRoomService`, `roomProtocol`, `hostLoop`, `clientLoop`, `renderScene`,
  `worldSession`, `inputState`, `haptics` en `useMatchClock`.
- [qrcode.react](https://github.com/zpao/qrcode.react): lokale SVG-generatie met TypeScript.
- [Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API).
- [Screen Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API).
- Next.js route- en clientcomponentgidsen uit `node_modules/next/dist/docs/`.

## Afgerond

Uitgevoerd in versie 0.3.0. Zie [resultaten en screenshots](../../tech/arena/slice-2-verification/README.md) en [API/migratie](../../tech/arena/TV-MODE.md).
