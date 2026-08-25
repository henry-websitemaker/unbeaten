/**
 * Cup competitions.
 *
 * The Champions Cup gathers the best clubs from the tier-1 leagues into a straight knockout.
 * SPEC §2.4 expects cups to be measurably more upset-prone than leagues — one bad afternoon
 * ends a cup run, whereas a league gives you eighteen more rounds to put it right — and that
 * difference is produced here by the format, not by a fudge factor.
 */

import { getLeague } from '../data'
import { simulateMatch } from './match'
import { rngFor } from './rng'
import type { LeagueId, Team } from '../types/core'
import type { MatchResult } from '../types/match'

export const CHAMPIONS_CUP_LEAGUES: readonly LeagueId[] = [
  'super_rugby',
  'premiership',
  'top_14',
  'urc',
]

export interface CupEntry {
  team: Team
  /** Where the club finished in its own league — used for seeding. */
  leaguePosition: number
}

export interface CupResult {
  name: string
  championId: string
  finalistIds: string[]
  matches: MatchResult[]
  rounds: number
}

/** Round the field down to a power of two so the bracket is clean. */
function toPowerOfTwo(n: number): number {
  let size = 1
  while (size * 2 <= n) size *= 2
  return size
}

/**
 * Play a knockout cup.
 *
 * Single leg, higher seed at home. There are no second chances, which is precisely what
 * makes a cup a worse guide to who is actually best.
 */
export function simulateCup(
  seed: number,
  season: number,
  name: string,
  entries: readonly CupEntry[],
): CupResult {
  const seeded = [...entries].sort((a, b) => a.leaguePosition - b.leaguePosition)
  const fieldSize = toPowerOfTwo(seeded.length)
  let alive = seeded.slice(0, fieldSize)

  const matches: MatchResult[] = []
  let round = 0

  while (alive.length > 1) {
    round += 1
    const next: CupEntry[] = []

    for (let i = 0; i < alive.length / 2; i++) {
      const home = alive[i]!
      const away = alive[alive.length - 1 - i]!

      const result = simulateMatch({
        seed: seed ^ 0x5eed,
        season,
        // Offset so cup ties never collide with league fixtures in the RNG.
        round: 1000 + round,
        home: home.team,
        away: away.team,
        modifiers: { bigMatch: true },
      })

      matches.push(result)
      // A draw goes to the higher seed.
      next.push(result.winnerId === away.team.id ? away : home)
    }

    alive = next
  }

  const champion = alive[0]
  return {
    name,
    championId: champion?.team.id ?? '',
    finalistIds: matches.length > 0 ? lastTieContestants(matches) : [],
    matches,
    rounds: round,
  }
}

function lastTieContestants(matches: readonly MatchResult[]): string[] {
  const final = matches[matches.length - 1]!
  return [final.home.teamId, final.away.teamId]
}

/**
 * Entries per league, summing exactly to a 16-club bracket.
 *
 * Weighted by league size: the URC (16 clubs) and Top 14 (14) send more than Super Rugby
 * (11) and the Premiership (10), which is what SPEC §2.4 means by the trophy skewing to the
 * strong leagues.
 *
 * The quotas have to sum to a power of two. Taking "the top 45% of each league" and then
 * truncating to 16 looks equivalent but is not: truncation is by league position, so it
 * keeps every league's champion, then every runner-up, and ends up handing all four leagues
 * exactly four places — erasing the very size difference the target depends on.
 */
export const CHAMPIONS_CUP_QUOTAS: Readonly<Record<LeagueId, number>> = {
  urc: 6,
  top_14: 6,
  super_rugby: 2,
  premiership: 2,
  // Tier-2 leagues do not enter.
  shute_shield: 0,
  npc: 0,
  rfu_championship: 0,
  pro_d2: 0,
}

/** Build the Champions Cup field: the leading clubs from each tier-1 league. */
export function buildChampionsCupField(
  standings: ReadonlyMap<LeagueId, readonly { teamId: string; position: number }[]>,
  teamsById: ReadonlyMap<string, Team>,
  perLeague?: ReadonlyMap<LeagueId, number>,
): CupEntry[] {
  const entries: CupEntry[] = []

  for (const leagueId of CHAMPIONS_CUP_LEAGUES) {
    const ladder = standings.get(leagueId)
    if (!ladder) continue

    const league = getLeague(leagueId)
    const quota = Math.min(
      league.teamCount,
      perLeague?.get(leagueId) ?? CHAMPIONS_CUP_QUOTAS[leagueId] ?? 0,
    )

    for (const row of ladder.slice(0, quota)) {
      const team = teamsById.get(row.teamId)
      if (team) entries.push({ team, leaguePosition: row.position })
    }
  }

  return entries
}

/** Which league a cup winner came from — used by the balance assertions. */
export function leagueOfChampion(result: CupResult, teamsById: ReadonlyMap<string, Team>): LeagueId | null {
  return teamsById.get(result.championId)?.leagueId ?? null
}

export function cupSeed(seed: number, season: number): number {
  return rngFor(seed, 'cup', season).int(0, 2 ** 30)
}
