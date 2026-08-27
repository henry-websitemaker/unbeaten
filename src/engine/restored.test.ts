/**
 * The systems restored from the previous build: pre-season training, the game plan, the
 * league choice, Mystery Club, pre-match news and the season verdict.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  MYSTERY_CLUB_SALARY_PREMIUM,
  createCareer,
  generateTransferOffers,
  placeCareerInWorld,
} from './career'
import {
  TRAINING_BLOCKS,
  TRAINING_RULES,
  applyTraining,
  blockForStat,
  getTrainingBlock,
  hasTrainedThisSeason,
  trainingGainForSeason,
  trainingOptions,
} from './training'
import {
  DEFAULT_GAME_PLAN,
  GAME_PLANS,
  forwardBias,
  gamePlanModifiers,
  getGamePlan,
  resolveAdaptive,
} from './gamePlan'
import { preMatchNews, seasonVerdict } from './flavour'
import { computeOvr } from './ovr'
import { HARD_CEILING, growthHeadroom } from './progression'
import { createWorld, randomStartingClub } from './world'
import { createRng, rngFor } from './rng'
import { POSITIONS, TIER_TWO_LEAGUES, LEAGUES } from '../data'
import type { PositionId, StatBlock, StatKey, TeamDef } from '../types/core'
import { CAREER_SEASONS, type SeasonRecord } from '../types/career'
import type { World } from './world'

let defs: readonly TeamDef[]
let world: World

beforeAll(async () => {
  const { loadTeams } = await import('../data')
  defs = await loadTeams()
  world = createWorld(1234, defs)
}, 60_000)

const ALL_POSITIONS = Object.keys(POSITIONS) as PositionId[]

/** Season 1, the top rung of the training curve, unless a test cares about the curve itself. */
const TRAINING_SEASON = 1

function statsFor(position: PositionId, level: number): StatBlock {
  const block: StatBlock = {}
  for (const stat of Object.keys(POSITIONS[position].statRanges) as StatKey[]) {
    block[stat] = level
  }
  return block
}

function newCareer(seed = 7, position: PositionId = 'OC', leagueId?: string) {
  const club = randomStartingClub(
    world,
    rngFor(seed, 'start'),
    position,
    leagueId as never,
  )
  const career = createCareer(
    seed,
    { name: 'Test', position, archetypeId: 'wonderkid', nationId: 'eng' },
    club,
  )
  return { career, world: placeCareerInWorld(world, career), club }
}

// ---------------------------------------------------------------------------
// Pre-season training (SPEC §2.8)
// ---------------------------------------------------------------------------

