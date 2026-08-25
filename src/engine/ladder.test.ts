import { describe, it, expect } from 'vitest'
import { DRAW_POINTS, WIN_POINTS, buildLadder, isPerfect, ladderPosition, ladderRow } from './ladder'
import { getLeague } from '../data'
import type { MatchResult, TeamMatchLine } from '../types/match'
import type { LeagueId } from '../types/core'

function side(
  teamId: string,
  score: number,
  tries: number,
  bonusPoints: number,
): TeamMatchLine {
  return { teamId, score, tries, conversions: 0, penalties: 0, bonusPoints }
}

/** Build a result with bonus points derived from the real league thresholds. */
function result(
  homeId: string,
  homeScore: number,
  homeTries: number,
  awayId: string,
  awayScore: number,
  awayTries: number,
  leagueId: LeagueId = 'premiership',
  round = 1,
): MatchResult {
  const t = getLeague(leagueId).bonusPoints
  const bonus = (tries: number, score: number, other: number) => {
    let b = 0
    if (tries >= t.tryBonus) b++
    const margin = other - score
    if (margin > 0 && margin <= t.losingBonus) b++
    return b
  }

  return {
    season: 1,
    round,
    leagueId,
    home: side(homeId, homeScore, homeTries, bonus(homeTries, homeScore, awayScore)),
    away: side(awayId, awayScore, awayTries, bonus(awayTries, awayScore, homeScore)),
    winnerId: homeScore === awayScore ? null : homeScore > awayScore ? homeId : awayId,
    motmPlayerId: 'x',
    players: [],
  }
}

describe('buildLadder', () => {
  it('lists every club even before a ball is kicked', () => {
    const ladder = buildLadder(['a', 'b', 'c'], [])
    expect(ladder).toHaveLength(3)
    for (const row of ladder) {
      expect(row.played).toBe(0)
      expect(row.points).toBe(0)
    }
  })

  it('awards 4 for a win and 0 for a loss', () => {
    const ladder = buildLadder(['a', 'b'], [result('a', 30, 2, 'b', 10, 1)])
    expect(ladderRow(ladder, 'a')!.points).toBe(WIN_POINTS)
    expect(ladderRow(ladder, 'a')!.won).toBe(1)
    expect(ladderRow(ladder, 'b')!.points).toBe(0)
    expect(ladderRow(ladder, 'b')!.lost).toBe(1)
  })

  it('awards 2 each for a draw', () => {
    const ladder = buildLadder(['a', 'b'], [result('a', 17, 2, 'b', 17, 2)])
    expect(ladderRow(ladder, 'a')!.points).toBe(DRAW_POINTS)
    expect(ladderRow(ladder, 'b')!.points).toBe(DRAW_POINTS)
    expect(ladderRow(ladder, 'a')!.drawn).toBe(1)
  })

  it('adds the try bonus at the league threshold', () => {
    // 4 tries wins a bonus point on top of the 4 for the win.
    const ladder = buildLadder(['a', 'b'], [result('a', 34, 4, 'b', 3, 0)])
    const a = ladderRow(ladder, 'a')!
    expect(a.tryBonuses).toBe(1)
    expect(a.points).toBe(WIN_POINTS + 1)
  })

  it('adds the losing bonus inside the league margin', () => {
    const ladder = buildLadder(['a', 'b'], [result('a', 27, 3, 'b', 20, 2)])
    const b = ladderRow(ladder, 'b')!
    expect(b.losingBonuses).toBe(1)
    expect(b.points).toBe(1)
  })

  it('can award both bonuses to the same club', () => {
    // Loses 27-24 having scored four tries.
    const ladder = buildLadder(['a', 'b'], [result('a', 27, 3, 'b', 24, 4)])
    const b = ladderRow(ladder, 'b')!
    expect(b.tryBonuses).toBe(1)
    expect(b.losingBonuses).toBe(1)
    expect(b.points).toBe(2)
  })

  it('accumulates points for and against, and derives the difference', () => {
    const ladder = buildLadder(
      ['a', 'b'],
      [result('a', 30, 3, 'b', 10, 1, 'premiership', 1), result('a', 12, 1, 'b', 20, 2, 'premiership', 2)],
    )
    const a = ladderRow(ladder, 'a')!
    expect(a.played).toBe(2)
    expect(a.pointsFor).toBe(42)
    expect(a.pointsAgainst).toBe(30)
    expect(a.pointsDifference).toBe(12)
    expect(a.triesFor).toBe(4)
    expect(a.triesAgainst).toBe(3)
  })

  it('ignores results for clubs outside this league', () => {
    const ladder = buildLadder(['a', 'b'], [result('a', 30, 3, 'zz', 10, 1)])
    expect(ladder).toHaveLength(2)
    expect(ladderRow(ladder, 'a')!.played).toBe(1)
    expect(ladderRow(ladder, 'b')!.played).toBe(0)
  })
})

