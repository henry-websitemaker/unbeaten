/**
 * League table.
 *
 * Standard rugby union scoring: 4 for a win, 2 for a draw, plus the two bonus points
 * defined per league in `leagues.json` — one for scoring enough tries, one for losing
 * narrowly. Both thresholds are read from the data.
 */

import { getLeague } from '../data'
import type { MatchResult } from '../types/match'

export const WIN_POINTS = 4
export const DRAW_POINTS = 2

export interface LadderRow {
  teamId: string
  played: number
  won: number
  drawn: number
  lost: number
  pointsFor: number
  pointsAgainst: number
  /** Points difference — the first tiebreak. */
  pointsDifference: number
  triesFor: number
  triesAgainst: number
  tryBonuses: number
  losingBonuses: number
  bonusPoints: number
  points: number
  /** 1-based, assigned after sorting. */
  position: number
}

function emptyRow(teamId: string): LadderRow {
  return {
    teamId,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    pointsDifference: 0,
    triesFor: 0,
    triesAgainst: 0,
    tryBonuses: 0,
    losingBonuses: 0,
    bonusPoints: 0,
    points: 0,
    position: 0,
  }
}

/**
 * Build the table from a set of results.
 *
 * `teamIds` is passed explicitly so clubs that have not played yet still appear — a table
 * that hides winless clubs is wrong, and it matters in round 1.
 */
export function buildLadder(
  teamIds: readonly string[],
  results: readonly MatchResult[],
  deductions?: ReadonlyMap<string, number>,
): LadderRow[] {
  const rows = new Map<string, LadderRow>()
  for (const id of teamIds) rows.set(id, emptyRow(id))

  for (const result of results) {
    for (const side of [result.home, result.away] as const) {
      const opponent = side === result.home ? result.away : result.home
      const row = rows.get(side.teamId)
      if (!row) continue

      row.played += 1
      row.pointsFor += side.score
      row.pointsAgainst += opponent.score
      row.triesFor += side.tries
      row.triesAgainst += opponent.tries

      if (result.winnerId === null) {
        row.drawn += 1
        row.points += DRAW_POINTS
      } else if (result.winnerId === side.teamId) {
        row.won += 1
        row.points += WIN_POINTS
      } else {
        row.lost += 1
      }

      row.bonusPoints += side.bonusPoints
      row.points += side.bonusPoints

      // Split the combined bonus into its two kinds, for display in the table.
      const thresholds = getLeague(result.leagueId).bonusPoints
      if (side.tries >= thresholds.tryBonus) row.tryBonuses += 1
      const margin = opponent.score - side.score
      if (margin > 0 && margin <= thresholds.losingBonus) row.losingBonuses += 1
    }
  }

  for (const [teamId, penalty] of deductions ?? []) {
    const row = rows.get(teamId)
    if (row) row.points -= penalty
  }

  for (const row of rows.values()) {
    row.pointsDifference = row.pointsFor - row.pointsAgainst
  }

  return sortLadder([...rows.values()])
}

/**
 * Sort into finishing order: points, then points difference, then tries scored, then
 * points scored. The club id breaks any remaining tie so the order is stable.
 */
export function sortLadder(rows: LadderRow[]): LadderRow[] {
  const sorted = rows.slice().sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    if (b.pointsDifference !== a.pointsDifference) return b.pointsDifference - a.pointsDifference
    if (b.triesFor !== a.triesFor) return b.triesFor - a.triesFor
    if (b.pointsFor !== a.pointsFor) return b.pointsFor - a.pointsFor
    return a.teamId.localeCompare(b.teamId)
  })

  sorted.forEach((row, index) => {
    row.position = index + 1
  })

  return sorted
}

export function ladderPosition(ladder: readonly LadderRow[], teamId: string): number {
  return ladder.find((row) => row.teamId === teamId)?.position ?? ladder.length
}

export function ladderRow(ladder: readonly LadderRow[], teamId: string): LadderRow | undefined {
  return ladder.find((row) => row.teamId === teamId)
}

/** A club that wins every match it plays has gone unbeaten — the whole point. */
export function isPerfect(row: LadderRow): boolean {
  return row.played > 0 && row.won === row.played
}
