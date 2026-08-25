import type { LeagueId } from './core'

/**
 * Money is an append-only ledger, never a running total.
 *
 * SPEC §4 warns this is the part most likely to end up faked. It cannot be faked here
 * because there is no stored balance to drift: gross, spent and balance are all *derived*
 * from the same entry list, so "purchases + balance === gross" is true by construction
 * rather than by discipline.
 */

export type CreditType =
  | 'salary'
  | 'win_bonus'
  | 'prize_money'
  | 'sponsor'
  | 'international_fee'

export type DebitType = 'lifestyle'

export type LedgerEntryType = CreditType | DebitType

export interface LedgerEntry {
  /** Season the money moved in. Season 0 means "before the career started". */
  season: number
  type: LedgerEntryType
  label: string
  /** Always positive. Direction is carried by `type`, not by the sign. */
  amount: number
}

export interface Ledger {
  entries: readonly LedgerEntry[]
}

export interface Reconciliation {
  gross: number
  spent: number
  balance: number
  /** `spent + balance === gross`. */
  ok: boolean
}

/** A lifestyle purchase, recorded against the season it takes effect in. */
export interface LifestylePurchase {
  itemId: string
  /** The season the benefit first applies to. */
  season: number
}

export interface LifestyleState {
  purchases: readonly LifestylePurchase[]
}

/** The combined effect of everything owned, resolved for one specific season. */
export interface LifestyleEffects {
  matchGrowthMultiplier: number
  injuryRiskMultiplier: number
  recoveryWeeksReduction: number
  slumpDurationMultiplier: number
  bigMatchRatingBonus: number
  extraOffersPerWindow: number
  futureSalaryMultiplier: number
  /** Off-Season Retreat — true only for the season it was bought for. */
  startSeasonInPeakForm: boolean
}

export interface LifestyleItem {
  id: string
  name: string
  cost: number
  repeatable: boolean
  description: string
  effect: {
    matchGrowthMultiplier?: number
    injuryRiskMultiplier?: number
    recoveryWeeksReduction?: number
    slumpDurationMultiplier?: number
    bigMatchRatingBonus?: number
    extraOffersPerWindow?: number
    futureSalaryMultiplier?: number
    startSeasonInPeakForm?: boolean
  }
}

/** Why a purchase was refused — the UI shows this, so it has to be specific. */
export type PurchaseRefusal =
  | { ok: true }
  | { ok: false; reason: 'unknown_item'; message: string }
  | { ok: false; reason: 'already_owned'; message: string }
  | { ok: false; reason: 'insufficient_funds'; message: string; shortfall: number }

export interface Contract {
  clubId: string
  leagueId: LeagueId
  /** Annual salary in GBP. */
  salary: number
  /** Total length in seasons. */
  years: number
  /** Seasons already served. */
  yearsServed: number
}
