import { describe, it, expect } from 'vitest'
import {
  byeRounds,
  fixturesByRound,
  fixturesForTeam,
  generateFixtures,
  matchCountForTeam,
} from './fixtures'
import { LEAGUE_LIST, getLeague } from '../data'
import { createRng } from './rng'
import type { LeagueDef } from '../types/core'

function idsFor(league: LeagueDef): string[] {
  return Array.from({ length: league.teamCount }, (_, i) => `club-${i}`)
}

describe('generateFixtures — every league in the data', () => {
  it('produces exactly league.rounds rounds for all 8 leagues', () => {
    for (const league of LEAGUE_LIST) {
      const fixtures = generateFixtures(league, idsFor(league), createRng(1))
      const rounds = fixturesByRound(fixtures)
      expect(rounds.size).toBe(league.rounds)
      // Rounds are numbered 1..rounds with no gaps.
      for (let r = 1; r <= league.rounds; r++) expect(rounds.has(r)).toBe(true)
    }
  })

  it('never has a club playing twice in the same round', () => {
    for (const league of LEAGUE_LIST) {
      for (let seed = 0; seed < 5; seed++) {
        const fixtures = generateFixtures(league, idsFor(league), createRng(seed))
        for (const [round, list] of fixturesByRound(fixtures)) {
          const seen = new Set<string>()
          for (const f of list) {
            expect(seen.has(f.homeId), `${league.id} r${round} dup ${f.homeId}`).toBe(false)
            expect(seen.has(f.awayId), `${league.id} r${round} dup ${f.awayId}`).toBe(false)
            seen.add(f.homeId)
            seen.add(f.awayId)
          }
        }
      }
    }
  })

  it('never pairs a club with itself', () => {
    for (const league of LEAGUE_LIST) {
      for (const f of generateFixtures(league, idsFor(league), createRng(3))) {
        expect(f.homeId).not.toBe(f.awayId)
      }
    }
  })

  it('fills every round with the right number of matches', () => {
    for (const league of LEAGUE_LIST) {
      const expected = Math.floor(league.teamCount / 2)
      const fixtures = generateFixtures(league, idsFor(league), createRng(4))
      for (const [, list] of fixturesByRound(fixtures)) {
        expect(list.length).toBe(expected)
      }
    }
  })

  it('gives every club a broadly even number of matches', () => {
    for (const league of LEAGUE_LIST) {
      const ids = idsFor(league)
      const fixtures = generateFixtures(league, ids, createRng(5))
      const counts = ids.map((id) => matchCountForTeam(fixtures, id))
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(2)
    }
  })

  it('gives every club a roughly even home/away split', () => {
    for (const league of LEAGUE_LIST) {
      const ids = idsFor(league)
      const fixtures = generateFixtures(league, ids, createRng(6))
      for (const id of ids) {
        const own = fixturesForTeam(fixtures, id)
        const home = own.filter((f) => f.homeId === id).length
        const away = own.length - home
        // A club hosting several more matches than it visits is a real competitive
        // advantage, so this is deliberately tight.
        expect(Math.abs(home - away), `${league.id} ${id}: ${home}H/${away}A`).toBeLessThanOrEqual(3)
      }
    }
  })
})

