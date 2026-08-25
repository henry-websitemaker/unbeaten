/**
 * Season orchestration: fixtures, rounds, ladder, finals.
 *
 * Every function is pure and returns new state, and `runSeason` is a generator that yields
 * after each round. That is what lets "Sim to season end" stay off the main thread's back
 * (SPEC §6) — the UI drives the generator and paints between rounds instead of blocking on
 * a 30-round loop.
 */

import { getLeague } from '../data'
import { generateFixtures, fixturesByRound, type Fixture } from './fixtures'
import { buildLadder, type LadderRow } from './ladder'
import { simulateMatch } from './match'
import { findDerby } from './derbies'
import { rngFor } from './rng'
import type { LeagueDef, LeagueId, Team } from '../types/core'
import type { MatchModifiers, MatchResult } from '../types/match'

export interface SeasonState {
  seed: number
  season: number
  leagueId: LeagueId
  teams: readonly Team[]
  fixtures: readonly Fixture[]
  /** Regular-season results only. */
  results: readonly MatchResult[]
  /** Finals and playoff results, in order. */
  finals: readonly MatchResult[]
  /** Rounds completed so far. */
  roundsPlayed: number
  /** Points deductions, used by Team Career overspending. */
  deductions: ReadonlyMap<string, number>
  /** Set once the finals are done. */
  championId: string | null
  /** Set for leagues with `promotionRelegation`. */
  promotedIds: readonly string[]
}

/**
 * Per-match hooks. Injuries, events and the player's own form live outside the season
 * engine, so they are supplied as modifiers rather than imported — which keeps this module
 * testable on its own and stops phase 4 from having to reach back into it.
 */
export interface SeasonContext {
  modifiersFor?: (fixture: Fixture, state: SeasonState) => MatchModifiers | undefined
  /** Called after each round so callers can apply injuries, events and progression. */
  onRoundComplete?: (round: number, results: readonly MatchResult[], state: SeasonState) => void
}

export function createSeason(
  seed: number,
  season: number,
  leagueId: LeagueId,
  teams: readonly Team[],
): SeasonState {
  const league = getLeague(leagueId)
  const rng = rngFor(seed, 'fixtures', season, leagueId)
  const fixtures = generateFixtures(league, teams.map((t) => t.id), rng)

  return {
    seed,
    season,
    leagueId,
    teams,
    fixtures,
    results: [],
    finals: [],
    roundsPlayed: 0,
    deductions: new Map(),
    championId: null,
    promotedIds: [],
  }
}

export function teamById(state: SeasonState, id: string): Team | undefined {
  return state.teams.find((t) => t.id === id)
}

/** The table as it stands. */
export function currentLadder(state: SeasonState): LadderRow[] {
  return buildLadder(
    state.teams.map((t) => t.id),
    state.results,
    state.deductions,
  )
}

export function totalRounds(state: SeasonState): number {
  return getLeague(state.leagueId).rounds
}

export function isRegularSeasonComplete(state: SeasonState): boolean {
  return state.roundsPlayed >= totalRounds(state)
}

/**
 * Play one round. Returns new state; the input is untouched.
 *
 * Derbies are detected here rather than by the caller, because the rivalry list keys on
 * club names and the season engine is the only layer that has both clubs to hand.
 */
export function simulateRound(state: SeasonState, ctx: SeasonContext = {}): SeasonState {
  if (isRegularSeasonComplete(state)) return state

  const round = state.roundsPlayed + 1
  const fixtures = fixturesByRound(state.fixtures).get(round) ?? []
  const roundResults: MatchResult[] = []

  for (const fixture of fixtures) {
    const home = teamById(state, fixture.homeId)
    const away = teamById(state, fixture.awayId)
    if (!home || !away) continue

    const supplied = ctx.modifiersFor?.(fixture, state)
    const derby = findDerby(home.name, away.name)

    const modifiers: MatchModifiers = { ...supplied }
    if (derby) {
      modifiers.derbyIntensity = derby.intensity
      modifiers.derbyName = derby.name
    }

    roundResults.push(
      simulateMatch({
        seed: state.seed,
        season: state.season,
        round,
        home,
        away,
        modifiers,
      }),
    )
  }

  const next: SeasonState = {
    ...state,
    results: [...state.results, ...roundResults],
    roundsPlayed: round,
  }

  ctx.onRoundComplete?.(round, roundResults, next)
  return next
}

/**
 * Drive a whole season, yielding after every round.
 *
 * Callers that need responsiveness step this from a scheduler; callers that do not (tests,
 * the Monte Carlo balance pass) can use `simulateSeason` instead.
 */
export function* runSeason(
  state: SeasonState,
  ctx: SeasonContext = {},
): Generator<SeasonState, SeasonState, void> {
  let current = state
  while (!isRegularSeasonComplete(current)) {
    current = simulateRound(current, ctx)
    yield current
  }
  current = runFinals(current, ctx)
  yield current
  return current
}

/** Run a season to completion in one go. */
export function simulateSeason(state: SeasonState, ctx: SeasonContext = {}): SeasonState {
  let current = state
  while (!isRegularSeasonComplete(current)) current = simulateRound(current, ctx)
  return runFinals(current, ctx)
}

// ---------------------------------------------------------------------------
// Finals
// ---------------------------------------------------------------------------

/**
 * How many clubs contest the finals series.
 *
 * A knockout of `finalsRounds` rounds needs `2^finalsRounds` clubs, which lands exactly on
 * the real formats in the data: the Premiership's 2 rounds give a top-4 semi-final and
 * final, and the 3-round leagues give a top-8 quarter-final bracket.
 */
