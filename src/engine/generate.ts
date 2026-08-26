/**
 * Player and squad generation.
 *
 * Two jobs. First, the 48 tier-2 clubs came back from the recovered bundle with empty
 * rosters, so their squads have to be built from `positions.json` `statRanges`. Second,
 * every club — recovered or generated — needs bench depth, because the recovered rosters
 * are a starting XV only and an injury with no cover would leave a hole in the team.
 *
 * All of it is driven by the career seed, so the same career always sees the same league.
 */

import { POSITIONS, getLeague } from '../data'
import { clampStat, computeOvr, ratePlayer, ratingInSlot } from './ovr'
import { generateName, regionForLeague } from './names'
import { hashString, type Rng, rngFor } from './rng'
import {
  POSITION_IDS,
  type LeagueDef,
  type LeagueId,
  type Player,
  type PositionId,
  type StatBlock,
  type StatKey,
  type Team,
  type TeamDef,
} from '../types/core'

/**
 * Measured from the recovered tier-1 rosters: squad OVR runs 75.1-84.9 with a mean of
 * 80.6, and individual players 71-93. Tier 2 is pitched well below that so reaching a
 * tier-1 league is a genuine step up (SPEC §3: "Tier-1 leagues must be earned").
 */
export const TIER_TWO_SQUAD_OVR = { mean: 67, spread: 4.5 } as const

/** The eight bench slots that turn a recovered XV into a real 23-man squad. */
const BENCH_SLOTS: readonly PositionId[] = ['HOO', 'LHP', 'THP', 'LK2', 'N8', 'SH', 'FH', 'OC']

/** Reserves sit this far below their club's starters. */
const BENCH_OVR_GAP = 4

// ---------------------------------------------------------------------------
// Club prestige
// ---------------------------------------------------------------------------

/**
 * A club's standing, in [-1, 1], derived from its name alone.
 *
 * Stable across every career — Sydney University should be a Shute Shield force in all of
 * them — while the career seed still varies the individual players who make up the squad.
 */
export function clubPrestige(clubName: string): number {
  // Two independent hash bits, averaged, to avoid a lumpy distribution.
  const a = (hashString(`prestige:${clubName}`) % 10_000) / 10_000
  const b = (hashString(`prestige2:${clubName}`) % 10_000) / 10_000
  return (a + b) - 1
}

/**
 * How much a club is worth beyond the sum of its players, in rating points.
 *
 * Coaching, cohesion, a hard ground to visit — the things that make a club more than its
 * stat sheet. This is not a fudge: it is counted in `squadStrength` as well as in the match
 * engine, so a club that benefits from it really is stronger, and the balance pass measures
 * it as such.
 *
 * It exists because the recovered rosters do not differentiate every league. The Premiership's
 * ten squads span just 3.3 rating points (sd 0.93) — practically identical — so results there
 * were close to a coin toss and squad strength barely predicted the table at all, well short
 * of the r >= 0.65 that SPEC §2.4 asks for. The Top 14, whose squads span 9.2, needed no help.
 */
export const CLUB_QUALITY_RANGE = 4.2

export function clubQuality(clubName: string): number {
  return clubPrestige(clubName) * CLUB_QUALITY_RANGE
}

