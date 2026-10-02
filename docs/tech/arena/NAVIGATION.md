# Kaart en navigatie

Tik op de radar om de stratenkaart op volledig scherm te openen. Sleep om de
kaart te verplaatsen en gebruik de zoomknoppen of het muiswiel om te zoomen.
Een druk van 550 ms op een straat stelt de bestemming in; slepen, loslaten en
een onderbroken aanwijzergebaar annuleren de selectie. Bekende plekken en
de knop **Kies kaartmidden** bieden alternatieven. Met het toetsenbord werken
de pijltjes, Enter en +/−. Escape sluit de kaart en herstelt de focus.

De bestemming ligt op de dichtstbijzijnde toegestane straat binnen 100 meter.
Tijdens het rijden vermijdt de route voetgangersstraten en respecteert hij
eenrichtingsverkeer. Te voet zijn snelwegen en autowegen uitgesloten. Een
onbereikbare bestemming geeft een melding zonder een rechte lijn door de
wereld te tekenen.

De route verschijnt op de radar, op de grote kaart en als blauwe pijlen op
het wegdek. Na verplaatsing wordt maximaal eenmaal per seconde opnieuw
gepland; wisselen tussen lopen en rijden triggert direct een nieuwe route.
Bij aankomst stopt de begeleiding. Via de kaart kan de speler de bestemming
veranderen of **Navigatie stoppen** kiezen.

## Implementatie

- `src/lib/cityArena/world/navigation.ts` hergebruikt het bestaande A*-algoritme
  en splitst de geselecteerde wegsegmenten tijdelijk bij vertrek en bestemming.
  De gedeelde verkeersgraaf wordt niet aangepast.
- `ArenaNavigationMap.tsx` gebruikt de reeds geladen wegen en locaties. Er zijn
  geen extra kaartdiensten, afhankelijkheden of API-aanroepen nodig.
- De bestemming hoort bij de lokale runtime en wordt niet naar andere spelers
  verstuurd. In een gedeeld scherm verschijnt de route alleen in een viewport
  waarin de lokale speler zit.
- Tijdens het plannen worden de spelbesturing en ingedrukte knoppen vrijgegeven.
  De simulatie blijft lopen; de kaart pauzeert een multiplayerpotje niet.

## Verificatie

Unit- en integratietests dekken segmentselectie, eenrichtingsverkeer,
onbereikbare bestemmingen, routeherberekening, aankomst, lang indrukken versus
slepen, toetsenbordbediening, focusherstel en de tekenvolgorde van de begeleiding.

Lokaal gecontroleerd met Playwright op desktop (1280×800), telefoon (390×844)
en liggend scherm (844×390), inclusief een browser-touchgebaar en de
controle dat kaartbediening de speler niet verplaatst. Deze browsercontrole
gebruikte een gemockte accountsessie en de lokale verkenmodus.
