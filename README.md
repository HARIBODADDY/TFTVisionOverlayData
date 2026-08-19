# TFT Vision Overlay Data

Public, static metadata feed for the private TFT Vision Overlay Android app.

The current feed contains five patch 17.9 recommended comps, exact 4×7 board
coordinates, item recommendations, Team Planner codes, and S/A/B/C tiers for
247 augments. The Android app fetches `catalog.json` at startup and keeps the
last successful response as its offline cache.

The repository contains no app source, credentials, or personal data. It stores
only a compact, transformed metadata catalog; fetched HTML is never committed.
Champion and item names, exact board slots, recommended compositions, and tier
labels are refreshed from publicly visible LoLCHESS.GG pages. The original
source is attributed in every generated entry.

## Feed

- `catalog.json`: production feed fetched by the app at startup
- `catalog.schema.json`: JSON Schema for validation

Board coordinates use four rows (`0..3`) and seven columns (`0..6`). A TFT Team Planner code identifies the roster, while `units[].row` and `units[].column` preserve the exact formation.

Deck and augment tiers are transformed from attributed public meta snapshots.
An augment `pickRate` remains `null` when the source does not expose a
verifiable value; the app displays it as pending instead of inventing a number.

## Automatic refresh

`scripts/update-from-lolchess.mjs` reads the public server-rendered metadata,
matches statistical decks to curated 4×7 formations, converts slot indexes to
row/column coordinates, and resolves Korean champion/item names. It checks
`robots.txt`, includes a contact address in the standard `From` request header,
waits at least 1.2 seconds between requests, and fails without replacing the
last valid catalog if the source format changes.

The GitHub Actions workflow runs once per day at 06:20 KST and can also be run
manually. It does not build the Android app.

```bash
node scripts/update-from-lolchess.mjs --dry-run
node scripts/update-from-lolchess.mjs
node scripts/validate-catalog.mjs catalog.json
```

LoLCHESS.GG currently exposes S/A/B/C/D augment tiers but not a verifiable
augment pick rate. D is folded into C for the app's four-tier UI. Existing
verified pick rates are retained; otherwise `pickRate` stays `null`.
