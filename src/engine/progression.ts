/**
 * OVR progression.
 *
 * SPEC §2.5 is emphatic that manual training is gone and that OVR moves from exactly four
 * sources: match performance, club moves, wheel outcomes, and age curves per archetype and
 * position. Nothing in this file offers a way to spend points, pick an attribute, or choose
 * a development plan — those systems are not hidden here, they do not exist.
 */

import { ARCHETYPES, POSITIONS } from '../data'
import { clampOvr, clampStat, computeOvr } from './ovr'
import type { Rng } from './rng'
import type { Archetype, ClubMoveDirection } from '../types/career'
import type { PositionId, StatBlock, StatKey } from '../types/core'

export const ARCHETYPE_LIST = ARCHETYPES as unknown as Archetype[]

export function getArchetype(id: string): Archetype {
  const found = ARCHETYPE_LIST.find((a) => a.id === id)
  if (!found) throw new Error(`Unknown archetype: ${id}`)
  return found
}

/** Nobody moves more than this in a single season, in either direction. */
const MAX_SEASON_SWING = 6

/**
 * The knobs that shape a career arc.
 *
 * Gathered into one object rather than scattered as constants because they only make sense
 * together — lowering the neutral bar without bounding decay, or bounding decay without
 * fixing involvement, produces a worse curve than changing neither. Every value here was
 * chosen from the Monte Carlo sweep recorded in `REPORT.md`, and is held in place by the
 * `progression` targets in `balance-targets.json`.
 */
export interface ProgressionTuning {
  /** A season rated at this level holds your ground. */
  neutralRating: number
  /** OVR gained per rating point above neutral. */
  ratingToOvr: number
  /**
   * OVR lost per rating point below neutral. Deliberately steeper than the gain: it keeps a
   * bad season punitive for a young player whose maturation is pulling the other way, and it
   * is the brake that stops a good player climbing to 99.
   */
  ratingPenalty: number
  /** Multiplies the maturation a developing player earns. */
  maturationScale: number
  /**
   * How much an archetype's `earlyMultiplier` sets the *height* of its peak, as opposed to
   * how quickly it gets there.
   *
   * At 1 the multiplier scales maturation directly, which is what it used to do — and it
   * made the Wonderkid (1.45) strictly dominant: it peaked around 90 while the Late Bloomer
   * (0.7) stalled in the low sixties, so the choice at creation was one right answer and
   * three wrong ones. Pushing the shared knobs hard enough to lift the Late Bloomer sent the
   * Wonderkid past 99.
   *
   * Low values converge the archetypes on a similar peak while leaving them genuinely
   * different in shape: `earlyMultiplier` still sets how fast a player matures and how well
   * they convert a good season, and `lateMultiplier` still sets how they fall away.
   */
  archetypeInfluence: number
  /**
   * The share of maturation a young player earns while *not* in the side.
   *
   * This is the way out of the trap. Squad players in the world are static — they never age
   * or improve — so a rookie who starts behind one must climb past a fixed target. If growth
   * needed game time and game time needed growth, the career could never start. A prospect
   * kept out of the side still develops; he just develops more slowly than one playing every
   * week, which is what the remaining `1 - floor` scales with involvement.
   */
  maturationFloor: number
  /** Decay ceiling for an archetype with `lateMultiplier` 1. */
  baseDecayCeiling: number
  /** Absolute cap on a season's decay, whatever the archetype. */
  maxDecayPerSeason: number
  /** Years past the peak at which decay reaches ~63% of its ceiling. */
  decayTau: number
  /**
   * The rating a player approaches but does not reach, and how far out the pull starts.
   *
   * Improvement gets harder the better you already are: going from 90 to 95 is not the same
   * task as going from 70 to 75. Without this the arc has no top end at all — a strong
   * career kept compounding into the high nineties, past anything in the recovered data.
   */
  eliteCeiling: number
  eliteHeadroom: number
}

export const TUNING: ProgressionTuning = {
  neutralRating: 5.7,
  ratingToOvr: 1.7,
  ratingPenalty: 2.4,
  maturationScale: 2.18,
  archetypeInfluence: 0.15,
  maturationFloor: 0.95,
  baseDecayCeiling: 0.8,
  maxDecayPerSeason: 3,
  decayTau: 4,
  eliteCeiling: 89,
  eliteHeadroom: 14,
}

