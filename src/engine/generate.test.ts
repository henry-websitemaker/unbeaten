import { describe, it, expect, beforeAll } from 'vitest'
import {
  TIER_TWO_SQUAD_OVR,
  applyKeyStatBonus,
  buildSquad,
  clubPrestige,
  generatePlayer,
  rollAge,
  rollStats,
  selectBestXV,
  shiftToOvr,
  squadStrength,
  teamId,
} from './generate'
import { computeOvr } from './ovr'
import { createRng } from './rng'
import { KEY_STAT_CREATION_BONUS, POSITIONS, loadTeams } from '../data'
import { POSITION_IDS, type StatKey, type TeamDef } from '../types/core'

let teams: readonly TeamDef[]
beforeAll(async () => {
  teams = await loadTeams()
})

describe('rollStats', () => {
  it('rolls every stat inside the position generation ranges', () => {
    const rng = createRng(1)
    for (const position of POSITION_IDS) {
      const ranges = POSITIONS[position].statRanges
      for (let i = 0; i < 200; i++) {
        const stats = rollStats(rng, position)
        expect(Object.keys(stats).sort()).toEqual(Object.keys(ranges).sort())
        for (const [stat, value] of Object.entries(stats) as [StatKey, number][]) {
          const [min, max] = ranges[stat]!
          expect(value).toBeGreaterThanOrEqual(min)
          expect(value).toBeLessThanOrEqual(max)
        }
      }
    }
  })
})

describe('SPEC §2.6 — key stats start +4..+6 above the rest', () => {
  it('lifts every key stat into the required band for every position', () => {
    const rng = createRng(42)
    const [minBonus, maxBonus] = KEY_STAT_CREATION_BONUS

    for (const position of POSITION_IDS) {
      const def = POSITIONS[position]
      for (let i = 0; i < 100; i++) {
        const raw = rollStats(rng, position)
        const withBonus = applyKeyStatBonus(rng, raw, position, KEY_STAT_CREATION_BONUS)

        const others = (Object.entries(withBonus) as [StatKey, number][])
          .filter(([stat]) => !def.keyStats.includes(stat))
          .map(([, v]) => v)
        const baseline = others.reduce((a, b) => a + b, 0) / others.length

        for (const key of def.keyStats) {
          const gap = withBonus[key]! - baseline
          // Clamping at 99 can shave the top of the band.
          expect(gap).toBeGreaterThanOrEqual(minBonus - 1)
          expect(gap).toBeLessThanOrEqual(maxBonus + 1)
        }
      }
    }
  })

  it('reads the bonus range from positions.json rather than hardcoding 4..6', () => {
    expect(KEY_STAT_CREATION_BONUS).toEqual([4, 6])
  })

  it('leaves non-key stats untouched', () => {
    const rng = createRng(7)
    const raw = rollStats(rng, 'FH')
    const withBonus = applyKeyStatBonus(rng, raw, 'FH', KEY_STAT_CREATION_BONUS)
    for (const [stat, value] of Object.entries(raw) as [StatKey, number][]) {
      if (POSITIONS.FH.keyStats.includes(stat)) continue
      expect(withBonus[stat]).toBe(value)
    }
  })
})

describe('shiftToOvr', () => {
  it('hits the requested OVR across the whole usable range', () => {
    const rng = createRng(9)
    for (const position of POSITION_IDS) {
      for (const target of [45, 55, 65, 75, 85, 92]) {
        const stats = shiftToOvr(rollStats(rng, position), position, target)
        expect(computeOvr(stats, position)).toBeGreaterThanOrEqual(target - 1)
        expect(computeOvr(stats, position)).toBeLessThanOrEqual(target + 1)
      }
    }
  })

  it('preserves the key-stat gaps that §2.6 established', () => {
    const rng = createRng(11)
    const position = 'LHP'
    const def = POSITIONS[position]

    const withBonus = applyKeyStatBonus(
      rng,
      rollStats(rng, position),
      position,
      KEY_STAT_CREATION_BONUS,
    )
    const shifted = shiftToOvr(withBonus, position, 80)

    // Additive shifting must move every stat equally, so the gaps survive.
    for (const key of def.keyStats) {
      const before = withBonus[key]!
      const after = shifted[key]!
      const delta = after - before
      for (const [stat, value] of Object.entries(withBonus) as [StatKey, number][]) {
        if (def.keyStats.includes(stat)) continue
        expect(shifted[stat]! - value).toBeCloseTo(delta, 0)
      }
    }
  })
})

