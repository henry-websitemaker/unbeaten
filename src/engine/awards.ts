/**
 * Season awards.
 *
 * The one that matters is World Player of the Year. SPEC §3 asks for it to be computed
 * against a *simulated elite pool* with hard eligibility floors, changing nominees each
 * season, a one-line justification per nominee, and a rookie almost never winning. Handing
 * it to whoever the player happens to be would make it worthless.
 */

import { AWARDS, getLeague } from '../data'
import { rngFor, type Rng } from './rng'
import type { LeagueId, PositionId } from '../types/core'
import type { MatchResult, PlayerMatchLine } from '../types/match'

export interface AwardDef {
  id: string
  name: string
  scope: 'league' | 'global'
  metric: string
  maxAge?: number
  slots?: number
}

interface AwardsData {
  seasonAwards: AwardDef[]
  worldPlayerEligibility: {
    minInternationalCaps: number
    minAppearances: number
    minAvgRating: number
    elitePoolSize: number
  }
  nearMiss: { topTryScorer: string }
  achievementGrid: { categories: string[] }
}

const DATA = AWARDS as unknown as AwardsData

export const AWARD_DEFS: readonly AwardDef[] = DATA.seasonAwards
export const WORLD_PLAYER_ELIGIBILITY = DATA.worldPlayerEligibility

/** Season totals for one player, accumulated from match lines. */
export interface PlayerSeasonStats {
  playerId: string
  playerName: string
  teamId: string
  slot: PositionId
  age: number
  appearances: number
  tries: number
  points: number
  totalRating: number
  motm: number
}

export function accumulateSeasonStats(
  results: readonly MatchResult[],
  ageOf: (playerId: string) => number,
): Map<string, PlayerSeasonStats> {
  const stats = new Map<string, PlayerSeasonStats>()

  const touch = (line: PlayerMatchLine): PlayerSeasonStats => {
    let entry = stats.get(line.playerId)
    if (!entry) {
      entry = {
        playerId: line.playerId,
        playerName: line.playerName,
        teamId: line.teamId,
        slot: line.slot,
        age: ageOf(line.playerId),
        appearances: 0,
        tries: 0,
        points: 0,
        totalRating: 0,
        motm: 0,
      }
      stats.set(line.playerId, entry)
    }
    return entry
  }

  for (const result of results) {
    for (const line of result.players) {
      const entry = touch(line)
      entry.appearances += 1
      entry.tries += line.tries
      entry.points += line.tries * 5 + line.kickPoints
      entry.totalRating += line.rating
      if (result.motmPlayerId === line.playerId) entry.motm += 1
    }
  }

  return stats
}

export function avgRating(stats: PlayerSeasonStats): number {
  return stats.appearances === 0 ? 0 : stats.totalRating / stats.appearances
}

// ---------------------------------------------------------------------------
// League awards
// ---------------------------------------------------------------------------

export interface AwardResult {
  id: string
  name: string
  winnerId: string
  winnerName: string
  value: number
  /** Populated for Team of the Season. */
  squad?: { slot: PositionId; playerId: string; playerName: string }[]
}

/** The near-miss line SPEC §3 asks for when the player places 2nd or 3rd. */
export interface NearMiss {
  awardId: string
  placed: number
  behindBy: number
  leaderName: string
  message: string
}

function best(
  entries: readonly PlayerSeasonStats[],
  score: (s: PlayerSeasonStats) => number,
): PlayerSeasonStats[] {
  return [...entries].sort((a, b) => {
    const diff = score(b) - score(a)
    if (diff !== 0) return diff
    // Stable and deterministic.
    return a.playerId.localeCompare(b.playerId)
  })
}

/** Minimum appearances to be considered for a rating-based award. */
const MIN_APPEARANCES_FOR_RATING_AWARD = 6

