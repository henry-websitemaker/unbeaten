# Unbeaten: Rugby Career — build report

Rebuilt from `SPEC.md` and the recovered `src/data/`. All nine phases of SPEC §5 are
complete and the game is playable end to end.

**502 tests, all passing. Entry chunk 294.0 kB raw / 95.4 kB gzip.**

> **Update — the awards, internationals and match agency pass.** The section
> [Three SPEC §3 features that were not actually wired in](#three-spec-3-features-that-were-not-actually-wired-in)
> corrects this report's earlier claim that phase 5 delivered internationals and awards. It
> also records a progression defect found while testing that work.

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
| 11 | Awards, internationals and match agency joined to the game; nineteen screens |

## Three SPEC §3 features that were not actually wired in

The row above for phase 5 — "Internationals; season awards; World Player; achievements;
rival" — was only half true, and this report should not have claimed it.

`src/engine/awards.ts` (393 lines) and `src/engine/internationals.ts` (306 lines) were
written and thoroughly unit-tested, and then **imported by nothing but their own tests**. The
career never played a test match and never won an award: `PlayerCareer.awards` was
initialised to `[]` and never appended to, and `SeasonRecord.internationalCaps` was written
as a literal `0` on every season of every career. Match agency — SPEC §3's "at most two
skippable, stat-driven decisions per match" — had no implementation at all.

The consequence was concrete. **Eight of the twenty-six achievements could never unlock**,
because their predicates read `internationalCaps` or `awardTypes`: `test_debut`, `caps_10`,
`caps_50`, `caps_100`, `wc_winner`, `legend`, `top_scorer` and `world_player`. The
achievement grid rendered them permanently greyed out.

The lesson is the same one the phase-10 note about `getInitialState` makes: a test that
exercises a function proves the function works, not that the game uses it. Unit tests on an
unimported module pass forever. The new `src/engine/seasonClose.test.ts` drives the real
season loop instead, and `src/spec-compliance.test.ts` would be the right place to pin
"every engine module has a non-test importer" if this recurs.

**What was added**

- `src/engine/seasonClose.ts` joins both engines to `endSeason`, which is the only season
  boundary. Internationals resolve first, because World Player of the Year scores on test
  caps. Selection reads a genuine recent-form window — the last six match ratings, the
  `formWindowMatches` the data specifies — rather than the season average.
- The World Cup is simulated whether or not the player is picked, so a World Cup season has
  a winner even when the player watched it from home. Only caps, tries and trophies are
  withheld. The trophy name comes from `internationals.json`, which is the same string
  `wc_winner` matches on, so the two cannot drift.
- `src/engine/agency.ts` is new. Nine situations, each offering a safe option that is always
  a certainty and always positive, and a risky one whose odds come from the stats the call
  actually tests, clamped to 25–90% and shown on the card before the choice. Which
  situations a player sees is decided by their stat block, not a hardcoded position list — a
  prop is never asked to take a shot at goal because a prop has no KCK.
- A failed call costs form or morale through the existing `TemporaryEffect` machinery and
  can never touch stats, OVR or traits. That is the wheel's guarantee, tested the same way:
  every option, every seed.
- Three screens: `MatchScreen`, and `AwardsScreen` / `InternationalsScreen` in
  `SeasonScreens.tsx`. Both new season screens fall back to career-level data, so they still
  render after a mid-career reload when there is no summary in memory.

**One interface change worth knowing about.** `nextRound()` still means "play a round", so
everything that drives a season forward kept working unchanged. The dashboard button now
calls `openMatch()`, which offers the calls first and falls through to `nextRound()` when
there are none. Splitting it this way, rather than making `nextRound` stop to ask, avoided
touching every season-driving loop in the tests — and the loops that were touched would have
been silently playing zero rounds.

`selectionOutlook` is a plain function, not a hook. A hook defined inside `gameStore.ts`
calls the real `useGame` even when a test has mocked the module for its importers — the same
`useSyncExternalStore` trap phase 10 hit, which cost a round of debugging here too.

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

## Unfixed: the career arc collapses, and no ordinary career reaches international standard

Found while testing the internationals work, measured, **not fixed** — it is a progression
balance question, not a wiring one, and it needs a decision rather than a guess.

A career cannot climb. Measured over full 20-season runs:

| | |
|---|---|
| Tier-2 starting XV averages | **66.8–68.1** OVR (bench 62–63) |
| Player starts at | **58–64** OVR (SPEC §3: "OVR 55–65") |
| Player's season rating | **5.1–5.9**, against a `NEUTRAL_RATING` of **6.4** |
| Peak OVR reached | **~71** at best, typically 60–64 |
| OVR at season 20 | **17–47** |
| Italy's selection floor | 73 OVR and 7.08 average form |

Two independent defects compound:

**1. Match performance only ever subtracts.** The rating scale is fine — 30 players in a
tier-2 match average 6.47, so `NEUTRAL_RATING = 6.4` is the right bar. But a player rates
above it only from about OVR 73, and reaching 73 requires growth that, per SPEC §2.5, comes
primarily from match performance. It is a bootstrap that never starts: `performance` is
negative in *every* season of a typical career, and the only positive term is maturation,
which is capped around +1.5/season and expires at the archetype's peak age.

The earlier "Careers had no arc" fix addressed the symptom by adding maturation. It did not
reconcile the rating a fringe tier-2 player actually earns with the bar they are measured
against, which is the underlying disagreement.

**2. Age decay is unbounded.** `ageEffect` decays by `(yearsPast × 0.45 + yearsPast² × 0.05)
/ lateMultiplier`, which for a Wonderkid at 38 is **−18.3 OVR in a single season**. The
`MAX_SEASON_SWING` clamp holds it to −6, but −6 every season for the last third of a career
is what takes a peak of 71 down to 25. Only the Late Bloomer (`lateMultiplier` 1.4) declines
plausibly.

The effect on the work above: **internationals are wired correctly and provably work** — at
OVR 80 the player is selected and wins 9 caps in a season — but an ordinary career never
gets there, so in practice the caps achievements stay locked for balance reasons rather than
wiring ones. `seasonClose.test.ts` therefore tests the wiring against a player raised to
international standard, and says so at the harness.

Fixing this means retuning `NEUTRAL_RATING`, the involvement curve and the decay formula
against `balance-targets.json` — SPEC §2.4's "enforced as tests, not eyeballed" discipline —
and it should be its own pass with its own Monte Carlo evidence.

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

- `npm test` — 502 tests across 22 files
- `npm run build` — clean. The entry chunk is **294.0 kB raw / 95.4 kB gzip**, up from
  274.4 kB: `career.ts` now reaches the awards and internationals engines, and `careerRun.ts`
  reaches the agency table, so all three land in the entry chunk however the screens are
  split. Still inside SPEC §6's 300 kB, but with only ~6 kB of headroom — the next engine
  added to the season loop will need route-level splitting of the engine itself, not just
  the screens.
- Store tests play a full 20-season career through the real store and reload mid-career
- Screen tests render all nineteen screens
- `npm run dev` — server starts and serves

**Still not verified:** no browser this session either, so the 380px audit and the visual
pass remain outstanding. The new screens follow the same fluid-width, `ScrollX`-for-tables
conventions as the rest, and the dashboard's action row was moved to a 2×2 grid that becomes
4×1 above `sm` — but that is design intent, not a measurement.

## Dependencies

Exactly the spec's stack: react, react-dom, zustand; vite, @vitejs/plugin-react, typescript,
vitest, tailwindcss, @tailwindcss/vite, and the React types.

One addition beyond it: **`@types/node`**, dev-only and types-only, needed so the
spec-compliance test can read the source tree. No runtime or bundle impact.
