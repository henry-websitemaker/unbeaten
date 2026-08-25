import { describe, it, expect } from 'vitest'
import {
  BASE_INJURY_CHANCE_PER_MATCH,
  SEASON_ENDING_SHARE,
  advanceInjury,
  isAvailable,
  rollMatchInjury,
  type InjuryRiskInput,
} from './injuries'
import {
  ALL_EVENTS,
  EVENT_RULES,
  advanceEffects,
  applySlumpReduction,
  eventsForMode,
  resolveEvent,
  rollEvent,
  totalEffects,
} from './events'
import { createRng } from './rng'
import type { TemporaryEffect } from '../types/career'

const FIT: InjuryRiskInput = { riskMultiplier: 1, recoveryWeeksReduction: 0 }
const MATCHES_PER_SEASON = 20

function simulateSeasons(seasons: number, input = FIT, seed = 1) {
  const rng = createRng(seed)
  const injuries: { weeks: number; seasonEnding: boolean }[] = []
  const perSeason: number[] = []

  for (let s = 0; s < seasons; s++) {
    let count = 0
    for (let m = 0; m < MATCHES_PER_SEASON; m++) {
      const injury = rollMatchInjury(rng, input)
      if (injury) {
        count++
        injuries.push({ weeks: injury.weeksRemaining, seasonEnding: injury.seasonEnding })
      }
    }
    perSeason.push(count)
  }

  return { injuries, perSeason }
}

describe('SPEC §3 — injury rates', () => {
  it('averages 0-1 injuries per season for a fit player', () => {
    const { perSeason } = simulateSeasons(4_000)
    const mean = perSeason.reduce((a, b) => a + b, 0) / perSeason.length
    expect(mean).toBeGreaterThan(0)
    expect(mean).toBeLessThanOrEqual(1)
  })

  it('leaves most seasons with at most one injury', () => {
    const { perSeason } = simulateSeasons(4_000)
    const atMostOne = perSeason.filter((n) => n <= 1).length / perSeason.length
    expect(atMostOne).toBeGreaterThan(0.8)
  })

  it('makes most lay-offs 1-3 weeks', () => {
    const { injuries } = simulateSeasons(6_000)
    const short = injuries.filter((i) => i.weeks >= 1 && i.weeks <= 3).length / injuries.length
    expect(short).toBeGreaterThan(0.65)
  })

  it('keeps season-enders under 2%', () => {
    expect(SEASON_ENDING_SHARE).toBeLessThan(0.02)
    const { injuries } = simulateSeasons(8_000)
    const share = injuries.filter((i) => i.seasonEnding).length / injuries.length
    expect(share).toBeLessThan(0.02)
  })

  it('never produces a zero-week injury', () => {
    const { injuries } = simulateSeasons(3_000, { riskMultiplier: 3, recoveryWeeksReduction: 4 })
    for (const injury of injuries) expect(injury.weeks).toBeGreaterThanOrEqual(1)
  })
})

describe('injury risk modifiers', () => {
  it('halves the rate for the Private Physio', () => {
    const normal = simulateSeasons(3_000, FIT).injuries.length
    const physio = simulateSeasons(3_000, { riskMultiplier: 0.5, recoveryWeeksReduction: 1 })
      .injuries.length
    expect(physio).toBeLessThan(normal * 0.7)
  })

  it('makes the Iron Man archetype notably more durable', () => {
    const normal = simulateSeasons(3_000, FIT).injuries.length
    const ironMan = simulateSeasons(3_000, { riskMultiplier: 0.4, recoveryWeeksReduction: 0 })
      .injuries.length
    expect(ironMan).toBeLessThan(normal * 0.6)
  })

  it('shortens recoveries by the reduction, floored at one week', () => {
    const rng = createRng(7)
    for (let i = 0; i < 4_000; i++) {
      const plain = rollMatchInjury(rng, { riskMultiplier: 5, recoveryWeeksReduction: 0 })
      const helped = rollMatchInjury(rng, { riskMultiplier: 5, recoveryWeeksReduction: 1 })
      if (plain && helped) expect(helped.weeksRemaining).toBeGreaterThanOrEqual(1)
    }
  })

  it('makes a tired player more fragile', () => {
    const fresh = simulateSeasons(2_500, { ...FIT, fitness: 90 }).injuries.length
    const exhausted = simulateSeasons(2_500, { ...FIT, fitness: 30 }).injuries.length
    expect(exhausted).toBeGreaterThan(fresh)
  })

  it('has a low base rate to begin with', () => {
    expect(BASE_INJURY_CHANCE_PER_MATCH).toBeLessThan(0.05)
  })
})

describe('injury recovery', () => {
  it('counts down a week at a time and clears', () => {
    let injury = { label: 'Knock', weeksRemaining: 3, seasonEnding: false }
    expect(isAvailable(injury)).toBe(false)

    const week2 = advanceInjury(injury)!
    expect(week2.weeksRemaining).toBe(2)
    injury = week2

    expect(advanceInjury(advanceInjury(injury))).toBeNull()
  })

  it('treats no injury as available', () => {
    expect(isAvailable(null)).toBe(true)
    expect(advanceInjury(null)).toBeNull()
  })
})

