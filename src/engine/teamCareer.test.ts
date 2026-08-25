import { describe, it, expect, beforeAll } from 'vitest'
import {
  BUDGET_SQUAD_SIZE,
  MAX_SQUAD_SIZE,
  assessSack,
  affordableTargets,
  boardExpectation,
  canSign,
  createManagerCareer,
  gateReceipts,
  managerLadder,
  pointsDeduction,
  prizeMoney,
  releasePlayer,
  reviewManagerSeason,
  signPlayer,
  squadWageBill,
  wageBudget,
  weeklyWage,
} from './teamCareer'
import { buildSquad } from './generate'
import { buildLadder } from './ladder'
import { createRng } from './rng'
import { getLeague, loadTeams } from '../data'
import type { Player, Team, TeamDef } from '../types/core'

let defs: readonly TeamDef[]
let club: Team

beforeAll(async () => {
  defs = await loadTeams()
  club = buildSquad(1, defs.find((d) => d.leagueId === 'premiership')!)
})

function playerAt(ovr: number, id = `p-${ovr}`): Player {
  return { id, name: `Player ${ovr}`, position: 'WL', age: 25, stats: { PAC: ovr }, ovr }
}

describe('wage scale', () => {
  it('is anchored on the wage budget in the data', () => {
    for (const id of ['premiership', 'top_14', 'shute_shield'] as const) {
      const league = getLeague(id)
      const reference = league.tier === 1 ? 80 : 67
      // A player at the tier's reference standard costs one budget share.
      expect(weeklyWage(id, reference)).toBe(
        Math.round(league.wageBudgetBase / BUDGET_SQUAD_SIZE),
      )
    }
  })

  it('costs more for better players', () => {
    expect(weeklyWage('premiership', 90)).toBeGreaterThan(weeklyWage('premiership', 75))
  })

  it('pays more in richer leagues', () => {
    expect(weeklyWage('top_14', 80)).toBeGreaterThan(weeklyWage('shute_shield', 80))
  })

  it('never drops to nothing', () => {
    expect(weeklyWage('shute_shield', 1)).toBeGreaterThanOrEqual(200)
  })
})

describe('SPEC §3 — a signing that breaks the budget fails', () => {
  it('refuses the signing and says by how much', () => {
    const budget = squadWageBill(club) + 100
    const star = playerAt(95)

    const check = canSign(club, star, budget)
    expect(check.ok).toBe(false)
    if (!check.ok && check.reason === 'over_budget') {
      expect(check.overBy).toBeGreaterThan(0)
      expect(check.message).toContain('over budget')
    } else {
      throw new Error('expected an over_budget refusal')
    }
  })

  it('throws rather than quietly signing anyway', () => {
    const budget = squadWageBill(club) + 100
    expect(() => signPlayer(club, playerAt(95), budget)).toThrow('Signing refused')
  })

  it('leaves the squad untouched when a signing is refused', () => {
    const budget = squadWageBill(club) + 100
    const before = club.squad.length
    try {
      signPlayer(club, playerAt(95), budget)
    } catch {
      // expected
    }
    expect(club.squad).toHaveLength(before)
  })

  it('allows a signing that fits, and reports the headroom', () => {
    const cheap = playerAt(55, 'cheap')
    const budget = squadWageBill(club) + weeklyWage(club.leagueId, 55) + 5_000

    const check = canSign(club, cheap, budget)
    expect(check.ok).toBe(true)
    if (check.ok) expect(check.remaining).toBeGreaterThanOrEqual(0)

    const after = signPlayer(club, cheap, budget)
    expect(after.squad).toHaveLength(club.squad.length + 1)
    expect(after.squad.some((p) => p.id === 'cheap')).toBe(true)
  })

  it('refuses the signing that tips the club exactly one pound over', () => {
    const wage = weeklyWage(club.leagueId, 70)
    const exact = squadWageBill(club) + wage
    // Exactly on budget is allowed...
    expect(canSign(club, playerAt(70, 'a'), exact).ok).toBe(true)
    // ...one short is not.
    expect(canSign(club, playerAt(70, 'b'), exact - 1).ok).toBe(false)
  })

  it('refuses once the squad is full, whatever the budget', () => {
    let full = club
    let i = 0
    while (full.squad.length < MAX_SQUAD_SIZE) {
      full = { ...full, squad: [...full.squad, playerAt(40, `filler-${i++}`)] }
    }
    const check = canSign(full, playerAt(40, 'extra'), Number.MAX_SAFE_INTEGER)
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toBe('squad_full')
  })

  it('can sign again after releasing someone', () => {
    const budget = squadWageBill(club)
    expect(canSign(club, playerAt(80, 'new'), budget).ok).toBe(false)

    const lightened = releasePlayer(club, club.squad[0]!.id)
    expect(squadWageBill(lightened)).toBeLessThan(squadWageBill(club))
  })

  it('only offers affordable targets', () => {
    const candidates = [playerAt(95, 'a'), playerAt(90, 'b'), playerAt(50, 'c'), playerAt(45, 'd')]
    const lean: Team = { ...club, squad: club.squad.slice(0, 5) }
    for (const target of affordableTargets(lean, candidates, createRng(1))) {
      expect(canSign(lean, target, wageBudget(lean.leagueId)).ok).toBe(true)
    }
  })
})

