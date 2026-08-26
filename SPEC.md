# Unbeaten: Rugby Career — Build Spec

A browser-based rugby union career sim in the 38-0-0 genre. No rugby equivalent exists — 15 positions
give richer squad-building than football, position eligibility is genuinely strict, and the sport has
real "perfect season" lore.

**Stack:** Vite + React + TypeScript + Tailwind + Zustand. Engine logic as pure functions in
`/src/engine/` with Vitest tests. Seeded RNG. localStorage persistence with a versioned state object
and a migration function.

**Rules for Claude Code:** plan mode first, always. Tests pass and `npm run build` succeeds before any
phase is done. No new dependencies without asking.

> **Section 2 overrides anything older.** Where this spec contradicts an earlier instruction, this spec
> wins. Superseded systems are listed in §2.7 and must be deleted, not disabled.

---

## 1. Data layer (built — `/src/data/`)

| File | Contents |
|---|---|
| `teams.json` | 99 clubs, 765 players — position, age, stat block |
| `leagues.json` | 8 leagues — real season lengths, finals format, bonus points, wage budget, prize pool, promotion |
| `positions.json` | 15 positions — number, stat set, OVR weights, generation ranges, **keyStats** |
| `achievements.json` | 26 achievements across bronze/silver/gold/legend |
| `archetypes.json` | 4 starting archetypes with growth curves |
| `wheel-outcomes.json` | Gamble wheel at exactly 50/35/15, permanence flags per outcome |
| `lifestyle.json` | 5 lifestyle purchases with costs and effects |
| `events.json` | 10 between-round events |
| `derbies.json` | 26 real rivalries with intensity ratings |
| `awards.json` | 7 season awards, World Player floors, achievement grid categories |
| `internationals.json` | 22 nations in 6 regions, 8 competitions, World Cup seasons, selection thresholds |
| `balance-targets.json` | Monte Carlo distribution assertions |

Text names only — no logos, badges, kits or competition branding.

Stats: SCR, LNO, CAR, TCK, RUK, FIT (forward-leaning) and PAC, HND, VIS, KCK, EVA (back-leaning).

---

## 2. Corrected rules

### 2.1 Career length — fixed at 20

Every career is **exactly 20 seasons**. No 10-season option, no Long Career toggle. The HUD always
reads `Season X/20`. Career-score maths assumes a 20-season denominator. Any copy referring to variable
career length is wrong and must be rewritten.

### 2.2 Hall of Fame

Ranks **only legitimate completed 20-season careers**. Stored entries from any other format are
migrated out of the ranked table. Unfinished careers appear in a separate, clearly unranked section.
Migration needs a test against a store containing old-format entries.

### 2.3 Season lengths — from the data file, never hardcoded

| League | Regular rounds | Finals |
|---|---|---|
| Bunnings NPC | 10 | + finals |
| Super Rugby Pacific | 14 | + finals |
| Shute Shield | 18 | + finals |
| Gallagher Premiership | 18 | + playoffs |
| United Rugby Championship | 18 | + playoffs |
| RFU Championship | 22 | none |
| Top 14 | 26 | + finals |
| Pro D2 | 30 | + finals |

Fixture generation, the sim, appearance counts and career records all read these values. No league
length may appear as a literal anywhere in the engine.

### 2.4 Ladder and trophy realism

Targets live in `balance-targets.json` and are enforced as tests, not eyeballed.

**Ladders** (100 sims per league): strength correlates with finishing position; realistic points
differential at both ends; try bonuses track attacking stats; roughly one club per season overachieves
by 4+ places; promoted clubs finish bottom third at least 60% of the time.

**Trophies** (200 sims): favourites win 60–70%; genuine underdogs take 3–7%; cup favourites win at
least 15 points less often than league favourites; Top 14 and URC clubs take 55%+ of Champions Cups.

**Internationals**: New Zealand, South Africa, France and Ireland win 65–80% of World Cups between
them, but no single nation exceeds 30%; a nation outside the top 6 reaches a final in 5%+ of cycles.

### 2.5 Progression — match performance first, plus a pre-season block

> **Amended twice.** An earlier revision removed manual training entirely; it was then
> restored as a per-summer block; it is now a **per-stat pick**. The line that survives both
> reversals is **no currency and no accumulation** — you get one pick a year, it is
> use-it-or-lose-it, and nothing carries over. That is what still separates this from the
> points shop, which stays deleted.

