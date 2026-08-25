/**
 * Team Career — the manager mode.
 *
 * The three rules SPEC §3 is specific about, and which are all enforced here rather than in
 * the UI:
 *   - a signing that breaks the wage budget **fails**, it is not merely discouraged
 *   - overspending triggers a points deduction
 *   - **any trophy that season protects you from the sack, regardless of league finish**
 *
 * ---
 * A note on the wage scale.
 *
 * The recovered data contains two figures that cannot both be true on one scale:
 * `leagues.json` gives the Premiership a `wageBudgetBase` of 150,000, while
 * `achievements.json` makes £10M of *career* earnings a gold-tier achievement over twenty
 * seasons. A single scale that lets one player earn £500k a season cannot also fit a
 * 23-man squad inside 150,000.
 *
 * So Team Career anchors its wages directly on `wageBudgetBase`, which is the number the
 * mode is actually built around, while Player Career keeps the salary curve that makes the
 * earnings achievements reachable. Both are internally consistent; they are simply
 * different units, and this is the one place the seam is visible.
 */

import { getLeague } from '../data'
import { createLedger, credit, debit, formatMoney } from './economy'
import type { Ledger } from '../types/economy'
import { buildLadder, ladderRow, type LadderRow } from './ladder'
import type { LeagueId, Player, Team } from '../types/core'
import type { MatchResult } from '../types/match'
import type { Rng } from './rng'

/** Squad size the wage budget is scaled against. */
export const BUDGET_SQUAD_SIZE = 23

/**
 * A player's weekly wage in the manager mode's units.
 *
 * The reference OVR is the typical squad standard for the tier (measured at 80.6 for the
 * recovered tier-1 rosters), so a squad of average players lands close to the budget and a
 * squad of stars blows straight through it.
 */
export function weeklyWage(leagueId: LeagueId, ovr: number): number {
  const league = getLeague(leagueId)
  const reference = league.tier === 1 ? 80 : 67
  const perPlayer = league.wageBudgetBase / BUDGET_SQUAD_SIZE
  return Math.max(200, Math.round(perPlayer * Math.pow(1.085, ovr - reference)))
}

export function squadWageBill(team: Team): number {
  return team.squad.reduce((total, p) => total + weeklyWage(team.leagueId, p.ovr), 0)
}

export function wageBudget(leagueId: LeagueId): number {
  return getLeague(leagueId).wageBudgetBase
}

// ---------------------------------------------------------------------------
// Signing
// ---------------------------------------------------------------------------

export type SigningRefusal =
  | { ok: true; wage: number; remaining: number }
  | { ok: false; reason: 'over_budget'; message: string; wage: number; overBy: number }
  | { ok: false; reason: 'squad_full'; message: string }

export const MAX_SQUAD_SIZE = 32

/**
 * Can this club sign this player?
 *
 * The budget check is the point of the mode, so it returns a specific refusal rather than a
 * boolean — the UI shows exactly how far over the club would be.
 */
export function canSign(team: Team, player: Player, budget?: number): SigningRefusal {
  if (team.squad.length >= MAX_SQUAD_SIZE) {
    return { ok: false, reason: 'squad_full', message: `Squad is full (${MAX_SQUAD_SIZE}).` }
  }

  const limit = budget ?? wageBudget(team.leagueId)
  const wage = weeklyWage(team.leagueId, player.ovr)
  const projected = squadWageBill(team) + wage

  if (projected > limit) {
    const overBy = projected - limit
    return {
      ok: false,
      reason: 'over_budget',
      message: `${player.name} costs ${formatMoney(wage)}/week and would put you ${formatMoney(overBy)} over budget.`,
      wage,
      overBy,
    }
  }

  return { ok: true, wage, remaining: limit - projected }
}

/**
 * Sign a player. Throws if it would break the budget.
 *
 * Deliberately not "clamp and continue": SPEC §3 says the signing *fails*, and a function
 * that quietly succeeds anyway is the exact bug the spec is guarding against.
 */
export function signPlayer(team: Team, player: Player, budget?: number): Team {
  const check = canSign(team, player, budget)
  if (!check.ok) throw new Error(`Signing refused: ${check.message}`)
  return { ...team, squad: [...team.squad, player] }
}

export function releasePlayer(team: Team, playerId: string): Team {
  return { ...team, squad: team.squad.filter((p) => p.id !== playerId) }
}

// ---------------------------------------------------------------------------
// Board expectation
// ---------------------------------------------------------------------------

export interface BoardExpectation {
  /** The worst league position the board will accept. */
  minPosition: number
  description: string
}

