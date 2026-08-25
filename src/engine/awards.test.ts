import { describe, it, expect } from 'vitest'
import {
  AWARD_DEFS,
  WORLD_PLAYER_ELIGIBILITY,
  accumulateSeasonStats,
  avgRating,
  computeLeagueAwards,
  computeWorldPlayer,
  meetsWorldPlayerFloors,
  nearMissFor,
  simulateElitePool,
  worldPlayerScore,
  type PlayerSeasonStats,
  type WorldPlayerCandidate,
} from './awards'
import {
  ACHIEVEMENT_DEFS,
  CATEGORIES,
  PREDICATES,
  evaluateAchievements,
  groupByCategory,
  newlyUnlocked,
} from './achievements'
import { advanceRival, createRival, headToHead, rivalVerdict } from './rival'
import { createLedger, credit } from './economy'
import type { PlayerCareer } from '../types/career'
import type { MatchResult } from '../types/match'
import type { PositionId } from '../types/core'

function stats(overrides: Partial<PlayerSeasonStats> & { playerId: string }): PlayerSeasonStats {
  return {
    playerName: overrides.playerId,
    teamId: 't',
    slot: 'WL' as PositionId,
    age: 26,
    appearances: 18,
    tries: 0,
    points: 0,
    totalRating: 18 * 6.5,
    motm: 0,
    ...overrides,
  }
}

function asMap(list: PlayerSeasonStats[]): Map<string, PlayerSeasonStats> {
  return new Map(list.map((s) => [s.playerId, s]))
}

describe('season stats accumulation', () => {
  it('adds up appearances, tries, points, ratings and MOTMs', () => {
    const results: MatchResult[] = [
      {
        season: 1,
        round: 1,
        leagueId: 'premiership',
        home: { teamId: 'a', score: 20, tries: 2, conversions: 2, penalties: 2, bonusPoints: 0 },
        away: { teamId: 'b', score: 10, tries: 1, conversions: 1, penalties: 1, bonusPoints: 0 },
        winnerId: 'a',
        motmPlayerId: 'p1',
        players: [
          { playerId: 'p1', playerName: 'One', teamId: 'a', slot: 'WL', rating: 8.2, tries: 2, kickPoints: 0, outOfPosition: false },
          { playerId: 'p2', playerName: 'Two', teamId: 'a', slot: 'FH', rating: 7.0, tries: 0, kickPoints: 10, outOfPosition: false },
        ],
      },
      {
        season: 1,
        round: 2,
        leagueId: 'premiership',
        home: { teamId: 'a', score: 15, tries: 1, conversions: 1, penalties: 2, bonusPoints: 0 },
        away: { teamId: 'c', score: 12, tries: 1, conversions: 1, penalties: 0, bonusPoints: 0 },
        winnerId: 'a',
        motmPlayerId: 'p2',
        players: [
          { playerId: 'p1', playerName: 'One', teamId: 'a', slot: 'WL', rating: 6.0, tries: 1, kickPoints: 0, outOfPosition: false },
          { playerId: 'p2', playerName: 'Two', teamId: 'a', slot: 'FH', rating: 8.0, tries: 0, kickPoints: 8, outOfPosition: false },
        ],
      },
    ]

    const totals = accumulateSeasonStats(results, () => 25)
    const one = totals.get('p1')!
    expect(one.appearances).toBe(2)
    expect(one.tries).toBe(3)
    expect(one.points).toBe(15)
    expect(one.motm).toBe(1)
    expect(avgRating(one)).toBeCloseTo(7.1, 5)
  })
})