OVR moves from five sources only:

1. Match performance — still the dominant one
2. Club moves
3. Wheel outcomes
4. Age curves per archetype and position
5. **Pre-season training** — exactly one block per summer (§2.8)

### 2.8 Pre-season training

Summer Plans shows the player's current stats and they choose **exactly one to improve**,
once per season. Each stat belongs to one of four blocks, which supply the flavour of what
that choice represents:

| Block | Stats | Represents |
|---|---|---|
| Gym Block | SCR, CAR, TCK | Power — contact and set piece |
| Fitness Camp | FIT, PAC | Conditioning — lasting a season |
| Tactical Film | LNO, VIS, KCK | Reading the game |
| Skills Session | HND, EVA, RUK | Ball skills |

The **OVR effect of each pick is shown on its card** before it is chosen, the same way a
destination card shows its OVR consequence (§2.5). Key stats carry 2.5× weight, so working on
one moves OVR two to three times as much; the player is entitled to know that rather than
guess, and rounding out a weakness stays a legitimate call.

Training must not be able to break the progression targets in `balance-targets.json`: the peak
band holds with a player who trains optimally every summer, enforced by the Monte Carlo pass
rather than by eyeballing.

There is still **no points shop, no currency and no accumulation** — one pick a year, use it
or lose it. The development-environment model remains deleted (§2.7).

### 2.9 The shape of a career

OVR **moves in both directions**. A poor season costs OVR rather than merely slowing growth:
`balance-targets.json` requires a share of prime seasons to go backwards, because a line that
only ever climbs has no tension in it.

There is **no effective ceiling**. Growth slows as a player improves — going 90 to 95 is not
the task 70 to 75 is — but it is never switched off, so **99 is reachable** by an exceptional
twenty-season career and out of reach for an ordinary one. An earlier model tapered everyone
out in the mid-eighties, which made the top of the scale not hard but impossible.

**Club move rule, end to end:**

| Move | OVR change |
|---|---|
| Step up a tier | +1 to +3 |
| Stay | ±0 |
| Step down a tier | −1 to −3 |

Shown on the Summer Plans destination cards before choosing, and again in the season review. Any older
development-environment model is deleted.

### 2.6 Player creation

Each position's three `keyStats` start **+4 to +6 above** the player's other stats, and carry **2.5×
weight** in the engine. Both values sit in `positions.json`.

### 2.7 Deleted systems

Removed from the codebase, not left dormant:

- Points shop and any per-attribute spending
- Development-environment model
- 10-season career paths and the Long Career toggle
- Any permanent-loss wheel outcome

Pre-season training was on this list and has been **deliberately restored** (§2.8), first as a
block and then as a per-stat pick. It is the one entry ever taken off it; the rest stay gone.
Note that "per-attribute spending" is banned as a *currency* — saving and spending points —
not as the act of choosing which attribute a summer's work goes into.

---

## 3. Game modes

Menu: **Player Career** → **Team Career** → **Quick Season** → Trophy Cabinet → Hall of Fame.
Separate save slots per career mode.

### Player Career (the main mode)

**Forge Your Player.** Origin draft pulling stat cards from real stars, locking one stat at a time.
Position archetype card (FWD / HLF / BCK), then a starting archetype from `archetypes.json` —
Wonderkid, Late Bloomer, Iron Man or Journeyman.

**Choose your league.** Pick one of the four tier-2 leagues at creation, with copy explaining
what each sets: budget, style of play and difficulty. The club within it is still random, and
still weighted towards squads thin in your position so a career can actually start. OVR 55–65,
rookie minimum, selection not guaranteed. **Tier-1 leagues are not selectable and must be
earned** — starting in one at 55–65 means never being picked at all.

**Season preview.** Club, league, salary, contract years remaining, squad role, coach expectation,
league difficulty, current OVR and form.

**Dashboard.** The 38-0-0 layout exactly — four stat cards, green club pill, match log with coloured
result chips, *Play next match* and *Sim to season end*. Plus a **separate full-screen league table
view**. Every result shows tries and rating: `W 31–17 · 2 tries · rating 8.4`.

**Mid-season wheel.** Auto-pause at halfway. One optional, skippable spin. 50% positive / 35% negative
/ 15% neutral. Positives permanent (stats, OVR, traits); negatives temporary only (form, injury,
morale). A test must spin every outcome and assert nothing permanent is ever lost.

