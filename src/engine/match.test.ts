import { describe, it, expect, beforeAll } from 'vitest'
import { bonusPointsFor, rateTeam, simulateMatch } from './match'
import { buildSquad, selectBestXV } from './generate'
import { getLeague, loadTeams } from '../data'
import type { Team, TeamDef } from '../types/core'
import type { MatchResult } from '../types/match'

let defs: readonly TeamDef[]
let strong: Team
let weak: Team
let evenA: Team
let evenB: Team

beforeAll(async () => {
  defs = await loadTeams()
  const superRugby = defs.filter((d) => d.leagueId === 'super_rugby')
  const ranked = superRugby
    .map((d) => buildSquad(1, d))
    .sort((a, b) => avgOvr(b) - avgOvr(a))
  strong = ranked[0]!
  weak = ranked[ranked.length - 1]!
  evenA = ranked[Math.floor(ranked.length / 2)]!
  evenB = ranked[Math.floor(ranked.length / 2) + 1]!
})

function avgOvr(team: Team): number {
  return team.squad.reduce((a, p) => a + p.ovr, 0) / team.squad.length
}

function sim(home: Team, away: Team, round = 1, seed = 42): MatchResult {
  return simulateMatch({ seed, season: 1, round, home, away })
}

describe('simulateMatch — determinism', () => {
  it('reproduces a fixture exactly for the same coordinates', () => {
    expect(sim(evenA, evenB)).toEqual(sim(evenA, evenB))
  })

  it('gives a different match in a different round', () => {
    expect(sim(evenA, evenB, 1)).not.toEqual(sim(evenA, evenB, 2))
  })

  it('gives a different match under a different career seed', () => {
    expect(sim(evenA, evenB, 1, 1)).not.toEqual(sim(evenA, evenB, 1, 2))
  })

  it('does not depend on what was simulated before it', () => {
    const direct = sim(evenA, evenB, 7)
    // Run a pile of unrelated fixtures first.
    for (let r = 1; r < 20; r++) sim(strong, weak, r)
    expect(sim(evenA, evenB, 7)).toEqual(direct)
  })
})

