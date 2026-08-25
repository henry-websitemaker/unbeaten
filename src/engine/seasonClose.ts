/**
 * What happens to a player at the end of a season, beyond the club game.
 *
 * `awards.ts` and `internationals.ts` were both written, tested and then left unimported —
 * the career never played a test match and never won anything. This is the layer that joins
 * them to the season boundary.
 *
 * It takes the player's id as an argument rather than importing `PLAYER_ID`, so that
 * `career.ts` can depend on this module without the two importing each other.
 */

import {
  accumulateSeasonStats,
  computeLeagueAwards,
  computeWorldPlayer,
  nearMissFor,
  type AwardResult,
  type NearMiss,
  type WorldPlayerCandidate,
  type WorldPlayerResult,
} from './awards'
import {
  assessSelection,
  getNation,
  isWorldCupSeason,
  simulateInternationalSeason,
  type InternationalSeason,
  type SelectionVerdict,
  type TournamentResult,
} from './internationals'
import { rngFor } from './rng'
import type { LeagueId, Team } from '../types/core'
import type { MatchResult } from '../types/match'
import type { AwardWin, Trophy } from '../types/career'

// ---------------------------------------------------------------------------
// Internationals
// ---------------------------------------------------------------------------

export interface InternationalOutcome {
  nationId: string
  nationName: string
  verdict: SelectionVerdict
  /** The player's own test season. Null when they were not picked. */
  season: InternationalSeason | null
  /**
   * The tournament itself, which happens whether or not the player is in it. A World Cup
   * still has a winner in a season the player watched from home.
   */
  worldCup: TournamentResult | null
  /** Silverware won *by the player*, so an unselected season yields nothing. */
  trophies: Trophy[]
  caps: number
  tries: number
}

export interface InternationalInput {
  seed: number
  season: number
  nationId: string
  ovr: number
  /** Mean match rating across the recent form window, not the whole season. */
  formRating: number
  existingCaps: number
}

/**
 * Decide selection, then play the international season out.
 *
 * The tournament is simulated either way. Only the caps, tries and trophies are withheld
 * when the player is not picked — the world does not stop because you had a poor season.
 */
export function computeInternationals(input: InternationalInput): InternationalOutcome {
  const nation = getNation(input.nationId)
  const verdict = assessSelection({
    nationId: input.nationId,
    ovr: input.ovr,
    formRating: input.formRating,
    existingCaps: input.existingCaps,
  })

  const rng = rngFor(input.seed, 'intl', input.season)
  const played = simulateInternationalSeason(rng, nation, input.season, input.ovr)

  // `simulateInternationalSeason` runs the World Cup internally, so the result is here for
  // the banner even when none of the caps are credited.
  const worldCup = isWorldCupSeason(input.season) ? played.worldCup : null

  if (!verdict.selected) {
    return {
      nationId: nation.id,
      nationName: nation.name,
      verdict,
      season: null,
      worldCup,
      trophies: [],
      caps: 0,
      tries: 0,
    }
  }

  const trophies: Trophy[] = played.competitions
    .filter((competition) => competition.won)
    .map((competition) => ({
      season: input.season,
      // `internationals.json` already names the World Cup "World Cup", which is the string
      // the `wc_winner` achievement matches on. Taking the name from the data keeps the two
      // from drifting apart.
      name: competition.name,
      type: 'international' as const,
      clubOrNation: nation.name,
    }))

  return {
    nationId: nation.id,
    nationName: nation.name,
    verdict,
    season: played,
    worldCup,
    trophies,
    caps: played.caps,
    tries: played.tries,
  }
}

/**
 * The rating a selector actually looks at: the last few games, not the season average.
 *
 * `SelectionInput.formRating` documents itself as "mean rating across the recent form
 * window", so a player who started badly and finished strongly gets judged on the finish.
 */
export const FORM_WINDOW = 6

export function recentFormRating(ratings: readonly number[]): number {
  if (ratings.length === 0) return 0
  const window = ratings.slice(-FORM_WINDOW)
  return window.reduce((total, rating) => total + rating, 0) / window.length
}

// ---------------------------------------------------------------------------
// Awards
// ---------------------------------------------------------------------------

export interface SeasonAwards {
  /** Every league award, whoever won it. */
  league: AwardResult[]
  /** The ones the player won, ready to append to `career.awards`. */
  playerWins: AwardWin[]
  /** SPEC §3's near-miss line, when the player placed 2nd or 3rd. */
  nearMissTries: NearMiss | null
  nearMissPoints: NearMiss | null
  worldPlayer: WorldPlayerResult
}

export interface AwardsInput {
  seed: number
  season: number
  leagueId: LeagueId
  /**
   * Regular-season results only, so the award tables describe the same set of matches as
   * the season record the player is shown alongside them.
   */
  results: readonly MatchResult[]
  teams: readonly Team[]
  playerId: string
  /** Null when the player played no part — an injured season, or no club. */
  playerCandidate: Omit<WorldPlayerCandidate, 'isPlayer' | 'playerId'> | null
}

export function computeSeasonAwards(input: AwardsInput): SeasonAwards {
  const ages = new Map<string, number>()
  for (const team of input.teams) {
    for (const player of team.squad) ages.set(player.id, player.age)
  }

  const stats = accumulateSeasonStats(input.results, (id) => ages.get(id) ?? 24)
  const league = computeLeagueAwards(stats)

  const candidate: WorldPlayerCandidate | null = input.playerCandidate
    ? { ...input.playerCandidate, playerId: input.playerId, isPlayer: true }
    : null
  const worldPlayer = computeWorldPlayer(input.seed, input.season, candidate)

  const playerWins: AwardWin[] = []
  for (const award of league) {
    const won =
      award.id === 'team_of_season'
        ? (award.squad ?? []).some((slot) => slot.playerId === input.playerId)
        : award.winnerId === input.playerId
    if (won) {
      playerWins.push({
        season: input.season,
        type: award.id,
        name: award.name,
        leagueId: input.leagueId,
      })
    }
  }

  if (worldPlayer.playerWon) {
    playerWins.push({
      season: input.season,
      type: 'world_player',
      name: 'World Player of the Year',
    })
  }

  return {
    league,
    playerWins,
    nearMissTries: nearMissFor(stats, input.playerId, 'top_try_scorer'),
    nearMissPoints: nearMissFor(stats, input.playerId, 'top_points_scorer'),
    worldPlayer,
  }
}
