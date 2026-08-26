/**
 * Pre-season training (SPEC §2.8).
 *
 * An earlier revision of the spec deleted manual training outright; §2.8 restores it as a
 * deliberate reversal, and the distinction that survived the reversal matters: this is **one
 * block of work per summer**, not a points shop. There is no per-attribute spend and no
 * currency. You choose what to work on and it shapes you.
 *
 * Every block names the stats it works on before it is chosen, and only ever adds — training
 * cannot take anything away. What it is worth depends on the position: raising the stats a
 * shirt is judged on moves OVR more than raising the ones it is not, because `computeOvr`
 * weights key stats at 2.5x. A Tactical Film block is worth more to a fly-half than to a prop.
 *
 * Gains taper as a player approaches the ceiling, the same way season progression does — a
 * career that trained every summer for twenty years must not compound past the top of the
 * scale. The Monte Carlo pass in `balance.test.ts` holds that.
 */

import { TRAINING } from '../data'
import { clampStat, computeOvr } from './ovr'
import { TUNING, type ProgressionTuning } from './progression'
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

export interface TrainingResult {
  stats: StatBlock
  ovr: number
  ovrDelta: number
  /** The stats that actually moved, for the summary line. */
  raised: StatKey[]
}

/**
 * Apply a block. Only ever increases stats.
 *
 * Deliberately not routed through `distributeOvrChange`: that finishes with an alignment pass
 * which can shave a point off an individual stat even as OVR rises, and a player who has just
 * spent a summer in the gym should not come out of it worse at anything. This is the same
 * reason the wheel's positive outcomes use `raiseOvrOnly`.
 */
export function applyTraining(
  stats: StatBlock,
  position: PositionId,
  blockId: string,
  tuning: ProgressionTuning = TUNING,
): TrainingResult {
  const block = getTrainingBlock(blockId)
  const before = computeOvr(stats, position)
  const raised = trainableStats(block, stats)

  // The same taper season progression uses: the closer to the ceiling, the less a summer
  // moves you. Without it, twenty summers of training compound past the top of the scale.
  const headroom = Math.max(
    0,
    Math.min(1, (tuning.eliteCeiling - before) / tuning.eliteHeadroom),
  )
  const gain = TRAINING_RULES.statGain * headroom

  const out: StatBlock = { ...stats }
  for (const stat of raised) {
    out[stat] = clampStat((out[stat] ?? 0) + gain)
  }

  const after = computeOvr(out, position)
  return { stats: out, ovr: after, ovrDelta: after - before, raised }
}

/** Has the player already taken their block this summer? */
export function hasTrainedThisSeason(
  training: readonly { season: number }[],
  season: number,
): boolean {
  const taken = training.filter((t) => t.season === season).length
  return taken >= TRAINING_RULES.blocksPerSeason
}