describe('clubPrestige', () => {
  it('is stable across calls and careers', () => {
    expect(clubPrestige('Sydney University')).toBe(clubPrestige('Sydney University'))
  })

  it('separates clubs', () => {
    expect(clubPrestige('Randwick')).not.toBe(clubPrestige('Warringah'))
  })

  it('stays inside [-1, 1] and spreads across the range', () => {
    const values = teams.map((t) => clubPrestige(t.name))
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(-1)
      expect(v).toBeLessThanOrEqual(1)
    }
    expect(Math.min(...values)).toBeLessThan(-0.4)
    expect(Math.max(...values)).toBeGreaterThan(0.4)
  })
})

describe('buildSquad', () => {
  it('keeps recovered tier-1 rosters exactly as found', () => {
    const blues = teams.find((t) => t.name === 'Blues')!
    const built = buildSquad(1234, blues)

    for (const entry of blues.roster) {
      const found = built.squad.find((p) => p.name === entry.name)
      expect(found).toBeDefined()
      expect(found!.position).toBe(entry.position)
      expect(found!.age).toBe(entry.age)
      expect(found!.stats).toEqual(entry.stats)
    }
  })

  it('generates a full XV for the empty tier-2 clubs', () => {
    const tierTwo = teams.filter((t) => t.roster.length === 0)
    expect(tierTwo.length).toBe(48)

    for (const def of tierTwo.slice(0, 12)) {
      const built = buildSquad(99, def)
      const covered = new Set(built.squad.map((p) => p.position))
      for (const position of POSITION_IDS) expect(covered.has(position)).toBe(true)
    }
  })

  it('gives every club bench depth, so an injury always has cover', () => {
    for (const def of [teams.find((t) => t.name === 'Blues')!, teams.find((t) => t.roster.length === 0)!]) {
      const built = buildSquad(5, def)
      expect(built.squad.length).toBe(23)
    }
  })

  it('is deterministic for a seed and varies between seeds', () => {
    const def = teams.find((t) => t.roster.length === 0)!
    const a = buildSquad(1, def)
    const b = buildSquad(1, def)
    const c = buildSquad(2, def)

    expect(a.squad.map((p) => `${p.name}:${p.ovr}`)).toEqual(b.squad.map((p) => `${p.name}:${p.ovr}`))
    expect(a.squad.map((p) => p.name)).not.toEqual(c.squad.map((p) => p.name))
  })

  it('gives generated players unique names within a squad', () => {
    for (let seed = 0; seed < 30; seed++) {
      const def = teams.filter((t) => t.roster.length === 0)[seed % 48]!
      const built = buildSquad(seed, def)
      const names = built.squad.map((p) => p.name)
      expect(new Set(names).size).toBe(names.length)
    }
  })

  it('slugs accented club names cleanly', () => {
    const stade = teams.find((t) => t.name.includes('Français'))
    expect(stade).toBeDefined()
    const id = teamId(stade!)
    expect(id).toBe('top_14:stade-francais')
    expect(id).toMatch(/^[a-z0-9_:-]+$/)
  })

  it('gives every club a unique id', () => {
    const ids = teams.map(teamId)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('tier separation — tier 1 must be earned', () => {
  it('builds tier-2 squads clearly weaker than the recovered tier-1 ones', () => {
    const tierOne = teams.filter((t) => t.roster.length > 0).map((t) => squadStrength(buildSquad(7, t)))
    const tierTwo = teams.filter((t) => t.roster.length === 0).map((t) => squadStrength(buildSquad(7, t)))

    const meanOne = tierOne.reduce((a, b) => a + b, 0) / tierOne.length
    const meanTwo = tierTwo.reduce((a, b) => a + b, 0) / tierTwo.length

    expect(meanTwo).toBeLessThan(meanOne - 8)
    // The strongest tier-2 club should still not out-rank a mid-table tier-1 club.
    expect(Math.max(...tierTwo)).toBeLessThan(meanOne)
  })

  it('centres generated tier-2 squads on the calibrated mean', () => {
    const strengths = teams
      .filter((t) => t.roster.length === 0)
      .map((t) => squadStrength(buildSquad(3, t)))
    const mean = strengths.reduce((a, b) => a + b, 0) / strengths.length
    // Bench depth pulls the squad mean a little below the starting XV target.
    expect(mean).toBeGreaterThan(TIER_TWO_SQUAD_OVR.mean - 6)
    expect(mean).toBeLessThan(TIER_TWO_SQUAD_OVR.mean + 6)
  })

  it('spreads tier-2 clubs so some are genuinely better than others', () => {
    const strengths = teams
      .filter((t) => t.roster.length === 0)
      .map((t) => squadStrength(buildSquad(3, t)))
    expect(Math.max(...strengths) - Math.min(...strengths)).toBeGreaterThan(4)
  })
})

describe('selectBestXV', () => {
  it('fills all 15 shirts and returns them in shirt order', () => {
    for (const def of teams.slice(0, 20)) {
      const xv = selectBestXV(buildSquad(2, def))
      expect(xv).toHaveLength(15)
      const numbers = xv.map((s) => POSITIONS[s.slot].number)
      expect(numbers).toEqual([...numbers].sort((a, b) => a - b))
      expect(new Set(xv.map((s) => s.slot)).size).toBe(15)
    }
  })

  it('never picks the same player twice', () => {
    for (const def of teams.slice(0, 20)) {
      const xv = selectBestXV(buildSquad(2, def))
      const ids = xv.map((s) => s.player.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('respects strict eligibility when the squad is healthy', () => {
    const xv = selectBestXV(buildSquad(2, teams.find((t) => t.name === 'Blues')!))
    for (const pick of xv) {
      expect(pick.outOfPosition).toBe(false)
      expect(POSITIONS[pick.player.position].canPlayAt).toContain(pick.slot)
    }
  })

  it('still fields fifteen when specialists are unavailable', () => {
    const team = buildSquad(2, teams.find((t) => t.name === 'Blues')!)
    // Rule out every hooker in the squad.
    const unavailable = new Set(team.squad.filter((p) => p.position === 'HOO').map((p) => p.id))
    expect(unavailable.size).toBeGreaterThan(0)

    const xv = selectBestXV(team, unavailable)
    expect(xv).toHaveLength(15)
    for (const pick of xv) expect(unavailable.has(pick.player.id)).toBe(false)
    // Someone had to cover, and is correctly flagged.
    expect(xv.some((s) => s.outOfPosition)).toBe(true)
  })

  it('weakens a club when it has to field people out of position', () => {
    const team = buildSquad(2, teams.find((t) => t.name === 'Blues')!)
    const full = squadStrength(team)
    const missingProps = new Set(
      team.squad.filter((p) => p.position === 'LHP' || p.position === 'THP').map((p) => p.id),
    )
    expect(squadStrength(team, missingProps)).toBeLessThan(full)
  })
})

describe('rollAge', () => {
  it('stays in a plausible professional range and centres on the mid twenties', () => {
    const rng = createRng(3)
    const ages = Array.from({ length: 5_000 }, () => rollAge(rng))
    expect(Math.min(...ages)).toBeGreaterThanOrEqual(18)
    expect(Math.max(...ages)).toBeLessThanOrEqual(36)
    const mean = ages.reduce((a, b) => a + b, 0) / ages.length
    expect(mean).toBeGreaterThan(24)
    expect(mean).toBeLessThan(28)
  })
})

describe('generatePlayer', () => {
  it('hits its target OVR', () => {
    const rng = createRng(15)
    for (const position of POSITION_IDS) {
      for (const target of [56, 68, 80, 90]) {
        const p = generatePlayer(rng, 'x', { position, leagueId: 'npc', targetOvr: target })
        expect(Math.abs(p.ovr - target)).toBeLessThanOrEqual(1)
      }
    }
  })

  it('caches ovr consistently with its own stats', () => {
    const rng = createRng(16)
    for (let i = 0; i < 200; i++) {
      const position = POSITION_IDS[i % POSITION_IDS.length]!
      const p = generatePlayer(rng, 'x', { position, leagueId: 'top_14', targetOvr: 75 })
      expect(p.ovr).toBe(computeOvr(p.stats, p.position))
    }
  })
})