export interface AgeEffect {
  /** Multiplies gains earned from match performance. */
  growthMultiplier: number
  /**
   * OVR gained simply by maturing, before performance is considered.
   *
   * This is the half of "age curves" that is easy to leave out. Without it a young player
   * who starts below his squad's average rates around 6.0, never clears the neutral 6.4,
   * and flatlines for twenty seasons — which is not how a career works. An eighteen-year-old
   * does not go from 60 to 80 by rating 8/10 at eighteen; he grows into the player.
   */
  maturation: number
  /** Flat OVR lost to age, before any gains. */
  decay: number
  phase: 'developing' | 'peak' | 'declining'
}

/**
 * What age does to a player, per their archetype's curve.
 *
 * A Wonderkid (peak 26, early multiplier 1.45) matures fast and then falls away sharply in
 * their thirties; a Late Bloomer (peak 31, late multiplier 1.4) grows slowly but is still
 * improving when the Wonderkid is finished.
 */
export function ageEffect(
  age: number,
  archetype: Archetype,
  tuning: ProgressionTuning = TUNING,
): AgeEffect {
  const { peakAge, earlyMultiplier, lateMultiplier } = archetype.growthCurve

  if (age < peakAge - 1) {
    const yearsToPeak = peakAge - age
    // How much of the archetype's multiplier reaches the height of the curve, as opposed to
    // its shape. `growthMultiplier` below still carries the full multiplier, so a Wonderkid
    // remains the archetype that turns a good season into OVR fastest.
    const shape = 1 + (earlyMultiplier - 1) * tuning.archetypeInfluence
    // Tapers as the peak nears, so growth slows rather than stopping dead.
    const maturation = shape * tuning.maturationScale * (yearsToPeak / (yearsToPeak + 2))
    return { growthMultiplier: earlyMultiplier, maturation, decay: 0, phase: 'developing' }
  }

  if (age <= peakAge + 1) {
    return { growthMultiplier: 1, maturation: 0, decay: 0, phase: 'peak' }
  }

  return {
    // Heavily damped past the peak. At 0.55 a Late Bloomer — whose gentle `lateMultiplier`
    // also buys it the slowest decay — still converted good seasons faster than age took
    // them away, and went on improving until 38. An archetype that peaks at 31 by
    // description should not be at its best seven years later.
    growthMultiplier: Math.max(0.08, 0.25 * lateMultiplier),
    maturation: 0,
    decay: decayAt(age - (peakAge + 1), lateMultiplier, tuning),
    phase: 'declining',
  }
}

/**
 * How much age takes off a player this season, `yearsPast` years beyond their peak.
 *
 * The old curve was quadratic and unbounded: a Wonderkid at 38 lost 18.3 OVR in one season,
 * and even clamped to the -6 season swing that took a peak of 71 down to 25 by retirement.
 *
 * This one approaches a ceiling instead. It is still strictly increasing every year — a
 * player really is declining faster at 36 than at 30 — but it can never run away, because
 * the exponential only ever gets closer to the ceiling. A low `lateMultiplier` raises that
 * ceiling, so a Wonderkid still falls away faster than a Late Bloomer.
 */
export function decayAt(
  yearsPast: number,
  lateMultiplier: number,
  tuning: ProgressionTuning = TUNING,
): number {
  if (yearsPast <= 0) return 0
  const ceiling = Math.min(
    tuning.maxDecayPerSeason,
    tuning.baseDecayCeiling / Math.max(0.4, lateMultiplier),
  )
  return ceiling * (1 - Math.exp(-yearsPast / tuning.decayTau))
}

export interface SeasonProgressionInput {
  stats: StatBlock
  position: PositionId
  age: number
  archetype: Archetype
  /** Mean match rating across the season. */
  avgRating: number
  appearances: number
  /**
   * Matches there were to play — the league's own round count, never a constant.
   *
   * Required rather than defaulted, because a default would be a hardcoded season length in
   * all but name, which is what SPEC §2.3 bans. Involvement used to divide by a flat 12: an
   * ever-present player in the 10-round NPC could never earn full development, while one in
   * the 30-round Pro D2 earned it by round 12.
   */
  matchesAvailable: number
  /** From the lifestyle shop — Personal Trainer is 1.25. */
  matchGrowthMultiplier: number
  rng: Rng
  tuning?: ProgressionTuning
}

