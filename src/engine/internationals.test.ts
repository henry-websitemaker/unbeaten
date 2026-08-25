import { describe, it, expect } from 'vitest'
import {
  COMPETITIONS,
  NATIONS,
  SELECTION_RULES,
  WORLD_CUP_SEASONS,
  assessSelection,
  competitionsForSeason,
  getNation,
  isWorldCupSeason,
  nationsByStrength,
  nationsForLeague,
  ovrFloor,
  selectionThreshold,
  simulateWorldCup,
  winProbability,
} from './internationals'
import { createRng } from './rng'
import { BALANCE_TARGETS } from '../data'
import { CAREER_SEASONS } from '../types/career'

describe('data', () => {
  it('has twelve nations and four competitions', () => {
    expect(NATIONS).toHaveLength(12)
    expect(COMPETITIONS).toHaveLength(4)
  })

  it('puts World Cups in seasons 4, 8, 12, 16 and 20', () => {
    expect([...WORLD_CUP_SEASONS]).toEqual([4, 8, 12, 16, 20])
    for (const season of [4, 8, 12, 16, 20]) expect(isWorldCupSeason(season)).toBe(true)
    for (const season of [1, 5, 11, 19]) expect(isWorldCupSeason(season)).toBe(false)
  })

  it('lands the last World Cup on the final season of a career', () => {
    expect(WORLD_CUP_SEASONS[WORLD_CUP_SEASONS.length - 1]).toBe(CAREER_SEASONS)
  })

  it('maps every league to at least one nation', () => {
    for (const leagueId of ['super_rugby', 'premiership', 'top_14', 'urc', 'npc', 'shute_shield', 'rfu_championship', 'pro_d2'] as const) {
      expect(nationsForLeague(leagueId).length).toBeGreaterThan(0)
    }
  })

  it('throws on an unknown nation', () => {
    expect(() => getNation('atlantis')).toThrow('Unknown nation')
  })
})

describe('selection scales with nation strength', () => {
  it('sets a higher bar for New Zealand than for Italy', () => {
    const nz = getNation('nzl')
    const ita = getNation('ita')
    expect(selectionThreshold(nz, 0)).toBeGreaterThan(selectionThreshold(ita, 0))
    expect(ovrFloor(nz, 0)).toBeGreaterThan(ovrFloor(ita, 0))
  })

  it('lets a hot streak at a smaller nation force a call-up', () => {
    const samoa = assessSelection({
      nationId: 'sam',
      ovr: 76,
      formRating: 7.5,
      existingCaps: 0,
    })
    const newZealand = assessSelection({
      nationId: 'nzl',
      ovr: 76,
      formRating: 7.5,
      existingCaps: 0,
    })
    expect(samoa.selected).toBe(true)
    expect(newZealand.selected).toBe(false)
  })

  it('judges an established international more kindly than a debutant', () => {
    const debutant = assessSelection({ nationId: 'eng', ovr: 78, formRating: 7.3, existingCaps: 0 })
    const veteran = assessSelection({ nationId: 'eng', ovr: 78, formRating: 7.3, existingCaps: 40 })
    expect(veteran.threshold).toBeLessThan(debutant.threshold)
  })

  it('refuses a player below the OVR floor whatever their form', () => {
    const verdict = assessSelection({ nationId: 'nzl', ovr: 60, formRating: 9.5, existingCaps: 0 })
    expect(verdict.selected).toBe(false)
    expect(verdict.reason).toContain('OVR')
  })

  it('gives a specific reason for a refusal', () => {
    const verdict = assessSelection({ nationId: 'eng', ovr: 80, formRating: 6.0, existingCaps: 0 })
    expect(verdict.selected).toBe(false)
    expect(verdict.reason).toContain('average form')
  })

  it('uses the form window and floors from the data file', () => {
    expect(SELECTION_RULES.formWindowMatches).toBe(6)
    expect(SELECTION_RULES.minAvgRatingForDebut).toBe(7.2)
    expect(SELECTION_RULES.minOvrForDebut).toBe(74)
  })
})

