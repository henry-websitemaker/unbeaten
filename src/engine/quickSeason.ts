/**
 * Quick Season.
 *
 * Draft an XV, play one season, chase the perfect record, restart. No budget, no contracts,
 * no saves — SPEC §3 is explicit that this mode keeps nothing.
 */

import { LEAGUE_LIST, POSITIONS, getLeague } from '../data'
import { computeOvr } from './ovr'
import { teamId } from './generate'
import { rngFor, type Rng } from './rng'
import { createSeason, isPerfectSeason, seasonWins, type SeasonState } from './season'
import { teamsInLeague, type World } from './world'
import { POSITION_IDS, type LeagueId, type Player, type PositionId, type Team } from '../types/core'

export const QUICK_SEASON_TEAM_ID = 'quick:your-xv'

export interface DraftPick {
  slot: PositionId
  options: Player[]
}

/**
 * Build the draft: three candidates for each of the fifteen shirts.
 *
 * Candidates are real players from the recovered rosters, so the XV is assembled from
 * recognisable names rather than generated filler.
 */
export function buildDraft(world: World, rng: Rng, optionsPerSlot = 3): DraftPick[] {
  return POSITION_IDS.map((slot) => {
    const eligible = world.teams
      .flatMap((t) => t.squad)
      .filter((p) => POSITIONS[p.position].canPlayAt.includes(slot))

    const options = rng.shuffle(eligible).slice(0, optionsPerSlot)
    return { slot, options }
  })
}

/** Turn a completed draft into a club. */
export function buildDraftedTeam(picks: readonly Player[], leagueId: LeagueId, name = 'Your XV'): Team {
  return {
    id: QUICK_SEASON_TEAM_ID,
    name,
    shortName: 'XV',
    leagueId,
    squad: picks.map((p, index) => ({ ...p, id: `${QUICK_SEASON_TEAM_ID}:${index}` })),
  }
}

export interface QuickSeasonSetup {
  seed: number
  leagueId: LeagueId
  team: Team
  season: SeasonState
}

/**
 * Start a Quick Season.
 *
 * The drafted XV replaces one club in the chosen league so the fixture list and ladder stay
 * exactly the right size — a league with an extra club would have the wrong round count,
 * which SPEC §2.3 does not allow.
 */
export function startQuickSeason(
  world: World,
  seed: number,
  leagueId: LeagueId,
  drafted: Team,
): QuickSeasonSetup {
  const rng = rngFor(seed, 'quick-season', leagueId)
  const league = getLeague(leagueId)

  const existing = teamsInLeague(world, leagueId)
  // Displace a random club rather than always the same one.
  const displaced = rng.pick(existing)
  const teams = existing.map((t) => (t.id === displaced.id ? { ...drafted, leagueId } : t))

  if (teams.length !== league.teamCount) {
    throw new Error(
      `Quick Season built ${teams.length} clubs for ${leagueId}, which expects ${league.teamCount}`,
    )
  }

  return {
    seed,
    leagueId,
    team: { ...drafted, leagueId },
    season: createSeason(seed, 1, leagueId, teams),
  }
}

export interface QuickSeasonResult {
  wins: number
  target: number
  perfect: boolean
  champion: boolean
  shareText: string
}

/** The result screen, and the line the player shares. */
export function summariseQuickSeason(season: SeasonState, teamIdToCheck = QUICK_SEASON_TEAM_ID): QuickSeasonResult {
  const league = getLeague(season.leagueId)
  const wins = seasonWins(season, teamIdToCheck)
  const played = season.fixtures.filter(
    (f) => f.homeId === teamIdToCheck || f.awayId === teamIdToCheck,
  ).length
  const target = played + league.finalsRounds
  const perfect = isPerfectSeason(season, teamIdToCheck)
  const champion = season.championId === teamIdToCheck

  const shareText = perfect
    ? `Unbeaten. ${wins}/${target} in the ${league.name}. Nobody laid a glove on us.`
    : `${wins}/${target} in the ${league.name}${champion ? ' — champions, but not unbeaten.' : '.'}`

  return { wins, target, perfect, champion, shareText }
}

/** Leagues offered for a Quick Season. */
export function selectableLeagues(): { id: LeagueId; name: string; rounds: number; tier: 1 | 2 }[] {
  return LEAGUE_LIST.map((l) => ({ id: l.id, name: l.name, rounds: l.rounds, tier: l.tier }))
}

/** The drafted XV's overall standard, for the pre-season readout. */
export function draftStrength(team: Team): number {
  if (team.squad.length === 0) return 0
  return Math.round(
    team.squad.reduce((total, p) => total + computeOvr(p.stats, p.position), 0) / team.squad.length,
  )
}

export { teamId }