export function computeLeagueAwards(
  stats: ReadonlyMap<string, PlayerSeasonStats>,
): AwardResult[] {
  const all = [...stats.values()]
  if (all.length === 0) return []

  const results: AwardResult[] = []
  const rated = all.filter((s) => s.appearances >= MIN_APPEARANCES_FOR_RATING_AWARD)
  const ratingPool = rated.length > 0 ? rated : all

  const topTries = best(all, (s) => s.tries)[0]
  if (topTries) {
    results.push({
      id: 'top_try_scorer',
      name: 'Top Try Scorer',
      winnerId: topTries.playerId,
      winnerName: topTries.playerName,
      value: topTries.tries,
    })
  }

  const topPoints = best(all, (s) => s.points)[0]
  if (topPoints) {
    results.push({
      id: 'top_points_scorer',
      name: 'Top Points Scorer',
      winnerId: topPoints.playerId,
      winnerName: topPoints.playerName,
      value: topPoints.points,
    })
  }

  const playersPlayer = best(ratingPool, avgRating)[0]
  if (playersPlayer) {
    results.push({
      id: 'players_player',
      name: "Players' Player of the Year",
      winnerId: playersPlayer.playerId,
      winnerName: playersPlayer.playerName,
      value: Math.round(avgRating(playersPlayer) * 100) / 100,
    })
  }

  const youngDef = AWARD_DEFS.find((a) => a.id === 'young_player')
  const maxAge = youngDef?.maxAge ?? 23
  const youngPool = ratingPool.filter((s) => s.age <= maxAge)
  const youngPlayer = best(youngPool, avgRating)[0]
  if (youngPlayer) {
    results.push({
      id: 'young_player',
      name: 'Young Player of the Year',
      winnerId: youngPlayer.playerId,
      winnerName: youngPlayer.playerName,
      value: Math.round(avgRating(youngPlayer) * 100) / 100,
    })
  }

  // Team of the Season: the best player in each shirt.
  const bySlot = new Map<PositionId, PlayerSeasonStats>()
  for (const entry of ratingPool) {
    const current = bySlot.get(entry.slot)
    if (!current || avgRating(entry) > avgRating(current)) bySlot.set(entry.slot, entry)
  }
  results.push({
    id: 'team_of_season',
    name: 'Team of the Season',
    winnerId: '',
    winnerName: '',
    value: bySlot.size,
    squad: [...bySlot.entries()].map(([slot, s]) => ({
      slot,
      playerId: s.playerId,
      playerName: s.playerName,
    })),
  })

  // Try of the Season: a highlight score, weighted towards players who scored a lot at pace.
  const highlight = best(all, (s) => s.tries * 2 + avgRating(s))[0]
  if (highlight && highlight.tries > 0) {
    results.push({
      id: 'try_of_season',
      name: 'Try of the Season',
      winnerId: highlight.playerId,
      winnerName: highlight.playerName,
      value: highlight.tries,
    })
  }

  return results
}

/**
 * Where a player placed, and by how much they missed.
 *
 * SPEC §3 wants "finished 2 tries behind X" when the player is 2nd or 3rd — the near miss
 * is more interesting than a silent absence.
 */
export function nearMissFor(
  stats: ReadonlyMap<string, PlayerSeasonStats>,
  playerId: string,
  awardId: 'top_try_scorer' | 'top_points_scorer' = 'top_try_scorer',
): NearMiss | null {
  const all = [...stats.values()]
  const score = (s: PlayerSeasonStats) => (awardId === 'top_try_scorer' ? s.tries : s.points)
  const ranked = best(all, score)

  const index = ranked.findIndex((s) => s.playerId === playerId)
  if (index < 1 || index > 2) return null

  const player = ranked[index]!
  const leader = ranked[0]!
  const behindBy = score(leader) - score(player)
  if (behindBy <= 0) return null

  // "try" pluralises to "tries", not "trys" — SPEC §3 quotes this line verbatim.
  const unit =
    awardId === 'top_try_scorer'
      ? behindBy === 1
        ? 'try'
        : 'tries'
      : behindBy === 1
        ? 'point'
        : 'points'

  return {
    awardId,
    placed: index + 1,
    behindBy,
    leaderName: leader.playerName,
    message: `Finished ${behindBy} ${unit} behind ${leader.playerName}.`,
  }
}

// ---------------------------------------------------------------------------
// World Player of the Year
// ---------------------------------------------------------------------------

export interface WorldPlayerNominee {
  playerId: string
  playerName: string
  clubName: string
  leagueId: LeagueId
  appearances: number
  tries: number
  internationalCaps: number
  avgRating: number
  score: number
  /** One line explaining the case for this nominee. */
  justification: string
  isPlayer: boolean
}

export interface WorldPlayerResult {
  nominees: WorldPlayerNominee[]
  winner: WorldPlayerNominee | null
  /** True when the career player met the floors and made the shortlist. */
  playerNominated: boolean
  playerWon: boolean
}

export interface WorldPlayerCandidate {
  playerId: string
  playerName: string
  clubName: string
  leagueId: LeagueId
  appearances: number
  tries: number
  internationalCaps: number
  avgRating: number
  trophies: number
  isPlayer: boolean
}

export function meetsWorldPlayerFloors(candidate: WorldPlayerCandidate): boolean {
  const floors = WORLD_PLAYER_ELIGIBILITY
  return (
    candidate.internationalCaps >= floors.minInternationalCaps &&
    candidate.appearances >= floors.minAppearances &&
    candidate.avgRating >= floors.minAvgRating
  )
}

