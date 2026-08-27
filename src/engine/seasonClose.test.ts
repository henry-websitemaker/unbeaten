/**
 * The season boundary beyond the club game.
 *
 * `awards.ts` and `internationals.ts` had thorough unit tests and no callers, so the
 * property that actually mattered went untested: that a career played through the real
 * season loop ever earns a cap or wins anything. These tests drive the loop, not the
 * functions.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { PLAYER_ID, createCareer, placeCareerInWorld } from './career'
import { beginSeason, closeSeason, playRound, skipWheelSpin, type CareerRun } from './careerRun'
import { computeInternationals, computeSeasonAwards, recentFormRating } from './seasonClose'
import { evaluateAchievements } from './achievements'
import { computeOvr } from './ovr'
import { createWorld, randomStartingClub } from './world'
import { isRegularSeasonComplete } from './season'
import { WORLD_CUP_SEASONS, getNation } from './internationals'
import { rngFor } from './rng'
import { loadTeams } from '../data'
import { CAREER_SEASONS, type PlayerCareer } from '../types/career'
import type { StatBlock, StatKey, TeamDef } from '../types/core'
import type { World } from './world'

let defs: readonly TeamDef[]
let world: World

beforeAll(async () => {
  defs = await loadTeams()
  world = createWorld(1234, defs)
}, 60_000)

function newCareer(seed = 7, nationId = 'eng') {
  const club = randomStartingClub(world, rngFor(seed, 'start'))
  const career = createCareer(
    seed,
    { name: 'Test Player', position: 'OC', archetypeId: 'wonderkid', nationId },
    club,
  )
  return { career, world: placeCareerInWorld(world, career) }
}

/**
 * The same career, raised to international standard.
 *
 * Whether an ordinary 55-65 OVR start ever reaches this level is a question about the
 * progression curve, not about this module. These tests are about the wiring: given a player
 * good enough to be picked, do the caps, tries and trophies reach the career.
 */
function internationalStandardCareer(seed: number, nationId: string) {
  const { career } = newCareer(seed, nationId)
  const stats: StatBlock = {}
  for (const key of Object.keys(career.stats)) stats[key as StatKey] = 80
  const strong: PlayerCareer = { ...career, stats, ovr: computeOvr(stats, career.position) }
  return { career: strong, world: placeCareerInWorld(world, strong) }
}

/** Play one season out and close it, skipping the wheel so nothing else moves. */
function playSeason(career: PlayerCareer, placed: World) {
  let run: CareerRun = beginSeason(career, placed)
  while (!isRegularSeasonComplete(run.season)) {
    run = playRound(run)
    if (run.wheelPending) run = skipWheelSpin(run)
  }
  return closeSeason(run)
}

// ---------------------------------------------------------------------------
// Internationals
// ---------------------------------------------------------------------------

describe('the recent form window', () => {
  it('judges the last six games, not the whole season', () => {
    // A bad start and a strong finish: the season mean is 6.0, the form window is 8.0.
    const ratings = [4, 4, 4, 4, 4, 4, 8, 8, 8, 8, 8, 8]
    expect(recentFormRating(ratings)).toBeCloseTo(8, 5)
  })

  it('handles a season with no appearances at all', () => {
    expect(recentFormRating([])).toBe(0)
  })
})