describe('the three schedule shapes present in the recovered data', () => {
  it('truncates when rounds are shorter than a full round-robin (NPC: 12 clubs, 10 rounds)', () => {
    const npc = getLeague('npc')
    expect(npc.rounds).toBeLessThan(npc.teamCount - 1)

    const ids = idsFor(npc)
    const fixtures = generateFixtures(npc, ids, createRng(1))
    expect(fixturesByRound(fixtures).size).toBe(10)

    // Nobody meets twice, because we never get through one full leg.
    const pairs = fixtures.map((f) => [f.homeId, f.awayId].sort().join('|'))
    expect(new Set(pairs).size).toBe(pairs.length)
  })

  it('is a true double round-robin when rounds are exactly 2x (Premiership: 10 clubs, 18 rounds)', () => {
    const prem = getLeague('premiership')
    expect(prem.rounds).toBe((prem.teamCount - 1) * 2)

    const ids = idsFor(prem)
    const fixtures = generateFixtures(prem, ids, createRng(2))

    // Every club meets every other exactly twice...
    const counts = new Map<string, number>()
    for (const f of fixtures) {
      const key = [f.homeId, f.awayId].sort().join('|')
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    expect(counts.size).toBe((ids.length * (ids.length - 1)) / 2)
    for (const [, n] of counts) expect(n).toBe(2)

    // ...once at each ground.
    const venues = new Map<string, Set<string>>()
    for (const f of fixtures) {
      const key = [f.homeId, f.awayId].sort().join('|')
      const set = venues.get(key) ?? new Set<string>()
      set.add(f.homeId)
      venues.set(key, set)
    }
    for (const [, set] of venues) expect(set.size).toBe(2)

    // Each club plays every round.
    for (const id of ids) expect(matchCountForTeam(fixtures, id)).toBe(18)
  })

  it('extends beyond a double round-robin without replaying the opening rounds (Pro D2: 14 clubs, 30 rounds)', () => {
    const proD2 = getLeague('pro_d2')
    expect(proD2.rounds).toBeGreaterThan((proD2.teamCount - 1) * 2)

    const ids = idsFor(proD2)
    const fixtures = generateFixtures(proD2, ids, createRng(3))
    const byRound = fixturesByRound(fixtures)
    expect(byRound.size).toBe(30)

    const signature = (r: number) =>
      byRound
        .get(r)!
        .map((f) => `${f.homeId}>${f.awayId}`)
        .sort()
        .join(',')

    // Round 27 is the first of the extension; it must not simply repeat round 1.
    expect(signature(27)).not.toBe(signature(1))
  })
})

describe('byes for odd club counts (Super Rugby: 11 clubs)', () => {
  const superRugby = getLeague('super_rugby')

  it('has an odd club count, so somebody sits out every round', () => {
    expect(superRugby.teamCount % 2).toBe(1)
  })

  it('leaves exactly one club without a fixture each round', () => {
    const ids = idsFor(superRugby)
    const fixtures = generateFixtures(superRugby, ids, createRng(8))
    for (const [, list] of fixturesByRound(fixtures)) {
      expect(list.length).toBe(5)
      const playing = new Set(list.flatMap((f) => [f.homeId, f.awayId]))
      expect(playing.size).toBe(10)
      expect(ids.length - playing.size).toBe(1)
    }
  })

  it('means a club plays fewer matches than the league has rounds', () => {
    const ids = idsFor(superRugby)
    const fixtures = generateFixtures(superRugby, ids, createRng(9))
    for (const id of ids) {
      const played = matchCountForTeam(fixtures, id)
      expect(played).toBeLessThan(superRugby.rounds)
      expect(byeRounds(fixtures, id, superRugby.rounds)).toHaveLength(superRugby.rounds - played)
    }
  })
})

describe('SPEC §2.3 — season length is read from data, never hardcoded', () => {
  it('follows a mutated round count rather than a literal', () => {
    const prem = getLeague('premiership')
    const ids = idsFor(prem)

    for (const rounds of [1, 5, 13, 18, 40]) {
      const mutated: LeagueDef = { ...prem, rounds }
      const fixtures = generateFixtures(mutated, ids, createRng(1))
      expect(fixturesByRound(fixtures).size).toBe(rounds)
    }
  })

  it('follows a mutated club count', () => {
    const prem = getLeague('premiership')
    for (const teamCount of [4, 6, 11, 20]) {
      const mutated: LeagueDef = { ...prem, teamCount }
      const ids = idsFor(mutated)
      const fixtures = generateFixtures(mutated, ids, createRng(1))
      for (const [, list] of fixturesByRound(fixtures)) {
        expect(list.length).toBe(Math.floor(teamCount / 2))
      }
    }
  })

  it('agrees with perfectTarget = rounds + finalsRounds for all 8 leagues', () => {
    // The data's own consistency check — if this drifts, the perfect-season goal is wrong.
    for (const league of LEAGUE_LIST) {
      expect(league.perfectTarget).toBe(league.rounds + league.finalsRounds)
    }
  })
})

describe('determinism', () => {
  it('reproduces the same schedule for the same seed', () => {
    const league = getLeague('urc')
    const ids = idsFor(league)
    const a = generateFixtures(league, ids, createRng(77))
    const b = generateFixtures(league, ids, createRng(77))
    expect(a).toEqual(b)
  })

  it('produces a different schedule for a different seed', () => {
    const league = getLeague('urc')
    const ids = idsFor(league)
    const a = generateFixtures(league, ids, createRng(1))
    const b = generateFixtures(league, ids, createRng(2))
    expect(a).not.toEqual(b)
  })
})

describe('degenerate inputs', () => {
  it('returns nothing for a league with fewer than two clubs', () => {
    const league = getLeague('npc')
    expect(generateFixtures(league, [], createRng(1))).toEqual([])
    expect(generateFixtures(league, ['solo'], createRng(1))).toEqual([])
  })
})
