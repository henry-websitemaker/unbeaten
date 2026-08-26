import type { LeagueId, PositionId, StatBlock } from './core'
import type { Contract, Ledger, LifestyleState } from './economy'

/** SPEC §2.1: every career is exactly 20 seasons. No variable length, anywhere. */
export const CAREER_SEASONS = 20

export interface Archetype {
  id: string
  name: string
  description: string
  startAge: number
  startOvrRange: [number, number]
  growthCurve: { peakAge: number; earlyMultiplier: number; lateMultiplier: number }
  startingSalaryMultiplier: number
  injuryRiskMultiplier?: number
  fitDecayMultiplier?: number
  extraOffersPerWindow?: number
  contractLengthModifier?: number
}

export interface Trait {
  id: string
  name: string
  description: string
}

/** A season of club football, as it appears in the career history. */
export interface SeasonRecord {
  season: number
  clubId: string
  clubName: string
  leagueId: LeagueId
  appearances: number
  tries: number
  points: number
  /** Mean match rating across the season. */
  avgRating: number
  motm: number
  /** Where the club finished. */
  ladderPosition: number
  championship: boolean
  salary: number
  ovrStart: number
  ovrEnd: number
  internationalCaps: number
  injuries: number
}

export interface Trophy {
  season: number
  name: string
  type: 'league' | 'cup' | 'international'
  clubOrNation: string
}

export interface AwardWin {
  season: number
  type: string
  name: string
  leagueId?: LeagueId
}

/** One pre-season block, taken once per summer (SPEC §2.8). */
export interface TrainingRecord {
  season: number
  blockId: string
  ovrDelta: number
}

/** The plan the side takes into a match (SPEC §3). Sticky between matches. */
export type GamePlanId =
  | 'forward_power'
  | 'backline_finesse'
  | 'balanced_flair'
  | 'tactical_depth'
  | 'high_risk'
  | 'adapt'

/** Temporary state that expires — form slumps, morale knocks, suspensions. */
export interface TemporaryEffect {
  id: string
  label: string
  formModifier?: number
  moraleModifier?: number
  selectionPenalty?: number
  /** Matches remaining. */
  matchesRemaining: number
}

export interface Injury {
  label: string
  weeksRemaining: number
  seasonEnding: boolean
}

export interface PlayerCareer {
  /** Drives every stochastic system in the career. */
  seed: number
  name: string
  position: PositionId
  archetypeId: string
  nationId: string

  age: number
  stats: StatBlock
  ovr: number
  traits: string[]

  /** 1-based; the HUD always reads `Season X/20`. */
  season: number
  /** Rounds completed in the current season. */
  round: number

  contract: Contract
  ledger: Ledger
  lifestyle: LifestyleState

  /** 0-100. Drives selection and match ratings. */
  form: number
  morale: number
  isCaptain: boolean

  injury: Injury | null
  effects: TemporaryEffect[]

  history: SeasonRecord[]
  trophies: Trophy[]
  awards: AwardWin[]
  achievements: string[]
  /** Pre-season blocks taken, newest last (SPEC §2.8). */
  training: TrainingRecord[]
  /** Carries over from the last match until the player changes it (SPEC §3). */
  gamePlan: GamePlanId

  careerCaps: number
  careerTries: number
  careerPoints: number
  internationalCaps: number
  internationalTries: number

  rivalId: string | null
  /** Set once season 20 is complete. */
  retired: boolean
  /** Whether the mid-season wheel has been offered this season. */
  wheelSpunThisSeason: boolean
}

/** What a club move does to OVR, shown before the choice is made (SPEC §2.5). */
export type ClubMoveDirection = 'up' | 'stay' | 'down'

export interface TransferOffer {
  clubId: string
  clubName: string
  leagueId: LeagueId
  leagueName: string
  tier: 1 | 2
  salary: number
  years: number
  squadRole: SquadRole
  direction: ClubMoveDirection
  /** The OVR consequence, shown on the card up front. */
  ovrChangeRange: [number, number]
  /**
   * A Mystery Club: the destination is hidden until the season starts (SPEC §3).
   *
   * The club, salary, contract length and squad role are all real and decided now — only the
   * name and league are withheld. The OVR consequence is still shown, because SPEC §2.5
   * requires it on every destination card: you know what the move does to you, you just do
   * not know where you are going.
   */
  mystery: boolean
}

export type SquadRole = 'star' | 'starter' | 'squad' | 'fringe'
