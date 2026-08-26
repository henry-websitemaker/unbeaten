/**
 * Pre-season training (SPEC §2.8).
 *
 * An earlier revision of the spec deleted manual training outright; §2.8 restores it, and a
 * later revision made the choice per-stat. The distinction that survives both reversals is
 * the one that matters: **one pick per summer, use it or lose it.** There is no currency and
 * nothing accumulates across seasons, which is what separates this from the points shop that
 * stayed deleted.
 *
 * Training only ever adds. What a pick is worth depends on the position: raising a stat the
 * shirt is judged on moves OVR two to three times as much, because `computeOvr` weights key
 * stats at 2.5x — and `trainingOptions` puts that number on the card rather than leaving the
 * player to guess.
 *
 * Gains taper as a player approaches the ceiling, the same way season progression does — a
 * career that trained every summer for twenty years must not compound past the top of the
 * scale. The Monte Carlo pass in `balance.test.ts` holds that.
 */

import { POSITIONS, TRAINING } from '../data'
import { clampStat, computeOvr } from './ovr'
import { TUNING, growthHeadroom, type ProgressionTuning } from './progression'
import type { PositionId, StatBlock, StatKey } from '../types/core'

export interface TrainingBlock {
  id: string
  name: string
  /** The one-word area, for the card. */
  focus: string
  stats: StatKey[]
  description: string
  flavour: string
}

interface TrainingData {
  rules: { blocksPerSeason: number; statGain: number }
  blocks: TrainingBlock[]
}

const DATA = TRAINING as unknown as TrainingData

export const TRAINING_BLOCKS: readonly TrainingBlock[] = DATA.blocks
export const TRAINING_RULES = DATA.rules

export function getTrainingBlock(id: string): TrainingBlock {
  const block = TRAINING_BLOCKS.find((b) => b.id === id)
  if (!block) throw new Error(`Unknown training block: ${id}`)
  return block
}

/**
 * The stats a block actually works on for a given position.
 *
 * Positions carry different stat sets — a wing has no scrummaging, a prop no handling — so a
 * block only ever touches what the player has. Every block is built to reach at least one
 * stat of every position, so all four are always a real choice.
 */
export function trainableStats(block: TrainingBlock, stats: StatBlock): StatKey[] {
  return block.stats.filter((stat) => stats[stat] !== undefined)
}

/** Which flavour block a stat belongs to. Every stat belongs to exactly one. */
export function blockForStat(stat: StatKey): TrainingBlock {
  const block = TRAINING_BLOCKS.find((b) => b.stats.includes(stat))
  if (!block) throw new Error(`No training block covers ${stat}`)
  return block
}

export interface TrainingResult {
  stats: StatBlock
  ovr: number
  ovrDelta: number
  /** The stat that was worked on. */
  raised: StatKey
}

/**
 * Work on one stat for a summer (SPEC §2.8). Only ever increases it.
 *
 * Deliberately not routed through `distributeOvrChange`: that finishes with an alignment pass
 * which can shave a point off an individual stat even as OVR rises, and a player who has just
 * spent a summer in the gym should not come out of it worse at anything. This is the same
 * reason the wheel's positive outcomes use `raiseOvrOnly`.
 */
export function applyTraining(
  stats: StatBlock,
  position: PositionId,
  stat: StatKey,
  tuning: ProgressionTuning = TUNING,
): TrainingResult {
  const before = computeOvr(stats, position)
  if (stats[stat] === undefined) {
    return { stats: { ...stats }, ovr: before, ovrDelta: 0, raised: stat }
  }

  // The same taper season progression uses, so a summer's work faces the same diminishing
  // returns as a season's and twenty of them cannot compound past the top of the scale.
  const gain = TRAINING_RULES.statGain * growthHeadroom(before, tuning)

  const out: StatBlock = { ...stats, [stat]: clampStat((stats[stat] ?? 0) + gain) }
  const after = computeOvr(out, position)
  return { stats: out, ovr: after, ovrDelta: after - before, raised: stat }
}

export interface TrainingOption {
  stat: StatKey
  /** What the player has now. */
  current: number
  /** What a summer on it would do to OVR — shown on the card, per SPEC §2.5's discipline. */
  ovrDelta: number
  /** True for the three stats the shirt is actually judged on. */
  isKeyStat: boolean
  block: TrainingBlock
}

/**
 * Every stat the player could work on, with what each is worth.
 *
 * The OVR effect is surfaced rather than hidden: key stats carry 2.5x weight in `computeOvr`,
 * so working on one moves OVR two to three times as much, and a player is entitled to know
 * that before choosing. Rounding out a weakness stays a legitimate call — just an informed one.
 */
export function trainingOptions(
  stats: StatBlock,
  position: PositionId,
  tuning: ProgressionTuning = TUNING,
): TrainingOption[] {
  const keyStats = new Set<StatKey>(POSITIONS[position].keyStats)

  return (Object.keys(stats) as StatKey[]).map((stat) => ({
    stat,
    current: stats[stat] ?? 0,
    ovrDelta: applyTraining(stats, position, stat, tuning).ovrDelta,
    isKeyStat: keyStats.has(stat),
    block: blockForStat(stat),
  }))
}

/** Has the player already taken their block this summer? */
export function hasTrainedThisSeason(
  training: readonly { season: number }[],
  season: number,
): boolean {
  const taken = training.filter((t) => t.season === season).length
  return taken >= TRAINING_RULES.blocksPerSeason
}