export interface SeasonProgression {
  stats: StatBlock
  ovr: number
  ovrDelta: number
  breakdown: {
    /** From how the player actually played. */
    performance: number
    /** Lost to age. */
    age: number
    phase: AgeEffect['phase']
  }
}

/**
 * Apply a season's worth of development.
 *
 * A player who barely featured cannot develop much from match performance — there were no
 * matches — so gains scale with appearances up to a full season's involvement.
 */
export function applySeasonProgression(input: SeasonProgressionInput): SeasonProgression {
  const { stats, position, age, archetype, avgRating, appearances, rng } = input
  const tuning = input.tuning ?? TUNING

  const effect = ageEffect(age, archetype, tuning)

  // Involvement: a fringe player who played four times gets a fraction of the development,
  // measured against the season that was actually available to him.
  const involvement =
    input.matchesAvailable > 0 ? Math.min(1, appearances / input.matchesAvailable) : 0

  // Falling short costs more per rating point than doing well gains. That asymmetry is what
  // keeps a bad season punitive for a young player who is maturing anyway, and what stops a
  // good one compounding all the way to 99.
  const gap = avgRating - tuning.neutralRating
  const rawPerformance =
    gap * (gap >= 0 ? tuning.ratingToOvr : tuning.ratingPenalty) * involvement
  const performance =
    rawPerformance > 0
      ? rawPerformance * effect.growthMultiplier * input.matchGrowthMultiplier
      : rawPerformance

  // Maturing still depends on playing — a young player kept out of the side develops more
  // slowly — but not entirely, or being behind in the pecking order would be unrecoverable.
  const floor = tuning.maturationFloor
  const maturation =
    effect.maturation * (floor + (1 - floor) * involvement) * input.matchGrowthMultiplier

  const currentOvr = computeOvr(stats, position)

  // Diminishing returns near the top: the closer a player is to the ceiling, the less any
  // given season moves them. Applied to gains only — decline is not slowed by being good.
  const headroom = Math.max(
    0.1,
    Math.min(1, (tuning.eliteCeiling - currentOvr) / tuning.eliteHeadroom),
  )
  const gain = (performance > 0 ? performance : 0) + maturation
  const loss = performance < 0 ? performance : 0

  const noise = rng.gaussian(0, 0.35)
  const delta = clampSwing(gain * headroom + loss - effect.decay + noise)
  const targetOvr = clampOvr(currentOvr + delta)
  const appliedDelta = targetOvr - currentOvr

  return {
    stats: distributeOvrChange(stats, position, appliedDelta, rng),
    ovr: targetOvr,
    ovrDelta: appliedDelta,
    breakdown: {
      performance: Math.round(performance * 10) / 10,
      // Net effect of age: maturing while young, decay once past the peak.
      age: Math.round((maturation - effect.decay) * 10) / 10,
      phase: effect.phase,
    },
  }
}

function clampSwing(delta: number): number {
  return Math.max(-MAX_SEASON_SWING, Math.min(MAX_SEASON_SWING, delta))
}

/**
 * Spread an OVR change across the stat block.
 *
 * Gains land mostly on the position's key stats — a fly-half who has a great season gets
 * better at the things a fly-half does. Losses come off physical attributes first, because
 * that is what age actually takes.
 */
export function distributeOvrChange(
  stats: StatBlock,
  position: PositionId,
  ovrDelta: number,
  rng: Rng,
): StatBlock {
  if (ovrDelta === 0) return { ...stats }

  const def = POSITIONS[position]
  const keys = new Set<StatKey>(def.keyStats)
  const entries = Object.keys(stats) as StatKey[]
  if (entries.length === 0) return { ...stats }

  const physical = new Set<StatKey>(['PAC', 'FIT', 'EVA'])

  const weights = new Map<StatKey, number>()
  for (const stat of entries) {
    if (ovrDelta > 0) {
      weights.set(stat, keys.has(stat) ? 2.2 : 1)
    } else {
      weights.set(stat, physical.has(stat) ? 2.4 : 1)
    }
  }

  const out: StatBlock = { ...stats }
  const steps = Math.round(Math.abs(ovrDelta) * entries.length * 0.55)
  const direction = ovrDelta > 0 ? 1 : -1

  for (let i = 0; i < steps; i++) {
    const stat = rng.weighted(entries, (s) => weights.get(s) ?? 1)
    out[stat] = clampStat((out[stat] ?? 50) + direction)
  }

  // The stat walk approximates the target; nudge the whole block to land on it.
  return alignToOvr(out, position, computeOvr(stats, position) + ovrDelta)
}

