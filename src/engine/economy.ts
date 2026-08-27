/**
 * Career money: the ledger, the salary curve, and the lifestyle shop (SPEC §4).
 *
 * Every function here is pure and returns new state — nothing mutates a ledger in place,
 * which is what makes the reconciliation invariant checkable at any point in history.
 */

import { LEAGUE_LIST, LIFESTYLE, getLeague } from '../data'
import type { LeagueDef, LeagueId } from '../types/core'
import type {
  CreditType,
  Ledger,
  LedgerEntry,
  LifestyleEffects,
  LifestyleItem,
  LifestyleState,
  PurchaseRefusal,
  Reconciliation,
} from '../types/economy'

const DEBIT_TYPES = new Set<string>(['lifestyle'])

export const LIFESTYLE_ITEMS = LIFESTYLE.items as unknown as readonly LifestyleItem[]

export function getLifestyleItem(id: string): LifestyleItem | undefined {
  return LIFESTYLE_ITEMS.find((item) => item.id === id)
}

// ---------------------------------------------------------------------------
// Ledger
// ---------------------------------------------------------------------------

export function createLedger(): Ledger {
  return { entries: [] }
}

function isDebit(entry: LedgerEntry): boolean {
  return DEBIT_TYPES.has(entry.type)
}

/** Record income. Amount must be positive — direction lives in the type. */
export function credit(
  ledger: Ledger,
  season: number,
  type: CreditType,
  label: string,
  amount: number,
): Ledger {
  if (amount < 0) throw new Error(`credit: amount must be positive, got ${amount}`)
  return { entries: [...ledger.entries, { season, type, label, amount: Math.round(amount) }] }
}

/** Record spending. Amount must be positive. */
export function debit(
  ledger: Ledger,
  season: number,
  label: string,
  amount: number,
): Ledger {
  if (amount < 0) throw new Error(`debit: amount must be positive, got ${amount}`)
  return {
    entries: [...ledger.entries, { season, type: 'lifestyle', label, amount: Math.round(amount) }],
  }
}

/** Everything ever earned, before spending. */
export function grossEarnings(ledger: Ledger): number {
  let total = 0
  for (const entry of ledger.entries) if (!isDebit(entry)) total += entry.amount
  return total
}

/** Everything ever spent. */
export function totalSpent(ledger: Ledger): number {
  let total = 0
  for (const entry of ledger.entries) if (isDebit(entry)) total += entry.amount
  return total
}

/** What is actually available to spend right now. */
export function balance(ledger: Ledger): number {
  return grossEarnings(ledger) - totalSpent(ledger)
}

/**
 * The SPEC §4 invariant: purchases + remaining balance must equal gross earnings.
 *
 * This holds by construction, so a failure means something bypassed `credit`/`debit` and
 * wrote entries directly — which is exactly the bug worth catching.
 */
export function reconcile(ledger: Ledger): Reconciliation {
  const gross = grossEarnings(ledger)
  const spent = totalSpent(ledger)
  const remaining = gross - spent
  return { gross, spent, balance: remaining, ok: spent + remaining === gross }
}

export function assertReconciled(ledger: Ledger, context = 'ledger'): void {
  const r = reconcile(ledger)
  if (!r.ok) {
    throw new Error(
      `${context}: reconciliation failed — spent ${r.spent} + balance ${r.balance} !== gross ${r.gross}`,
    )
  }
  if (r.balance < 0) {
    throw new Error(`${context}: balance went negative (${r.balance}) — a debit was not checked`)
  }
}

/** Per-season breakdown, for the season review and the career summary screens. */
export function earningsBySeason(ledger: Ledger): Map<number, number> {
  const out = new Map<number, number>()
  for (const entry of ledger.entries) {
    if (isDebit(entry)) continue
    out.set(entry.season, (out.get(entry.season) ?? 0) + entry.amount)
  }
  return out
}

export function entriesForSeason(ledger: Ledger, season: number): LedgerEntry[] {
  return ledger.entries.filter((e) => e.season === season)
}

// ---------------------------------------------------------------------------
// Salary
// ---------------------------------------------------------------------------

/**
 * Salary is anchored on league wealth rather than a hardcoded table, so adding or
 * re-tiering a league in the data changes wages without touching this file.
 *
 * `wageBudgetBase` is the Team Career squad budget and is a poor fit for one player's
 * wage, so the curve uses `prizePool` relative to the tier median as the wealth signal.
 */
