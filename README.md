# TFT Vision Overlay Data

Public, static metadata feed for the private TFT Vision Overlay Android app.

The current feed contains five patch 17.9 recommended comps, exact 4×7 board
coordinates, item recommendations, Team Planner codes, and S/A/B/C tiers for
247 augments. The Android app fetches `catalog.json` at startup and keeps the
last successful response as its offline cache.

The repository contains no app source, credentials, personal data, or copied LoLCHESS.GG content. Deck entries must be curated from data that the contributor is allowed to use. Riot/CommunityDragon identifiers may be used for static champion and item references.

## Feed

- `catalog.json`: production feed fetched by the app at startup
- `catalog.schema.json`: JSON Schema for validation

Board coordinates use four rows (`0..3`) and seven columns (`0..6`). A TFT Team Planner code identifies the roster, while `units[].row` and `units[].column` preserve the exact formation.

Deck and augment tiers are transformed from attributed public meta snapshots.
An augment `pickRate` remains `null` when the source does not expose a
verifiable value; the app displays it as pending instead of inventing a number.