export function finalsParticipantCount(league: LeagueDef): number {
  if (league.finalsFormat === 'none' || league.finalsRounds <= 0) return 0
  return Math.min(league.teamCount, 2 ** league.finalsRounds)
}

/**
 * Play the finals series and crown a champion.
 *
 * Leagues with `finalsFormat: 'none'` — the RFU Championship — are won by whoever tops the
 * table, which is how that competition actually works.
 */
export function runFinals(state: SeasonState, ctx: SeasonContext = {}): SeasonState {
  const league = getLeague(state.leagueId)
  const ladder = currentLadder(state)

  if (league.finalsFormat === 'none' || league.finalsRounds <= 0) {
    return {
      ...state,
      championId: ladder[0]?.teamId ?? null,
      promotedIds: promotedFrom(league, ladder),
    }
  }

  const count = finalsParticipantCount(league)
  let alive = ladder.slice(0, count).map((row) => row.teamId)
  const finals: MatchResult[] = []

  // Seeded knockout: 1 v N, 2 v N-1, and so on. The higher seed hosts.
  let roundNumber = totalRounds(state)
  while (alive.length > 1) {
    roundNumber += 1
    const next: string[] = []

    for (let i = 0; i < alive.length / 2; i++) {
      const higherSeed = alive[i]!
      const lowerSeed = alive[alive.length - 1 - i]!
      const home = teamById(state, higherSeed)
      const away = teamById(state, lowerSeed)
      if (!home || !away) {
        next.push(higherSeed)
        continue
      }

      const result = playFinalsMatch(state, home, away, roundNumber, ctx)
      finals.push(result)

      // A drawn final goes to the higher seed, as most competitions provide for.
      next.push(result.winnerId ?? higherSeed)
    }

    alive = next
  }

  const withFinals: SeasonState = {
    ...state,
    finals,
    championId: alive[0] ?? null,
  }

  return { ...withFinals, promotedIds: promotedFrom(league, ladder, withFinals.championId) }
}

function playFinalsMatch(
  state: SeasonState,
  home: Team,
  away: Team,
  round: number,
  ctx: SeasonContext,
): MatchResult {
  const derby = findDerby(home.name, away.name)
  const modifiers: MatchModifiers = {
    ...ctx.modifiersFor?.({ round, homeId: home.id, awayId: away.id }, state),
    bigMatch: true,
  }
  if (derby) {
    modifiers.derbyIntensity = derby.intensity
    modifiers.derbyName = derby.name
  }

  return simulateMatch({
    seed: state.seed,
    season: state.season,
    round,
    home,
    away,
    modifiers,
  })
}

/**
 * Who goes up.
 *
 * Only the two leagues with `promotionRelegation` in the data promote anyone: the RFU
 * Championship into the Premiership, and Pro D2 into the Top 14.
 */
function promotedFrom(
  league: LeagueDef,
  ladder: readonly LadderRow[],
  championId?: string | null,
): string[] {
  const rule = league.promotionRelegation
  if (!rule) return []

  const spots = Math.max(0, rule.spots)
  if (spots === 0) return []

  // The champion goes up; any remaining spots come off the top of the table.
  const promoted: string[] = []
  if (championId) promoted.push(championId)
  for (const row of ladder) {
    if (promoted.length >= spots) break
    if (!promoted.includes(row.teamId)) promoted.push(row.teamId)
  }

  return promoted.slice(0, spots)
}

/** Bottom `count` clubs — the other side of promotion, applied to the tier above. */
export function relegatedFrom(ladder: readonly LadderRow[], count: number): string[] {
  if (count <= 0) return []
  return ladder.slice(Math.max(0, ladder.length - count)).map((row) => row.teamId)
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

/** Every result a club was involved in, regular season and finals, in order. */
export function resultsForTeam(state: SeasonState, teamId: string): MatchResult[] {
  return [...state.results, ...state.finals]
    .filter((r) => r.home.teamId === teamId || r.away.teamId === teamId)
    .sort((a, b) => a.round - b.round)
}

export type ResultChip = 'W' | 'D' | 'L'

export function chipFor(result: MatchResult, teamId: string): ResultChip {
  if (result.winnerId === null) return 'D'
  return result.winnerId === teamId ? 'W' : 'L'
}

/** Wins across the whole season — the number the perfect-season target is measured against. */
export function seasonWins(state: SeasonState, teamId: string): number {
  return resultsForTeam(state, teamId).filter((r) => r.winnerId === teamId).length
}

/**
 * Has this club gone unbeaten and won the competition — the thing the game is named after?
 *
 * Deliberately *not* "wins >= perfectTarget". `perfectTarget` in the data is simply
 * `rounds + finalsRounds`, which assumes every club plays every round. Super Rugby has 11
 * clubs and therefore a bye each round, so its clubs play 12-13 matches and could never
 * reach 17 wins — gating on that number would make a perfect season impossible in the one
 * league most associated with them.
 *
 * The honest definition is: won every match you played, and finished as champion.
 */
export function isPerfectSeason(state: SeasonState, teamId: string): boolean {
  if (state.championId !== teamId) return false
  const own = resultsForTeam(state, teamId)
  if (own.length === 0) return false
  return own.every((r) => r.winnerId === teamId)
}

/**
 * The headline "wins needed" figure for the season preview.
 *
 * Uses the club's actual fixture count plus the finals it would have to win, which for a
 * league with byes is lower than the league's stored `perfectTarget`.
 */
export function perfectSeasonTarget(state: SeasonState, teamId: string): number {
  const league = getLeague(state.leagueId)
  const played = state.fixtures.filter((f) => f.homeId === teamId || f.awayId === teamId).length
  return played + league.finalsRounds
}