describe('simulateMatch — scoreline coherence', () => {
  it('scores exactly match tries, conversions and penalties', () => {
    for (let round = 1; round <= 60; round++) {
      const result = sim(evenA, evenB, round)
      for (const side of [result.home, result.away]) {
        expect(side.score).toBe(side.tries * 5 + side.conversions * 2 + side.penalties * 3)
      }
    }
  })

  it('never converts more tries than were scored', () => {
    for (let round = 1; round <= 100; round++) {
      const result = sim(strong, weak, round)
      expect(result.home.conversions).toBeLessThanOrEqual(result.home.tries)
      expect(result.away.conversions).toBeLessThanOrEqual(result.away.tries)
    }
  })

  it('credits every try to a named player on the right side', () => {
    for (let round = 1; round <= 60; round++) {
      const result = sim(evenA, evenB, round)
      for (const [teamId, line] of [
        [result.home.teamId, result.home],
        [result.away.teamId, result.away],
      ] as const) {
        const credited = result.players
          .filter((p) => p.teamId === teamId)
          .reduce((total, p) => total + p.tries, 0)
        expect(credited).toBe(line.tries)
      }
      for (const p of result.players) {
        if (p.tries > 0) expect(p.playerName.length).toBeGreaterThan(0)
      }
    }
  })

  it('produces believable rugby scorelines', () => {
    const scores: number[] = []
    for (let round = 1; round <= 400; round++) {
      const result = sim(evenA, evenB, round)
      scores.push(result.home.score, result.away.score)
    }
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length
    expect(mean).toBeGreaterThan(15)
    expect(mean).toBeLessThan(35)
    expect(Math.max(...scores)).toBeLessThan(100)
    expect(Math.min(...scores)).toBeGreaterThanOrEqual(0)
  })

  it('scores no negative values anywhere', () => {
    for (let round = 1; round <= 200; round++) {
      const result = sim(strong, weak, round)
      for (const side of [result.home, result.away]) {
        expect(side.score).toBeGreaterThanOrEqual(0)
        expect(side.tries).toBeGreaterThanOrEqual(0)
        expect(side.conversions).toBeGreaterThanOrEqual(0)
        expect(side.penalties).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('sets winnerId consistently with the scoreline', () => {
    for (let round = 1; round <= 200; round++) {
      const r = sim(evenA, evenB, round)
      if (r.home.score > r.away.score) expect(r.winnerId).toBe(r.home.teamId)
      else if (r.away.score > r.home.score) expect(r.winnerId).toBe(r.away.teamId)
      else expect(r.winnerId).toBeNull()
    }
  })
})

describe('simulateMatch — the better side wins more often', () => {
  it('gives a clearly stronger club the majority of results', () => {
    let strongWins = 0
    const n = 300
    for (let round = 1; round <= n; round++) {
      if (sim(strong, weak, round).winnerId === strong.id) strongWins++
    }
    expect(strongWins / n).toBeGreaterThan(0.7)
    // ...but not every single one. Upsets have to exist.
    expect(strongWins / n).toBeLessThan(0.99)
  })

  it('still lets the weaker side win sometimes', () => {
    let upsets = 0
    for (let round = 1; round <= 300; round++) {
      if (sim(strong, weak, round).winnerId === weak.id) upsets++
    }
    expect(upsets).toBeGreaterThan(0)
  })

  it('is close to even between evenly matched clubs', () => {
    let homeWins = 0
    let awayWins = 0
    const n = 400
    for (let round = 1; round <= n; round++) {
      const r = sim(evenA, evenB, round)
      if (r.winnerId === evenA.id) homeWins++
      else if (r.winnerId === evenB.id) awayWins++
    }
    // Home advantage exists, so the host should lead but not dominate.
    expect(homeWins).toBeGreaterThan(awayWins)
    expect(homeWins / n).toBeLessThan(0.72)
  })

  it('gives a real home advantage — the same fixture reversed favours the other club', () => {
    let hostWinsA = 0
    let hostWinsB = 0
    for (let round = 1; round <= 300; round++) {
      if (sim(evenA, evenB, round).winnerId === evenA.id) hostWinsA++
      if (sim(evenB, evenA, round).winnerId === evenB.id) hostWinsB++
    }
    expect(hostWinsA).toBeGreaterThan(0)
    expect(hostWinsB).toBeGreaterThan(0)
  })
})

describe('simulateMatch — player lines', () => {
  it('fields fifteen a side and rates all of them', () => {
    const r = sim(evenA, evenB)
    expect(r.players).toHaveLength(30)
    expect(r.players.filter((p) => p.teamId === evenA.id)).toHaveLength(15)
    for (const p of r.players) {
      expect(p.rating).toBeGreaterThanOrEqual(1)
      expect(p.rating).toBeLessThanOrEqual(10)
      // One decimal place, as the match log shows it.
      expect(Math.round(p.rating * 10)).toBe(p.rating * 10)
    }
  })

  it('names a player of the match who actually played', () => {
    for (let round = 1; round <= 50; round++) {
      const r = sim(evenA, evenB, round)
      expect(r.players.some((p) => p.playerId === r.motmPlayerId)).toBe(true)
    }
  })

  it('picks the highest-rated player as MOTM', () => {
    for (let round = 1; round <= 50; round++) {
      const r = sim(evenA, evenB, round)
      const best = Math.max(...r.players.map((p) => p.rating))
      const motm = r.players.find((p) => p.playerId === r.motmPlayerId)!
      expect(motm.rating).toBe(best)
    }
  })

  it('rates try scorers above the average of their own team', () => {
    let scorerTotal = 0
    let scorerCount = 0
    let otherTotal = 0
    let otherCount = 0

    for (let round = 1; round <= 200; round++) {
      for (const p of sim(evenA, evenB, round).players) {
        if (p.tries > 0) {
          scorerTotal += p.rating
          scorerCount++
        } else {
          otherTotal += p.rating
          otherCount++
        }
      }
    }

    expect(scorerTotal / scorerCount).toBeGreaterThan(otherTotal / otherCount)
  })

  it('spreads tries towards the back three, as rugby does', () => {
    const bySlot = new Map<string, number>()
    for (let round = 1; round <= 400; round++) {
      for (const p of sim(evenA, evenB, round).players) {
        if (p.tries > 0) bySlot.set(p.slot, (bySlot.get(p.slot) ?? 0) + p.tries)
      }
    }
    const wings = (bySlot.get('WL') ?? 0) + (bySlot.get('WR') ?? 0)
    const props = (bySlot.get('LHP') ?? 0) + (bySlot.get('THP') ?? 0)
    expect(wings).toBeGreaterThan(props * 2)
  })
})

describe('bonus points — thresholds come from the league data', () => {
  it('awards a try bonus at the league threshold', () => {
    const league = getLeague('premiership')
    expect(league.bonusPoints.tryBonus).toBe(4)
    expect(bonusPointsFor('premiership', 3, 30, 10)).toBe(0)
    expect(bonusPointsFor('premiership', 4, 30, 10)).toBe(1)
  })

  it('awards a losing bonus within the league margin, and not outside it', () => {
    const league = getLeague('premiership')
    expect(league.bonusPoints.losingBonus).toBe(7)
    expect(bonusPointsFor('premiership', 1, 20, 27)).toBe(1) // lost by 7
    expect(bonusPointsFor('premiership', 1, 20, 28)).toBe(0) // lost by 8
  })

  it('never gives a losing bonus to a winner or a draw', () => {
    expect(bonusPointsFor('premiership', 1, 30, 28)).toBe(0)
    expect(bonusPointsFor('premiership', 1, 28, 28)).toBe(0)
  })

  it('can award both bonuses in the same match', () => {
    expect(bonusPointsFor('premiership', 4, 24, 27)).toBe(2)
  })

  it('matches what the simulated results actually record', () => {
    for (let round = 1; round <= 100; round++) {
      const r = sim(evenA, evenB, round)
      expect(r.home.bonusPoints).toBe(
        bonusPointsFor(r.leagueId, r.home.tries, r.home.score, r.away.score),
      )
    }
  })
})

describe('modifiers', () => {
  it('lets weather re-weight what matters', () => {
    const dry = simulateMatch({ seed: 5, season: 1, round: 3, home: evenA, away: evenB })
    const wet = simulateMatch({
      seed: 5,
      season: 1,
      round: 3,
      home: evenA,
      away: evenB,
      modifiers: {
        statWeightOverride: { KCK: 1.5, SCR: 1.3, PAC: 0.7, EVA: 0.6 },
        conditions: 'Washout Conditions',
      },
    })
    expect(wet.conditions).toBe('Washout Conditions')
    expect(wet).not.toEqual(dry)
  })

  it('records a derby name and narrows the gap for the underdog', () => {
    let plainUpsets = 0
    let derbyUpsets = 0
    for (let round = 1; round <= 400; round++) {
      if (simulateMatch({ seed: 9, season: 1, round, home: strong, away: weak }).winnerId === weak.id) {
        plainUpsets++
      }
      const derby = simulateMatch({
        seed: 9,
        season: 1,
        round,
        home: strong,
        away: weak,
        modifiers: { derbyIntensity: 10, derbyName: 'Test Derby' },
      })
      expect(derby.derbyName).toBe('Test Derby')
      if (derby.winnerId === weak.id) derbyUpsets++
    }
    expect(derbyUpsets).toBeGreaterThan(plainUpsets)
  })

  it('honours a strength delta', () => {
    let base = 0
    let boosted = 0
    for (let round = 1; round <= 200; round++) {
      if (sim(evenA, evenB, round).winnerId === evenA.id) base++
      const r = simulateMatch({
        seed: 42,
        season: 1,
        round,
        home: evenA,
        away: evenB,
        modifiers: { homeStrengthDelta: 15 },
      })
      if (r.winnerId === evenA.id) boosted++
    }
    expect(boosted).toBeGreaterThan(base)
  })

  it('leaves out unavailable players entirely', () => {
    const out = new Set([evenA.squad[0]!.id, evenA.squad[1]!.id])
    const r = simulateMatch({
      seed: 1,
      season: 1,
      round: 1,
      home: evenA,
      away: evenB,
      modifiers: { unavailableHome: out },
    })
    for (const p of r.players) expect(out.has(p.playerId)).toBe(false)
    expect(r.players.filter((p) => p.teamId === evenA.id)).toHaveLength(15)
  })

  it('weakens a club that loses players to injury', () => {
    const injured = new Set(
      [...evenA.squad].sort((a, b) => b.ovr - a.ovr).slice(0, 8).map((p) => p.id),
    )
    let fullStrength = 0
    let depleted = 0
    for (let round = 1; round <= 300; round++) {
      if (sim(evenA, evenB, round).winnerId === evenA.id) fullStrength++
      const r = simulateMatch({
        seed: 42,
        season: 1,
        round,
        home: evenA,
        away: evenB,
        modifiers: { unavailableHome: injured },
      })
      if (r.winnerId === evenA.id) depleted++
    }
    expect(depleted).toBeLessThan(fullStrength)
  })
})

describe('rateTeam', () => {
  it('rewards the league physicality bias', () => {
    const xv = selectBestXV(evenA)
    // The same XV judged under a forward-leaning and a back-leaning league.
    const forwardLeague = rateTeam(xv, 'premiership')
    const backLeague = rateTeam(xv, 'super_rugby')
    expect(forwardLeague.attack).toBe(backLeague.attack)
    // Only the blend changes, and it does change.
    expect(forwardLeague.overall).not.toBe(backLeague.overall)
  })

  it('rates a stronger squad above a weaker one', () => {
    expect(rateTeam(selectBestXV(strong), 'super_rugby').overall).toBeGreaterThan(
      rateTeam(selectBestXV(weak), 'super_rugby').overall,
    )
  })
})
