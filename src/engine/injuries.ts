/**
 * Injuries.
 *
 * SPEC §3 sets the shape precisely: a low base rate of 0-1 per season for a fit player,
 * most lay-offs 1-3 weeks, and season-enders under 2%. Rugby is a collision sport, so
 * injuries have to exist — but a career that is mostly spent in the physio room is not the
 * game anyone asked for.
 */

import type { Rng } from './rng'
import type { Injury } from '../types/career'

/**
 * Per-match chance of picking up a knock, before any modifier.
 *
 * Calibrated against a ~20-match season: 0.038 gives a mean of about 0.76 injuries per
 * season, which sits inside the "0-1 for a fit player" target.
 */
export const BASE_INJURY_CHANCE_PER_MATCH = 0.038

/** Severity bands. Weights sum to 1; season-enders are deliberately rare. */
const SEVERITY_BANDS = [
  { label: 'Knock', weeks: [1, 3] as const, weight: 0.735, seasonEnding: false },
  { label: 'Strain', weeks: [4, 8] as const, weight: 0.2, seasonEnding: false },
  { label: 'Serious injury', weeks: [9, 16] as const, weight: 0.05, seasonEnding: false },
  { label: 'Season-ending injury', weeks: [20, 30] as const, weight: 0.015, seasonEnding: true },
] as const

/** SPEC §3: season-enders under 2%. */
export const SEASON_ENDING_SHARE = SEVERITY_BANDS.find((b) => b.seasonEnding)!.weight

export interface InjuryRiskInput {
  /** Combined archetype and lifestyle modifiers — Iron Man 0.4, Private Physio 0.5. */
  riskMultiplier: number
  /** Weeks knocked off every recovery by the Private Physio. */
  recoveryWeeksReduction: number
  /** A tired player is more fragile. 0-100. */
  fitness?: number
}

/**
 * Roll for an injury after one match. Returns null the vast majority of the time.
 */
export function rollMatchInjury(rng: Rng, input: InjuryRiskInput): Injury | null {
  const fitnessFactor = input.fitness === undefined ? 1 : 1 + (70 - input.fitness) * 0.004
  const chance = BASE_INJURY_CHANCE_PER_MATCH * input.riskMultiplier * Math.max(0.5, fitnessFactor)

  if (!rng.bool(Math.max(0, Math.min(0.5, chance)))) return null

  const band = rng.weighted(SEVERITY_BANDS, (b) => b.weight)
  const rawWeeks = rng.int(band.weeks[0], band.weeks[1])
  // Recovery reduction never turns an injury into nothing at all.
  const weeks = Math.max(1, rawWeeks - input.recoveryWeeksReduction)

  return { label: band.label, weeksRemaining: weeks, seasonEnding: band.seasonEnding }
}

/** Tick a week off an injury. Returns null once the player is fit again. */
export function advanceInjury(injury: Injury | null): Injury | null {
  if (!injury) return null
  const weeksRemaining = injury.weeksRemaining - 1
  if (weeksRemaining <= 0) return null
  return { ...injury, weeksRemaining }
}

export function isAvailable(injury: Injury | null): boolean {
  return injury === null || injury.weeksRemaining <= 0
}