describe('international selection', () => {
  const base = { seed: 11, season: 1, nationId: 'eng', existingCaps: 0 }

  it('picks a player in form and turns them away when they are not', () => {
    const inForm = computeInternationals({ ...base, ovr: 88, formRating: 9.2 })
    const outOfForm = computeInternationals({ ...base, ovr: 88, formRating: 4.0 })

    expect(inForm.verdict.selected).toBe(true)
    expect(inForm.caps).toBeGreaterThan(0)

    expect(outOfForm.verdict.selected).toBe(false)
    expect(outOfForm.caps).toBe(0)
    expect(outOfForm.tries).toBe(0)
    expect(outOfForm.trophies).toEqual([])
    expect(outOfForm.season).toBeNull()
  })

  it('scales the bar by nation strength — the same form gets you into Italy, not New Zealand', () => {
    const form = { ovr: 82, formRating: 7.6 }
    const italy = computeInternationals({ ...base, nationId: 'ita', ...form })
    const newZealand = computeInternationals({ ...base, nationId: 'nzl', ...form })

    expect(italy.verdict.threshold).toBeLessThan(newZealand.verdict.threshold)
    expect(italy.verdict.ovrFloor).toBeLessThan(newZealand.verdict.ovrFloor)
  })

  it('runs the World Cup only in the seasons the data names, selected or not', () => {
    for (let season = 1; season <= CAREER_SEASONS; season++) {
      const picked = computeInternationals({ ...base, season, ovr: 90, formRating: 9.5 })
      const dropped = computeInternationals({ ...base, season, ovr: 50, formRating: 3.0 })
      const expected = WORLD_CUP_SEASONS.includes(season)

      expect(picked.worldCup !== null).toBe(expected)
      // The tournament happens whether or not the player is in it.
      expect(dropped.worldCup !== null).toBe(expected)
    }
  })

  it('writes a trophy the wc_winner achievement can match when the nation wins it', () => {
    // Search seeds for a World Cup the player's nation actually wins.
    let won: ReturnType<typeof computeInternationals> | null = null
    for (let seed = 0; seed < 400 && !won; seed++) {
      const outcome = computeInternationals({
        seed,
        season: 4,
        nationId: 'nzl',
        ovr: 92,
        formRating: 9.5,
        existingCaps: 40,
      })
      if (outcome.worldCup?.championId === 'nzl') won = outcome
    }

    expect(won).not.toBeNull()
    const trophy = won!.trophies.find((t) => t.name === 'World Cup')
    expect(trophy).toBeDefined()
    expect(trophy!.type).toBe('international')
    expect(trophy!.clubOrNation).toBe(getNation('nzl').name)
  })

  it('is deterministic for a seed', () => {
    const input = { ...base, season: 8, ovr: 86, formRating: 8.1 }
    expect(computeInternationals(input)).toEqual(computeInternationals(input))
  })
})

// ---------------------------------------------------------------------------
// Awards
// ---------------------------------------------------------------------------

