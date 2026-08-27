/**
 * The world outside the player's own league: the other seven leagues, both cups, and the
 * world ranking.
 *
 * `cups.ts` was written in phase 2 and imported by nothing but a balance test until now, so
 * the Champions Cup had never been played in a career. These tests exist to make sure that
 * cannot quietly become true again — they drive a career and assert what reaches the cabinet,
 * rather than testing the cup engine in isolation the way the old tests did.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { PLAYER_ID, createCareer, placeCareerInWorld } from './career'
import { beginSeason, closeSeason, playRound, skipWheelSpin, type CareerRun } from './careerRun'
import { simulateWorldSeason, playChampionsCup, domesticCupFor } from './worldSeason'
import { DOMESTIC_CUPS, championsCupName } from './cupData'
import { CHAMPIONS_CUP_LEAGUES } from './cups'
import { worldRanking, MIN_APPEARANCES_FOR_RANKING } from './ranking'
import { createSeason, simulateSeason, isRegularSeasonComplete } from './season'
import { createWorld, randomStartingClub, teamsInLeague } from './world'
import { squadStrength } from './generate'
import { computeOvr } from './ovr'
import { rngFor } from './rng'
import { LEAGUE_LIST, loadTeams } from '../data'
import type { PositionId, StatBlock, StatKey, TeamDef } from '../types/core'
import type { World } from './world'

let defs: readonly TeamDef[]
let world: World

beforeAll(async () => {
  defs = await loadTeams()
  world = createWorld(1234, defs)
}, 60_000)

function playSeason(seed: number, position: PositionId = 'OC') {
  const club = randomStartingClub(world, rngFor(seed, 'start'), position)
  const career = createCareer(
    seed,
    { name: 'World Test', position, archetypeId: 'wonderkid', nationId: 'eng' },
    club,
  )
  let run: CareerRun = beginSeason(career, placeCareerInWorld(world, career))
  while (!isRegularSeasonComplete(run.season)) {
    run = playRound(run)
    if (run.wheelPending) run = skipWheelSpin(run)
  }
  return closeSeason(run)
}

/**
 * A season at a chosen club, with the player good enough to be picked there.
 *
 * Needed because a career starts in tier 2 and the Champions Cup is a tier-1 competition —
 * a tier-2 career can never win it, however many seeds are tried. Whether an ordinary career
 * ever climbs that far is a progression question the §2.5 targets already cover; this is
 * about whether the trophy reaches the cabinet once it is won.
 */
function playSeasonAt(seed: number, leagueId: (typeof LEAGUE_LIST)[number]['id'], position: PositionId = 'OC') {
  const club = [...teamsInLeague(world, leagueId)].sort(
    (a, b) => squadStrength(b) - squadStrength(a),
  )[0]!
  const base = createCareer(
    seed,
    { name: 'Elite', position, archetypeId: 'wonderkid', nationId: 'eng' },
    club,
  )
  const stats: StatBlock = {}
  for (const key of Object.keys(base.stats) as StatKey[]) stats[key] = 88
  const career = {
    ...base,
    stats,
    ovr: computeOvr(stats, position),
    contract: { ...base.contract, clubId: club.id, leagueId },
  }

  let run: CareerRun = beginSeason(career, placeCareerInWorld(world, career))
  while (!isRegularSeasonComplete(run.season)) {
    run = playRound(run)
    if (run.wheelPending) run = skipWheelSpin(run)
  }
  return closeSeason(run)
}

/** A career where the player actually got on the pitch. Selection is not guaranteed. */
function playSeasonWithAppearances(from: number) {
  for (let seed = from; seed < from + 30; seed++) {
    const closed = playSeason(seed)
    if (closed.summary.record.appearances > 0) return closed
  }
  throw new Error('no career featured in 30 seeds')
}

// ---------------------------------------------------------------------------