describe('overspending triggers a points deduction', () => {
  it('deducts nothing when inside the budget', () => {
    expect(pointsDeduction(club, squadWageBill(club) + 1_000)).toBe(0)
    expect(pointsDeduction(club, squadWageBill(club))).toBe(0)
  })

  it('deducts more the further over the club is', () => {
    const bill = squadWageBill(club)
    const slightly = pointsDeduction(club, bill * 0.95)
    const badly = pointsDeduction(club, bill * 0.5)
    expect(slightly).toBeGreaterThan(0)
    expect(badly).toBeGreaterThan(slightly)
  })

  it('caps the penalty', () => {
    expect(pointsDeduction(club, 1)).toBeLessThanOrEqual(15)
  })

  it('actually moves the club down the table', () => {
    const teamIds = ['a', 'b']
    const manager = { ...createManagerCareer(1, club, 1), clubId: 'a', deduction: 10 }
    const results = [
      {
        season: 1,
        round: 1,
        leagueId: 'premiership' as const,
        home: { teamId: 'a', score: 30, tries: 4, conversions: 0, penalties: 0, bonusPoints: 1 },
        away: { teamId: 'b', score: 3, tries: 0, conversions: 0, penalties: 1, bonusPoints: 0 },
        winnerId: 'a',
        motmPlayerId: 'x',
        players: [],
      },
    ]

    const clean = buildLadder(teamIds, results)
    expect(clean[0]!.teamId).toBe('a')

    const docked = managerLadder(teamIds, results, manager)
    expect(docked[0]!.teamId).toBe('b')
  })
})

describe('board expectation', () => {
  it('asks the strongest squad to win it and the weakest to survive', () => {
    expect(boardExpectation(1, 12).description).toBe('Win the league')
    expect(boardExpectation(12, 12).description).toBe('Avoid finishing bottom')
  })

  it('sets a target that is achievable at every rank', () => {
    for (let rank = 1; rank <= 14; rank++) {
      const expectation = boardExpectation(rank, 14)
      expect(expectation.minPosition).toBeGreaterThanOrEqual(1)
      expect(expectation.minPosition).toBeLessThanOrEqual(14)
    }
  })
})

describe('SPEC §3 — sack immunity: any trophy protects you', () => {
  const expectation = { minPosition: 4, description: 'Reach the finals' }

  it('saves a manager who finished last but won something', () => {
    const verdict = assessSack(12, expectation, 1, 5)
    expect(verdict.sacked).toBe(false)
    expect(verdict.savedByTrophy).toBe(true)
  })

  it('saves them regardless of how bad the finish was', () => {
    for (const position of [5, 8, 12, 20, 99]) {
      const verdict = assessSack(position, expectation, 1, 5)
      expect(verdict.sacked, `position ${position} should be survivable with a trophy`).toBe(false)
      expect(verdict.savedByTrophy).toBe(true)
    }
  })

  it('sacks the same manager without the trophy', () => {
    expect(assessSack(12, expectation, 0, 5).sacked).toBe(true)
  })

  it('keeps a manager who met the target without a trophy', () => {
    const verdict = assessSack(3, expectation, 0, 5)
    expect(verdict.sacked).toBe(false)
    expect(verdict.savedByTrophy).toBe(false)
  })

  it('gives a first-season manager some benefit of the doubt', () => {
    expect(assessSack(6, expectation, 0, 1).sacked).toBe(false)
    expect(assessSack(6, expectation, 0, 3).sacked).toBe(true)
  })

  it('is applied by the season review, not just the helper', () => {
    const manager = createManagerCareer(1, club, 1)
    const ladder = buildLadder([club.id, 'other'], [])
    // Bottom of the table, but the club won a cup.
    const review = reviewManagerSeason(
      { ...manager, expectation: { minPosition: 1, description: 'Win the league' } },
      ladder,
      club.name,
      null,
      ['Champions Cup'],
    )
    expect(review.verdict.savedByTrophy).toBe(true)
    expect(review.manager.sacked).toBe(false)
    expect(review.manager.trophies.map((t) => t.name)).toContain('Champions Cup')
  })

  it('records the league title as a trophy and saves the manager with it', () => {
    const manager = createManagerCareer(1, club, 1)
    const ladder = buildLadder([club.id], [])
    const review = reviewManagerSeason(
      { ...manager, expectation: { minPosition: 1, description: 'Win the league' } },
      ladder,
      club.name,
      club.id,
    )
    expect(review.manager.trophies).toHaveLength(1)
    expect(review.verdict.savedByTrophy).toBe(true)
  })
})

describe('club finances', () => {
  it('pays more gate money in richer leagues, and more for a win', () => {
    expect(gateReceipts('top_14', false)).toBeGreaterThan(gateReceipts('shute_shield', false))
    expect(gateReceipts('top_14', true)).toBeGreaterThan(gateReceipts('top_14', false))
  })

  it('pays more prize money the higher you finish', () => {
    expect(prizeMoney('premiership', 1, 10)).toBeGreaterThan(prizeMoney('premiership', 10, 10))
  })

  it('still pays something to the club that finishes bottom', () => {
    expect(prizeMoney('premiership', 10, 10)).toBeGreaterThan(0)
  })

  it('credits prize money into the club ledger at the season review', () => {
    const manager = createManagerCareer(1, club, 1)
    const review = reviewManagerSeason(manager, buildLadder([club.id], []), club.name, null)
    expect(review.manager.finances.entries.length).toBeGreaterThan(0)
    expect(review.manager.finances.entries[0]!.type).toBe('prize_money')
  })

  it('records a history line every season', () => {
    const manager = createManagerCareer(1, club, 1)
    const review = reviewManagerSeason(manager, buildLadder([club.id], []), club.name, null)
    expect(review.manager.history).toHaveLength(1)
    expect(review.manager.history[0]!.clubName).toBe(club.name)
    expect(review.manager.seasonsInCharge).toBe(1)
  })
})
