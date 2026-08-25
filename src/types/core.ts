/**
 * Core domain types. These mirror the recovered `src/data/*.json` shapes exactly —
 * if a type here disagrees with the data, the data wins and the type is wrong.
 */

/** The eleven stats. Forwards and backs use different subsets. */
export const STAT_KEYS = [
  'SCR', // scrum
  'LNO', // lineout
  'CAR', // carry
  'TCK', // tackle
  'RUK', // ruck
  'FIT', // fitness
  'PAC', // pace
  'HND', // handling
  'VIS', // vision
  'KCK', // kicking
  'EVA', // evasion
] as const
export type StatKey = (typeof STAT_KEYS)[number]

/** A stat block is always partial — a prop has no EVA, a winger has no SCR. */
export type StatBlock = Partial<Record<StatKey, number>>

/** The fifteen shirts. `LK1`/`LK2` are the two locks, `WL`/`WR` the two wings. */
export const POSITION_IDS = [
  'LHP', 'HOO', 'THP', 'LK1', 'LK2', 'BF', 'OF', 'N8',
  'SH', 'FH', 'IC', 'OC', 'WL', 'WR', 'FB',
] as const
export type PositionId = (typeof POSITION_IDS)[number]

export type StatSet = 'forward' | 'back' | 'hybrid'

/** The three broad archetype cards shown at creation (SPEC §3). */
export type PositionGroup = 'FWD' | 'HLF' | 'BCK'

export interface PositionDef {
  id: PositionId
  name: string
  number: number
  statSet: StatSet
  /** Strict eligibility — a hooker can only ever play hooker. */
  canPlayAt: PositionId[]
  ovrWeights: Partial<Record<StatKey, number>>
  statRanges: Partial<Record<StatKey, [number, number]>>
  /** The three stats that start +4..+6 high and carry 2.5x engine weight (SPEC §2.6). */
  keyStats: StatKey[]
}

/** The `_rules` block that sits alongside the positions in positions.json. */
export interface PositionRules {
  keyStats: string
  creationKeyStatBonus: [number, number]
  keyStatEngineWeight: number
}

export const LEAGUE_IDS = [
  'super_rugby', 'premiership', 'top_14', 'urc',
  'shute_shield', 'npc', 'rfu_championship', 'pro_d2',
] as const
export type LeagueId = (typeof LEAGUE_IDS)[number]

export type FinalsFormat = 'finals' | 'playoffs' | 'none'
export type PhysicalityBias = 'forward' | 'back' | 'balanced'

export interface LeagueDef {
  id: LeagueId
  name: string
  tier: 1 | 2
  teamCount: number
  /** Regular-season rounds. SPEC §2.3: never hardcoded, always read from here. */
  rounds: number
  /** Wins needed for a perfect season — equals `rounds + finalsRounds`. */
  perfectTarget: number
  physicalityBias: PhysicalityBias
  wageBudgetBase: number
  prizePool: number
  finalsFormat: FinalsFormat
  finalsRounds: number
  bonusPoints: { tryBonus: number; losingBonus: number }
  promotionRelegation: { promotesTo: LeagueId; spots: number } | null
}

/** A roster entry as it appears in teams.json (no id — ids are synthesised on load). */
export interface RosterEntry {
  name: string
  position: PositionId
  age: number
  stats: StatBlock
}

export interface TeamDef {
  name: string
  shortName: string
  leagueId: LeagueId
  roster: RosterEntry[]
}

/** A player once loaded into the engine, with a stable id. */
export interface Player {
  id: string
  name: string
  position: PositionId
  age: number
  stats: StatBlock
  /** Cached overall, computed from stats via position weights. */
  ovr: number
}

export interface Team {
  id: string
  name: string
  shortName: string
  leagueId: LeagueId
  squad: Player[]
}
