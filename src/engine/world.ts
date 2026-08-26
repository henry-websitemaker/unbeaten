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
import type { LeagueDef, LeagueId, Player, PositionId, Team, TeamDef } from '../types/core'
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
 *
 * When the position is known the club is still random, but weighted towards squads that are
 * thin in that shirt. Selection is not guaranteed — a strong incumbent is entirely possible
 * — but landing behind a settled international at 18 used to end a career before it began:
 * with no game time there is no development, and no way back up the pecking order.
 */
export function randomStartingClub(
  world: World,
  rng: Rng,
  position?: PositionId,
  /** Chosen at creation (SPEC §3). Ignored if it is not a tier-2 league. */
  leagueId?: LeagueId,
): Team {
  const tierTwo = LEAGUE_LIST.filter((l) => l.tier === 2)
  const chosen = leagueId ? tierTwo.find((l) => l.id === leagueId) : undefined
  const league = chosen ?? rng.pick(tierTwo)
  const clubs = teamsInLeague(world, league.id)
  if (!position) return rng.pick(clubs)

  // Weight by how weak the best incumbent in that shirt is. A club whose first choice is 60
  // is a far more attractive place to start than one whose first choice is 72.
  return rng.weighted(clubs, (team) => {
    const incumbent = team.squad
      .filter((p) => p.position === position)
      .reduce((best, p) => Math.max(best, p.ovr), 0)
    return Math.max(1, INCUMBENT_WEIGHT_BASE - incumbent)
  })
}

/**
 * The incumbent OVR at which a club becomes an unattractive place to start.
 *
 * Above this it still draws the minimum weight rather than zero, so no club is impossible.
 */
const INCUMBENT_WEIGHT_BASE = 75

/** Clubs a player could plausibly move to, for the Summer Plans destination cards. */
export function transferCandidates(world: World, excludeClubId: string): Team[] {
  return world.teams.filter((t) => t.id !== excludeClubId)
}

export { teamId }
