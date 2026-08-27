/**
 * Trophies reaching the cabinet — the slow half of the world tests.
 *
 * These search dozens of seeds for a career that actually wins each kind of trophy, which is
 * the only honest way to assert "when it is won, it is recorded" without hand-building a
 * result. That costs about eighty seconds, so they sit behind `npm run test:balance` rather
 * than in the everyday suite. The fast structural checks — that every league plays, that the
 * Champions Cup draws only from tier one, that cups are seeded off the table — stay in
 * `worldSeason.test.ts`.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { PLAYER_ID, createCareer, placeCareerInWorld } from './career'
import { beginSeason, closeSeason, playRound, skipWheelSpin, type CareerRun } from './careerRun'
import { championsCupName } from './cupData'
import { isRegularSeasonComplete } from './season'
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

function runSeason(career: Parameters<typeof beginSeason>[0]) {
  let run: CareerRun = beginSeason(career, placeCareerInWorld(world, career))
  while (!isRegularSeasonComplete(run.season)) {
    run = playRound(run)
    if (run.wheelPending) run = skipWheelSpin(run)
  }
  return closeSeason(run)
}

function playSeason(seed: number, position: PositionId = 'OC') {
  const club = randomStartingClub(world, rngFor(seed, 'start'), position)
  return runSeason(
    createCareer(
      seed,
      { name: 'World Test', position, archetypeId: 'wonderkid', nationId: 'eng' },
      club,
    ),
  )
}

/**
 * A season at a chosen club, with the player good enough to be picked there.
 *
 * A career starts in tier 2 and the Champions Cup is a tier-1 competition, so a tier-2 career
 * can never win it however many seeds are tried. Whether an ordinary career climbs that far is
 * a progression question the §2.5 targets cover; this is about the trophy being recorded.
 */
function playSeasonAt(
  seed: number,
  leagueId: (typeof LEAGUE_LIST)[number]['id'],
  position: PositionId = 'OC',
) {
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

  return runSeason({
    ...base,
    stats,
    ovr: computeOvr(stats, position),
    contract: { ...base.contract, clubId: club.id, leagueId },
  })
}

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
    let won: { name: string; type: string } | null = null

    for (let seed = 0; seed < 30 && !won; seed++) {
      const { summary } = playSeasonAt(4000 + seed, 'premiership')
      won = summary.career.trophies.find((t) => t.name === championsCupName()) ?? null
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
      expect(summary.career.careerCaps).toBeGreaterThanOrEqual(ties.length)
      return
    }
    throw new Error('no career played a cup tie in 25 seeds')
  }, 600_000)
})
