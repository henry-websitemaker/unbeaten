import { describe, it, expect } from 'vitest'
import {
  TRAITS,
  WHEEL_OUTCOMES,
  WHEEL_RULES,
  WHEEL_TARGET_ODDS,
  actualOdds,
  applySpin,
  pickOutcome,
  spin,
  wheelRound,
  type SpinTarget,
} from './wheel'
import { computeOvr } from './ovr'
import { createRng } from './rng'
import { POSITIONS, getLeague } from '../data'
import type { StatBlock, StatKey } from '../types/core'

function target(): SpinTarget {
  const stats: StatBlock = {}
  for (const stat of Object.keys(POSITIONS.OC.statRanges) as StatKey[]) stats[stat] = 70
  return {
    stats,
    position: 'OC',
    ovr: computeOvr(stats, 'OC'),
    traits: [],
    isCaptain: false,
    salary: 200_000,
    form: 70,
    morale: 70,
    injury: null,
    effects: [],
  }
}

describe('SPEC §3 — the wheel sits at exactly 50/35/15', () => {
  it('declares those odds in the data', () => {
    expect(WHEEL_TARGET_ODDS).toEqual({ positive: 0.5, negative: 0.35, neutral: 0.15 })
  })

  it('has weights that actually produce them', () => {
    const odds = actualOdds()
    expect(odds.positive).toBeCloseTo(0.5, 10)
    expect(odds.negative).toBeCloseTo(0.35, 10)
    expect(odds.neutral).toBeCloseTo(0.15, 10)
  })

  it('produces those odds when actually spun', () => {
    const rng = createRng(2024)
    const counts = { positive: 0, negative: 0, neutral: 0 }
    const n = 60_000
    for (let i = 0; i < n; i++) counts[pickOutcome(rng).type]++

    expect(counts.positive / n).toBeCloseTo(0.5, 1)
    expect(counts.negative / n).toBeCloseTo(0.35, 1)
    expect(counts.neutral / n).toBeCloseTo(0.15, 1)
  })

  it('is one optional spin per season at the midpoint', () => {
    expect(WHEEL_RULES.spinsPerSeason).toBe(1)
    expect(WHEEL_RULES.optional).toBe(true)
    expect(WHEEL_RULES.trigger).toBe('season_midpoint')
  })

  it('offers the spin halfway through, for every league length in the data', () => {
    for (const id of ['npc', 'premiership', 'pro_d2'] as const) {
      const rounds = getLeague(id).rounds
      const round = wheelRound(rounds)
      expect(round).toBeGreaterThanOrEqual(1)
      expect(round).toBeLessThan(rounds)
    }
  })
})

describe('SPEC §3 — nothing permanent is ever lost', () => {
  it('holds when every single outcome is spun', () => {
    const before = target()
    const rng = createRng(1)

    // Every outcome, not a sample of them.
    for (const outcome of WHEEL_OUTCOMES) {
      const { target: after } = applySpin(before, outcome, rng)

      // No stat may fall.
      for (const stat of Object.keys(before.stats) as StatKey[]) {
        expect(
          after.stats[stat]!,
          `${outcome.id} reduced ${stat}`,
        ).toBeGreaterThanOrEqual(before.stats[stat]!)
      }

      // OVR may not fall.
      expect(after.ovr, `${outcome.id} reduced OVR`).toBeGreaterThanOrEqual(before.ovr)

      // Traits may not be taken away.
      for (const trait of before.traits) {
        expect(after.traits, `${outcome.id} removed a trait`).toContain(trait)
      }
      expect(after.traits.length).toBeGreaterThanOrEqual(before.traits.length)

      // The captaincy may not be taken away.
      if (before.isCaptain) expect(after.isCaptain).toBe(true)

      // Salary may not be cut.
      expect(after.salary, `${outcome.id} cut salary`).toBeGreaterThanOrEqual(before.salary)
    }
  })

  it('holds across ten thousand random spins from varied starting points', () => {
    const rng = createRng(99)
    for (let i = 0; i < 10_000; i++) {
      const before = target()
      before.traits = i % 3 === 0 ? ['clutch'] : []
      before.isCaptain = i % 5 === 0

      const { target: after, outcome } = spin(before, rng)

      for (const stat of Object.keys(before.stats) as StatKey[]) {
        expect(after.stats[stat]!).toBeGreaterThanOrEqual(before.stats[stat]!)
      }
      expect(after.ovr).toBeGreaterThanOrEqual(before.ovr)
      expect(after.salary).toBeGreaterThanOrEqual(before.salary)
      for (const trait of before.traits) expect(after.traits).toContain(trait)
      if (before.isCaptain) expect(after.isCaptain).toBe(true)
      expect(outcome.id.length).toBeGreaterThan(0)
    }
  })

  it('marks every negative outcome as non-permanent in the data', () => {
    for (const outcome of WHEEL_OUTCOMES) {
      if (outcome.type === 'negative') {
        expect(outcome.permanent, `${outcome.id} is a permanent negative`).toBe(false)
      }
    }
  })

  it('gives negatives only form, injury, morale or selection effects', () => {
    const allowed = new Set([
      'weeksOut',
      'formModifier',
      'moraleModifier',
      'selectionPenalty',
      'matches',
    ])
    for (const outcome of WHEEL_OUTCOMES) {
      if (outcome.type !== 'negative') continue
      for (const key of Object.keys(outcome.effect)) {
        expect(allowed.has(key), `${outcome.id} has a permanent effect: ${key}`).toBe(true)
      }
    }
  })

  it('does not mutate the target it is given', () => {
    const before = target()
    const snapshot = JSON.parse(JSON.stringify(before))
    for (const outcome of WHEEL_OUTCOMES) applySpin(before, outcome, createRng(3))
    expect(JSON.parse(JSON.stringify(before))).toEqual(snapshot)
  })
})

