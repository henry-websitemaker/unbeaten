import type { LeagueId, PositionId, StatKey } from './core'

/** A player's involvement in one match. Kept flat so it serialises straight into a save. */
export interface PlayerMatchLine {
  playerId: string
  playerName: string
  teamId: string
  slot: PositionId
  /** 0-10, one decimal. */
  rating: number
  tries: number
  /** Conversions and penalties, in points. */
  kickPoints: number
  outOfPosition: boolean
}

export interface TeamMatchLine {
  teamId: string
  score: number
  tries: number
  conversions: number
  penalties: number
  /** Ladder bonus points earned in this match. */
  bonusPoints: number
}

export interface MatchResult {
  season: number
  round: number
  leagueId: LeagueId
  home: TeamMatchLine
  away: TeamMatchLine
  /** Winner's team id, or null for a draw. */
  winnerId: string | null
  /** Player of the match. */
  motmPlayerId: string
  players: PlayerMatchLine[]
  /** Set when the fixture is a listed rivalry. */
  derbyName?: string
  /** Set when an event re-weighted the match, e.g. Washout Conditions. */
  conditions?: string
}

export interface MatchModifiers {
  /** Added to the club's effective strength — form, morale, derby lift. */
  homeStrengthDelta?: number
  awayStrengthDelta?: number
  /** Multiplies stat weights for both sides, e.g. wet weather. */
  statWeightOverride?: Partial<Record<StatKey, number>>
  /** 1-10 from derbies.json; raises variance and lifts the underdog. */
  derbyIntensity?: number
  derbyName?: string
  conditions?: string
  /** Player ids unavailable through injury or suspension. */
  unavailableHome?: ReadonlySet<string>
  unavailableAway?: ReadonlySet<string>
  /** Ratings bonus for specific players, e.g. the Sports Psychologist in a final. */
  ratingBonus?: ReadonlyMap<string, number>
  /** Selection-only nudges — form, morale, and the "Dropped" outcome's penalty. */
  selectionAdjustHome?: ReadonlyMap<string, number>
  selectionAdjustAway?: ReadonlyMap<string, number>
  /** Finals and internationals carry more weight in ratings and morale. */
  bigMatch?: boolean
}