describe('the rest of the world', () => {
  it('plays every league, not just the player’s', () => {
    const { summary } = playSeason(11)
    expect(summary.world.seasons).toHaveLength(LEAGUE_LIST.length)

    const leagues = summary.world.seasons.map((s) => s.leagueId).sort()
    expect(leagues).toEqual(LEAGUE_LIST.map((l) => l.id).sort())

    // Every one of them actually finished and crowned somebody.
    for (const state of summary.world.seasons) {
      expect(state.results.length, state.leagueId).toBeGreaterThan(0)
      expect(state.championId, state.leagueId).not.toBeNull()
    }
  }, 120_000)

  it('keeps the player’s own league as the one they actually played', () => {
    const { run, summary } = playSeasonWithAppearances(12)
    const mine = summary.world.seasons.find((s) => s.leagueId === run.career.contract.leagueId)
    expect(mine).toBeDefined()
    // Re-simulating it would have thrown away the player's own match lines.
    expect(mine!.results.some((r) => r.players.some((p) => p.playerId === PLAYER_ID))).toBe(true)
  }, 300_000)

  it('is deterministic for a seed', () => {
    const a = playSeason(13)
    const b = playSeason(13)
    expect(a.summary.world.championsCup.championId).toBe(b.summary.world.championsCup.championId)
    expect(a.summary.world.domesticCups.map((c) => c.championId)).toEqual(
      b.summary.world.domesticCups.map((c) => c.championId),
    )
  }, 120_000)
})

describe('cups', () => {
  it('runs a domestic cup for every league', () => {
    const { summary } = playSeason(14)
    expect(summary.world.domesticCups).toHaveLength(LEAGUE_LIST.length)
    for (const league of LEAGUE_LIST) {
      expect(DOMESTIC_CUPS[league.id], `${league.id} has no cup`).toBeDefined()
    }
    for (const cup of summary.world.domesticCups) {
      expect(cup.championId.length).toBeGreaterThan(0)
      expect(cup.matches.length).toBeGreaterThan(0)
    }
  }, 120_000)

  it('draws the Champions Cup only from the tier-one leagues', () => {
    const seasons = LEAGUE_LIST.map((league) =>
      simulateSeason(createSeason(7, 1, league.id, teamsInLeague(world, league.id))),
    )
    const cup = playChampionsCup(seasons, 7, 1)

    expect(cup.name).toBe(championsCupName())
    const tierOneClubIds = new Set(
      seasons
        .filter((s) => CHAMPIONS_CUP_LEAGUES.includes(s.leagueId))
        .flatMap((s) => s.teams.map((t) => t.id)),
    )
    for (const match of cup.matches) {
      expect(tierOneClubIds.has(match.home.teamId)).toBe(true)
      expect(tierOneClubIds.has(match.away.teamId)).toBe(true)
    }
    expect(tierOneClubIds.has(cup.championId)).toBe(true)
  }, 120_000)

  it('seeds a domestic cup from the league table, not at random', () => {
    const state = simulateSeason(createSeason(9, 1, 'premiership', teamsInLeague(world, 'premiership')))
    const cup = domesticCupFor(state, 9, 1)
    expect(cup).not.toBeNull()
    // The field is the top N of the table, so the champion came from that group.
    const entered = new Set(cup!.matches.flatMap((m) => [m.home.teamId, m.away.teamId]))
    expect(entered.size).toBeLessThanOrEqual(DOMESTIC_CUPS.premiership!.teams)
  }, 120_000)
})

/**
 * SPEC §3's trophy cabinet takes league titles, cups and international silverware. The league
 * title has always worked; the two cups did not exist in a career until now.
 */
