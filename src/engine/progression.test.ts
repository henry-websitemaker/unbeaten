import { describe, it, expect } from 'vitest'
import {
  ARCHETYPE_LIST,
  CLUB_MOVE_OVR_RANGE,
  applyClubMove,
  applySeasonProgression,
  ageEffect,
  clubMoveDirection,
  distributeOvrChange,
  getArchetype,
  rollClubMoveOvrChange,
} from './progression'
import { computeOvr } from './ovr'
import { createRng } from './rng'
import { POSITIONS } from '../data'
import { POSITION_IDS, type StatBlock, type StatKey } from '../types/core'

function statsAt(position: (typeof POSITION_IDS)[number], value: number): StatBlock {
  const out: StatBlock = {}
  for (const stat of Object.keys(POSITIONS[position].statRanges) as StatKey[]) out[stat] = value
  return out
}

describe('archetypes', () => {
  it('exposes the four from the data file', () => {
    expect(ARCHETYPE_LIST.map((a) => a.id).sort()).toEqual([
      'iron_man',
      'journeyman',
      'late_bloomer',
      'wonderkid',
    ])
  })

  it('throws on an unknown id rather than returning undefined', () => {
    expect(() => getArchetype('nope')).toThrow('Unknown archetype')
  })
})

describe('ageEffect', () => {
  it('has a developing, peak and declining phase for every archetype', () => {
    for (const archetype of ARCHETYPE_LIST) {
      const peak = archetype.growthCurve.peakAge
      expect(ageEffect(peak - 5, archetype).phase).toBe('developing')
      expect(ageEffect(peak, archetype).phase).toBe('peak')
      expect(ageEffect(peak + 5, archetype).phase).toBe('declining')
    }
  })

  it('never decays before the peak', () => {
    for (const archetype of ARCHETYPE_LIST) {
      for (let age = 18; age <= archetype.growthCurve.peakAge; age++) {
        expect(ageEffect(age, archetype).decay).toBe(0)
      }
    }
  })

  it('decays faster and faster after the peak', () => {
    const wonderkid = getArchetype('wonderkid')
    const decays = [1, 2, 3, 4, 5].map(
      (n) => ageEffect(wonderkid.growthCurve.peakAge + 1 + n, wonderkid).decay,
    )
    for (let i = 1; i < decays.length; i++) {
      expect(decays[i]!).toBeGreaterThan(decays[i - 1]!)
    }
  })

  it('makes the Wonderkid fall away faster than the Late Bloomer', () => {
    const wonderkid = getArchetype('wonderkid')
    const lateBloomer = getArchetype('late_bloomer')
    // Compare each at the same distance past its own peak.
    const w = ageEffect(wonderkid.growthCurve.peakAge + 6, wonderkid).decay
    const l = ageEffect(lateBloomer.growthCurve.peakAge + 6, lateBloomer).decay
    expect(w).toBeGreaterThan(l)
  })

  it('gives the Wonderkid the fastest early growth', () => {
    const early = ARCHETYPE_LIST.map((a) => ({
      id: a.id,
      growth: ageEffect(a.growthCurve.peakAge - 5, a).growthMultiplier,
    })).sort((a, b) => b.growth - a.growth)
    expect(early[0]!.id).toBe('wonderkid')
  })

  it('still lets a 34-year-old Late Bloomer be a useful player', () => {
    const lateBloomer = getArchetype('late_bloomer')
    expect(ageEffect(34, lateBloomer).decay).toBeLessThan(3)
  })
})