/**
 * What the board wants, based on where the squad ranks in its league.
 *
 * A club with the best squad is expected to win it; a club with the worst is expected to
 * survive. Being handed an impossible target would make the mode unwinnable.
 */
export function boardExpectation(
  strengthRank: number,
  teamCount: number,
): BoardExpectation {
  const share = strengthRank / Math.max(1, teamCount)

  if (share <= 0.2) {
    return { minPosition: Math.max(1, Math.ceil(teamCount * 0.15)), description: 'Win the league' }
  }
  if (share <= 0.45) {
    return { minPosition: Math.ceil(teamCount * 0.4), description: 'Reach the finals' }
  }
  if (share <= 0.75) {
    return { minPosition: Math.ceil(teamCount * 0.7), description: 'Finish mid-table' }
  }
  return { minPosition: teamCount - 1, description: 'Avoid finishing bottom' }
}

// ---------------------------------------------------------------------------
// Club finances
// ---------------------------------------------------------------------------

/** Gate receipts per home match, scaled to the league's standing. */
export function gateReceipts(leagueId: LeagueId, won: boolean): number {
  const league = getLeague(leagueId)
  const base = league.prizePool / 40
  return Math.round(base * (won ? 1.15 : 1))
}

/** Prize money for finishing in a given position. */
export function prizeMoney(leagueId: LeagueId, position: number, teamCount: number): number {
  const league = getLeague(leagueId)
  // Top of the table takes the biggest share; the bottom still gets something.
  const share = Math.max(0.15, 1 - (position - 1) / Math.max(1, teamCount))
  return Math.round((league.prizePool / teamCount) * share * 2)
}

/** Weekly wage bill, charged for each round played. */
export function chargeWeeklyWages(ledger: Ledger, season: number, team: Team): Ledger {
  return debit(ledger, season, 'Weekly wages', squadWageBill(team))
}

export function creditGate(
  ledger: Ledger,
  season: number,
  leagueId: LeagueId,
  won: boolean,
): Ledger {
  return credit(ledger, season, 'prize_money', 'Gate receipts', gateReceipts(leagueId, won))
}

export function creditPrizeMoney(
  ledger: Ledger,
  season: number,
  leagueId: LeagueId,
  position: number,
  teamCount: number,
): Ledger {
  return credit(
    ledger,
    season,
    'prize_money',
    'Prize money',
    prizeMoney(leagueId, position, teamCount),
  )
}

// ---------------------------------------------------------------------------
// Overspending
// ---------------------------------------------------------------------------

/** Points deducted per full multiple of the budget that a club overspends by. */
export const OVERSPEND_DEDUCTION_STEP = 0.1
export const MAX_POINTS_DEDUCTION = 15

/**
 * The points penalty for carrying a wage bill above the budget.
 *
 * Scales with how far over the club is, so being marginally over is a nuisance and being
 * wildly over is a relegation sentence.
 */
export function pointsDeduction(team: Team, budget?: number): number {
  const limit = budget ?? wageBudget(team.leagueId)
  const bill = squadWageBill(team)
  if (bill <= limit) return 0

  const overshoot = (bill - limit) / limit
  const points = Math.ceil(overshoot / OVERSPEND_DEDUCTION_STEP)
  return Math.min(MAX_POINTS_DEDUCTION, points)
}

// ---------------------------------------------------------------------------
// The sack
// ---------------------------------------------------------------------------

export interface SackVerdict {
  sacked: boolean
  /** True when a trophy saved the manager despite a poor finish. */
  savedByTrophy: boolean
  reason: string
}

/**
 * Decide whether the manager keeps their job.
 *
 * SPEC §3: **any trophy that season protects you regardless of league finish.** That is
 * checked before the league position is even looked at — a cup run genuinely rescues a
 * disastrous season, which is the whole point of the rule.
 */
export function assessSack(
  finalPosition: number,
  expectation: BoardExpectation,
  trophiesThisSeason: number,
  seasonsInCharge: number,
): SackVerdict {
  if (trophiesThisSeason > 0) {
    return {
      sacked: false,
      savedByTrophy: true,
      reason: `Silverware. The board can hardly sack a manager who just won something.`,
    }
  }

  if (finalPosition <= expectation.minPosition) {
    return {
      sacked: false,
      savedByTrophy: false,
      reason: `Finished ${ordinal(finalPosition)}. The board expected ${expectation.description.toLowerCase()}.`,
    }
  }

  // A first season is given some benefit of the doubt.
  if (seasonsInCharge <= 1 && finalPosition <= expectation.minPosition + 2) {
    return {
      sacked: false,
      savedByTrophy: false,
      reason: `Finished ${ordinal(finalPosition)}, short of the target — but you are given another year.`,
    }
  }

  return {
    sacked: true,
    savedByTrophy: false,
    reason: `Finished ${ordinal(finalPosition)} against a target of ${ordinal(expectation.minPosition)}. The board has acted.`,
  }
}

