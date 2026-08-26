/**
 * The game plan (SPEC §3).
 *
 * A plan the side takes into a match. Unlike match agency — which asks about one moment and
 * is resolved on the spot — this sets how the whole eighty minutes is played, so it is
 * **sticky**: it carries from the last match until the player changes it. Choosing a plan
 * once in August and leaving it there is a legitimate way to play; being asked the same
 * question thirty times a season is not.
 *
 * A plan re-weights which stats the match engine leans on, through the `statWeightOverride`
 * hook `MatchModifiers` already exposes for weather. That means a plan is only as good as the
 * players asked to execute it: Forward power in a side built around its back three is a worse
 * plan than Back-line finesse, and the engine works that out rather than being told.
 *
 * Applied to the player's club only, so none of this touches the league-wide ladder sims or
 * the SPEC §2.4 targets measured against them.
 */

import type { GamePlanId } from '../types/career'
import type { StatKey } from '../types/core'
import type { MatchModifiers } from '../types/match'
import type { Rng } from './rng'

export interface GamePlanDef {
  id: GamePlanId
  name: string
  description: string
  /** Stat weight multipliers, applied to both sides of the match by the engine. */
  weights: Partial<Record<StatKey, number>>
  /** Added to the club's effective strength. Positive plans trade variance for it. */
  strengthDelta: number
  /**
   * How much more unpredictable the match becomes. High risk widens the range of results in
   * both directions; tactical depth narrows it.
   */
  variance: number
}

export const GAME_PLANS: readonly GamePlanDef[] = [
  {
    id: 'forward_power',
    name: 'Forward power',
    description: 'Through the middle, off nine, and squeeze them at the set piece.',
    weights: { SCR: 1.45, CAR: 1.35, RUK: 1.25, LNO: 1.2, PAC: 0.75, EVA: 0.7 },
    strengthDelta: 0.4,
    variance: 0.85,
  },
  {
    id: 'backline_finesse',
    name: 'Back-line finesse',
    description: 'Width early, hands through the line, and ask questions out wide.',
    weights: { HND: 1.45, PAC: 1.35, EVA: 1.3, VIS: 1.2, SCR: 0.75, CAR: 0.8 },
    strengthDelta: 0.4,
    variance: 1.1,
  },
  {
    id: 'balanced_flair',
    name: 'Balanced flair',
    description: 'Play what is in front of you. No script, no hiding place.',
    weights: {},
    strengthDelta: 0,
    variance: 1,
  },
  {
    id: 'tactical_depth',
    name: 'Tactical depth',
    description: 'Kick for territory, squeeze the exit, and win the game in their half.',
    weights: { KCK: 1.5, VIS: 1.3, TCK: 1.2, FIT: 1.15, EVA: 0.75 },
    strengthDelta: 0.6,
    variance: 0.7,
  },
  {
    id: 'high_risk',
    name: 'High risk, high reward',
    description: 'Counter from everywhere, offload out of contact, and take them on.',
    weights: { EVA: 1.5, HND: 1.35, PAC: 1.3, TCK: 0.75, FIT: 0.85 },
    strengthDelta: 1.1,
    variance: 1.8,
  },
  {
    id: 'adapt',
    name: 'Adapt to opponent',
    description: 'No plan of your own — read what they bring and answer it.',
    weights: {},
    strengthDelta: 0.3,
    variance: 0.95,
  },
]

export const DEFAULT_GAME_PLAN: GamePlanId = 'balanced_flair'

export function getGamePlan(id: GamePlanId): GamePlanDef {
  const plan = GAME_PLANS.find((p) => p.id === id)
  if (!plan) throw new Error(`Unknown game plan: ${id}`)
  return plan
}

/**
 * "Adapt to opponent" resolves to whichever plan best answers the opposition.
 *
 * It counters rather than mirrors: a pack-heavy side is met by taking the game away from the
 * forwards, and a dangerous back line is met by slowing the game down. Deliberately the plan
 * with no standout weighting of its own — it buys a smaller edge than committing, but it is
 * never the wrong call.
 */
export function resolveAdaptive(
  opponentForwardBias: number,
): Exclude<GamePlanId, 'adapt'> {
  if (opponentForwardBias > 0.5) return 'backline_finesse'
  if (opponentForwardBias < -0.5) return 'tactical_depth'
  return 'balanced_flair'
}

/**
 * How forward-leaning a side is, from the stats of the XV it fields.
 *
 * Positive means the pack is where their danger is.
 */
export function forwardBias(
  stats: readonly { stats: Partial<Record<StatKey, number>> }[],
): number {
  const FORWARD: StatKey[] = ['SCR', 'LNO', 'CAR', 'RUK']
  const BACK: StatKey[] = ['PAC', 'EVA', 'HND', 'VIS']

  const mean = (keys: StatKey[]) => {
    let total = 0
    let n = 0
    for (const p of stats) {
      for (const key of keys) {
        const value = p.stats[key]
        if (value !== undefined) {
          total += value
          n++
        }
      }
    }
    return n === 0 ? 0 : total / n
  }

  return (mean(FORWARD) - mean(BACK)) / 10
}

/** The modifiers a plan contributes for the player's club. */
export function gamePlanModifiers(
  id: GamePlanId,
  isHome: boolean,
  rng: Rng,
  opponentForwardBias = 0,
): MatchModifiers {
  const effective = id === 'adapt' ? resolveAdaptive(opponentForwardBias) : id
  const plan = getGamePlan(effective)
  const adaptive = getGamePlan('adapt')

  const mods: MatchModifiers = {}
  if (Object.keys(plan.weights).length > 0) mods.statWeightOverride = { ...plan.weights }

  // Variance is spent as a strength swing: a high-risk plan can come off spectacularly or
  // fall apart, while tactical depth narrows the match towards the form book.
  const base = id === 'adapt' ? adaptive.strengthDelta : plan.strengthDelta
  const swing = rng.gaussian(0, plan.variance)
  const delta = base + swing

  if (isHome) mods.homeStrengthDelta = delta
  else mods.awayStrengthDelta = delta

  return mods
}