describe('applySeasonProgression', () => {
  const base = {
    position: 'FH' as const,
    matchGrowthMultiplier: 1,
    appearances: 20,
  }

  it('improves a young player who rated well', () => {
    const stats = statsAt('FH', 65)
    const result = applySeasonProgression({
      ...base,
      stats,
      age: 21,
      archetype: getArchetype('wonderkid'),
      avgRating: 7.8,
      rng: createRng(1),
    })
    expect(result.ovrDelta).toBeGreaterThan(0)
    expect(result.ovr).toBeGreaterThan(computeOvr(stats, 'FH'))
    expect(result.breakdown.phase).toBe('developing')
  })

  it('costs a player who rated badly', () => {
    const result = applySeasonProgression({
      ...base,
      stats: statsAt('FH', 75),
      age: 24,
      archetype: getArchetype('iron_man'),
      avgRating: 5.2,
      rng: createRng(2),
    })
    expect(result.ovrDelta).toBeLessThan(0)
  })

  it('declines an ageing player even on a decent season', () => {
    const result = applySeasonProgression({
      ...base,
      stats: statsAt('FH', 80),
      age: 35,
      archetype: getArchetype('wonderkid'),
      avgRating: 6.8,
      rng: createRng(3),
    })
    expect(result.breakdown.phase).toBe('declining')
    expect(result.breakdown.age).toBeLessThan(0)
    expect(result.ovrDelta).toBeLessThan(0)
  })

  it('scales development with how much the player actually played', () => {
    const shared = {
      ...base,
      stats: statsAt('FH', 65),
      age: 21,
      archetype: getArchetype('wonderkid'),
      avgRating: 8.0,
    }
    const fullSeason = applySeasonProgression({ ...shared, appearances: 20, rng: createRng(4) })
    const barelyPlayed = applySeasonProgression({ ...shared, appearances: 2, rng: createRng(4) })
    expect(fullSeason.ovrDelta).toBeGreaterThan(barelyPlayed.ovrDelta)
  })

  it('honours the Personal Trainer growth multiplier', () => {
    const shared = {
      ...base,
      stats: statsAt('FH', 65),
      age: 21,
      archetype: getArchetype('wonderkid'),
      avgRating: 8.0,
    }
    const plain = applySeasonProgression({ ...shared, matchGrowthMultiplier: 1, rng: createRng(5) })
    const trained = applySeasonProgression({
      ...shared,
      matchGrowthMultiplier: 1.25,
      rng: createRng(5),
    })
    expect(trained.ovrDelta).toBeGreaterThanOrEqual(plain.ovrDelta)
  })

  it('never swings more than 6 OVR in a season', () => {
    const rng = createRng(6)
    for (let i = 0; i < 400; i++) {
      const position = POSITION_IDS[i % POSITION_IDS.length]!
      const stats = statsAt(position, rng.int(45, 90))
      const before = computeOvr(stats, position)
      const result = applySeasonProgression({
        stats,
        position,
        age: rng.int(18, 36),
        archetype: rng.pick(ARCHETYPE_LIST),
        avgRating: rng.float(3, 9.5),
        appearances: rng.int(0, 30),
        matchGrowthMultiplier: 1.25,
        rng,
      })
      expect(Math.abs(result.ovr - before)).toBeLessThanOrEqual(6)
    }
  })

  it('keeps stats and the cached OVR in agreement', () => {
    const rng = createRng(7)
    for (let i = 0; i < 200; i++) {
      const position = POSITION_IDS[i % POSITION_IDS.length]!
      const result = applySeasonProgression({
        stats: statsAt(position, rng.int(50, 88)),
        position,
        age: rng.int(18, 36),
        archetype: rng.pick(ARCHETYPE_LIST),
        avgRating: rng.float(4, 9),
        appearances: 18,
        matchGrowthMultiplier: 1,
        rng,
      })
      expect(Math.abs(computeOvr(result.stats, position) - result.ovr)).toBeLessThanOrEqual(1)
    }
  })

  it('produces a plausible 20-season Wonderkid arc — rise, peak, decline', () => {
    const rng = createRng(2026)
    const archetype = getArchetype('wonderkid')
    let stats = statsAt('OC', 60)
    let age = archetype.startAge
    const ovrByAge: { age: number; ovr: number }[] = []

    for (let season = 1; season <= 20; season++) {
      const result = applySeasonProgression({
        stats,
        position: 'OC',
        age,
        archetype,
        avgRating: 7.2,
        appearances: 20,
        matchGrowthMultiplier: 1,
        rng,
      })
      stats = result.stats
      ovrByAge.push({ age, ovr: result.ovr })
      age++
    }

    const peak = ovrByAge.reduce((best, x) => (x.ovr > best.ovr ? x : best))
    const first = ovrByAge[0]!
    const last = ovrByAge[ovrByAge.length - 1]!

    expect(peak.ovr).toBeGreaterThan(first.ovr)
    expect(last.ovr).toBeLessThan(peak.ovr)
    // Peaks somewhere near the archetype's stated peak age.
    expect(Math.abs(peak.age - archetype.growthCurve.peakAge)).toBeLessThanOrEqual(6)
  })
})