describe('sorting', () => {
  it('ranks by points first', () => {
    const ladder = buildLadder(
      ['a', 'b', 'c'],
      [result('a', 30, 1, 'b', 10, 1, 'premiership', 1), result('c', 30, 1, 'b', 0, 0, 'premiership', 2)],
    )
    expect(ladder[0]!.points).toBeGreaterThanOrEqual(ladder[1]!.points)
    expect(ladder[1]!.points).toBeGreaterThanOrEqual(ladder[2]!.points)
  })

  it('breaks a points tie on points difference', () => {
    const ladder = buildLadder(
      ['a', 'b', 'c', 'd'],
      [
        result('a', 50, 1, 'b', 0, 0, 'premiership', 1), // a +50
        result('c', 10, 1, 'd', 5, 0, 'premiership', 2), // c +5
      ],
    )
    expect(ladder[0]!.teamId).toBe('a')
    expect(ladder[1]!.teamId).toBe('c')
  })

  it('breaks a points-difference tie on tries scored', () => {
    const ladder = buildLadder(
      ['a', 'b', 'c', 'd'],
      [
        result('a', 20, 1, 'b', 10, 0, 'premiership', 1),
        result('c', 20, 3, 'd', 10, 0, 'premiership', 2),
      ],
    )
    // Same points and same difference; c scored more tries.
    expect(ladder[0]!.teamId).toBe('c')
  })

  it('assigns 1-based positions in order', () => {
    const ladder = buildLadder(['a', 'b', 'c'], [])
    expect(ladder.map((r) => r.position)).toEqual([1, 2, 3])
  })

  it('is stable for genuinely identical records', () => {
    const first = buildLadder(['b', 'a'], [])
    const second = buildLadder(['a', 'b'], [])
    expect(first.map((r) => r.teamId)).toEqual(second.map((r) => r.teamId))
  })
})

describe('points deductions', () => {
  it('subtracts a deduction and can push a club down the table', () => {
    const results = [result('a', 30, 1, 'b', 10, 1)]
    const clean = buildLadder(['a', 'b'], results)
    expect(ladderPosition(clean, 'a')).toBe(1)

    const docked = buildLadder(['a', 'b'], results, new Map([['a', 10]]))
    expect(ladderRow(docked, 'a')!.points).toBe(WIN_POINTS - 10)
    expect(ladderPosition(docked, 'a')).toBe(2)
  })

  it('allows a negative total', () => {
    const ladder = buildLadder(['a', 'b'], [], new Map([['a', 5]]))
    expect(ladderRow(ladder, 'a')!.points).toBe(-5)
  })
})

describe('isPerfect', () => {
  it('is true only for a club that has won everything it played', () => {
    const won = buildLadder(['a', 'b'], [result('a', 30, 1, 'b', 10, 1)])
    expect(isPerfect(ladderRow(won, 'a')!)).toBe(true)
    expect(isPerfect(ladderRow(won, 'b')!)).toBe(false)
  })

  it('is false for a club that has not played', () => {
    expect(isPerfect(buildLadder(['a'], [])[0]!)).toBe(false)
  })

  it('is false once a club draws', () => {
    const ladder = buildLadder(
      ['a', 'b'],
      [result('a', 30, 1, 'b', 10, 1, 'premiership', 1), result('a', 10, 1, 'b', 10, 1, 'premiership', 2)],
    )
    expect(isPerfect(ladderRow(ladder, 'a')!)).toBe(false)
  })
})

describe('league-specific thresholds', () => {
  it('reads each league bonus rule from its own data', () => {
    for (const id of ['premiership', 'npc', 'top_14', 'shute_shield'] as LeagueId[]) {
      const league = getLeague(id)
      const ladder = buildLadder(
        ['a', 'b'],
        [result('a', 40, league.bonusPoints.tryBonus, 'b', 0, 0, id)],
      )
      expect(ladderRow(ladder, 'a')!.tryBonuses).toBe(1)
    }
  })
})