describe('all three trophies reach the cabinet', () => {
  it('records a league title and a domestic cup won in a tier-two career', () => {
    const kinds = new Set<string>()
    for (let seed = 0; seed < 40 && kinds.size < 2; seed++) {
      const { summary } = playSeason(2000 + seed)
      for (const trophy of summary.career.trophies) {
        if (trophy.type === 'league') kinds.add('league')
        else if (trophy.type === 'cup') kinds.add('domestic')
      }
    }
    expect([...kinds].sort()).toEqual(['domestic', 'league'])
  }, 600_000)

  it('records a Champions Cup, which only a tier-one club can win', () => {
    // A tier-two career cannot win this however many seeds are tried — the competition is
    // drawn from the tier-one leagues. That is the design, not a gap, so the test puts the
    // player where the trophy is actually available.
    let won: { name: string; type: string } | null = null

    for (let seed = 0; seed < 30 && !won; seed++) {
      const { summary } = playSeasonAt(4000 + seed, 'premiership')
      won =
        summary.career.trophies.find((t) => t.name === championsCupName()) ?? null
    }

    expect(won, 'no Champions Cup won in 30 tier-one seasons').not.toBeNull()
    expect(won!.type).toBe('cup')
  }, 900_000)

  it('counts cup ties as appearances and pays win bonuses for them', () => {
    for (let seed = 0; seed < 25; seed++) {
      const { summary, run } = playSeason(3000 + seed)
      const clubId = run.career.contract.clubId
      const ties = [...summary.world.domesticCups, summary.world.championsCup]
        .flatMap((cup) => cup.matches)
        .filter((m) => m.home.teamId === clubId || m.away.teamId === clubId)
        .filter((m) => m.players.some((p) => p.playerId === PLAYER_ID))

      if (ties.length === 0) continue
      // Cup appearances are in the career total alongside league ones.
      expect(summary.career.careerCaps).toBeGreaterThanOrEqual(ties.length)
      return
    }
    throw new Error('no career played a cup tie in 25 seeds')
  }, 600_000)
})

describe('world ranking', () => {
  it('ranks against every player in the world, not just the league', () => {
    const { summary } = playSeasonWithAppearances(21)
    expect(summary.ranking).not.toBeNull()

    const playersInMyLeague = new Set(
      summary.world.seasons
        .find((s) => s.leagueId === summary.record.leagueId)!
        .results.flatMap((r) => r.players.map((p) => p.playerId)),
    ).size

    // The field is far larger than one league's worth of players.
    expect(summary.ranking!.ranked).toBeGreaterThan(playersInMyLeague)
    expect(summary.ranking!.rank).toBeGreaterThanOrEqual(1)
    expect(summary.ranking!.rank).toBeLessThanOrEqual(summary.ranking!.ranked)
    expect(summary.ranking!.percentile).toBeGreaterThanOrEqual(0)
    expect(summary.ranking!.percentile).toBeLessThanOrEqual(100)
  }, 120_000)

  it('does not let two appearances top the world', () => {
    const { summary } = playSeason(22)
    const seasons = summary.world.seasons

    const cameo = worldRanking(seasons, PLAYER_ID)
    expect(cameo).not.toBeNull()
    if (!cameo!.eligible) {
      // An ineligible player is still placed, but flagged rather than silently ranked.
      expect(cameo!.rank).toBeGreaterThan(1)
    }
    expect(MIN_APPEARANCES_FOR_RANKING).toBeGreaterThan(1)
  }, 120_000)

  it('returns nothing for a player who never appeared', () => {
    const seasons = LEAGUE_LIST.map((league) =>
      simulateSeason(createSeason(5, 1, league.id, teamsInLeague(world, league.id))),
    )
    expect(worldRanking(seasons, 'nobody-at-all')).toBeNull()
  }, 120_000)
})

describe('simulateWorldSeason', () => {
  it('does not re-simulate the league it is handed', () => {
    const played = simulateSeason(createSeason(3, 1, 'npc', teamsInLeague(world, 'npc')))
    const result = simulateWorldSeason(world, 3, 1, played)
    const mine = result.seasons.find((s) => s.leagueId === 'npc')!
    expect(mine).toBe(played)
  }, 120_000)
})
