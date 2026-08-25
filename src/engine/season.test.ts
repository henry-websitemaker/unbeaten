import { describe, it, expect, beforeAll } from 'vitest'
import {
  chipFor,
  createSeason,
  currentLadder,
  finalsParticipantCount,
  isPerfectSeason,
  isRegularSeasonComplete,
  perfectSeasonTarget,
  relegatedFrom,
  resultsForTeam,
  runSeason,
  seasonWins,
  simulateRound,
  simulateSeason,
  totalRounds,
  type SeasonState,
} from './season'
import { buildSquad, squadStrength } from './generate'
import { LEAGUE_LIST, getLeague, loadTeams } from '../data'
import type { LeagueId, Team, TeamDef } from '../types/core'

let defs: readonly TeamDef[]
const teamCache = new Map<string, Team[]>()

beforeAll(async () => {
  defs = await loadTeams()
})

function teamsFor(leagueId: LeagueId, seed = 1): Team[] {
  const key = `${leagueId}:${seed}`
  let built = teamCache.get(key)
  if (!built) {
    built = defs.filter((d) => d.leagueId === leagueId).map((d) => buildSquad(seed, d))
    teamCache.set(key, built)
  }
  return built
}

function season(leagueId: LeagueId, seed = 1, seasonNumber = 1): SeasonState {
  return createSeason(seed, seasonNumber, leagueId, teamsFor(leagueId, seed))
}

describe('createSeason', () => {
  it('builds a schedule of the right length for every league', () => {
    for (const league of LEAGUE_LIST) {
      const state = season(league.id)
      expect(totalRounds(state)).toBe(league.rounds)
      expect(state.roundsPlayed).toBe(0)
      expect(state.results).toHaveLength(0)
      expect(state.championId).toBeNull()
    }
  })

  it('lists every club in the table before a ball is kicked', () => {
    for (const league of LEAGUE_LIST) {
      expect(currentLadder(season(league.id))).toHaveLength(league.teamCount)
    }
  })
})

describe('simulateRound', () => {
  it('does not mutate the state it is given', () => {
    const before = season('premiership')
    const after = simulateRound(before)
    expect(before.roundsPlayed).toBe(0)
    expect(before.results).toHaveLength(0)
    expect(after.roundsPlayed).toBe(1)
    expect(after.results.length).toBeGreaterThan(0)
  })

  it('plays every fixture in the round', () => {
    const state = simulateRound(season('premiership'))
    expect(state.results).toHaveLength(5) // 10 clubs
  })

  it('stops once the regular season is complete', () => {
    let state = season('npc')
    for (let i = 0; i < totalRounds(state); i++) state = simulateRound(state)
    expect(isRegularSeasonComplete(state)).toBe(true)
    const again = simulateRound(state)
    expect(again).toBe(state)
  })

  it('calls the round hook with that round results', () => {
    const seen: number[] = []
    simulateRound(season('premiership'), {
      onRoundComplete: (round, results) => {
        seen.push(round)
        expect(results).toHaveLength(5)
      },
    })
    expect(seen).toEqual([1])
  })

  it('applies supplied modifiers', () => {
    const plain = simulateRound(season('premiership'))
    const modified = simulateRound(season('premiership'), {
      modifiersFor: () => ({ statWeightOverride: { KCK: 2 }, conditions: 'Washout Conditions' }),
    })
    expect(modified.results.some((r) => r.conditions === 'Washout Conditions')).toBe(true)
    expect(modified.results).not.toEqual(plain.results)
  })
})

describe('derbies are detected by the season engine', () => {
  it('flags the listed rivalries when they come up', () => {
    // Shute Shield has six listed derbies among ten clubs, so a full season hits several.
    const state = simulateSeason(season('shute_shield'))
    const named = [...state.results, ...state.finals].filter((r) => r.derbyName)
    expect(named.length).toBeGreaterThan(0)
    for (const r of named) expect(typeof r.derbyName).toBe('string')
  })

  it('finds the specific rivalries the spec calls out', () => {
    const state = simulateSeason(season('shute_shield'))
    const names = new Set([...state.results, ...state.finals].map((r) => r.derbyName))
    // Sydney Uni-Warringah, Randwick-Easts, Easts-Gordon and Manly-Norths all exist.
    expect(names.has('The Rat Pack Derby')).toBe(true)
    expect(names.has('Eastern Suburbs Derby')).toBe(true)
  })
})

