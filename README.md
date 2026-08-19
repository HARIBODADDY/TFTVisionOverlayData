# TFT Vision Overlay Data

Public, static metadata feed for the private TFT Vision Overlay Android app.

The current feed contains 12 patch 17.9 recommended comps, exact 4×7 board
coordinates, early/mid/final coach boards, item priorities and alternatives,
unit substitutions, Team Planner codes, and S/A/B/C tiers plus descriptions
for 272 augments. The Android app fetches `catalog.json` at startup and keeps
the last successful response as its offline cache.

The repository contains no app source, credentials, or personal data. It stores
only a compact, transformed metadata catalog; fetched HTML is never committed.
Champion and item names, exact board slots, recommended compositions, and tier
labels are refreshed from publicly visible LoLCHESS.GG pages. The original
source is attributed in every generated entry.

TFTactics.gg's public patch-matched team-comps page supplies Set 17 champion
game IDs and its Team Planner code format. When its roster exactly matches a
recommended comp, the site's code is used directly. Otherwise the same format
is applied to the LoLCHESS.GG roster, while the exact 4×7 formation continues
to come only from the curated LoLCHESS.GG board.

## Feed

- `catalog.json`: production feed fetched by the app at startup
- `catalog.schema.json`: JSON Schema for validation

Board coordinates use four rows (`0..3`) and seven columns (`0..6`). A TFT Team Planner code identifies the roster, while `units[].row` and `units[].column` preserve the exact formation.

Deck and augment tiers are transformed from attributed public meta snapshots.
The augment overlay intentionally displays only the S/A/B/C recommendation
tier so that unavailable or incomparable selection-rate values are not shown.

## Automatic refresh

`scripts/update-from-lolchess.mjs` reads the public server-rendered metadata,
matches statistical decks to curated 4×7 formations, converts slot indexes to
row/column coordinates, resolves Korean champion/item names and recommended
alternatives, builds three coach phases, and fills valid Team Planner codes and
substitution candidates from the current TFTactics.gg data bundle. It checks each
source's `robots.txt`, includes a contact address in the standard `From`
request header, waits at least 1.2 seconds between requests, and fails without
replacing the last valid catalog if a required source format changes.

The GitHub Actions workflow runs once per day at 06:20 KST and can also be run
manually. It does not build the Android app.

```bash
node scripts/update-from-lolchess.mjs --dry-run
node scripts/update-from-lolchess.mjs
node scripts/validate-catalog.mjs catalog.json
```

LoLCHESS.GG's D tier is folded into C for the app's four-tier UI. Augment
selection rates are deliberately omitted from both the feed and the overlay.
