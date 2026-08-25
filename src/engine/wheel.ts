/**
 * The mid-season gamble wheel.
 *
 * One optional, skippable spin at the season midpoint. The invariant that matters, stated
 * in both `wheel-outcomes.json` and SPEC §3, is that **nothing permanent can ever be lost**:
 * positives are permanent (stats, OVR, traits), negatives are temporary only (form, injury,
 * morale). Spinning is therefore never strictly a bad decision, only a risky one.
 */

import { WHEEL } from '../data'
import { clampOvr, computeOvr } from './ovr'
import { raiseOvrOnly } from './progression'
import type { Rng } from './rng'
import type { PositionId, StatBlock, StatKey } from '../types/core'
import type { Injury, TemporaryEffect } from '../types/career'

export type WheelOutcomeType = 'positive' | 'negative' | 'neutral'

export interface WheelOutcome {
  id: string
  type: WheelOutcomeType
  weight: number
  label: string
  permanent: boolean
  effect: {
    randomStat?: number
    ovr?: number
    grantsRandomTrait?: boolean
    isCaptain?: boolean
    salaryBonusPct?: number
    weeksOut?: number
    formModifier?: number
    moraleModifier?: number
    selectionPenalty?: number
    matches?: number
    cosmetic?: boolean
  }
}

interface WheelData {
  rules: {
    spinsPerSeason: number
    trigger: string
    optional: boolean
    targetOdds: { positive: number; negative: number; neutral: number }
  }
  outcomes: WheelOutcome[]
}

const DATA = WHEEL as unknown as WheelData

export const WHEEL_OUTCOMES: readonly WheelOutcome[] = DATA.outcomes
export const WHEEL_RULES = DATA.rules
/** SPEC §3: exactly 50% positive / 35% negative / 15% neutral. */
export const WHEEL_TARGET_ODDS = DATA.rules.targetOdds

/** Traits a spin can unlock. Cosmetic-plus: they read on My Player and never expire. */
export const TRAITS = [
  { id: 'clutch', name: 'Clutch', description: 'Rates higher in finals and internationals.' },
  { id: 'workhorse', name: 'Workhorse', description: 'Holds form deep into a long season.' },
  { id: 'finisher', name: 'Finisher', description: 'Converts more of the chances that come.' },
  { id: 'leader', name: 'Leader', description: 'Lifts the players around you.' },
  { id: 'iron_lungs', name: 'Iron Lungs', description: 'Last twenty minutes are yours.' },
] as const

/**
 * The odds each outcome type actually carries, derived from the weights.
 * A test asserts these land on 50/35/15.
 */
export function actualOdds(): Record<WheelOutcomeType, number> {
  const total = WHEEL_OUTCOMES.reduce((sum, o) => sum + o.weight, 0)
  const out: Record<WheelOutcomeType, number> = { positive: 0, negative: 0, neutral: 0 }
  for (const outcome of WHEEL_OUTCOMES) out[outcome.type] += outcome.weight / total
  return out
}

/** The state a spin can touch. Anything not listed here a spin cannot reach. */
export interface SpinTarget {
  stats: StatBlock
  position: PositionId
  ovr: number
  traits: string[]
  isCaptain: boolean
  salary: number
  form: number
  morale: number
  injury: Injury | null
  effects: TemporaryEffect[]
}

export interface SpinResult {
  outcome: WheelOutcome
  target: SpinTarget
  /** Human-readable summary for the reveal screen. */
  description: string
}

export function pickOutcome(rng: Rng): WheelOutcome {
  return rng.weighted(WHEEL_OUTCOMES, (o) => o.weight)
}

/**
 * Apply one spin.
 *
 * Every branch either improves something permanent or touches only temporary state. There
 * is deliberately no branch that reduces a stat, OVR, a trait, or the captaincy.
 */
export function applySpin(target: SpinTarget, outcome: WheelOutcome, rng: Rng): SpinResult {
  const next: SpinTarget = {
    ...target,
    stats: { ...target.stats },
    traits: [...target.traits],
    effects: [...target.effects],
  }
  const effect = outcome.effect
  let description = outcome.label

  if (effect.randomStat) {
    const keys = Object.keys(next.stats) as StatKey[]
    if (keys.length > 0) {
      const stat = rng.pick(keys)
      next.stats[stat] = Math.min(99, (next.stats[stat] ?? 50) + effect.randomStat)
      next.ovr = computeOvr(next.stats, next.position)
      description = `${outcome.label}: +${effect.randomStat} ${stat}`
    }
  }

  if (effect.ovr) {
    // raiseOvrOnly, not distributeOvrChange: the latter's alignment pass can shave a point
    // off an individual stat while OVR rises, which would breach the wheel's guarantee.
    next.stats = raiseOvrOnly(next.stats, next.position, effect.ovr, rng)
    next.ovr = clampOvr(computeOvr(next.stats, next.position))
    description = `${outcome.label}: +${effect.ovr} OVR`
  }

  if (effect.grantsRandomTrait) {
    const available = TRAITS.filter((t) => !next.traits.includes(t.id))
    if (available.length > 0) {
      const trait = rng.pick(available)
      next.traits.push(trait.id)
      description = `${outcome.label}: ${trait.name}`
    } else {
      // Already hold every trait — fall back to something that is still a gain.
      next.morale = Math.min(100, next.morale + 5)
      description = `${outcome.label}: nothing left to learn`
    }
  }

  if (effect.isCaptain) {
    next.isCaptain = true
    description = `${outcome.label}: you lead the side out`
  }

  if (effect.salaryBonusPct) {
    next.salary = Math.round(next.salary * (1 + effect.salaryBonusPct / 100))
    description = `${outcome.label}: +${effect.salaryBonusPct}% salary`
  }

  // --- temporary only, below this line ---

  if (effect.weeksOut) {
    next.injury = {
      label: outcome.label,
      weeksRemaining: effect.weeksOut,
      seasonEnding: false,
    }
    description = `${outcome.label}: ${effect.weeksOut} weeks out`
  }

  if (effect.formModifier || effect.moraleModifier || effect.selectionPenalty) {
    const temporary: TemporaryEffect = {
      id: outcome.id,
      label: outcome.label,
      matchesRemaining: effect.matches ?? 3,
    }
    if (effect.formModifier !== undefined) temporary.formModifier = effect.formModifier
    if (effect.moraleModifier !== undefined) temporary.moraleModifier = effect.moraleModifier
    if (effect.selectionPenalty !== undefined) temporary.selectionPenalty = effect.selectionPenalty
    next.effects.push(temporary)
    description = `${outcome.label}: ${temporary.matchesRemaining} matches`
  }

  return { outcome, target: next, description }
}

export function spin(target: SpinTarget, rng: Rng): SpinResult {
  return applySpin(target, pickOutcome(rng), rng)
}

/** The round the wheel is offered — halfway through the regular season. */
export function wheelRound(totalRounds: number): number {
  return Math.max(1, Math.floor(totalRounds / 2))
}
