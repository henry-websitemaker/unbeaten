/**
 * Typed access to `cups.json`.
 *
 * Separate from `cups.ts` — which is the knockout *engine* and knows nothing about which
 * competitions exist — so the engine stays a pure bracket simulator and the competition list
 * stays data, the way every other content table in this project is stored.
 */

import { CUPS } from '../data'
import type { LeagueId } from '../types/core'

export interface DomesticCupDef {
  name: string
  /** How many clubs enter, taken from the top of the league table. */
  teams: number
}

interface CupData {
  championsCup: { id: string; name: string }
  domestic: Record<string, DomesticCupDef>
}

const DATA = CUPS as unknown as CupData

export const DOMESTIC_CUPS = DATA.domestic as Record<LeagueId, DomesticCupDef | undefined>

export function championsCupName(): string {
  return DATA.championsCup.name
}

export function domesticCupName(leagueId: LeagueId): string | null {
  return DOMESTIC_CUPS[leagueId]?.name ?? null
}
