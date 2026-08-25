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

/** A season rated at this level is treated as holding your ground. */
const NEUTRAL_RATING = 6.4
/** OVR points per rating point above or below neutral. */
const RATING_TO_OVR = 1.7
/** Nobody moves more than this in a single season, in either direction. */
const MAX_SEASON_SWING = 6

export interface AgeEffect {
  /** Multiplies gains earned from match performance. */
  growthMultiplier: number
  /** Flat OVR lost to age, before any gains. */
  decay: number
  phase: 'developing' | 'peak' | 'declining'
}

/**
 * What age does to a player, per their archetype's curve.
 *
 * A Wonderkid (peak 26, late multiplier 0.6) falls away sharply in their thirties; a Late
 * Bloomer (peak 31, late multiplier 1.4) is still improving when the Wonderkid is finished.
 */
export function ageEffect(age: number, archetype: Archetype): AgeEffect {
  const { peakAge, earlyMultiplier, lateMultiplier } = archetype.growthCurve

  if (age < peakAge - 1) {
    return { growthMultiplier: earlyMultiplier, decay: 0, phase: 'developing' }
  }

  if (age <= peakAge + 1) {
    return { growthMultiplier: 1, decay: 0, phase: 'peak' }
  }

  const yearsPast = age - (peakAge + 1)
  // Decline accelerates, and a high late multiplier slows it down.
  const decay = (yearsPast * 0.45 + yearsPast ** 2 * 0.05) / Math.max(0.4, lateMultiplier)
  return {
    growthMultiplier: Math.max(0.15, 0.55 * lateMultiplier),
    decay,
    phase: 'declining',
  }
}

export interface SeasonProgressionInput {
  stats: StatBlock
  position: PositionId
  age: number
  archetype: Archetype
  /** Mean match rating across the season. */
  avgRating: number
  appearances: number
  /** From the lifestyle shop — Personal Trainer is 1.25. */
  matchGrowthMultiplier: number
  rng: Rng
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

  const effect = ageEffect(age, archetype)

  // Involvement: a fringe player who played four times gets a fraction of the development.
  const involvement = Math.min(1, appearances / 12)

  const rawPerformance = (avgRating - NEUTRAL_RATING) * RATING_TO_OVR * involvement
  const performance =
    rawPerformance > 0
      ? rawPerformance * effect.growthMultiplier * input.matchGrowthMultiplier
      : rawPerformance

  const noise = rng.gaussian(0, 0.35)
  const delta = clampSwing(performance - effect.decay + noise)

  const currentOvr = computeOvr(stats, position)
  const targetOvr = clampOvr(currentOvr + delta)
  const appliedDelta = targetOvr - currentOvr

  return {
    stats: distributeOvrChange(stats, position, appliedDelta, rng),
    ovr: targetOvr,
    ovrDelta: appliedDelta,
    breakdown: {
      performance: Math.round(performance * 10) / 10,
      age: Math.round(-effect.decay * 10) / 10,
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