describe('distributeOvrChange', () => {
  it('favours key stats when improving', () => {
    const position = 'FH'
    const keys = POSITIONS[position].keyStats
    let keyGain = 0
    let otherGain = 0

    for (let seed = 0; seed < 60; seed++) {
      const before = statsAt(position, 65)
      const after = distributeOvrChange(before, position, 4, createRng(seed))
      for (const stat of Object.keys(before) as StatKey[]) {
        const delta = (after[stat] ?? 0) - (before[stat] ?? 0)
        if (keys.includes(stat)) keyGain += delta
        else otherGain += delta
      }
    }

    expect(keyGain / keys.length).toBeGreaterThan(otherGain / 4)
  })

  it('takes losses off physical attributes first', () => {
    let pacLoss = 0
    let kckLoss = 0
    for (let seed = 0; seed < 60; seed++) {
      const before = statsAt('FB', 75)
      const after = distributeOvrChange(before, 'FB', -4, createRng(seed))
      pacLoss += (before.PAC ?? 0) - (after.PAC ?? 0)
      kckLoss += (before.KCK ?? 0) - (after.KCK ?? 0)
    }
    expect(pacLoss).toBeGreaterThan(kckLoss)
  })

  it('is a no-op for a zero change', () => {
    const before = statsAt('N8', 70)
    expect(distributeOvrChange(before, 'N8', 0, createRng(1))).toEqual(before)
  })

  it('lands close to the requested OVR', () => {
    const rng = createRng(9)
    for (const position of POSITION_IDS) {
      for (const change of [-3, -1, 1, 3]) {
        const before = statsAt(position, 70)
        const after = distributeOvrChange(before, position, change, rng)
        const actual = computeOvr(after, position) - computeOvr(before, position)
        expect(Math.abs(actual - change)).toBeLessThanOrEqual(1)
      }
    }
  })
})

describe('SPEC §2.5 — club move OVR consequences', () => {
  it('reads +1..+3 up, 0 stay, -1..-3 down', () => {
    expect(CLUB_MOVE_OVR_RANGE.up).toEqual([1, 3])
    expect(CLUB_MOVE_OVR_RANGE.stay).toEqual([0, 0])
    expect(CLUB_MOVE_OVR_RANGE.down).toEqual([-3, -1])
  })

  it('treats moving to tier 1 as a step up', () => {
    expect(clubMoveDirection(2, 1)).toBe('up')
    expect(clubMoveDirection(1, 2)).toBe('down')
    expect(clubMoveDirection(1, 1)).toBe('stay')
    expect(clubMoveDirection(2, 2)).toBe('stay')
  })

  it('rolls only inside the stated range, and covers all of it', () => {
    const rng = createRng(11)
    const seen = { up: new Set<number>(), down: new Set<number>() }
    for (let i = 0; i < 2_000; i++) {
      const up = rollClubMoveOvrChange('up', rng)
      const down = rollClubMoveOvrChange('down', rng)
      expect(up).toBeGreaterThanOrEqual(1)
      expect(up).toBeLessThanOrEqual(3)
      expect(down).toBeGreaterThanOrEqual(-3)
      expect(down).toBeLessThanOrEqual(-1)
      seen.up.add(up)
      seen.down.add(down)
    }
    expect([...seen.up].sort((a, b) => a - b)).toEqual([1, 2, 3])
    expect([...seen.down].sort((a, b) => a - b)).toEqual([-3, -2, -1])
  })

  it('always rolls exactly zero for staying put', () => {
    const rng = createRng(12)
    for (let i = 0; i < 200; i++) expect(rollClubMoveOvrChange('stay', rng)).toBe(0)
  })

  it('applies the move to the stat block', () => {
    const before = statsAt('IC', 70)
    const rng = createRng(13)

    const up = applyClubMove(before, 'IC', 'up', rng)
    expect(up.ovrDelta).toBeGreaterThan(0)
    expect(up.ovr).toBeGreaterThan(computeOvr(before, 'IC'))

    const down = applyClubMove(before, 'IC', 'down', rng)
    expect(down.ovrDelta).toBeLessThan(0)

    const stay = applyClubMove(before, 'IC', 'stay', rng)
    expect(stay.ovrDelta).toBe(0)
    expect(stay.ovr).toBe(computeOvr(before, 'IC'))
  })
})

describe('SPEC §2.5 — OVR moves from four sources and no others', () => {
  it('offers no way to spend points or pick an attribute', async () => {
    const module = await import('./progression')
    const surface = Object.keys(module).join(' ').toLowerCase()
    for (const banned of ['train', 'spendpoint', 'pointsshop', 'attributepick', 'devenv']) {
      expect(surface).not.toContain(banned)
    }
  })
})
