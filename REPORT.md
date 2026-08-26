# Unbeaten: Rugby Career — build report

Rebuilt from `SPEC.md` and the recovered `src/data/`. All nine phases of SPEC §5 are
complete and the game is playable end to end.

**512 tests, all passing. Entry chunk 295.0 kB raw / 95.8 kB gzip.**

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
| 12 | The career arc: five progression defects fixed, tuned against Monte Carlo evidence |

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

## The career arc: five defects, and the Monte Carlo pass that found them

The previous section of this report recorded the collapsing career arc as measured but
unfixed. This is that pass. Every constant below was chosen from the sweep, not guessed, and
is held by the new `progression` block in `balance-targets.json`.

### Before and after

Measured over 60 full 20-season careers, four archetypes, through the real season loop:

| | before | after |
|---|---|---|
| Careers that ever play a match | **33%** | **100%** |
| Median appearances across 20 seasons | **0** | **~310** |
| Median peak OVR | **60.5** | **81** |
| Median peak age | 25 | **30** |
| Median OVR at retirement | **49** | **77** |
| Careers retiring above 65 | 0% | **77%** |
| Careers earning a test cap | **0%** | **~58%** |
| Highest OVR reached by any career | 64 | 89 |

Archetype peaks went from 30 points apart (Wonderkid 86–97, Late Bloomer 61) to 6 apart
(84 / 82 / 80 / 79).

### What was actually wrong

Five defects, only two of which the brief anticipated. The first three were found by
measurement; the last two only became visible once the ones in front of them were fixed.

**1. Age decay was unbounded.** `(yearsPast × 0.45 + yearsPast² × 0.05) / lateMultiplier`
reached **−18.3 OVR in a single season** for a Wonderkid at 38. Clamped to −6 by
`MAX_SEASON_SWING`, that still took a peak of 71 down to 25. Now it approaches a per-archetype
ceiling exponentially: still strictly increasing every year, but incapable of running away.

**2. The involvement curve hid a hardcoded season length.** `min(1, appearances / 12)` meant
an **ever-present player in the 10-round NPC could never earn full development** (0.83 at
best), while one in the 30-round Pro D2 earned it by round 12 — 40% of a season. It now
divides by the league's own round count. `spec-compliance.test.ts` gained a rule for this
shape of the bug; its existing rule only caught `rounds === <literal>`.

**3. Morale had a one-way ratchet into selection.** An unselected player lost 3 morale a
round with no floor and no recovery. `selectionAdjustment` feeds morale straight back into
whether he is picked, on the same scale as the **1–3 rating points** that typically separate
two rivals for a shirt — so one season on the bench applied a permanent −1.8 selection penalty.
**Being dropped was what kept you dropped, for twenty seasons.** Morale now has a floor and
form drifts back to neutral while out of the side.

**4. Selection was a hard cut at fifteen.** No rotation, no rest, no injuries to AI players:
the same XV played every round of every season, so the sixteenth-best player never appeared.
Whether you were 15th or 16th was settled at career creation by which club you landed at.
**Only 33% of careers ever made a single appearance.** Since match performance is SPEC §2.5's
main source of OVR, two thirds of careers had no way to develop at all. Every club now gets a
weekly rotation nudge, and the starting club is weighted towards squads thin in the player's
position — still random, and a strong incumbent is still possible.

**5. The Wonderkid was strictly dominant.** Maturation scaled directly off `earlyMultiplier`
(1.45 against the Late Bloomer's 0.7), so the archetype choice at creation was one right
answer and three wrong ones. Pushing the shared knobs hard enough to lift the Late Bloomer
sent the Wonderkid past 99. `archetypeInfluence` now decides how much that multiplier sets
the *height* of the curve as opposed to its shape: `earlyMultiplier` still governs how fast a
player matures and how well they convert a good season, `lateMultiplier` still governs the
decline, but all four archetypes reach a competitive peak by different routes.

A sixth change fell out of the tuning: gains now suffer **diminishing returns near the top**,
because without it a strong career compounded into the high nineties, past anything in the
recovered data. Getting from 90 to 95 is not the same task as 70 to 75.

### Where the targets fought each other

Two pairs could not both be satisfied, and both are recorded at their assertions rather than
quietly loosened.

**Retirement share versus the peak band.** The plan proposed that 80% of careers retire above
65. Measured: **77%**, with a median retirement OVR of 77 — comfortably clear of the floor
itself. The last few points are a tail of Journeymen, who start latest and peak earliest;
lifting them means lifting low peaks, which pushes the median peak out of its 78–82 band. The
target is set at 0.75, which is measured with margin rather than aspirational.

**Rotation spread versus two ladder targets.** Rotation is what buys the player game time, but
it also perturbs league results, and it does so in opposite directions for two existing
targets — more rotation produces more underdog titles and *fewer* big overachievers, because
it costs a thin squad more than a deep one. At spread 2.2 the overachiever rate fell to
exactly its 0.4 floor; at 1.9 underdog titles fell to 2.875% against a 3% floor. **2.05
satisfies both**, along with every other ladder and trophy target. That is a narrower window
than is comfortable, and it is the reason `ROTATION_SPREAD` is a named constant with the
measurements written next to it.

### One test was recalibrated, deliberately

`costs a player who rated badly` asserted that a 24-year-old rating **5.2** loses OVR. That
was chosen against a neutral bar of 6.4. With the bar at 5.7, 5.2 is half a point below
average — a mediocre season, not a bad one — and the true delta of −0.25 rounds to an integer
0. The test was asserting against a scale that no longer existed. It now expresses its rating
**relative to `TUNING.neutralRating`**, so it cannot silently drift again, and a second test
was added asserting the property that actually matters: a bad season leaves the same player
worse off than a good one.

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

- `npm test` — 512 tests across 22 files, ~9 minutes. The progression block runs 60 full
  20-season careers through the real loop, which is most of the added time and the reason
  the defects it guards against were invisible to unit tests.
- `npm run build` — clean. The entry chunk is **295.0 kB raw / 95.8 kB gzip**, up from
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
