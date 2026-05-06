## Summary

Describe the change.

## User-facing release (“Wat is nieuw”)

De tour opent alleen als `package.json`-versie een bijpassende sleutel in `src/lib/changelog.ts` heeft én de gebruiker die versie nog niet heeft bevestigd.

- [ ] Nee — geen release richting eindgebruikers (alleen intern/technisch)
- [ ] Ja — **`package.json`-versie verhoogd** en **zelfde versie als sleutel** toegevoegd in `src/lib/changelog.ts` (stappen + geldige `data-tour`-targets waar nodig)

## Docs

- [ ] Updated relevant feature docs under `docs/tech/...`
- [ ] `npm run docs:generate` succeeds locally
- Links:
  - Feature doc(s):
  - Functional spec section(s):