describe('between-round events', () => {
  it('fires roughly one round in four', () => {
    const rng = createRng(11)
    let fired = 0
    const rounds = 40_000
    for (let i = 0; i < rounds; i++) {
      // firedThisSeason kept at 0 so the cap does not distort the rate.
      if (rollEvent(rng, 'player_career', 0)) fired++
    }
    expect(fired / rounds).toBeCloseTo(EVENT_RULES.chancePerRound, 1)
    expect(EVENT_RULES.chancePerRound).toBe(0.25)
  })

  it('respects the per-season cap', () => {
    const rng = createRng(12)
    for (let i = 0; i < 100; i++) {
      expect(rollEvent(rng, 'player_career', EVENT_RULES.maxPerSeason)).toBeNull()
    }
  })

  it('keeps manager-only events out of Player Career', () => {
    const playerEvents = eventsForMode('player_career').map((e) => e.id)
    expect(playerEvents).not.toContain('coach_of_month')
    expect(playerEvents).not.toContain('injury_crisis')

    const managerEvents = eventsForMode('team_career').map((e) => e.id)
    expect(managerEvents).toContain('coach_of_month')
    expect(managerEvents).toContain('injury_crisis')
  })

  it('exposes all ten events from the data', () => {
    expect(ALL_EVENTS).toHaveLength(10)
  })

  it('resolves a citing into a real suspension', () => {
    const citing = ALL_EVENTS.find((e) => e.id === 'citing')!
    const outcome = resolveEvent(citing, createRng(3))
    expect(outcome.weeksSuspended).toBeGreaterThanOrEqual(1)
    expect(outcome.weeksSuspended).toBeLessThanOrEqual(3)
    expect(outcome.description).toContain('suspended')
  })

  it('resolves washout conditions into a stat re-weighting', () => {
    const wet = ALL_EVENTS.find((e) => e.id === 'wet_weather')!
    const outcome = resolveEvent(wet, createRng(4))
    expect(outcome.statWeightOverride).toEqual({ KCK: 1.5, SCR: 1.3, PAC: 0.7, EVA: 0.6 })
  })

  it('resolves a poaching bid into a transfer signal', () => {
    const bid = ALL_EVENTS.find((e) => e.id === 'poaching_bid')!
    expect(resolveEvent(bid, createRng(5)).triggersMidSeasonOffer).toBe(true)
  })

  it('attaches temporary form and morale effects', () => {
    const boost = ALL_EVENTS.find((e) => e.id === 'media_boost')!
    const outcome = resolveEvent(boost, createRng(6))
    expect(outcome.effects).toHaveLength(1)
    expect(outcome.effects[0]!.formModifier).toBe(8)
    expect(outcome.effects[0]!.moraleModifier).toBe(12)
  })
})

describe('temporary effects', () => {
  const effects: TemporaryEffect[] = [
    { id: 'a', label: 'Slump', formModifier: -12, matchesRemaining: 2 },
    { id: 'b', label: 'Fallout', moraleModifier: -15, matchesRemaining: 1 },
    { id: 'c', label: 'Dropped', selectionPenalty: 25, matchesRemaining: 3 },
  ]

  it('sums into one set of modifiers', () => {
    expect(totalEffects(effects)).toEqual({ form: -12, morale: -15, selectionPenalty: 25 })
  })

  it('is neutral when nothing is attached', () => {
    expect(totalEffects([])).toEqual({ form: 0, morale: 0, selectionPenalty: 0 })
  })

  it('ticks down and drops what has expired', () => {
    const after = advanceEffects(effects)
    expect(after.map((e) => e.id)).toEqual(['a', 'c'])
    expect(after[0]!.matchesRemaining).toBe(1)
  })

  it('halves slumps for the Sports Psychologist but leaves boosts alone', () => {
    const mixed: TemporaryEffect[] = [
      { id: 'slump', label: 'Slump', formModifier: -12, matchesRemaining: 4 },
      { id: 'boost', label: 'Boost', formModifier: 8, matchesRemaining: 4 },
    ]
    const reduced = applySlumpReduction(mixed, 0.5)
    expect(reduced[0]!.matchesRemaining).toBe(2)
    expect(reduced[1]!.matchesRemaining).toBe(4)
  })

  it('never shortens a slump below one match', () => {
    const one: TemporaryEffect[] = [
      { id: 'slump', label: 'Slump', formModifier: -5, matchesRemaining: 1 },
    ]
    expect(applySlumpReduction(one, 0.5)[0]!.matchesRemaining).toBe(1)
  })

  it('is a no-op without the psychologist', () => {
    expect(applySlumpReduction(effects, 1)).toEqual(effects)
  })
})