describe('a full season for every league in the data', () => {
  it('completes, crowns a champion, and keeps the table consistent', () => {
    for (const league of LEAGUE_LIST) {
      const state = simulateSeason(season(league.id))

      expect(state.roundsPlayed).toBe(league.rounds)
      expect(state.championId).not.toBeNull()

      const ladder = currentLadder(state)
      expect(ladder).toHaveLength(league.teamCount)

      // Played counts add up to the fixture list.
      const totalPlayed = ladder.reduce((a, r) => a + r.played, 0)
      expect(totalPlayed).toBe(state.results.length * 2)

      // Points difference across the whole league nets to zero.
      expect(ladder.reduce((a, r) => a + r.pointsDifference, 0)).toBe(0)

      // Wins and losses balance, allowing for draws.
      const wins = ladder.reduce((a, r) => a + r.won, 0)
      const losses = ladder.reduce((a, r) => a + r.lost, 0)
      expect(wins).toBe(losses)
    }
  })

  it('plays the right number of finals matches', () => {
    for (const league of LEAGUE_LIST) {
      const state = simulateSeason(season(league.id))
      const participants = finalsParticipantCount(league)
      if (league.finalsFormat === 'none') {
        expect(participants).toBe(0)
        expect(state.finals).toHaveLength(0)
      } else {
        // A knockout of N clubs is N-1 matches.
        expect(state.finals).toHaveLength(participants - 1)
      }
    }
  })

  it('crowns the table-topper in a league with no finals', () => {
    const state = simulateSeason(season('rfu_championship'))
    expect(getLeague('rfu_championship').finalsFormat).toBe('none')
    expect(state.championId).toBe(currentLadder(state)[0]!.teamId)
  })

  it('crowns a finals qualifier in a league with finals', () => {
    for (const id of ['premiership', 'top_14', 'urc', 'super_rugby'] as LeagueId[]) {
      const state = simulateSeason(season(id))
      const league = getLeague(id)
      const qualifiers = currentLadder(state)
        .slice(0, finalsParticipantCount(league))
        .map((r) => r.teamId)
      expect(qualifiers).toContain(state.championId)
    }
  })

  it('uses a top-4 bracket for the Premiership and top-8 for the 3-round leagues', () => {
    expect(finalsParticipantCount(getLeague('premiership'))).toBe(4)
    expect(finalsParticipantCount(getLeague('top_14'))).toBe(8)
    expect(finalsParticipantCount(getLeague('urc'))).toBe(8)
  })
})

describe('strength predicts finishing position', () => {
  it('correlates squad strength with where clubs finish', () => {
    // The full assertion lives in the balance pass; this is the smoke test.
    const league = getLeague('top_14')
    const teams = teamsFor(league.id, 11)
    const state = simulateSeason(createSeason(11, 1, league.id, teams))
    const ladder = currentLadder(state)

    const strengths = new Map(teams.map((t) => [t.id, squadStrength(t)]))
    const top3 = ladder.slice(0, 3).map((r) => strengths.get(r.teamId)!)
    const bottom3 = ladder.slice(-3).map((r) => strengths.get(r.teamId)!)

    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length
    expect(mean(top3)).toBeGreaterThan(mean(bottom3))
  })
})

describe('promotion', () => {
  it('promotes only from the two leagues that have a promotion rule', () => {
    for (const league of LEAGUE_LIST) {
      const state = simulateSeason(season(league.id))
      if (league.promotionRelegation) {
        expect(state.promotedIds).toHaveLength(league.promotionRelegation.spots)
      } else {
        expect(state.promotedIds).toHaveLength(0)
      }
    }
  })

  it('sends the RFU Championship winner up to the Premiership', () => {
    const rule = getLeague('rfu_championship').promotionRelegation!
    expect(rule.promotesTo).toBe('premiership')
    const state = simulateSeason(season('rfu_championship'))
    expect(state.promotedIds).toEqual([state.championId])
  })

  it('sends the Pro D2 champion up to the Top 14', () => {
    expect(getLeague('pro_d2').promotionRelegation!.promotesTo).toBe('top_14')
    const state = simulateSeason(season('pro_d2'))
    expect(state.promotedIds).toContain(state.championId)
  })

  it('relegates from the bottom of the table', () => {
    const state = simulateSeason(season('premiership'))
    const ladder = currentLadder(state)
    expect(relegatedFrom(ladder, 1)).toEqual([ladder[ladder.length - 1]!.teamId])
    expect(relegatedFrom(ladder, 0)).toEqual([])
  })
})

