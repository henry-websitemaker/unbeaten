/**
 * The rest of the world.
 *
 * A career only ever simulated its own league. That was enough for the dashboard and the
 * ladder, but it meant three things the game claims were not true: there was nobody outside
 * your league to be ranked against, the Champions Cup had no qualified field to draw from,
 * and no domestic cup could run because no other league had a table.
 *
 * The other seven leagues are simulated **once, at season close** rather than round by round.
 * Nothing looks at them mid-season — the ranking, both cups and the world table are all
 * season-end concepts — so stepping them in lockstep with the player's rounds would cost
 * twenty to thirty times as much for a result nobody sees until the end.
 */

import { LEAGUE_LIST } from '../data'
import { createSeason, currentLadder, simulateSeason, type SeasonState } from './season'
import {
  CHAMPIONS_CUP_LEAGUES,
  CHAMPIONS_CUP_QUOTAS,
  simulateCup,
  type CupEntry,
  type CupResult,
} from './cups'
import { DOMESTIC_CUPS, championsCupName } from './cupData'
import { teamsInLeague, type World } from './world'
import type { LeagueId, Team } from '../types/core'

export interface WorldSeason {
  /** Every league's finished season, including the player's own. */
  seasons: SeasonState[]
  /** One domestic knockout per league. */
  domesticCups: CupResult[]
  championsCup: CupResult
}

/**
 * Play out the whole world for a season.
 *
 * The player's own league is passed in already played rather than re-simulated — replaying it
 * would produce the same result but throw away the player's own match lines, which is where
 * every appearance, try and rating in the career came from.
 */
export function simulateWorldSeason(
  world: World,
  seed: number,
  season: number,
  playerSeason: SeasonState,
): WorldSeason {
  const seasons: SeasonState[] = [playerSeason]

  for (const league of LEAGUE_LIST) {
    if (league.id === playerSeason.leagueId) continue
    const teams = teamsInLeague(world, league.id)
    if (teams.length === 0) continue
    seasons.push(simulateSeason(createSeason(seed, season, league.id, teams)))
  }

  const domesticCups = seasons
    .map((state) => domesticCupFor(state, seed, season))
    .filter((cup): cup is CupResult => cup !== null)

  return {
    seasons,
    domesticCups,
    championsCup: playChampionsCup(seasons, seed, season),
  }
}

/** Seed a league's clubs by where they finished, for either cup. */
function entriesFrom(state: SeasonState): CupEntry[] {
  const ladder = currentLadder(state)
  const byId = new Map<string, Team>(state.teams.map((t) => [t.id, t]))

  return ladder
    .map((row) => {
      const team = byId.get(row.teamId)
      return team ? { team, leaguePosition: row.position } : null
    })
    .filter((entry): entry is CupEntry => entry !== null)
}

/** The domestic knockout that runs alongside a league season. */
export function domesticCupFor(
  state: SeasonState,
  seed: number,
  season: number,
): CupResult | null {
  const definition = DOMESTIC_CUPS[state.leagueId]
  if (!definition) return null

  const entries = entriesFrom(state).slice(0, definition.teams)
  if (entries.length < 2) return null

  // Its own rng stream, so a cup result never depends on how many leagues ran before it.
  return simulateCup(seed ^ hashLeague(state.leagueId), season, definition.name, entries)
}

/**
 * The Champions Cup, drawn from the tier-1 leagues.
 *
 * Entry is by league finish rather than a fixed allocation of names, so qualifying is
 * something a club — and a career — can actually achieve.
 */
export function playChampionsCup(
  seasons: readonly SeasonState[],
  seed: number,
  season: number,
): CupResult {
  const entries: CupEntry[] = []

  for (const state of seasons) {
    if (!CHAMPIONS_CUP_LEAGUES.includes(state.leagueId)) continue
    // The per-league allocation `cups.ts` already defines, taken off the top of the table.
    entries.push(...entriesFrom(state).slice(0, CHAMPIONS_CUP_QUOTAS[state.leagueId] ?? 4))
  }

  // Re-seed across leagues: a league winner outranks another league's runner-up.
  const ranked = entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.leaguePosition - b.entry.leaguePosition || a.index - b.index)
    .map(({ entry }, index) => ({ ...entry, leaguePosition: index + 1 }))

  return simulateCup(seed ^ 0xc0f, season, championsCupName(), ranked)
}

function hashLeague(id: LeagueId): number {
  let hash = 2166136261
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}