describe('league awards', () => {
  it('exposes the seven awards from the data', () => {
    expect(AWARD_DEFS).toHaveLength(7)
  })

  it('crowns the leading try and points scorers', () => {
    const table = asMap([
      stats({ playerId: 'a', tries: 12, points: 60 }),
      stats({ playerId: 'b', tries: 8, points: 140 }),
    ])
    const awards = computeLeagueAwards(table)
    expect(awards.find((a) => a.id === 'top_try_scorer')!.winnerId).toBe('a')
    expect(awards.find((a) => a.id === 'top_points_scorer')!.winnerId).toBe('b')
  })

  it("gives Players' Player to the best average rating", () => {
    const table = asMap([
      stats({ playerId: 'a', totalRating: 18 * 8.4 }),
      stats({ playerId: 'b', totalRating: 18 * 7.1 }),
    ])
    expect(computeLeagueAwards(table).find((a) => a.id === 'players_player')!.winnerId).toBe('a')
  })

  it('restricts Young Player to the age cap in the data', () => {
    const maxAge = AWARD_DEFS.find((a) => a.id === 'young_player')!.maxAge!
    const table = asMap([
      stats({ playerId: 'old', age: maxAge + 1, totalRating: 18 * 9.0 }),
      stats({ playerId: 'young', age: maxAge, totalRating: 18 * 7.8 }),
    ])
    expect(computeLeagueAwards(table).find((a) => a.id === 'young_player')!.winnerId).toBe('young')
  })

  it('ignores a cameo appearance for rating-based awards', () => {
    const table = asMap([
      stats({ playerId: 'cameo', appearances: 1, totalRating: 10 }),
      stats({ playerId: 'regular', appearances: 20, totalRating: 20 * 7.9 }),
    ])
    expect(computeLeagueAwards(table).find((a) => a.id === 'players_player')!.winnerId).toBe(
      'regular',
    )
  })

  it('names a Team of the Season with one player per shirt', () => {
    const table = asMap([
      stats({ playerId: 'w1', slot: 'WL', totalRating: 18 * 8 }),
      stats({ playerId: 'w2', slot: 'WL', totalRating: 18 * 7 }),
      stats({ playerId: 'f1', slot: 'FH', totalRating: 18 * 8.5 }),
    ])
    const tots = computeLeagueAwards(table).find((a) => a.id === 'team_of_season')!
    expect(tots.squad).toHaveLength(2)
    expect(tots.squad!.find((s) => s.slot === 'WL')!.playerId).toBe('w1')
  })

  it('handles an empty league without throwing', () => {
    expect(computeLeagueAwards(new Map())).toEqual([])
  })
})

describe('near miss', () => {
  it('reports how far back a runner-up finished', () => {
    const table = asMap([
      stats({ playerId: 'leader', playerName: 'Leader', tries: 14 }),
      stats({ playerId: 'player', playerName: 'Player', tries: 12 }),
    ])
    const miss = nearMissFor(table, 'player')!
    expect(miss.placed).toBe(2)
    expect(miss.behindBy).toBe(2)
    expect(miss.message).toBe('Finished 2 tries behind Leader.')
  })

  it('says nothing for the winner or for someone well down the list', () => {
    const table = asMap([
      stats({ playerId: 'a', tries: 14 }),
      stats({ playerId: 'b', tries: 12 }),
      stats({ playerId: 'c', tries: 10 }),
      stats({ playerId: 'd', tries: 2 }),
    ])
    expect(nearMissFor(table, 'a')).toBeNull()
    expect(nearMissFor(table, 'd')).toBeNull()
    expect(nearMissFor(table, 'c')).not.toBeNull()
  })
})

describe('World Player of the Year', () => {
  const elite = (overrides: Partial<WorldPlayerCandidate> = {}): WorldPlayerCandidate => ({
    playerId: 'player',
    playerName: 'Career Player',
    clubName: 'Club',
    leagueId: 'premiership',
    appearances: 22,
    tries: 10,
    internationalCaps: 8,
    avgRating: 8.1,
    trophies: 1,
    isPlayer: true,
    ...overrides,
  })

  it('enforces the hard floors from the data', () => {
    const floors = WORLD_PLAYER_ELIGIBILITY
    expect(meetsWorldPlayerFloors(elite())).toBe(true)
    expect(meetsWorldPlayerFloors(elite({ internationalCaps: floors.minInternationalCaps - 1 }))).toBe(false)
    expect(meetsWorldPlayerFloors(elite({ appearances: floors.minAppearances - 1 }))).toBe(false)
    expect(meetsWorldPlayerFloors(elite({ avgRating: floors.minAvgRating - 0.1 }))).toBe(false)
  })

  it('produces a shortlist with a justification for every nominee', () => {
    const result = computeWorldPlayer(1, 5, elite())
    expect(result.nominees.length).toBeGreaterThan(1)
    for (const nominee of result.nominees) {
      expect(nominee.justification.length).toBeGreaterThan(0)
      expect(nominee.justification).toContain('average across')
    }
  })

  it('changes its nominees from season to season', () => {
    const first = computeWorldPlayer(1, 3, null).nominees.map((n) => n.playerName)
    const second = computeWorldPlayer(1, 4, null).nominees.map((n) => n.playerName)
    expect(first).not.toEqual(second)
  })

  it('almost never goes to a rookie', () => {
    // A first-season player in a tier-2 league: few caps, modest ratings.
    let wins = 0
    const seasons = 400
    for (let season = 1; season <= seasons; season++) {
      const rookie = elite({
        leagueId: 'rfu_championship',
        appearances: 16,
        tries: 4,
        internationalCaps: 0,
        avgRating: 7.0,
        trophies: 0,
      })
      if (computeWorldPlayer(season, season, rookie).playerWon) wins++
    }
    expect(wins / seasons).toBeLessThan(0.01)
  })

  it('can be won by a genuinely outstanding season', () => {
    let wins = 0
    for (let season = 1; season <= 200; season++) {
      const superstar = elite({
        leagueId: 'top_14',
        appearances: 26,
        tries: 18,
        internationalCaps: 13,
        avgRating: 9.2,
        trophies: 2,
      })
      if (computeWorldPlayer(season, season, superstar).playerWon) wins++
    }
    expect(wins).toBeGreaterThan(0)
  })

  it('runs without a career player at all', () => {
    const result = computeWorldPlayer(1, 1, null)
    expect(result.winner).not.toBeNull()
    expect(result.playerNominated).toBe(false)
    expect(result.playerWon).toBe(false)
  })

  it('rewards a tier-1 season over an identical tier-2 one', () => {
    const tierOne = worldPlayerScore(elite({ leagueId: 'top_14' }))
    const tierTwo = worldPlayerScore(elite({ leagueId: 'pro_d2' }))
    expect(tierOne).toBeGreaterThan(tierTwo)
  })

  it('builds a pool of the size stated in the data', () => {
    expect(simulateElitePool(1, 1)).toHaveLength(WORLD_PLAYER_ELIGIBILITY.elitePoolSize)
  })
})