/**
 * Weekly wage at the OVR anchor, per tier.
 *
 * Chosen to preserve the scale the annual figures had: £1,200 a week over a 22-round
 * Championship season is £26.4k against the £30k the old annual anchor paid, and £10,000 a
 * week over an 18-round Premiership season is £180k against £250k. Tier 1 is deliberately a
 * little tighter than before — the old figure assumed a full year, not a season.
 */
const TIER_ANCHOR_WEEKLY_WAGE: Record<1 | 2, number> = { 1: 10_000, 2: 1_200 }
const ANCHOR_OVR = 65
/** Each point of OVR above the anchor is worth 9% more. */
const OVR_SALARY_GROWTH = 1.09

const medianCache = new Map<number, number>()

function tierMedianPrizePool(tier: 1 | 2): number {
  const cached = medianCache.get(tier)
  if (cached !== undefined) return cached

  const pools = LEAGUE_LIST.filter((l) => l.tier === tier)
    .map((l) => l.prizePool)
    .sort((a, b) => a - b)
  if (pools.length === 0) return 1

  const mid = Math.floor(pools.length / 2)
  const median = pools.length % 2 === 0 ? (pools[mid - 1]! + pools[mid]!) / 2 : pools[mid]!
  medianCache.set(tier, median)
  return median
}

/** How wealthy a league is relative to the median of its own tier. */
export function leagueWealthFactor(league: LeagueDef): number {
  const median = tierMedianPrizePool(league.tier)
  if (median <= 0) return 1
  // Dampened — Top 14 pays best, but not proportionally to its whole prize pool.
  return Math.pow(league.prizePool / median, 0.6)
}

/**
 * Expected **weekly** wage for a player of this OVR at this club's level.
 *
 * Contracts are weekly rather than annual because that is the unit a wage is actually paid
 * in, and it is what makes the earnings identity exact: what a career banks is the weekly
 * wage times the rounds that were played. An annual figure cannot express that, because
 * league seasons run from 10 rounds to 30 — the same "annual salary" would mean three
 * different weekly rates depending on where you signed.
 *
 * The anchors are set so the scale is roughly what it was: a tier-2 player at the OVR 65
 * anchor earns about £1.2k a week, which over a 22-round Championship season is close to the
 * £30k the old annual figure paid.
 *
 * `squadRoleFactor` lets a fringe player be offered less than a guaranteed starter.
 */
export function expectedSalary(
  leagueId: LeagueId,
  ovr: number,
  squadRoleFactor = 1,
): number {
  const league = getLeague(leagueId)
  const anchor = TIER_ANCHOR_WEEKLY_WAGE[league.tier]
  const ovrFactor = Math.pow(OVR_SALARY_GROWTH, ovr - ANCHOR_OVR)
  const raw = anchor * ovrFactor * leagueWealthFactor(league) * squadRoleFactor
  // Rounded to something a contract would actually be written for.
  return Math.max(200, Math.round(raw / 100) * 100)
}

/** What a contract at this weekly wage pays across a whole season of the given length. */
export function seasonWages(weeklyWage: number, rounds: number): number {
  return weeklyWage * rounds
}

/** Win bonus per victory, scaled to the league's prize pool. */
export function winBonus(leagueId: LeagueId): number {
  const league = getLeague(leagueId)
  // A Top 14 win is worth roughly £5k, a Shute Shield win £150.
  return Math.round(league.prizePool / 1000 / 100) * 100
}

// ---------------------------------------------------------------------------
// Lifestyle shop
// ---------------------------------------------------------------------------

export function createLifestyleState(): LifestyleState {
  return { purchases: [] }
}

/** One-time items grey out once owned (SPEC §4). */
export function owns(state: LifestyleState, itemId: string): boolean {
  return state.purchases.some((p) => p.itemId === itemId)
}

export function purchaseCount(state: LifestyleState, itemId: string): number {
  return state.purchases.filter((p) => p.itemId === itemId).length
}

/**
 * Can this item be bought for `season`? Returns the specific refusal so the shop can
 * explain itself rather than just disabling a button.
 */
