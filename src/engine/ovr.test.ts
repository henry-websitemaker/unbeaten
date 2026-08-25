import { describe, it, expect } from 'vitest'
import {
  canPlayAt,
  clampOvr,
  computeOvr,
  engineWeights,
  positionGroup,
  positionsInGroup,
  ratePlayer,
  ratingInSlot,
} from './ovr'
import { KEY_STAT_ENGINE_WEIGHT, POSITIONS, POSITION_RULES } from '../data'
import { POSITION_IDS, type StatBlock, type StatKey } from '../types/core'

describe('engineWeights', () => {
  it('normalises to 1 for every position', () => {
    for (const id of POSITION_IDS) {
      const total = Object.values(engineWeights(id)).reduce((a, b) => a + b, 0)
      expect(total).toBeCloseTo(1, 10)
    }
  })

  it('applies the 2.5x key-stat weight from the data, not a literal', () => {
    expect(KEY_STAT_ENGINE_WEIGHT).toBe(POSITION_RULES.keyStatEngineWeight)

    // Loosehead prop: SCR .30 (key) and LNO .14 (not key). After a 2.5x boost on SCR the
    // ratio between them must be 2.5x what it was in the raw data.
    const raw = POSITIONS.LHP.ovrWeights
    const w = engineWeights('LHP')
    const rawRatio = raw.SCR! / raw.LNO!
    const engineRatio = w.SCR! / w.LNO!
    expect(engineRatio / rawRatio).toBeCloseTo(KEY_STAT_ENGINE_WEIGHT, 10)
  })

  it('ranks every key stat above every non-key stat of equal raw weight', () => {
    for (const id of POSITION_IDS) {
      const def = POSITIONS[id]
      const w = engineWeights(id)
      for (const key of def.keyStats) {
        for (const [stat, rawWeight] of Object.entries(def.ovrWeights) as [StatKey, number][]) {
          if (def.keyStats.includes(stat)) continue
          if (rawWeight !== def.ovrWeights[key]) continue
          expect(w[key]!).toBeGreaterThan(w[stat]!)
        }
      }
    }
  })

  it('returns a cached frozen object', () => {
    const a = engineWeights('FH')
    const b = engineWeights('FH')
    expect(a).toBe(b)
    expect(Object.isFrozen(a)).toBe(true)
  })
})

describe('ratePlayer', () => {
  it('returns the flat value when every stat is equal', () => {
    for (const id of POSITION_IDS) {
      const stats: StatBlock = {}
      for (const stat of Object.keys(POSITIONS[id].ovrWeights) as StatKey[]) stats[stat] = 70
      expect(ratePlayer(stats, id)).toBeCloseTo(70, 6)
    }
  })

  it('rewards key stats more than non-key stats', () => {
    const flat: StatBlock = {}
    for (const stat of Object.keys(POSITIONS.LHP.ovrWeights) as StatKey[]) flat[stat] = 70

    const keyBoosted = { ...flat, SCR: 90 } // SCR is a key stat
    const nonKeyBoosted = { ...flat, LNO: 90 } // LNO is not

    expect(ratePlayer(keyBoosted, 'LHP')).toBeGreaterThan(ratePlayer(nonKeyBoosted, 'LHP'))
  })

  it('ignores stats the position does not use', () => {
    const stats: StatBlock = {}
    for (const stat of Object.keys(POSITIONS.LHP.ovrWeights) as StatKey[]) stats[stat] = 70
    const withIrrelevant = { ...stats, EVA: 99 } // a prop's OVR does not weight evasion
    expect(ratePlayer(withIrrelevant, 'LHP')).toBeCloseTo(ratePlayer(stats, 'LHP'), 10)
  })

  it('applies weather-style overrides', () => {
    const stats: StatBlock = {}
    for (const stat of Object.keys(POSITIONS.FB.ovrWeights) as StatKey[]) stats[stat] = 60
    stats.KCK = 90

    const dry = ratePlayer(stats, 'FB')
    const wet = ratePlayer(stats, 'FB', { KCK: 1.5, PAC: 0.7 })

    // A big boot matters more in the wet.
    expect(wet).toBeGreaterThan(dry)
  })

  it('returns 0 rather than NaN for an empty stat block', () => {
    expect(ratePlayer({}, 'LHP')).toBe(0)
  })
})

describe('computeOvr', () => {
  it('clamps into 1-99', () => {
    const huge: StatBlock = {}
    for (const stat of Object.keys(POSITIONS.N8.ovrWeights) as StatKey[]) huge[stat] = 500
    expect(computeOvr(huge, 'N8')).toBe(99)
    expect(clampOvr(-40)).toBe(1)
  })

  it('produces sane OVRs for the real recovered stat blocks', () => {
    // Ofa Tu'ungafasi, Blues loosehead — a genuinely good tier-1 prop.
    const ovr = computeOvr(
      { SCR: 85, LNO: 72, CAR: 78, TCK: 74, RUK: 78, FIT: 80 },
      'LHP',
    )
    expect(ovr).toBeGreaterThan(75)
    expect(ovr).toBeLessThan(90)
  })
})

describe('position grouping', () => {
  it('splits all 15 positions into exactly three groups', () => {
    const fwd = positionsInGroup('FWD')
    const hlf = positionsInGroup('HLF')
    const bck = positionsInGroup('BCK')
    expect(fwd.length + hlf.length + bck.length).toBe(15)
    expect(hlf).toEqual(['SH', 'FH'])
    expect(fwd).toHaveLength(8)
    expect(bck).toHaveLength(5)
  })

  it('groups the front row as forwards and the back three as backs', () => {
    expect(positionGroup('LHP')).toBe('FWD')
    expect(positionGroup('N8')).toBe('FWD')
    expect(positionGroup('FH')).toBe('HLF')
    expect(positionGroup('FB')).toBe('BCK')
  })
})

describe('eligibility', () => {
  it('is strict for specialists', () => {
    expect(canPlayAt('HOO', 'HOO')).toBe(true)
    expect(canPlayAt('HOO', 'LHP')).toBe(false)
    expect(canPlayAt('SH', 'FH')).toBe(false)
  })

  it('allows the listed cover roles', () => {
    expect(canPlayAt('FB', 'WL')).toBe(true)
    expect(canPlayAt('BF', 'N8')).toBe(true)
  })

  it('every position can play its own slot', () => {
    for (const id of POSITION_IDS) expect(canPlayAt(id, id)).toBe(true)
  })
})

describe('ratingInSlot', () => {
  const stats: StatBlock = { PAC: 80, KCK: 78, VIS: 76, HND: 74, EVA: 72, TCK: 60, FIT: 70 }

  it('is unpenalised in the natural slot', () => {
    expect(ratingInSlot(stats, 'FB', 'FB')).toBe(ratePlayer(stats, 'FB'))
  })

  it('costs a little in an eligible cover slot', () => {
    const natural = ratingInSlot(stats, 'FB', 'FB')
    const cover = ratingInSlot(stats, 'FB', 'WL')
    expect(cover).toBeLessThan(natural)
    expect(cover).toBeGreaterThan(natural * 0.9)
  })

  it('costs a lot out of position', () => {
    const natural = ratingInSlot(stats, 'FB', 'FB')
    const wrong = ratingInSlot(stats, 'FB', 'LHP')
    expect(wrong).toBeLessThan(natural * 0.8)
  })
})