/** The squad OVR a generated tier-2 club is built to. */
export function targetSquadOvr(clubName: string, league: LeagueDef, rng: Rng): number {
  if (league.tier === 1) {
    // Not used for recovered clubs, but keeps the function total.
    return 80.6 + clubPrestige(clubName) * 3 + rng.gaussian(0, 0.6)
  }
  const { mean, spread } = TIER_TWO_SQUAD_OVR
  return mean + clubPrestige(clubName) * spread + rng.gaussian(0, 0.8)
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

/** Roll a raw stat block for a position from its generation ranges. */
export function rollStats(rng: Rng, position: PositionId): StatBlock {
  const def = POSITIONS[position]
  const stats: StatBlock = {}
  for (const [stat, range] of Object.entries(def.statRanges) as [StatKey, [number, number]][]) {
    stats[stat] = rng.int(range[0], range[1])
  }
  return stats
}

/**
 * SPEC §2.6: the three key stats start +4..+6 above the player's other stats.
 *
 * Applied literally — the non-key stats set the baseline, then each key stat is lifted to
 * `baseline + 4..6`. The bonus range is read from `positions.json` `_rules`, never hardcoded.
 */
export function applyKeyStatBonus(
  rng: Rng,
  stats: StatBlock,
  position: PositionId,
  bonusRange: readonly [number, number],
): StatBlock {
  const def = POSITIONS[position]
  const keys = new Set<StatKey>(def.keyStats)

  const others = (Object.entries(stats) as [StatKey, number][])
    .filter(([stat]) => !keys.has(stat))
    .map(([, value]) => value)

  if (others.length === 0) return { ...stats }
  const baseline = others.reduce((a, b) => a + b, 0) / others.length

  const out: StatBlock = { ...stats }
  for (const key of def.keyStats) {
    if (out[key] === undefined) continue
    out[key] = clampStat(baseline + rng.int(bonusRange[0], bonusRange[1]))
  }
  return out
}

/**
 * Shift a stat block so it rates at `target` for this position.
 *
 * Additive, not multiplicative: the rating is a weighted mean, so adding `d` to every stat
 * moves the rating by exactly `d` — and, critically, it preserves the +4..+6 key-stat gaps
 * that `applyKeyStatBonus` just established. Scaling would squash or stretch them.
 *
 * Iterated because clamping at 1/99 can absorb part of a shift.
 */
export function shiftToOvr(stats: StatBlock, position: PositionId, target: number): StatBlock {
  const working: Record<string, number> = { ...stats } as Record<string, number>

  for (let pass = 0; pass < 8; pass++) {
    const current = ratePlayer(roundBlock(working), position)
    const delta = target - current
    if (Math.abs(delta) < 0.05) break
    for (const key of Object.keys(working)) {
      working[key] = Math.max(1, Math.min(99, working[key]! + delta))
    }
  }

  return roundBlock(working)
}

function roundBlock(working: Record<string, number>): StatBlock {
  const out: StatBlock = {}
  for (const [key, value] of Object.entries(working)) {
    out[key as StatKey] = clampStat(value)
  }
  return out
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

export interface GeneratePlayerOptions {
  position: PositionId
  leagueId: LeagueId
  targetOvr: number
  /** Omit to roll an age from the standard squad curve. */
  age?: number
  /** Omit to generate a regional name. */
  name?: string
  taken?: Set<string>
  /** Key-stat bonus range; omit to skip the §2.6 lift (used for filler squad players). */
  keyStatBonus?: readonly [number, number]
}

/** Squad ages cluster in the mid-twenties with a tail either side. */
export function rollAge(rng: Rng): number {
  const age = Math.round(rng.gaussian(26, 3.6))
  return Math.max(18, Math.min(36, age))
}

export function generatePlayer(rng: Rng, id: string, opts: GeneratePlayerOptions): Player {
  const { position, leagueId, targetOvr } = opts

  let stats = rollStats(rng, position)
  if (opts.keyStatBonus) {
    stats = applyKeyStatBonus(rng, stats, position, opts.keyStatBonus)
  }
  stats = shiftToOvr(stats, position, targetOvr)

  const name = opts.name ?? generateName(rng, regionForLeague(rng, leagueId), opts.taken)

  return {
    id,
    name,
    position,
    age: opts.age ?? rollAge(rng),
    stats,
    ovr: computeOvr(stats, position),
  }
}

// ---------------------------------------------------------------------------
// Squads
// ---------------------------------------------------------------------------

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    // Strip combining marks so "Stade Français" slugs to "stade-francais".
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

export function teamId(team: TeamDef): string {
  return `${team.leagueId}:${slugify(team.name)}`
}

/**
 * Build a full squad for a club.
 *
 * Recovered rosters are used verbatim as the starting XV — that data is authoritative and
 * is never regenerated. Empty rosters get a generated XV. Both then get bench depth.
 */
export function buildSquad(seed: number, team: TeamDef): Team {
  const league = getLeague(team.leagueId)
  const id = teamId(team)
  const rng = rngFor(seed, 'squad', id)
  const taken = new Set<string>()

  const squad: Player[] = []

  if (team.roster.length > 0) {
    // Recovered XV — keep exactly as found.
    for (const entry of team.roster) {
      taken.add(entry.name)
      squad.push({
        id: `${id}:${slugify(entry.name)}`,
        name: entry.name,
        position: entry.position,
        age: entry.age,
        stats: entry.stats,
        ovr: computeOvr(entry.stats, entry.position),
      })
    }
  } else {
    const target = targetSquadOvr(team.name, league, rng)
    for (const position of POSITION_IDS) {
      // Individual players vary around the squad's level.
      const playerTarget = clampStat(target + rng.gaussian(0, 3))
      squad.push(
        generatePlayer(rng, `${id}:gen:${position}`, {
          position,
          leagueId: team.leagueId,
          targetOvr: playerTarget,
          taken,
        }),
      )
    }
  }

  // Bench depth for every club, recovered or generated.
  const starterAvg = squad.reduce((total, p) => total + p.ovr, 0) / Math.max(1, squad.length)
  BENCH_SLOTS.forEach((position, index) => {
    const target = clampStat(starterAvg - BENCH_OVR_GAP + rng.gaussian(0, 2.5))
    squad.push(
      generatePlayer(rng, `${id}:bench:${index}`, {
        position,
        leagueId: team.leagueId,
        targetOvr: target,
        taken,
      }),
    )
  })

  return {
    id,
    name: team.name,
    shortName: team.shortName,
    leagueId: team.leagueId,
    squad,
  }
}

/** Build every club in a league. */
export function buildLeagueTeams(seed: number, defs: readonly TeamDef[], leagueId: LeagueId): Team[] {
  return defs.filter((t) => t.leagueId === leagueId).map((t) => buildSquad(seed, t))
}

// ---------------------------------------------------------------------------
// Squad strength
// ---------------------------------------------------------------------------

/** One shirt, filled. `rating` already accounts for playing out of position. */
export interface Selection {
  slot: PositionId
  player: Player
  rating: number
  /** True when the player is covering a shirt that is not their own. */
  outOfPosition: boolean
}

/**
 * A club's playing strength: the mean rating of the best XV it can actually field.
 *
 * Uses ratings rather than raw OVR so that a squad forced to play people out of position —
 * through injury, or because it is simply thin — is correctly measured as weaker. The
 * balance pass asserts this correlates with where a club finishes.
 */
/**
 * How far a week's rotation can move a player up or down the pecking order, in rating points.
 *
 * Sized against the gaps that actually separate squad rivals — typically 1 to 3 points — so
 * a clear first choice still plays most weeks while the players just outside the XV get a
 * real share of the season.
 */
export const ROTATION_SPREAD = 2.05

/** This week's rotation for one squad. Deterministic for the rng it is handed. */
export function rollRotation(team: Team, rng: Rng, spread = ROTATION_SPREAD): Map<string, number> {
  const out = new Map<string, number>()
  for (const player of team.squad) out.set(player.id, rng.gaussian(0, spread))
  return out
}

export function squadStrength(team: Team, unavailable?: ReadonlySet<string>): number {
  const xv = selectBestXV(team, unavailable)
  if (xv.length === 0) return 0
  const playing = xv.reduce((total, s) => total + s.rating, 0) / xv.length
  return playing + clubQuality(team.name)
}

/**
 * Pick the strongest legal XV, respecting `canPlayAt`.
 *
 * Scarcest slot first, not shirt order: props, hookers and scrum-halves have almost no
 * eligible cover, so they are resolved before the back-three shirts that half the squad can
 * fill. Filling 1-15 in order would hand the fullback shirt to the only spare hooker and
 * then leave the front row short.
 *
 * Returned in shirt order, so callers can render a team sheet directly.
 */
export function selectBestXV(
  team: Team,
  unavailable?: ReadonlySet<string>,
  /**
   * Per-player rating nudges applied only for selection purposes — form, morale, and the
   * "Dropped" wheel outcome's selection penalty. A player can be pushed out of the XV this
   * way without their actual ability changing.
   */
  selectionAdjust?: ReadonlyMap<string, number>,
  /**
   * This week's rotation — a per-player nudge representing rest, a knock, or a coach
   * fancying someone.
   *
   * Without it selection is a hard cut at fifteen: the same XV plays every round of every
   * season, and the sixteenth-best player never appears. Measured across full careers, only
   * 33% of players ever made a single appearance, and whether you were 15th or 16th was
   * settled at career creation. Since match performance is the main source of OVR growth
   * (SPEC §2.5), that left two thirds of careers with no way to develop at all.
   *
   * Applied to every club equally — the player is picked by the same code as everyone else.
   */
  rotation?: ReadonlyMap<string, number>,
): Selection[] {
  const available = team.squad.filter((p) => !unavailable?.has(p.id))
  const used = new Set<string>()
  const picks: Selection[] = []

  const slots = [...POSITION_IDS].sort(
    (a, b) => countEligible(available, a) - countEligible(available, b),
  )

  for (const slot of slots) {
    let best: Selection | null = null
    let bestScore = -Infinity

    for (const player of available) {
      if (used.has(player.id)) continue

      const candidate: Selection = {
        slot,
        player,
        rating:
          ratingInSlot(player.stats, player.position, slot) +
          (selectionAdjust?.get(player.id) ?? 0),
        outOfPosition: !POSITIONS[player.position].canPlayAt.includes(slot),
      }

      // Rotation decides who is *picked*, and is deliberately kept out of the rating the
      // selection carries: `rateTeam` reads that rating, and since selection favours whoever
      // this week's nudge flattered, folding it in would bias every team's strength upward.
      const score = candidate.rating + (rotation?.get(player.id) ?? 0)

      if (best === null) {
        best = candidate
        bestScore = score
      } else if (best.outOfPosition !== candidate.outOfPosition) {
        // Eligibility beats rating outright — a fit specialist always starts ahead of a
        // higher-rated player who cannot legally wear the shirt.
        if (!candidate.outOfPosition) {
          best = candidate
          bestScore = score
        }
      } else if (score > bestScore) {
        best = candidate
        bestScore = score
      }
    }

    if (best) {
      used.add(best.player.id)
      picks.push(best)
    }
  }

  return picks.sort((a, b) => POSITIONS[a.slot].number - POSITIONS[b.slot].number)
}

function countEligible(players: readonly Player[], slot: PositionId): number {
  let n = 0
  for (const p of players) if (POSITIONS[p.position].canPlayAt.includes(slot)) n++
  return n
}
