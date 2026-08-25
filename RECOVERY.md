# Unbeaten: Rugby Career — Recovered Data

Extracted from the Netlify production build (deploy 6a883c0ab232befe7842cab8, published 21 Aug 2026).
The original TypeScript source was never committed to GitHub, so this is reconstructed from the
minified bundle. The **data** survived intact; the **code** did not.

## What's here

### `src/data/` — recovered from the build, plus design data rebuilt from the original planning thread

Recovered from the deployed bundle:
| File | Contents |
|---|---|
| `teams.json` | 99 teams, 765 players — name, position, age, full stat block |
| `leagues.json` | 8 leagues with tier, team count, rounds, perfect-season target, physicality bias, wage budget, prize pool |
| `positions.json` | 15 positions — shirt number, stat set, OVR weightings, stat generation ranges |
| `achievements.json` | 26 achievements with tier and unlock condition (as JS source strings) |

Rebuilt from the design decisions in the original build thread:
| File | Contents |
|---|---|
| `archetypes.json` | 4 starting archetypes — Wonderkid, Late Bloomer, Iron Man, Journeyman — with growth curves and peak ages |
| `wheel-outcomes.json` | Mid-season gamble wheel — permanent positives, temporary-only negatives |
| `events.json` | 10 between-round events including wet weather stat re-weighting and derby week |
| `derbies.json` | 24 real rivalries across all 8 leagues with intensity ratings |
| `awards.json` | 6 season awards plus World Player of the Year eligibility floors |
| `internationals.json` | 12 nations, 4 competitions, form-based selection thresholds |

### `SPEC.md` — rebuilt
The original spec was lost with the Codespace. Reconstructed from the planning conversation: both
career modes, the mid-season wheel, transfer consequences, sack immunity, build order and the test
coverage that matters.

### `dist/` — the working built site
Runs as-is. Serve the folder and the game plays. Not editable (minified).

## Leagues recovered

**Tier 1:** Super Rugby Pacific (11), Gallagher Premiership (10), Top 14 (14), United Rugby Championship (16)
**Tier 2:** Shute Shield (10), Bunnings NPC (12), RFU Championship (12), Pro D2 (14)

## Stat system

Eleven stats: SCR (scrum), LNO (lineout), CAR (carry), TCK (tackle), RUK (ruck), FIT (fitness),
PAC (pace), HND (handling), VIS (vision), KCK (kicking), EVA (evasion).

Forwards and backs use different subsets. Each position has `ovrWeights` (how OVR is calculated)
and `statRanges` (min/max for generation).

## Confirmed game features

Pack draft system, stat-lock selection, season progression with max-season cap, contracts and wages,
club transfers, international caps, MOTM awards, trophy cabinet, career sackings, achievement tiers
(bronze/silver/gold/legend).

## What was NOT recovered

Component code, game logic (match simulation, progression curves, transfer AI), styling, and
state management. These are compiled beyond practical recovery.

## Rebuilding

You have SPEC.md from the original project plus this data. Point Claude Code at a fresh Vite +
React + TypeScript project, drop `src/data/` in, and rebuild the logic against the spec. The data
layer — the slowest part to author — is done.

**Set up Git first this time.** `git init`, commit early, push to GitHub before building anything.
