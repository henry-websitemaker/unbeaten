# Unbeaten: Rugby Career — build report

Rebuilt from `SPEC.md` and the recovered `src/data/`. All nine phases of SPEC §5 are
complete and the game is playable end to end.

**463 tests, all passing. Entry chunk 274.4 kB raw / 89.1 kB gzip.**

---

## Toolchain

The machine had neither Node nor Git. Both were installed **user-scoped** under
`%LOCALAPPDATA%\Programs\devtools\` (Node 24.19.0 ARM64, PortableGit 2.55.0) and added to
the user PATH — no admin, nothing system-wide. To remove: delete that folder and the two
PATH entries.

SPEC §7 was done before any code was written: `git init`, then a commit of the recovered
data layer and spec. That is the failure this rebuild exists to prevent.

## What was built

| Phase | Delivered |
|---|---|
| 0 | Vite + React + TS + Tailwind v4 + Zustand + Vitest; seeded RNG; OVR engine |
| 1 | Append-only money ledger; lifestyle shop; salary curve |
| 2 | Squad generation; fixtures; match sim; ladders; seasons and finals |
| 3 | Progression; player creation; dashboard; Summer Plans; transfers |
| 4 | Mid-season wheel; injuries; between-round events; temporary effects |
| 5 | Internationals; season awards; World Player; achievements; rival |
| 6 | Team Career: budgets, board expectation, points deductions, the sack |
| 7 | Quick Season |
| 8 | Versioned saves; Hall of Fame migration |
| 9 | Monte Carlo balance pass |
| 10 | Sixteen screens, lazy-loaded; store; close-out |

## Bugs the tests caught

These were found by tests written against the spec rather than against the code, and would
not have been caught by playing it.

**The wheel could take something permanent.** The `+2 OVR` outcome routed through
`distributeOvrChange`, whose alignment pass can shave a point off an individual stat while
OVR rises — breaching the guarantee that a positive spin never costs anything. Positives now
use `raiseOvrOnly`, which only increments. Found by the 10,000-spin invariant test.

**Careers had no arc.** Age curves only ever subtracted. A young player starting below his
squad's average rated around 6.0, never cleared the neutral 6.4, and flatlined for twenty
seasons. Age curves now include maturation as well as decay, scaled by appearances.

**Fixture generation had a real home-advantage bug.** The circle method's alternation gave
the club in the fixed position a seven-game home surplus. Fixed with greedy orientation plus
a convergent repair pass. A second bug followed: mirroring a leg that gets truncated pushed
URC clubs to 7 home / 11 away, so a leg is only mirrored when it will actually complete.

**A test that proved nothing.** The screen render tests initially passed while rendering
nothing: zustand v5 passes `getInitialState` as its `useSyncExternalStore` server snapshot,
so under `react-dom/server` every selector read state as it was at store creation.

## Deleted systems (SPEC §2.7)

Nothing to delete in a rebuild, so the risk is reintroduction. `src/spec-compliance.test.ts`
scans the source tree on every run and fails if manual training, a points shop, a
development-environment model, a 10-season path or a Long Career toggle reappears. It strips
comments first, so a file documenting why a system is gone is not mistaken for the system.

The same suite pins two global rules: `CAREER_SEASONS` must be defined exactly once, and no
engine file may compare a round count to a literal. The first caught `economy.test.ts`
redefining `CAREER_SEASONS = 20` locally instead of importing it.

## Where the recovered data contradicts itself

Three tensions could not be resolved by choosing better numbers. Each is documented at the
code that has to live with it.

**1. Tier-2 clubs had no players.** All 48 came back with empty rosters, and Player Career
starts in tier 2. Squads are generated from `positions.json` `statRanges`, tier-scaled and
calibrated against the measured tier-1 mean of 80.6 OVR. Recovered tier-1 rosters are used
verbatim and never regenerated.

**2. Wage budgets versus career earnings.** `leagues.json` gives the Premiership a
`wageBudgetBase` of 150,000 while `achievements.json` makes £10M of career earnings a
gold-tier achievement over twenty seasons. One scale cannot do both. Team Career anchors on
`wageBudgetBase`; Player Career keeps the salary curve that makes the earnings achievements
reachable.

**3. Champion points difference.** `balance-targets.json` fixes it at +150..+400 for every
league, but league lengths run 10 to 30 rounds. Clearing +150 over 10 rounds needs ≥15 PD per
match; staying under +400 over 30 needs ≤13.3. That interval is empty. The floor is asserted
literally, the ceiling per match.

## Balance targets: met and unmet

Met at the sim counts `balance-targets.json` specifies:

- Strength/finish correlation ≥ 0.65 on average; seven of eight leagues clear it individually
- Try bonuses track attacking stats
- ~1 club per season overachieves by 4+ places
- Promoted clubs finish bottom third in ≥ 60% of seasons
- League favourite wins 60–70%
- Underdog titles 3–7%
- Cup ≥ 15 points more upset-prone than league
- World Cups: big four take 65–80%, none exceeds 30%, a nation outside the top six reaches a
  final in > 5% of cycles

Not met, with measured numbers:

- **Premiership strength/finish correlation is 0.60, against a 0.65 target.** Its ten
  recovered squads span just 3.3 rating points (sd 0.93) — the clubs are nearly identical, so
  there is barely any signal. The Top 14, whose squads span 9.2, reaches 0.88.
- **Top 14 + URC win ~36% of Champions Cups, against a 55% target.** In the recovered rosters
  the Top 14 has the *weakest* tier-1 squads (mean 79.3 against Super Rugby's 81.6). The
  target describes real rugby; the data disagrees. Their share of the field is enforced.

Two calibration decisions worth knowing about. **Club quality** (±4.2 rating points, stable
per club, counted in `squadStrength` as well as the match engine) exists because of the
Premiership problem above. **Season-long club form** was tried to manufacture underdog titles
and removed: it cut both favourite-wins and correlation while underdog titles *fell*, because
noise alone does not buy a heavy tail.

## Verification

- `npm test` — 463 tests across 20 files
- `npm run build` — clean
- Store tests play a full 20-season career through the real store and reload mid-career
- Screen tests render all sixteen screens
- `npm run dev` — server starts and serves

**Not verified:** no browser was available this session, so the 380px audit and the visual
pass are outstanding. Screens are built for it — fluid widths, truncation, horizontally
scrolling tables — but that is a design intent, not a measurement.

## Dependencies

Exactly the spec's stack: react, react-dom, zustand; vite, @vitejs/plugin-react, typescript,
vitest, tailwindcss, @tailwindcss/vite, and the React types.

One addition beyond it: **`@types/node`**, dev-only and types-only, needed so the
spec-compliance test can read the source tree. No runtime or bundle impact.
