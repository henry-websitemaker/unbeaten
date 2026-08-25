/**
 * The world: every club in every league, with squads built for this career's seed.
 *
 * The player is a real member of their club's squad rather than a special case bolted on
 * beside it. That is what makes "selection is not guaranteed" fall out naturally — the
 * player is picked by the same `selectBestXV` that picks everyone else, and if they are not
 * good enough for the shirt, they do not get it.
 */

import { LEAGUE_LIST, getLeague } from '../data'
import { buildSquad, teamId } from './generate'
import type { LeagueDef, LeagueId, Player, Team, TeamDef } from '../types/core'
import type { Rng } from './rng'

export interface World {
  seed: number
  teams: readonly Team[]
}

export function createWorld(seed: number, defs: readonly TeamDef[]): World {
  return { seed, teams: defs.map((def) => buildSquad(seed, def)) }
}

export function findTeam(world: World, id: string): Team | undefined {
  return world.teams.find((t) => t.id === id)
}

export function teamsInLeague(world: World, leagueId: LeagueId): Team[] {
  return world.teams.filter((t) => t.leagueId === leagueId)
}

export function leagueOf(world: World, clubId: string): LeagueDef {
  const team = findTeam(world, clubId)
  if (!team) throw new Error(`Unknown club: ${clubId}`)
  return getLeague(team.leagueId)
}

/**
 * Put a player into a club's squad, taking them out of wherever they were.
 * Returns a new world; nothing is mutated.
 */
export function joinClub(world: World, clubId: string, player: Player): World {
  return {
    ...world,
    teams: world.teams.map((team) => {
      const without = team.squad.filter((p) => p.id !== player.id)
      if (team.id === clubId) return { ...team, squad: [...without, player] }
      if (without.length === team.squad.length) return team
      return { ...team, squad: without }
    }),
  }
}

/** Replace a player already in the world — used after progression or a wheel spin. */
export function updatePlayer(world: World, player: Player): World {
  return {
    ...world,
    teams: world.teams.map((team) =>
      team.squad.some((p) => p.id === player.id)
        ? { ...team, squad: team.squad.map((p) => (p.id === player.id ? player : p)) }
        : team,
    ),
  }
}

/**
 * Pick the club a career starts at.
 *
 * SPEC §3: a random club in a random tier-2 league. Tier 1 has to be earned, so it is not
 * in the pool at all.
 */
export function randomStartingClub(world: World, rng: Rng): Team {
  const tierTwo = LEAGUE_LIST.filter((l) => l.tier === 2)
  const league = rng.pick(tierTwo)
  return rng.pick(teamsInLeague(world, league.id))
}

/** Clubs a player could plausibly move to, for the Summer Plans destination cards. */
export function transferCandidates(world: World, excludeClubId: string): Team[] {
  return world.teams.filter((t) => t.id !== excludeClubId)
}

export { teamId }
