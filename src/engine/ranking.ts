/**
 * Where the player stands against everyone playing the game, this season.
 *
 * Built from the same `accumulateSeasonStats` pass that produces the league awards, run
 * across every league's results rather than one. Nothing here re-simulates anything — it
 * reads the world season that has already been played.
 *
 * A minimum-appearances floor keeps the table honest: a player who came on twice and scored
 * would otherwise top the world on rating alone, which is precisely the kind of ranking
 * nobody believes.
 */

import { accumulateSeasonStats, avgRating, type PlayerSeasonStats } from './awards'
import type { SeasonState } from './season'

/** Below this a season is not a season, for ranking purposes. */
export const MIN_APPEARANCES_FOR_RANKING = 5

export interface WorldRanking {
  /** 1 is the best player in the world this season. */
  rank: number
  /** How many players were ranked at all. */
  ranked: number
  /** 0-100, higher is better. */
  percentile: number
  /** The player's own season rating, for the line under the rank. */
  rating: number
  /** False when the player did not play enough to be ranked. */
  eligible: boolean
}

/**
 * Score a season for ranking.
 *
 * Rating first, because it is the one number that survives a bad side, with tries and
 * player-of-the-match awards as the tie-breakers that separate two players rating the same.
 */
export function rankingScore(stats: PlayerSeasonStats): number {
  return avgRating(stats) * 10 + stats.tries * 0.35 + stats.motm * 0.6
}

export function worldRanking(
  seasons: readonly SeasonState[],
  playerId: string,
  ageOf: (id: string) => number = () => 24,
): WorldRanking | null {
  const everyone: PlayerSeasonStats[] = []
  for (const state of seasons) {
    everyone.push(...accumulateSeasonStats(state.results, ageOf).values())
  }

  const player = everyone.find((s) => s.playerId === playerId)
  if (!player) return null

  const eligible = everyone.filter((s) => s.appearances >= MIN_APPEARANCES_FOR_RANKING)
  const playerEligible = player.appearances >= MIN_APPEARANCES_FOR_RANKING

  // An ineligible player is still shown a rank, measured against the same field, so the
  // screen never has to say nothing at all — it just says why it does not count.
  const field = playerEligible ? eligible : [...eligible, player]
  const scored = field
    .map((s) => ({ id: s.playerId, score: rankingScore(s) }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))

  const index = scored.findIndex((s) => s.id === playerId)
  const rank = index + 1

  return {
    rank,
    ranked: scored.length,
    percentile:
      scored.length <= 1 ? 100 : Math.round(((scored.length - rank) / (scored.length - 1)) * 100),
    rating: Math.round(avgRating(player) * 100) / 100,
    eligible: playerEligible,
  }
}