describe('individual outcomes', () => {
  const find = (id: string) => WHEEL_OUTCOMES.find((o) => o.id === id)!

  it('Breakthrough raises a stat', () => {
    const before = target()
    const { target: after } = applySpin(before, find('stat_boost'), createRng(1))
    const raised = (Object.keys(before.stats) as StatKey[]).filter(
      (s) => after.stats[s]! > before.stats[s]!,
    )
    expect(raised).toHaveLength(1)
  })

  it('Level Up raises OVR by the stated amount', () => {
    const before = target()
    const { target: after } = applySpin(before, find('ovr_surge'), createRng(2))
    expect(after.ovr - before.ovr).toBeGreaterThanOrEqual(1)
    expect(after.ovr - before.ovr).toBeLessThanOrEqual(3)
  })

  it('New Dimension grants a trait the player does not already hold', () => {
    const before = target()
    const { target: after } = applySpin(before, find('trait_unlock'), createRng(3))
    expect(after.traits).toHaveLength(1)
    expect(TRAITS.map((t) => t.id)).toContain(after.traits[0])
  })

  it('New Dimension degrades gracefully when every trait is held', () => {
    const before = target()
    before.traits = TRAITS.map((t) => t.id)
    const { target: after } = applySpin(before, find('trait_unlock'), createRng(4))
    expect(after.traits).toHaveLength(TRAITS.length)
    expect(after.morale).toBeGreaterThan(before.morale)
  })

  it('Named Captain sets the captaincy', () => {
    const { target: after } = applySpin(target(), find('captaincy'), createRng(5))
    expect(after.isCaptain).toBe(true)
  })

  it('Boot Deal raises salary by the stated percentage', () => {
    const before = target()
    const { target: after } = applySpin(before, find('sponsor'), createRng(6))
    expect(after.salary).toBe(Math.round(before.salary * 1.15))
  })

  it('Knock produces a temporary injury only', () => {
    const before = target()
    const { target: after } = applySpin(before, find('minor_injury'), createRng(7))
    expect(after.injury).not.toBeNull()
    expect(after.injury!.weeksRemaining).toBe(2)
    expect(after.injury!.seasonEnding).toBe(false)
    expect(after.ovr).toBe(before.ovr)
  })

  it('Off the Boil dents form for a set number of matches', () => {
    const before = target()
    const { target: after } = applySpin(before, find('form_slump'), createRng(8))
    expect(after.effects).toHaveLength(1)
    expect(after.effects[0]!.formModifier).toBe(-12)
    expect(after.effects[0]!.matchesRemaining).toBe(3)
    expect(after.stats).toEqual(before.stats)
  })

  it('Quiet Week changes nothing that matters', () => {
    const before = target()
    const { target: after } = applySpin(before, find('nothing'), createRng(9))
    expect(after.stats).toEqual(before.stats)
    expect(after.ovr).toBe(before.ovr)
    expect(after.effects).toHaveLength(0)
    expect(after.injury).toBeNull()
  })
})

describe('determinism', () => {
  it('spins the same result for the same seed', () => {
    const a = spin(target(), createRng(500))
    const b = spin(target(), createRng(500))
    expect(a.outcome.id).toBe(b.outcome.id)
    expect(a.target).toEqual(b.target)
  })
})