/**
 * Score a candidate.
 *
 * Weighted so that sustained high performance at a strong club with a full test season wins
 * it — which is why a rookie in a tier-2 league, who almost never clears the caps floor,
 * almost never wins.
 */
export function worldPlayerScore(candidate: WorldPlayerCandidate): number {
  const league = getLeague(candidate.leagueId)
  const leaguePrestige = league.tier === 1 ? 1 : 0.72

  return (
    candidate.avgRating * 10 * leaguePrestige +
    candidate.tries * 0.9 +
    candidate.internationalCaps * 0.55 +
    candidate.trophies * 4 +
    Math.min(candidate.appearances, 30) * 0.12
  )
}

function justify(candidate: WorldPlayerCandidate): string {
  const parts: string[] = []
  parts.push(`${candidate.avgRating.toFixed(1)} average across ${candidate.appearances} games`)
  if (candidate.tries > 0) parts.push(`${candidate.tries} tries`)
  if (candidate.internationalCaps > 0) parts.push(`${candidate.internationalCaps} caps`)
  if (candidate.trophies > 0) {
    parts.push(`${candidate.trophies} ${candidate.trophies === 1 ? 'trophy' : 'trophies'}`)
  }
  return parts.join(', ') + '.'
}

/**
 * Build the simulated elite pool.
 *
 * These are the world's best players in a given season, generated fresh each time so the
 * shortlist changes rather than being the same five names for twenty years.
 */
export function simulateElitePool(
  seed: number,
  season: number,
  size = WORLD_PLAYER_ELIGIBILITY.elitePoolSize,
): WorldPlayerCandidate[] {
  const rng = rngFor(seed, 'elite-pool', season)
  const tierOne: LeagueId[] = ['super_rugby', 'premiership', 'top_14', 'urc']

  return Array.from({ length: size }, (_, index) => {
    const leagueId = rng.pick(tierOne)
    const caps = rng.int(4, 14)
    return {
      playerId: `elite:${season}:${index}`,
      playerName: elitePoolName(rng),
      clubName: getLeague(leagueId).name,
      leagueId,
      appearances: rng.int(14, 26),
      tries: rng.int(0, 14),
      internationalCaps: caps,
      avgRating: Math.round(rng.float(7.3, 8.8) * 100) / 100,
      trophies: rng.bool(0.25) ? 1 : 0,
      isPlayer: false,
    }
  })
}

const ELITE_FIRST = [
  'Ardie', 'Antoine', 'Caelan', 'Damian', 'Eben', 'Finn', 'Handre', 'Jac', 'Kwagga', 'Louis',
  'Maro', 'Pieter-Steph', 'Romain', 'Siya', 'Tadhg', 'Will',
]
const ELITE_LAST = [
  'Aumua', 'Barrett-Lowe', 'Cheslin', 'Dupont-Marchand', 'Etzebeth-Roux', 'Furlong-Healy',
  'Gatland', 'Hooper', 'Itoje', 'Jordan', 'Kolisi', 'Lowe', 'Meafou', 'Ntamack', 'Ospreys',
  'Porter',
]

function elitePoolName(rng: Rng): string {
  return `${rng.pick(ELITE_FIRST)} ${rng.pick(ELITE_LAST)}`
}

/**
 * Decide World Player of the Year.
 *
 * The career player is judged on exactly the same floors and the same score as the pool.
 */
export function computeWorldPlayer(
  seed: number,
  season: number,
  playerCandidate: WorldPlayerCandidate | null,
  shortlistSize = 5,
): WorldPlayerResult {
  const pool = simulateElitePool(seed, season)
  const field = playerCandidate ? [...pool, playerCandidate] : pool

  const eligible = field.filter(meetsWorldPlayerFloors)
  if (eligible.length === 0) {
    return { nominees: [], winner: null, playerNominated: false, playerWon: false }
  }

  const scored = eligible
    .map((candidate) => ({
      playerId: candidate.playerId,
      playerName: candidate.playerName,
      clubName: candidate.clubName,
      leagueId: candidate.leagueId,
      appearances: candidate.appearances,
      tries: candidate.tries,
      internationalCaps: candidate.internationalCaps,
      avgRating: candidate.avgRating,
      score: worldPlayerScore(candidate),
      justification: justify(candidate),
      isPlayer: candidate.isPlayer,
    }))
    .sort((a, b) => b.score - a.score || a.playerId.localeCompare(b.playerId))

  const nominees = scored.slice(0, shortlistSize)
  const winner = nominees[0] ?? null

  return {
    nominees,
    winner,
    playerNominated: nominees.some((n) => n.isPlayer),
    playerWon: winner?.isPlayer === true,
  }
}