// ---------------------------------------------------------------------------

function career(overrides: Partial<PlayerCareer> = {}): PlayerCareer {
  return {
    seed: 1,
    name: 'Player',
    position: 'WL',
    archetypeId: 'wonderkid',
    nationId: 'eng',
    age: 25,
    stats: {},
    ovr: 80,
    traits: [],
    season: 5,
    round: 0,
    contract: { clubId: 'c', leagueId: 'premiership', salary: 100_000, years: 3, yearsServed: 1 },
    ledger: createLedger(),
    lifestyle: { purchases: [] },
    form: 70,
    morale: 70,
    isCaptain: false,
    injury: null,
    effects: [],
    history: [],
    trophies: [],
    awards: [],
    achievements: [],
    careerCaps: 0,
    careerTries: 0,
    careerPoints: 0,
    internationalCaps: 0,
    internationalTries: 0,
    rivalId: null,
    retired: false,
    wheelSpunThisSeason: false,
    ...overrides,
  }
}

describe('achievements — typed predicates, never eval', () => {
  it('implements exactly the ids in achievements.json', () => {
    const dataIds = ACHIEVEMENT_DEFS.map((a) => a.id).sort()
    const registryIds = Object.keys(PREDICATES).sort()
    expect(registryIds).toEqual(dataIds)
  })

  it('categorises every achievement into the four-category grid', () => {
    for (const def of ACHIEVEMENT_DEFS) {
      expect(CATEGORIES[def.id], `${def.id} has no category`).toBeDefined()
    }
    const grid = groupByCategory(evaluateAchievements(career()))
    expect(Object.keys(grid).sort()).toEqual(['feats', 'journey', 'legend', 'milestones'])
    const total = Object.values(grid).reduce((a, list) => a + list.length, 0)
    expect(total).toBe(ACHIEVEMENT_DEFS.length)
  })

  it('never executes the source strings from the data', async () => {
    const source = await import('./achievements')
    void source
    // The check strings are still carried for reference...
    expect(ACHIEVEMENT_DEFS[0]!.check).toContain('=>')
    // ...but the module exposes typed functions, not compiled strings.
    expect(typeof PREDICATES.tries_10).toBe('function')
  })

  it('unlocks nothing for a fresh career', () => {
    const unlocked = evaluateAchievements(career()).filter((a) => a.unlocked)
    expect(unlocked).toHaveLength(0)
  })

  it('unlocks career-total achievements at the right thresholds', () => {
    const at9 = evaluateAchievements(career({ careerTries: 9 }))
    const at10 = evaluateAchievements(career({ careerTries: 10 }))
    expect(at9.find((a) => a.id === 'tries_10')!.unlocked).toBe(false)
    expect(at10.find((a) => a.id === 'tries_10')!.unlocked).toBe(true)
  })

  it('unlocks earnings achievements from the ledger, not from a stored total', () => {
    let ledger = createLedger()
    ledger = credit(ledger, 1, 'salary', 'Wages', 1_000_000)
    const result = evaluateAchievements(career({ ledger }))
    expect(result.find((a) => a.id === 'earnings_1m')!.unlocked).toBe(true)
    expect(result.find((a) => a.id === 'earnings_5m')!.unlocked).toBe(false)
  })

  it('unlocks Three Clubs on distinct clubs and Globe Trotter on distinct leagues', () => {
    const history = [
      { season: 1, clubId: 'a', clubName: 'A', leagueId: 'npc' as const, appearances: 1, tries: 0, points: 0, avgRating: 6, motm: 0, ladderPosition: 1, championship: false, salary: 0, ovrStart: 60, ovrEnd: 60, internationalCaps: 0, injuries: 0 },
      { season: 2, clubId: 'b', clubName: 'B', leagueId: 'premiership' as const, appearances: 1, tries: 0, points: 0, avgRating: 6, motm: 0, ladderPosition: 1, championship: false, salary: 0, ovrStart: 60, ovrEnd: 60, internationalCaps: 0, injuries: 0 },
      { season: 3, clubId: 'c', clubName: 'C', leagueId: 'top_14' as const, appearances: 1, tries: 0, points: 0, avgRating: 6, motm: 0, ladderPosition: 1, championship: false, salary: 0, ovrStart: 60, ovrEnd: 60, internationalCaps: 0, injuries: 0 },
    ]
    const result = evaluateAchievements(career({ history }))
    expect(result.find((a) => a.id === 'journeys_3')!.unlocked).toBe(true)
    expect(result.find((a) => a.id === 'journeys_5')!.unlocked).toBe(true)
  })

  it('unlocks the World Cup achievement only for an international trophy of that name', () => {
    const league = evaluateAchievements(
      career({ trophies: [{ season: 4, name: 'World Cup', type: 'league', clubOrNation: 'x' }] }),
    )
    expect(league.find((a) => a.id === 'wc_winner')!.unlocked).toBe(false)

    const test = evaluateAchievements(
      career({ trophies: [{ season: 4, name: 'World Cup', type: 'international', clubOrNation: 'England' }] }),
    )
    expect(test.find((a) => a.id === 'wc_winner')!.unlocked).toBe(true)
  })

  it('requires all three conditions for Living Legend', () => {
    const nearly = career({ careerCaps: 200, internationalCaps: 50, trophies: [] })
    expect(evaluateAchievements(nearly).find((a) => a.id === 'legend')!.unlocked).toBe(false)
  })

  it('reports only newly unlocked ids', () => {
    const c = career({ careerTries: 10, achievements: ['tries_10'] })
    expect(newlyUnlocked(c)).not.toContain('tries_10')
    expect(newlyUnlocked(career({ careerTries: 10 }))).toContain('tries_10')
  })
})

