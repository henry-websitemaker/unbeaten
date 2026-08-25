/**
 * Rivalries, from `derbies.json`.
 *
 * A derby raises the temperature: more variance in the result and a lift for the underdog,
 * which is why these fixtures produce upsets out of proportion to the clubs' league form.
 */

import { DERBIES } from '../data'
import type { LeagueId } from '../types/core'

export interface Derby {
  leagueId: LeagueId
  teams: [string, string]
  name: string
  /** 1-10. */
  intensity: number
}

const ALL = DERBIES as unknown as Derby[]

function key(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

const BY_PAIR = new Map<string, Derby>()
for (const derby of ALL) {
  BY_PAIR.set(key(derby.teams[0], derby.teams[1]), derby)
}

/** Look up a rivalry by club *names* — the data keys on names, not ids. */
export function findDerby(homeName: string, awayName: string): Derby | undefined {
  return BY_PAIR.get(key(homeName, awayName))
}

export function derbiesForLeague(leagueId: LeagueId): Derby[] {
  return ALL.filter((d) => d.leagueId === leagueId)
}

export function derbiesForClub(clubName: string): Derby[] {
  return ALL.filter((d) => d.teams.includes(clubName))
}

export const ALL_DERBIES: readonly Derby[] = ALL