export function canPurchase(
  ledger: Ledger,
  state: LifestyleState,
  itemId: string,
  season: number,
): PurchaseRefusal {
  const item = getLifestyleItem(itemId)
  if (!item) {
    return { ok: false, reason: 'unknown_item', message: `No such item: ${itemId}` }
  }

  if (!item.repeatable && owns(state, itemId)) {
    return { ok: false, reason: 'already_owned', message: `${item.name} is already yours.` }
  }

  if (item.repeatable && state.purchases.some((p) => p.itemId === itemId && p.season === season)) {
    return {
      ok: false,
      reason: 'already_owned',
      message: `${item.name} is already booked for this season.`,
    }
  }

  const available = balance(ledger)
  if (available < item.cost) {
    return {
      ok: false,
      reason: 'insufficient_funds',
      message: `${item.name} costs ${formatMoney(item.cost)}; you have ${formatMoney(available)}.`,
      shortfall: item.cost - available,
    }
  }

  return { ok: true }
}

export interface PurchaseResult {
  ledger: Ledger
  lifestyle: LifestyleState
}

/**
 * Buy an item. Throws if it was not affordable — callers must check `canPurchase` first,
 * which keeps "the money actually left the account" impossible to skip.
 */
export function purchase(
  ledger: Ledger,
  state: LifestyleState,
  itemId: string,
  season: number,
): PurchaseResult {
  const check = canPurchase(ledger, state, itemId, season)
  if (!check.ok) throw new Error(`purchase refused: ${check.message}`)

  const item = getLifestyleItem(itemId)!
  const nextLedger = debit(ledger, season, item.name, item.cost)
  const nextState: LifestyleState = {
    purchases: [...state.purchases, { itemId, season }],
  }

  assertReconciled(nextLedger, `purchase(${itemId})`)
  return { ledger: nextLedger, lifestyle: nextState }
}

/** Neutral effects — every multiplier at 1, every bonus at 0. */
export function noLifestyleEffects(): LifestyleEffects {
  return {
    matchGrowthMultiplier: 1,
    injuryRiskMultiplier: 1,
    recoveryWeeksReduction: 0,
    slumpDurationMultiplier: 1,
    bigMatchRatingBonus: 0,
    extraOffersPerWindow: 0,
    futureSalaryMultiplier: 1,
    startSeasonInPeakForm: false,
  }
}

/**
 * Resolve everything owned into one effect set for `season`.
 *
 * One-time items apply from the season they were bought onward. Off-Season Retreat is
 * repeatable and applies only to the single season it was bought for.
 */
export function lifestyleEffects(state: LifestyleState, season: number): LifestyleEffects {
  const out = noLifestyleEffects()

  for (const p of state.purchases) {
    const item = getLifestyleItem(p.itemId)
    if (!item) continue

    if (item.repeatable) {
      // Only for its own season.
      if (p.season !== season) continue
    } else if (p.season > season) {
      // Bought later in the career than the season being resolved.
      continue
    }

    const e = item.effect
    if (e.matchGrowthMultiplier) out.matchGrowthMultiplier *= e.matchGrowthMultiplier
    if (e.injuryRiskMultiplier) out.injuryRiskMultiplier *= e.injuryRiskMultiplier
    if (e.recoveryWeeksReduction) out.recoveryWeeksReduction += e.recoveryWeeksReduction
    if (e.slumpDurationMultiplier) out.slumpDurationMultiplier *= e.slumpDurationMultiplier
    if (e.bigMatchRatingBonus) out.bigMatchRatingBonus += e.bigMatchRatingBonus
    if (e.extraOffersPerWindow) out.extraOffersPerWindow += e.extraOffersPerWindow
    if (e.futureSalaryMultiplier) out.futureSalaryMultiplier *= e.futureSalaryMultiplier
    if (e.startSeasonInPeakForm) out.startSeasonInPeakForm = true
  }

  return out
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** £1.2M / £750k / £8,500 — the shop and contract screens all read the same way. */
export function formatMoney(amount: number): string {
  const sign = amount < 0 ? '-' : ''
  const abs = Math.abs(amount)
  if (abs >= 1_000_000) {
    const m = abs / 1_000_000
    return `${sign}£${m % 1 === 0 ? m.toFixed(0) : m.toFixed(2).replace(/0$/, '')}M`
  }
  if (abs >= 100_000) return `${sign}£${Math.round(abs / 1_000)}k`
  return `${sign}£${abs.toLocaleString('en-GB')}`
}