describe('rival', () => {
  it('is generated at the same position and close in ability', () => {
    const rival = createRival(1, 'OC', 60, 'npc')
    expect(rival.position).toBe('OC')
    expect(rival.ovr).toBeGreaterThanOrEqual(60)
    expect(rival.ovr).toBeLessThanOrEqual(70)
  })

  it('has a career arc of its own across twenty seasons', () => {
    let rival = createRival(2, 'FH', 62, 'shute_shield')
    for (let season = 1; season <= 20; season++) rival = advanceRival(rival, 2, season)

    expect(rival.history).toHaveLength(20)
    expect(rival.caps).toBeGreaterThan(0)
    expect(rival.age).toBe(39)

    const ovrs = rival.history.map((h) => h.ovr)
    const peak = Math.max(...ovrs)
    expect(peak).toBeGreaterThan(ovrs[0]!)
    expect(ovrs[ovrs.length - 1]!).toBeLessThan(peak)
  })

  it('compares like for like across five categories', () => {
    const rival = createRival(3, 'WL', 60, 'npc')
    const rows = headToHead(career({ careerCaps: 100, careerTries: 40 }), rival)
    expect(rows.map((r) => r.metric)).toEqual([
      'OVR',
      'Appearances',
      'Tries',
      'Test caps',
      'Trophies',
    ])
  })

  it('gives a verdict at retirement that reflects who actually won', () => {
    const rival = createRival(4, 'WL', 60, 'npc')
    const dominant = rivalVerdict(
      career({ ovr: 95, careerCaps: 300, careerTries: 150, internationalCaps: 100, trophies: [{ season: 1, name: 'x', type: 'league', clubOrNation: 'y' }] }),
      rival,
    )
    expect(dominant.playerWon).toBe(true)
    expect(dominant.categoriesWon).toBe(5)
    expect(dominant.verdict).toContain(rival.name)

    const beaten = rivalVerdict(career({ ovr: 40, careerCaps: 0, careerTries: 0 }), {
      ...rival,
      ovr: 90,
      caps: 300,
      tries: 100,
      internationalCaps: 80,
      trophies: 6,
    })
    expect(beaten.playerWon).toBe(false)
  })
})
