/**
 * Typed access to the recovered data layer.
 *
 * The small files are imported statically (~25KB combined). `teams.json` is 190KB raw and
 * is loaded on demand instead, so it never lands in the entry chunk — see SPEC §6's bundle
 * budget. Nothing here mutates the imported JSON; callers get frozen views.
 */

import positionsJson from './positions.json'
import leaguesJson from './leagues.json'
import archetypesJson from './archetypes.json'
import wheelJson from './wheel-outcomes.json'
import lifestyleJson from './lifestyle.json'
import eventsJson from './events.json'
import derbiesJson from './derbies.json'
import awardsJson from './awards.json'
import achievementsJson from './achievements.json'
import internationalsJson from './internationals.json'
import trainingJson from './training.json'
import cupsJson from './cups.json'
import balanceJson from './balance-targets.json'

import {
  POSITION_IDS,
  type LeagueDef,
  type LeagueId,
  type PositionDef,
  type PositionId,
  type PositionRules,
  type TeamDef,
} from '../types/core'

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

/** positions.json mixes the 15 positions with a `_rules` metadata block. */
const rawPositions = positionsJson as unknown as Record<string, unknown>

export const POSITION_RULES = rawPositions._rules as PositionRules

export const POSITIONS: Readonly<Record<PositionId, PositionDef>> = Object.freeze(
  Object.fromEntries(
    POSITION_IDS.map((id) => [id, rawPositions[id] as PositionDef]),
  ) as Record<PositionId, PositionDef>,
)

export const POSITION_LIST: readonly PositionDef[] = Object.freeze(
  POSITION_IDS.map((id) => POSITIONS[id]),
)

/** The bonus a key stat gets at creation, e.g. `[4, 6]` (SPEC §2.6). */
export const KEY_STAT_CREATION_BONUS = POSITION_RULES.creationKeyStatBonus
/** How much a key stat counts for in the engine, e.g. `2.5` (SPEC §2.6). */
export const KEY_STAT_ENGINE_WEIGHT = POSITION_RULES.keyStatEngineWeight

export function getPosition(id: PositionId): PositionDef {
  return POSITIONS[id]
}

// ---------------------------------------------------------------------------
// Leagues
// ---------------------------------------------------------------------------

export const LEAGUES = leaguesJson as unknown as Readonly<Record<LeagueId, LeagueDef>>

export const LEAGUE_LIST: readonly LeagueDef[] = Object.freeze(Object.values(LEAGUES))

export function getLeague(id: LeagueId): LeagueDef {
  const league = LEAGUES[id]
  if (!league) throw new Error(`Unknown league: ${id}`)
  return league
}

export const TIER_ONE_LEAGUES: readonly LeagueDef[] = LEAGUE_LIST.filter((l) => l.tier === 1)
export const TIER_TWO_LEAGUES: readonly LeagueDef[] = LEAGUE_LIST.filter((l) => l.tier === 2)

// ---------------------------------------------------------------------------
// Everything else
// ---------------------------------------------------------------------------

export const ARCHETYPES = archetypesJson
export const WHEEL = wheelJson
export const LIFESTYLE = lifestyleJson
export const EVENTS = eventsJson
export const DERBIES = derbiesJson
export const AWARDS = awardsJson
export const ACHIEVEMENTS = achievementsJson
export const INTERNATIONALS = internationalsJson
export const TRAINING = trainingJson
export const CUPS = cupsJson
export const BALANCE_TARGETS = balanceJson

// ---------------------------------------------------------------------------
// Teams — loaded on demand
// ---------------------------------------------------------------------------

let teamsCache: readonly TeamDef[] | null = null

/**
 * Load the 99 recovered clubs. Cached after the first call.
 *
 * Note that only the 51 tier-1 clubs carry rosters; the 48 tier-2 clubs are empty in the
 * recovered data and have their squads generated — see `engine/generate.ts`.
 */
export async function loadTeams(): Promise<readonly TeamDef[]> {
  if (teamsCache) return teamsCache
  const mod = await import('./teams.json')
  teamsCache = Object.freeze(mod.default as unknown as TeamDef[])
  return teamsCache
}

/** Test/preload hook — lets synchronous engine code run once teams are in memory. */
export function peekTeams(): readonly TeamDef[] | null {
  return teamsCache
}