describe('pre-season training', () => {
  it('offers every stat the position has, each with a flavour block behind it', () => {
    expect(TRAINING_BLOCKS).toHaveLength(4)
    for (const position of ALL_POSITIONS) {
      const stats = statsFor(position, 65)
      const options = trainingOptions(stats, position, TRAINING_SEASON)

      // One card per stat the player actually has — no more, no fewer.
      expect(options.map((o) => o.stat).sort()).toEqual((Object.keys(stats) as StatKey[]).sort())
      for (const option of options) {
        expect(option.current).toBe(65)
        expect(option.block.flavour.length).toBeGreaterThan(0)
      }
    }
  })

  it('covers all eleven stats across the four blocks, with no stat in two', () => {
    const seen = new Map<StatKey, string>()
    for (const block of TRAINING_BLOCKS) {
      for (const stat of block.stats) {
        expect(seen.has(stat), `${stat} is in two blocks`).toBe(false)
        seen.set(stat, block.id)
      }
    }
    expect(seen.size).toBe(11)
  })

  it('raises the chosen stat and nothing else', () => {
    for (const position of ALL_POSITIONS) {
      const before = statsFor(position, 60)
      for (const stat of Object.keys(before) as StatKey[]) {
        const after = applyTraining(before, position, stat, TRAINING_SEASON).stats
        expect(after[stat]!).toBeGreaterThan(before[stat]!)
        for (const other of Object.keys(before) as StatKey[]) {
          if (other === stat) continue
          expect(after[other], `${stat} moved ${other}`).toBe(before[other])
        }
      }
    }
  })

  it('never costs anything — a summer of work only ever adds', () => {
    for (const position of ALL_POSITIONS) {
      const before = statsFor(position, 60)
      for (const stat of Object.keys(before) as StatKey[]) {
        const result = applyTraining(before, position, stat, TRAINING_SEASON)
        expect(result.ovrDelta).toBeGreaterThanOrEqual(0)
        for (const other of Object.keys(before) as StatKey[]) {
          expect(result.stats[other]!).toBeGreaterThanOrEqual(before[other]!)
        }
      }
    }
  })

  it('is worth more on a stat the shirt is judged on', () => {
    // A fly-half is judged on KCK/VIS/HND at 2.5x weight, so working on one of those must
    // move OVR more than working on something he is barely rated for.
    const options = trainingOptions(statsFor('FH', 65), 'FH', TRAINING_SEASON)
    const key = options.filter((o) => o.isKeyStat)
    const rest = options.filter((o) => !o.isKeyStat)
    expect(key.length).toBe(3)
    expect(Math.min(...key.map((o) => o.ovrDelta))).toBeGreaterThan(
      Math.max(...rest.map((o) => o.ovrDelta)),
    )
  })

  it('ignores a stat the position does not have', () => {
    // A wing has no scrummaging; asking for it is a no-op rather than an invention.
    const stats = statsFor('WL', 65)
    expect(stats.SCR).toBeUndefined()
    const result = applyTraining(stats, 'WL', 'SCR', TRAINING_SEASON)
    expect(result.ovrDelta).toBe(0)
    expect(result.stats).toEqual(stats)
  })

  it('tapers as a player climbs, but never stops', () => {
    const gainAt = (level: number) =>
      Math.max(
        ...trainingOptions(statsFor('OC', level), 'OC', TRAINING_SEASON).map((o) => o.ovrDelta),
      )

    // Slower the better you are...
    expect(gainAt(88)).toBeLessThanOrEqual(gainAt(60))
    // ...but the underlying multiplier is never zeroed out below the top of the scale.
    expect(growthHeadroom(95)).toBeGreaterThan(0)
  })

  it('cannot be trained past the top of the scale', () => {
    let stats = statsFor('OC', 70)
    // Season 1 every time: the most generous rung of the curve, sixty summers running.
    for (let i = 0; i < 60; i++) {
      const best = trainingOptions(stats, 'OC', 1).sort((a, b) => b.ovrDelta - a.ovrDelta)[0]!
      stats = applyTraining(stats, 'OC', best.stat, 1).stats
    }
    expect(computeOvr(stats, 'OC')).toBeLessThanOrEqual(HARD_CEILING)
  })

  /**
   * SPEC §2.8: the figure is one definite number per season, not a range, and it shrinks as
   * a career goes on. It used to be a flat 5 every summer, which meant a thirty-eight-year-old
   * improved as fast as an academy graduate.
   */
  it('gives a single definite figure per season, larger while young', () => {
    const gains = Array.from({ length: CAREER_SEASONS }, (_, i) => trainingGainForSeason(i + 1))

    // Never rises as a career goes on.
    for (let i = 1; i < gains.length; i++) {
      expect(gains[i]!, `season ${i + 1}`).toBeLessThanOrEqual(gains[i - 1]!)
    }
    // And genuinely falls — a flat curve would pass the check above.
    expect(gains[0]!).toBeGreaterThan(gains[gains.length - 1]!)

    expect(trainingGainForSeason(1)).toBe(5)
    expect(trainingGainForSeason(20)).toBe(1)
  })

  it('covers every season of a career, and does not fall off the end', () => {
    for (let season = 1; season <= CAREER_SEASONS; season++) {
      expect(trainingGainForSeason(season), `season ${season}`).toBeGreaterThan(0)
    }
    // Past the end it holds the last rung rather than dropping to nothing.
    expect(trainingGainForSeason(CAREER_SEASONS + 5)).toBeGreaterThan(0)
  })

  it('sums to the total the curve advertises', () => {
    const total = Array.from({ length: CAREER_SEASONS }, (_, i) =>
      trainingGainForSeason(i + 1),
    ).reduce((a, b) => a + b, 0)
    // 4x5 + 5x4 + 5x3 + 3x2 + 3x1 = 64 raw stat points across a full career.
    expect(total).toBe(64)
  })

  it('allows exactly one pick a summer', () => {
    expect(TRAINING_RULES.blocksPerSeason).toBe(1)
    expect(hasTrainedThisSeason([], 3)).toBe(false)
    expect(hasTrainedThisSeason([{ season: 3 }], 3)).toBe(true)
    // A pick taken last summer does not use up this one — nothing accumulates.
    expect(hasTrainedThisSeason([{ season: 2 }], 3)).toBe(false)
  })

  it('rejects an unknown block rather than silently doing nothing', () => {
    expect(() => getTrainingBlock('nope')).toThrow('Unknown training block')
  })

  it('maps every stat to exactly one flavour block', () => {
    for (const block of TRAINING_BLOCKS) {
      for (const stat of block.stats) {
        expect(blockForStat(stat).id).toBe(block.id)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Game plan (SPEC §3)
// ---------------------------------------------------------------------------

describe('the game plan', () => {
  it('offers the six the spec names', () => {
    expect(GAME_PLANS.map((p) => p.id).sort()).toEqual([
      'adapt',
      'backline_finesse',
      'balanced_flair',
      'forward_power',
      'high_risk',
      'tactical_depth',
    ])
  })

  it('starts a career on a real plan, so a match is never played without one', () => {
    const { career } = newCareer()
    expect(career.gamePlan).toBe(DEFAULT_GAME_PLAN)
    expect(() => getGamePlan(career.gamePlan)).not.toThrow()
  })

  it('leans the match on the stats the plan is about', () => {
    const forward = getGamePlan('forward_power')
    expect(forward.weights.SCR!).toBeGreaterThan(1)
    expect(forward.weights.PAC!).toBeLessThan(1)

    const backs = getGamePlan('backline_finesse')
    expect(backs.weights.PAC!).toBeGreaterThan(1)
    expect(backs.weights.SCR!).toBeLessThan(1)
  })

  it('makes high risk more volatile than tactical depth', () => {
    expect(getGamePlan('high_risk').variance).toBeGreaterThan(
      getGamePlan('tactical_depth').variance,
    )
  })

  it('counters the opponent rather than mirroring them', () => {
    // A pack-heavy side is answered by taking the game away from the forwards.
    expect(resolveAdaptive(1.5)).toBe('backline_finesse')
    expect(resolveAdaptive(-1.5)).toBe('tactical_depth')
    expect(resolveAdaptive(0)).toBe('balanced_flair')
  })

  it('reads a forward-leaning squad as forward-leaning', () => {
    const pack = [{ stats: { SCR: 85, LNO: 85, CAR: 85, RUK: 85, PAC: 50, EVA: 50, HND: 50, VIS: 50 } }]
    const backs = [{ stats: { SCR: 50, LNO: 50, CAR: 50, RUK: 50, PAC: 85, EVA: 85, HND: 85, VIS: 85 } }]
    expect(forwardBias(pack)).toBeGreaterThan(0)
    expect(forwardBias(backs)).toBeLessThan(0)
  })

  it('puts its strength swing on the right side of the match', () => {
    const home = gamePlanModifiers('forward_power', true, createRng(1))
    expect(home.homeStrengthDelta).toBeDefined()
    expect(home.awayStrengthDelta).toBeUndefined()

    const away = gamePlanModifiers('forward_power', false, createRng(1))
    expect(away.awayStrengthDelta).toBeDefined()
    expect(away.homeStrengthDelta).toBeUndefined()
  })

  it('is deterministic for a seed', () => {
    expect(gamePlanModifiers('high_risk', true, createRng(9), 0.2)).toEqual(
      gamePlanModifiers('high_risk', true, createRng(9), 0.2),
    )
  })
})

// ---------------------------------------------------------------------------
// League choice (SPEC §3)
// ---------------------------------------------------------------------------

describe('choosing your league', () => {
  it('starts you in the league you picked', () => {
    for (const league of TIER_TWO_LEAGUES) {
      for (let seed = 0; seed < 8; seed++) {
        const club = randomStartingClub(world, rngFor(seed, 'start'), 'OC', league.id)
        expect(club.leagueId).toBe(league.id)
      }
    }
  })

  it('never starts a career in a tier-one league, asked for or not', () => {
    for (let seed = 0; seed < 40; seed++) {
      const random = randomStartingClub(world, rngFor(seed, 'start'), 'OC')
      expect(LEAGUES[random.leagueId].tier).toBe(2)

      // Asking for the Premiership is ignored rather than honoured.
      const asked = randomStartingClub(world, rngFor(seed, 'start'), 'OC', 'premiership')
      expect(LEAGUES[asked.leagueId].tier).toBe(2)
    }
  })

  it('still picks the club at random within the league', () => {
    const clubs = new Set<string>()
    for (let seed = 0; seed < 40; seed++) {
      clubs.add(randomStartingClub(world, rngFor(seed, 'start'), 'OC', 'npc').id)
    }
    expect(clubs.size).toBeGreaterThan(1)
  })
})

// ---------------------------------------------------------------------------
// Mystery Club (SPEC §3)
// ---------------------------------------------------------------------------

describe('the Mystery Club', () => {
  it('turns up sometimes, and never on the stay-put offer', () => {
    const { career, world: placed } = newCareer()
    let seen = 0
    for (let seed = 0; seed < 60; seed++) {
      const offers = generateTransferOffers(career, placed, createRng(seed))
      if (offers.some((o) => o.mystery)) seen++
      // The first offer is always "stay where you are", which cannot be a mystery.
      expect(offers[0]!.mystery).toBe(false)
      // Never more than one per window.
      expect(offers.filter((o) => o.mystery).length).toBeLessThanOrEqual(1)
    }
    expect(seen).toBeGreaterThan(0)
    expect(seen).toBeLessThan(60)
  })

  it('still shows the OVR consequence, which SPEC §2.5 requires of every card', () => {
    const { career, world: placed } = newCareer()
    for (let seed = 0; seed < 60; seed++) {
      for (const offer of generateTransferOffers(career, placed, createRng(seed))) {
        if (!offer.mystery) continue
        const [min, max] = offer.ovrChangeRange
        if (offer.direction === 'up') expect([min, max]).toEqual([1, 3])
        else if (offer.direction === 'down') expect([min, max]).toEqual([-3, -1])
        else expect([min, max]).toEqual([0, 0])
      }
    }
  })

  it('is a real club underneath, and pays for the secrecy', () => {
    const { career, world: placed } = newCareer()
    for (let seed = 0; seed < 60; seed++) {
      const offers = generateTransferOffers(career, placed, createRng(seed))
      const mystery = offers.find((o) => o.mystery)
      if (!mystery) continue

      // Everything about it is decided now — only the name is withheld from the player.
      expect(placed.teams.some((t) => t.id === mystery.clubId)).toBe(true)
      expect(mystery.clubName.length).toBeGreaterThan(0)
      expect(mystery.years).toBeGreaterThan(0)
      expect(MYSTERY_CLUB_SALARY_PREMIUM).toBeGreaterThan(1)
    }
  })
})

// ---------------------------------------------------------------------------
// Flavour
// ---------------------------------------------------------------------------

describe('pre-match news', () => {
  it('always produces a line, for any state', () => {
    const { career } = newCareer()
    for (let seed = 0; seed < 50; seed++) {
      const line = preMatchNews(
        {
          career,
          opponentName: 'Nowhere RFC',
          isHome: seed % 2 === 0,
          round: (seed % 18) + 1,
          totalRounds: 18,
        },
        createRng(seed),
      )
      expect(line.length).toBeGreaterThan(0)
    }
  })

  it('leads on the derby when there is one', () => {
    const { career } = newCareer()
    const lines = new Set<string>()
    for (let seed = 0; seed < 40; seed++) {
      lines.add(
        preMatchNews(
          {
            career,
            opponentName: 'Rivals',
            isHome: true,
            round: 5,
            totalRounds: 18,
            derbyName: 'The Big One',
          },
          createRng(seed),
        ),
      )
    }
    expect([...lines].some((l) => l.includes('The Big One'))).toBe(true)
  })
})

describe('the season verdict', () => {
  const base: SeasonRecord = {
    season: 5,
    clubId: 'c',
    clubName: 'Club',
    leagueId: 'npc',
    appearances: 16,
    tries: 5,
    points: 25,
    avgRating: 6.5,
    motm: 1,
    ladderPosition: 4,
    championship: false,
    salary: 100,
    ovrStart: 70,
    ovrEnd: 72,
    internationalCaps: 0,
    injuries: 0,
  }

  it('calls a dominant season World Class', () => {
    expect(seasonVerdict({ ...base, avgRating: 7.8, appearances: 17 }, 18).verdict).toBe(
      'World Class',
    )
  })

  it('calls a good season Solid and an ordinary one Steady', () => {
    expect(seasonVerdict({ ...base, avgRating: 7.0 }, 18).verdict).toBe('Solid')
    expect(seasonVerdict({ ...base, avgRating: 6.2 }, 18).verdict).toBe('Steady Performer')
  })

  it('calls a season barely played a Quiet Season, however well it was rated', () => {
    expect(seasonVerdict({ ...base, avgRating: 9, appearances: 2 }, 18).verdict).toBe(
      'Quiet Season',
    )
    expect(seasonVerdict({ ...base, avgRating: 0, appearances: 0 }, 18).verdict).toBe(
      'Quiet Season',
    )
  })

  it('always says something, and never contradicts the numbers', () => {
    for (const rating of [0, 4, 5.5, 6.4, 7.1, 8.5]) {
      for (const apps of [0, 3, 9, 18]) {
        const result = seasonVerdict({ ...base, avgRating: rating, appearances: apps }, 18)
        expect(result.line.length).toBeGreaterThan(0)
        if (apps > 0) expect(result.line).toContain(String(apps))
      }
    }
  })
})