function ordinal(n: number): string {
  const suffix =
    n % 100 >= 11 && n % 100 <= 13
      ? 'th'
      : n % 10 === 1
        ? 'st'
        : n % 10 === 2
          ? 'nd'
          : n % 10 === 3
            ? 'rd'
            : 'th'
  return `${n}${suffix}`
}

// ---------------------------------------------------------------------------
// Manager career state
// ---------------------------------------------------------------------------

export interface ManagerCareer {
  seed: number
  season: number
  clubId: string
  leagueId: LeagueId
  seasonsInCharge: number
  expectation: BoardExpectation
  finances: Ledger
  trophies: { season: number; name: string }[]
  /** Points deductions applied this season. */
  deduction: number
  sacked: boolean
  sackReason: string | null
  history: {
    season: number
    clubName: string
    leagueId: LeagueId
    position: number
    trophies: number
    survived: boolean
  }[]
}

export function createManagerCareer(
  seed: number,
  club: Team,
  strengthRank: number,
): ManagerCareer {
  const league = getLeague(club.leagueId)
  return {
    seed,
    season: 1,
    clubId: club.id,
    leagueId: club.leagueId,
    seasonsInCharge: 0,
    expectation: boardExpectation(strengthRank, league.teamCount),
    finances: createLedger(),
    trophies: [],
    deduction: 0,
    sacked: false,
    sackReason: null,
    history: [],
  }
}

/** The table as the board sees it, with any overspending penalty applied. */
export function managerLadder(
  teamIds: readonly string[],
  results: readonly MatchResult[],
  manager: ManagerCareer,
): LadderRow[] {
  const deductions = new Map<string, number>()
  if (manager.deduction > 0) deductions.set(manager.clubId, manager.deduction)
  return buildLadder(teamIds, results, deductions)
}

export interface SeasonReview {
  manager: ManagerCareer
  verdict: SackVerdict
  position: number
}

/** Close a manager's season: prize money, the board's verdict, the history line. */
export function reviewManagerSeason(
  manager: ManagerCareer,
  ladder: readonly LadderRow[],
  clubName: string,
  championId: string | null,
  cupTrophies: readonly string[] = [],
): SeasonReview {
  const league = getLeague(manager.leagueId)
  const row = ladderRow(ladder, manager.clubId)
  const position = row?.position ?? ladder.length

  const wonLeague = championId === manager.clubId
  const trophiesThisSeason = (wonLeague ? 1 : 0) + cupTrophies.length

  const finances = creditPrizeMoney(
    manager.finances,
    manager.season,
    manager.leagueId,
    position,
    league.teamCount,
  )

  const verdict = assessSack(
    position,
    manager.expectation,
    trophiesThisSeason,
    manager.seasonsInCharge + 1,
  )

  const trophies = [...manager.trophies]
  if (wonLeague) trophies.push({ season: manager.season, name: league.name })
  for (const cup of cupTrophies) trophies.push({ season: manager.season, name: cup })

  return {
    manager: {
      ...manager,
      finances,
      trophies,
      seasonsInCharge: manager.seasonsInCharge + 1,
      sacked: verdict.sacked,
      sackReason: verdict.sacked ? verdict.reason : null,
      deduction: 0,
      history: [
        ...manager.history,
        {
          season: manager.season,
          clubName,
          leagueId: manager.leagueId,
          position,
          trophies: trophiesThisSeason,
          survived: !verdict.sacked,
        },
      ],
    },
    verdict,
    position,
  }
}

// ---------------------------------------------------------------------------
// Signing targets
// ---------------------------------------------------------------------------

/** Players the club could plausibly sign, cheapest useful option first. */
export function affordableTargets(
  team: Team,
  candidates: readonly Player[],
  rng: Rng,
  count = 6,
): Player[] {
  const budget = wageBudget(team.leagueId)
  const affordable = candidates.filter((p) => canSign(team, p, budget).ok)
  if (affordable.length === 0) return []
  return rng.shuffle(affordable).slice(0, count).sort((a, b) => b.ovr - a.ovr)
}