function alignToOvr(stats: StatBlock, position: PositionId, target: number): StatBlock {
  const working: Record<string, number> = { ...stats } as Record<string, number>

  for (let pass = 0; pass < 6; pass++) {
    const current = computeOvr(roundBlock(working), position)
    const delta = target - current
    if (Math.abs(delta) < 0.5) break
    for (const key of Object.keys(working)) {
      working[key] = Math.max(1, Math.min(99, working[key]! + delta))
    }
  }

  return roundBlock(working)
}

function roundBlock(working: Record<string, number>): StatBlock {
  const out: StatBlock = {}
  for (const [key, value] of Object.entries(working)) out[key as StatKey] = clampStat(value)
  return out
}

/**
 * Raise OVR without ever lowering a single stat.
 *
 * `distributeOvrChange` finishes with an alignment pass that shifts the whole block to land
 * on the target, and that pass can shave a point off an individual stat even when OVR goes
 * up. That is fine for a season's development, but it breaks the wheel's guarantee that a
 * positive outcome can never take anything away — so positives use this instead, which only
 * ever increments.
 */
export function raiseOvrOnly(
  stats: StatBlock,
  position: PositionId,
  ovrDelta: number,
  rng: Rng,
): StatBlock {
  if (ovrDelta <= 0) return { ...stats }

  const out: StatBlock = { ...stats }
  const keys = Object.keys(out) as StatKey[]
  if (keys.length === 0) return out

  const keyStats = new Set<StatKey>(POSITIONS[position].keyStats)
  const target = computeOvr(stats, position) + ovrDelta

  // Bounded so a block already at the ceiling cannot spin forever.
  for (let step = 0; step < 600; step++) {
    if (computeOvr(out, position) >= target) break
    const headroom = keys.filter((k) => (out[k] ?? 0) < 99)
    if (headroom.length === 0) break
    const stat = rng.weighted(headroom, (k) => (keyStats.has(k) ? 2.2 : 1))
    out[stat] = clampStat((out[stat] ?? 50) + 1)
  }

  return out
}

// ---------------------------------------------------------------------------
// Club moves (SPEC §2.5)
// ---------------------------------------------------------------------------

/**
 * The OVR consequence of a transfer, end to end.
 *
 *   step up a tier  -> +1 to +3
 *   stay            ->  0
 *   step down       -> -1 to -3
 *
 * The *range* is shown on the destination card before the player chooses, and the rolled
 * value is shown again in the season review.
 */
export const CLUB_MOVE_OVR_RANGE: Record<ClubMoveDirection, [number, number]> = {
  up: [1, 3],
  stay: [0, 0],
  down: [-3, -1],
}

export function clubMoveDirection(fromTier: 1 | 2, toTier: 1 | 2): ClubMoveDirection {
  // Tier 1 is the higher standard, so a *lower* tier number is a step up.
  if (toTier < fromTier) return 'up'
  if (toTier > fromTier) return 'down'
  return 'stay'
}

export function rollClubMoveOvrChange(direction: ClubMoveDirection, rng: Rng): number {
  const [min, max] = CLUB_MOVE_OVR_RANGE[direction]
  return min === max ? min : rng.int(min, max)
}

/** Apply a club move to a stat block, keeping stats and OVR in step. */
export function applyClubMove(
  stats: StatBlock,
  position: PositionId,
  direction: ClubMoveDirection,
  rng: Rng,
): { stats: StatBlock; ovr: number; ovrDelta: number } {
  const change = rollClubMoveOvrChange(direction, rng)
  const nextStats = distributeOvrChange(stats, position, change, rng)
  return { stats: nextStats, ovr: computeOvr(nextStats, position), ovrDelta: change }
}