describe('runSeason generator — keeps the UI responsive', () => {
  it('yields once per round plus once for the finals', () => {
    const league = getLeague('npc')
    let yields = 0
    let final: SeasonState | null = null

    const gen = runSeason(season('npc'))
    let step = gen.next()
    while (!step.done) {
      yields++
      final = step.value
      step = gen.next()
    }

    expect(yields).toBe(league.rounds + 1)
    expect(final!.championId).not.toBeNull()
  })

  it('reaches exactly the same state as running it in one go', () => {
    const gen = runSeason(season('premiership'))
    let step = gen.next()
    let last: SeasonState | null = null
    while (!step.done) {
      last = step.value
      step = gen.next()
    }
    const direct = simulateSeason(season('premiership'))
    expect(last!.championId).toBe(direct.championId)
    expect(last!.results.length).toBe(direct.results.length)
  })
})

describe('determinism across the whole season', () => {
  it('reproduces an identical season for the same seed', () => {
    const a = simulateSeason(season('premiership', 5))
    const b = simulateSeason(season('premiership', 5))
    expect(a.championId).toBe(b.championId)
    expect(a.results).toEqual(b.results)
    expect(a.finals).toEqual(b.finals)
  })

  it('produces a different season for a different seed', () => {
    const a = simulateSeason(season('premiership', 5))
    const b = simulateSeason(season('premiership', 6))
    expect(a.results).not.toEqual(b.results)
  })

  it('is unaffected by simulating other leagues first', () => {
    const direct = simulateSeason(season('npc', 3))
    for (const id of ['top_14', 'urc', 'premiership'] as LeagueId[]) simulateSeason(season(id, 3))
    expect(simulateSeason(season('npc', 3)).results).toEqual(direct.results)
  })
})

describe('club reporting', () => {
  it('reports results, chips and wins for a club', () => {
    const state = simulateSeason(season('premiership'))
    const teamId = currentLadder(state)[0]!.teamId

    const own = resultsForTeam(state, teamId)
    expect(own.length).toBeGreaterThan(0)
    for (const r of own) {
      expect([r.home.teamId, r.away.teamId]).toContain(teamId)
      expect(['W', 'D', 'L']).toContain(chipFor(r, teamId))
    }

    const wins = own.filter((r) => chipFor(r, teamId) === 'W').length
    expect(seasonWins(state, teamId)).toBe(wins)
  })

  it('orders a club results by round', () => {
    const state = simulateSeason(season('top_14'))
    const teamId = currentLadder(state)[0]!.teamId
    const rounds = resultsForTeam(state, teamId).map((r) => r.round)
    expect(rounds).toEqual([...rounds].sort((a, b) => a - b))
  })
})

describe('perfect season', () => {
  it('is false for a club that lost anything', () => {
    const state = simulateSeason(season('premiership'))
    const ladder = currentLadder(state)
    const loser = ladder[ladder.length - 1]!.teamId
    expect(isPerfectSeason(state, loser)).toBe(false)
  })

  it('requires the championship, not just an unbeaten record', () => {
    const state = simulateSeason(season('premiership'))
    for (const row of currentLadder(state)) {
      if (row.teamId === state.championId) continue
      expect(isPerfectSeason(state, row.teamId)).toBe(false)
    }
  })

  it('sets a reachable target even in leagues with byes', () => {
    // Super Rugby has 11 clubs, so a bye every round and fewer matches than rounds.
    const state = season('super_rugby')
    const teamId = state.teams[0]!.id
    const target = perfectSeasonTarget(state, teamId)
    const played = state.fixtures.filter(
      (f) => f.homeId === teamId || f.awayId === teamId,
    ).length

    expect(target).toBe(played + getLeague('super_rugby').finalsRounds)
    // The stored perfectTarget assumes no byes and is therefore unreachable there.
    expect(target).toBeLessThan(getLeague('super_rugby').perfectTarget)
  })

  it('matches rounds + finals in a league where everyone plays every round', () => {
    const state = season('premiership')
    const teamId = state.teams[0]!.id
    expect(perfectSeasonTarget(state, teamId)).toBe(getLeague('premiership').perfectTarget)
  })
})