**Match agency.** At most two skippable, stat-driven decisions per match.

**Injuries.** Low base rate — 0–1 per season for a fit player. Most 1–3 weeks; season-enders under 2%.

**Between-round events.** ~1 in 4 rounds, from `events.json`.

**Summer Plans.** Destination choice with the OVR consequence shown up front, the **pre-season
training block** (§2.8), and the **Lifestyle shop** (§4). One destination among them may be a
**Mystery Club** — the club is hidden until the season starts, and the card says so.

**Squad role** reads as First Team, Impact Sub or Bench Cover.

**Match agency and the game plan.** Before each match, a game plan — Forward power, Back-line
finesse, Balanced flair, Tactical depth, High risk high reward, or Adapt to opponent. It is
**sticky**: it carries over from the last match until changed, so a season is not thirty
identical choices. Alongside it, at most two skippable, stat-driven decisions (§3). Pre-match
news lines carry the flavour.

**Season verdict.** The review opens with one of World Class, Solid, Steady Performer or
Quiet Season.

**Internationals.** Form-based selection with the threshold scaling by nation strength. Annual
tournament banner. World Cups in seasons 4, 8, 12, 16 and 20. Caps and international trophies tracked
through to retirement.

**Awards.** Top Try Scorer (with a near-miss line when 2nd or 3rd), Top Points Scorer, Players' Player,
Young Player, Team of the Season, Try of the Season. **World Player of the Year** computed against a
simulated elite pool with hard eligibility floors, changing nominees each season, a one-line
justification per nominee, and a test asserting a rookie almost never wins.

**Achievement grid.** Four categories: milestones, feats, journey, legend.

**Rival.** One AI player generated at creation, with a head-to-head view and a verdict at retirement.

**Derbies.** From `derbies.json`, including Sydney Uni–Warringah, Randwick–Easts, Easts–Gordon and
Manly–Norths.

**Career end.** Season 20 → summary with caps, tries, points, trophies, salary history → Hall of Fame.

### Team Career (manager)

Board expectation → sign via packs and stat-lock draft inside the wage budget → sim → extension or
sack. Wages deducted weekly, prize and gate money in. **Signing fails if it breaks budget** — Vitest
must prove it. Overspending triggers a points deduction. Promotion and relegation. Named try-scorers.

**Sack immunity: any trophy that season protects you regardless of league finish.**

### Quick Season

No budget, no saves. Draft an XV, sim one season, chase the perfect record, share, restart.

---

## 4. Lifestyle shop

Sits in Summer Plans. Purchases **actually deduct from career earnings** — this is the part most likely
to end up faked, so reconciliation is tested at every season boundary: purchases + remaining balance
must equal gross earnings.

| Item | Cost | Effect |
|---|---|---|
| Personal Trainer | £500k | +25% match-based growth |
| Private Physio | £750k | Injury risk halved, recovery −1 week |
| Sports Psychologist | £400k | Slumps 50% shorter, big-match boost |
| Elite Agent | £1M | +1 offer per window, +10% future salaries |
| Off-Season Retreat | £250k | Start next season in peak form — **repeatable** |

One-time items grey out once owned and show a badge on My Player.

---

## 5. Build order

1. Data layer — done
2. Economy and lifestyle reconciliation
3. Season sim + ladders reading real lengths from data
4. Player Career: creation → dashboard → Summer Plans → transfers
5. Wheel, events, injuries, match agency
6. Internationals, awards, achievements, rival
7. Team Career
8. Quick Season
9. Monte Carlo balance pass against `balance-targets.json`

---

## 6. Quality close-out

- Full suite green
- Dead code deleted: points shop and per-attribute spending, development-environment model,
  10-season paths. **Not** the training system — that is restored by §2.8
- Bundle under 300KB, or route-level lazy loading
- *Sim to season end* must not freeze the UI — chunk it or move it off the main thread
- 380px mobile audit on every screen
- Versioned save schema with a migration test
- Final report: what was fixed, what was removed, test count, bundle size

---

## 7. Before writing any code

```
git init
git add .
git commit -m "initial: recovered data layer + spec"
git remote add origin <your-repo-url>
git push -u origin main
```

The first build was lost because it lived only in a Codespace and went straight to Netlify from the
CLI. Commit first, build second.
