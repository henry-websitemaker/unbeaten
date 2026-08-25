/**
 * Overall rating.
 *
 * A position's `ovrWeights` already sum to 1. SPEC §2.6 then says the three `keyStats`
 * carry 2.5x weight "in the engine", so we scale those weights and renormalise back to 1 —
 * that keeps OVR on the same 0-100 scale as the raw stats while making the stats that
 * actually define a position dominate it.
 */

import { KEY_STAT_ENGINE_WEIGHT, getPosition } from '../data'
import type { PositionGroup, PositionId, StatBlock, StatKey } from '../types/core'

export type StatWeights = Partial<Record<StatKey, number>>

const weightCache = new Map<PositionId, StatWeights>()

/**
 * The engine weights for a position: `ovrWeights` with key stats boosted, renormalised.
 * Cached — this is called once per player per match.
 */
export function engineWeights(position: PositionId): StatWeights {
  const cached = weightCache.get(position)
  if (cached) return cached

  const def = getPosition(position)
  const keys = new Set<StatKey>(def.keyStats)

  const boosted: StatWeights = {}
  let total = 0
  for (const [stat, weight] of Object.entries(def.ovrWeights) as [StatKey, number][]) {
    const w = keys.has(stat) ? weight * KEY_STAT_ENGINE_WEIGHT : weight
    boosted[stat] = w
    total += w
  }

  const normalised: StatWeights = {}
  for (const [stat, w] of Object.entries(boosted) as [StatKey, number][]) {
    normalised[stat] = w / total
  }

  Object.freeze(normalised)
  weightCache.set(position, normalised)
  return normalised
}

/**
 * Weighted rating of a stat block for a position.
 *
 * `overrides` multiplies individual stat weights before normalising — this is how the
 * "Washout Conditions" event re-weights KCK/SCR up and PAC/EVA down without any other
 * system needing to know weather exists.
 */
export function ratePlayer(
  stats: StatBlock,
  position: PositionId,
  overrides?: Partial<Record<StatKey, number>>,
): number {
  const base = engineWeights(position)

  let sum = 0
  let totalWeight = 0
  for (const [stat, weight] of Object.entries(base) as [StatKey, number][]) {
    const value = stats[stat]
    if (value === undefined) continue
    const w = overrides?.[stat] === undefined ? weight : weight * overrides[stat]!
    sum += value * w
    totalWeight += w
  }

  // A player missing every weighted stat would otherwise divide by zero.
  if (totalWeight === 0) return 0
  return sum / totalWeight
}

/** OVR as an integer, clamped to the 1-99 range the UI assumes. */
export function computeOvr(stats: StatBlock, position: PositionId): number {
  return clampOvr(Math.round(ratePlayer(stats, position)))
}

export function clampOvr(value: number): number {
  return Math.max(1, Math.min(99, Math.round(value)))
}

export function clampStat(value: number): number {
  return Math.max(1, Math.min(99, Math.round(value)))
}

// ---------------------------------------------------------------------------
// Position grouping
// ---------------------------------------------------------------------------

const FORWARDS = new Set<PositionId>(['LHP', 'HOO', 'THP', 'LK1', 'LK2', 'BF', 'OF', 'N8'])
const HALVES = new Set<PositionId>(['SH', 'FH'])

/** The three archetype cards offered at creation (SPEC §3): FWD / HLF / BCK. */
export function positionGroup(position: PositionId): PositionGroup {
  if (FORWARDS.has(position)) return 'FWD'
  if (HALVES.has(position)) return 'HLF'
  return 'BCK'
}

export function positionsInGroup(group: PositionGroup): PositionId[] {
  const all: PositionId[] = [
    'LHP', 'HOO', 'THP', 'LK1', 'LK2', 'BF', 'OF', 'N8',
    'SH', 'FH', 'IC', 'OC', 'WL', 'WR', 'FB',
  ]
  return all.filter((p) => positionGroup(p) === group)
}

/** SPEC §1: eligibility is genuinely strict — a hooker only ever plays hooker. */
export function canPlayAt(position: PositionId, slot: PositionId): boolean {
  return getPosition(position).canPlayAt.includes(slot)
}

/**
 * Rating when fielded out of position. Eligible slots play at full rating; anything else
 * takes a hit steep enough that fielding a prop on the wing is never the right call.
 */
export function ratingInSlot(
  stats: StatBlock,
  position: PositionId,
  slot: PositionId,
  overrides?: Partial<Record<StatKey, number>>,
): number {
  const natural = ratePlayer(stats, position, overrides)
  if (position === slot) return natural
  if (canPlayAt(position, slot)) {
    // Covering a listed alternative costs a little, not a lot.
    return natural * 0.94
  }
  return natural * 0.72
}
