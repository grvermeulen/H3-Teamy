# GTA H3 — tv-modus (0.3.0)

## Gebruik

Open `/arena/scherm` op een tv of een laptop aan HDMI. Dit scherm hoeft niet in te loggen.
Open een nieuwe kamer, of verbind met een bestaande code. Spelers scannen de QR-code,
loggen in met hun H3-account en gebruiken hun telefoon als controller. De code blijft na
inloggen ingevuld. De QR-code wordt lokaal gemaakt en bevat alleen de openbare kamercode.

Via `/arena/spelen` zijn drie standen beschikbaar:

| Stand               | Beeld                                        | Bediening                        | Kan host zijn? |
| ------------------- | -------------------------------------------- | -------------------------------- | -------------- |
| Speler              | Eigen camera                                 | Toetsenbord, touch of gamepad    | Ja             |
| Controller          | Gezondheid, wapen, acties en wedstrijdstatus | Twee sticks, knoppen of gamepad  | Nee            |
| Scherm + controller | Gezamenlijk beeld met eigen bediening        | Touch, toetsenbord of gamepad    | Ja             |
| `/arena/scherm`     | Gezamenlijk beeld                            | Lobbyknoppen; geen spelersinvoer | Ja             |

Voor telefoons die via AirPlay of Chromecast worden gespiegeld: kies Scherm + controller
en draai de telefoon. De tv toont hetzelfde beeld. Chrome kan een tabblad casten; er is
geen apart castprotocol. Eén standaardgamepad bestuurt één ingelogde speler per browser.
De linker stick beweegt/stuurt; rechts richt; RT/A schiet, B stapt in/uit en Y/RB wisselt wapen.
Wake Lock blijft actief zolang de browser dat toestaat en wordt na tabherstel opnieuw aangevraagd.

## Autoriteit en verbindingen

Een kamer biedt acht accountgebonden spelersplaatsen plus twee schermplaatsen. Alleen
accountleden krijgen een simulatieseat en kunnen voorkomen in het startrooster en de uitslag.
De database bewaart `role`, `device` en voor schermen een gehashte willekeurige sleutel.
Het oorspronkelijke accountmodel van slice 1 blijft gelden voor alle speler-API's.

Een scherm krijgt een 256-bits sleutel in `h3-arena-display`: HttpOnly, SameSite=Strict,
Secure op HTTPS, pad `/api/arena`, maximaal twee uur geldig. Alleen de SHA-256-hash wordt
opgeslagen. Een kamercode of een lid-ID bewijst geen eigendom. Iedere schermmutatie controleert
origin, bestaande globale/IP-limieten en het eigendom van het lid. Een accountcookie levert
geen schermrecht op en een schermcookie levert geen accountidentiteit op.

Een gezonde host blijft host. Bij vertrek, verbergen of verlopen lease kiest de server een
zichtbaar scherm/hybride, daarna een desktopspeler, daarna een mobiele speler. Controllers
zijn nooit kandidaat. Een nieuw scherm wordt pas tijdens een lopende ronde verkiesbaar na
wereldboot én een geldige snapshot. Deze volgorde voorkomt dat een pas aangesloten scherm
een actieve host verdringt voordat de toestand is ontvangen.

Heartbeat: 3 s; hostlease: 12 s; lidmaatschap zonder heartbeat: 20 s; kamer: 2 uur; token: 60 s.
Epochkanalen sluiten de oude host uit zodra de volgende host is gekozen. Een overnemend
scherm behoudt spelersplaatsen, posities, gezondheid, scores en historie van vertrokken spelers.
Zonder host bevriest het spelbeeld. Controllerinvoer wordt bij ontbrekende snapshots gewist;
focusverlies stuurt direct neutrale invoer. Vertrek stopt de zender en verwijdert het lid;
de host begrenst achtergebleven invoer bovendien tot een halve seconde.

## Scherm-API

Alle succesvolle antwoorden hebben `Cache-Control: no-store`. Fouten zijn Nederlandse JSON.
Gebruik de bestaande Zod-schema's in `roomProtocol.ts` en `schemas/arena.ts`.

| Route                                     | Verzoek                                                          | Antwoord / rechten                                         |
| ----------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------- |
| `POST /api/arena/display-token`           | `{roomCode}` of `{action:"join",roomCode,joinNonce}`             | `{ticket}` en schermcookie                                 |
| Dezelfde POST                             | `{action:"create",zone,joinNonce}`                               | Nieuwe kamer, ticket en cookie                             |
| `PATCH /api/arena/display-token`          | `{action:"heartbeat",memberId,visible}`                          | Vernieuwd ticket                                           |
| Dezelfde PATCH                            | `{action:"start",memberId,epoch}`                                | Host start ronde; minimaal één echte speler                |
| Dezelfde PATCH                            | `{action:"leave",memberId}`                                      | Verwijdert uitsluitend het eigen lid                       |
| `GET /api/arena/display-token?memberId=…` | Schermcookie                                                     | Ably-tokenrequest, clientId, displayName en ticket         |
| `POST /api/arena/display-matches`         | `{roundId,memberId,epoch,results:[{memberId,kills,deaths,won}]}` | Dezelfde idempotente uitslagcontrole als voor accounthosts |

Een schermtoken kan presence publiceren en state lezen. Alleen het huidige hostscherm
kan state publiceren en invoer lezen. Schermtokens kunnen nooit invoer publiceren en
bevatten geen wildcardkanalen. Resultaten blijven hostgerapporteerd; deze modus maakt
uitslagen niet cheat-proof. `hostUserId` is null bij een schermhost; resultaatregels blijven
uitsluitend gekoppeld aan echte accounts.

## Rendering

`splitScreen.ts` groepeert spelers deterministisch op ID. Groepen splitsen boven 120 m
en voegen samen onder 100 m; alle paren moeten passen, zodat een keten van spelers niet
onbeperkt uitzoomt. Zoom past binnen een veilige binnenruimte van het cameravak.

Eén groep vult het scherm; twee groepen krijgen een snijlijn loodrecht op hun onderlinge
wereldrichting. Drie/vier groepen gebruiken twee kolommen; vijf tot acht twee of drie,
afhankelijk van de oriëntatie. Dode spelers houden hun plaats in de groep tot zij terugkomen.
Camera's en zoom bewegen vloeiend. Vlakken bewegen samen waar de geometrie dat toelaat;
bij splitsen/samenvoegen of resize schakelt de verdeling atomair om zonder gaten, terwijl
de scheiding vervaagt. Reduced motion schakelt de beweging uit.

Alle vakken delen wereldtegels en rastercache, met één rasterbudget per frame. Cachezoom
blijft discreet; canvasschaling maakt zoomovergangen vloeiend. De host laadt tegels rond
alle spelers. Controllertelefoons importeren geen wereldlader en downloaden geen kaart/sprites.

## Migratie en verificatie

Pas `20260913000100_arena_tv_roles` toe vóór deze applicatieversie, na de bestaande
`20260912203500_arena_room_authority`. De migratie voegt rollen en schermidentiteiten toe;
bestaande leden worden `player`/`desktop`. De migratie is lokaal op de geïsoleerde database
uitgevoerd. Productie is met deze opdracht niet gemigreerd of gedeployed.

Zie [verificatiebewijs](slice-2-verification/README.md) en het
[implementatieplan](../../superpowers/plans/2026-09-13-city-arena-slice-2-tv.md).
Fysieke AirPlay/Chromecast, smart-tv-browsers, iOS-haptiek, echte gamepads en langdurige
warmte/batterijtests vragen nog een controle op de betreffende hardware.