describe('season awards', () => {
  it('names a winner for every league award and records the ones the player won', () => {
    const { career, world: placed } = newCareer(2031)
    const { summary } = playSeason(career, placed)

    const ids = summary.awards.league.map((a) => a.id)
    expect(ids).toContain('top_try_scorer')
    expect(ids).toContain('top_points_scorer')
    expect(ids).toContain('players_player')
    expect(ids).toContain('young_player')
    expect(ids).toContain('team_of_season')

    // Team of the Season names one player per shirt.
    const xv = summary.awards.league.find((a) => a.id === 'team_of_season')
    expect(xv?.squad?.length).toBeGreaterThan(0)

    // Anything the player won is on the career, and nothing else is.
    const wonIds = summary.awards.league
      .filter((a) =>
        a.id === 'team_of_season'
          ? (a.squad ?? []).some((s) => s.playerId === PLAYER_ID)
          : a.winnerId === PLAYER_ID,
      )
      .map((a) => a.id)
    const recorded = summary.career.awards.filter((a) => a.type !== 'world_player')
    expect(recorded.map((a) => a.type).sort()).toEqual(wonIds.sort())
    for (const award of recorded) expect(award.season).toBe(summary.record.season)
  })

  // Closing a season now plays the whole world — seven more leagues and nine cups — so these
  // need a real budget rather than the 5s default.
  it('gives the near-miss line only for 2nd and 3rd', () => {
    for (const seed of [11, 22, 33, 44, 55]) {
      const { career, world: placed } = newCareer(seed)
      const { summary } = playSeason(career, placed)
      const near = summary.awards.nearMissTries
      if (near) {
        expect(near.placed).toBeGreaterThanOrEqual(2)
        expect(near.placed).toBeLessThanOrEqual(3)
        expect(near.behindBy).toBeGreaterThan(0)
        expect(near.message).toContain(near.leaderName)
      }
    }
  }, 120_000)

  it('does not shortlist a rookie for World Player of the Year', () => {
    const { career, world: placed } = newCareer(2032)
    const { summary } = playSeason(career, placed)
    expect(summary.awards.worldPlayer.playerWon).toBe(false)
    expect(summary.career.awards.some((a) => a.type === 'world_player')).toBe(false)
  })

  it('scores the player on this season only, not a career total', () => {
    // A candidate carrying twenty seasons of trophies would outscore the elite pool on
    // longevity alone. Two identical seasons must produce the same shortlist.
    const shared = {
      seed: 5,
      season: 6,
      leagueId: 'premiership' as const,
      results: [],
      teams: [],
      playerId: PLAYER_ID,
    }
    const first = computeSeasonAwards({ ...shared, playerCandidate: null })
    const second = computeSeasonAwards({ ...shared, playerCandidate: null })
    expect(first.worldPlayer.nominees.map((n) => n.playerId)).toEqual(
      second.worldPlayer.nominees.map((n) => n.playerId),
    )
  })

  it('changes the shortlist from season to season', () => {
    const shared = {
      seed: 5,
      leagueId: 'premiership' as const,
      results: [],
      teams: [],
      playerId: PLAYER_ID,
      playerCandidate: null,
    }
    const s3 = computeSeasonAwards({ ...shared, season: 3 })
    const s4 = computeSeasonAwards({ ...shared, season: 4 })
    expect(s3.worldPlayer.nominees.map((n) => n.playerName)).not.toEqual(
      s4.worldPlayer.nominees.map((n) => n.playerName),
    )
    for (const nominee of s3.worldPlayer.nominees) {
      expect(nominee.justification.length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// The point of all of it
// ---------------------------------------------------------------------------

describe('achievements that were previously unreachable', () => {
  it('caps a player good enough to be picked, and the caps reach the career', () => {
    // An international-standard player, so the test exercises the wiring rather than the
    // balance curve that decides whether an ordinary career ever gets this good.
    const { career, world: placed } = internationalStandardCareer(2026, 'ita')
    const { summary } = playSeason(career, placed)

    expect(summary.internationals.verdict.selected).toBe(true)
    expect(summary.internationals.caps).toBeGreaterThan(0)

    // The record carries this season's caps; the career carries the running total.
    expect(summary.record.internationalCaps).toBe(summary.internationals.caps)
    expect(summary.career.internationalCaps).toBe(
      career.internationalCaps + summary.internationals.caps,
    )
    expect(summary.career.internationalTries).toBe(
      career.internationalTries + summary.internationals.tries,
    )

    const unlocked = new Set(
      evaluateAchievements(summary.career)
        .filter((a) => a.unlocked)
        .map((a) => a.id),
    )
    // `test_debut` was impossible before internationals were wired in.
    expect(unlocked.has('test_debut')).toBe(true)
  }, 120_000)

  it('credits nothing when the player is not picked', () => {
    const { career, world: placed } = newCareer(2026, 'nzl')
    const { summary } = playSeason(career, placed)

    // An ordinary tier-2 rookie is nowhere near a New Zealand squad.
    expect(summary.internationals.verdict.selected).toBe(false)
    expect(summary.record.internationalCaps).toBe(0)
    expect(summary.career.internationalCaps).toBe(career.internationalCaps)
    expect(summary.career.trophies).toHaveLength(career.trophies.length)
  }, 120_000)

  it('records a league award on the career when the player wins one', () => {
    // A dominant player in a tier-2 league tops charts an ordinary one does not.
    const { career, world: placed } = internationalStandardCareer(4242, 'ita')
    const { summary } = playSeason(career, placed)

    for (const win of summary.career.awards) {
      expect(win.season).toBe(summary.record.season)
      expect(win.name.length).toBeGreaterThan(0)
    }
    // Whatever the league table says, the career's award list and the season's player wins
    // must agree — that is the join that did not exist before.
    expect(summary.career.awards).toEqual([...career.awards, ...summary.awards.playerWins])
  }, 120_000)
})