describe('competitions by hemisphere', () => {
  it('sends northern nations to the Six Nations and southern to the Rugby Championship', () => {
    const england = competitionsForSeason(getNation('eng'), 1).map((c) => c.id)
    const newZealand = competitionsForSeason(getNation('nzl'), 1).map((c) => c.id)

    expect(england).toContain('six_nations')
    expect(england).not.toContain('rugby_championship')
    expect(newZealand).toContain('rugby_championship')
    expect(newZealand).not.toContain('six_nations')
  })

  it('sends everyone to the Autumn Internationals', () => {
    for (const nation of NATIONS) {
      expect(competitionsForSeason(nation, 1).map((c) => c.id)).toContain('autumn_tests')
    }
  })

  it('adds the World Cup only in a World Cup season', () => {
    expect(competitionsForSeason(getNation('fra'), 3).map((c) => c.id)).not.toContain('world_cup')
    expect(competitionsForSeason(getNation('fra'), 4).map((c) => c.id)).toContain('world_cup')
  })
})

describe('winProbability', () => {
  it('is even between equals', () => {
    expect(winProbability(getNation('nzl'), getNation('rsa'))).toBeCloseTo(0.5, 5)
  })

  it('favours the stronger nation without making it certain', () => {
    const p = winProbability(getNation('nzl'), getNation('sam'))
    expect(p).toBeGreaterThan(0.85)
    expect(p).toBeLessThan(1)
  })

  it('is symmetric', () => {
    const a = winProbability(getNation('eng'), getNation('wal'))
    const b = winProbability(getNation('wal'), getNation('eng'))
    expect(a + b).toBeCloseTo(1, 10)
  })
})

describe('SPEC §2.4 — World Cup distribution', () => {
  const CYCLES = BALANCE_TARGETS.internationals.simsPerCycle * 5

  function runCycles(count: number) {
    const winners = new Map<string, number>()
    const finalists = new Map<string, number>()

    for (let i = 0; i < count; i++) {
      const result = simulateWorldCup(createRng(i * 7919 + 13))
      winners.set(result.championId, (winners.get(result.championId) ?? 0) + 1)
      for (const id of result.finalistIds) {
        finalists.set(id, (finalists.get(id) ?? 0) + 1)
      }
    }

    return { winners, finalists }
  }

  it('gives New Zealand, South Africa, France and Ireland 65-80% of titles between them', () => {
    const { winners } = runCycles(CYCLES)
    const bigFour = ['nzl', 'rsa', 'fra', 'irl']
    const share = bigFour.reduce((total, id) => total + (winners.get(id) ?? 0), 0) / CYCLES

    expect(share).toBeGreaterThanOrEqual(0.65)
    expect(share).toBeLessThanOrEqual(0.8)
  })

  it('lets no single nation exceed 30%', () => {
    const { winners } = runCycles(CYCLES)
    for (const [id, count] of winners) {
      expect(count / CYCLES, `${id} won too often`).toBeLessThanOrEqual(0.3)
    }
  })

  it('gets a nation outside the top six into a final in at least 5% of cycles', () => {
    const { finalists } = runCycles(CYCLES)
    const outsideTopSix = new Set(nationsByStrength().slice(6).map((n) => n.id))

    let shocks = 0
    for (const [id, count] of finalists) {
      if (outsideTopSix.has(id)) shocks += count
    }

    expect(shocks / CYCLES).toBeGreaterThanOrEqual(0.05)
  })

  it('always produces a champion who reached the final', () => {
    for (let i = 0; i < 200; i++) {
      const result = simulateWorldCup(createRng(i))
      expect(result.finalistIds).toContain(result.championId)
      expect(result.semiFinalistIds).toHaveLength(4)
    }
  })

  it('is deterministic for a seed', () => {
    expect(simulateWorldCup(createRng(42))).toEqual(simulateWorldCup(createRng(42)))
  })
})
