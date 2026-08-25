/**
 * Driving a Player Career forward.
 *
 * This is the layer that knows the *order* things happen in: wages before a ball is kicked,
 * the wheel at the midpoint, injuries after a match, progression at the season boundary.
 * The UI and the tests both drive careers through here, so what the tests prove is what the
 * game actually does.
 *
 * `runToSeasonEnd` is a generator. "Sim to season end" steps it from a scheduler and paints
 * between rounds, which is how SPEC §6's no-freezing requirement is met.
 */

import { getLeague } from '../data'
import {
  PLAYER_ID,
  applyRound,
  attachEffects,
  clubResult,
  creditMatchEarnings,
  creditSeasonSalary,
  endSeason,
  playerClubModifiers,
  playerLine,
  syncCareerToWorld,
  type SeasonSummary,
} from './career'
import { assertReconciled } from './economy'
import { resolveEvent, rollEvent, type EventOutcome } from './events'
import { rngFor } from './rng'
import {
  createSeason,
  isRegularSeasonComplete,
  runFinals,
  simulateRound,
  totalRounds,
  type SeasonState,
} from './season'
import { spin, wheelRound, type SpinResult } from './wheel'
import { findTeam, teamsInLeague, type World } from './world'
import type { PlayerCareer } from '../types/career'
import type { MatchModifiers, MatchResult, PlayerMatchLine } from '../types/match'
import type { Fixture } from './fixtures'

export interface CareerRun {
  career: PlayerCareer
  world: World
  season: SeasonState
  /** One entry per round the player's club played, newest last. */
  log: RoundLogEntry[]
  /** Set when the wheel is waiting to be offered. */
  wheelPending: boolean
}

export interface RoundLogEntry {
  round: number
  match: MatchResult | null
  line: PlayerMatchLine | null
  /** 'W' | 'D' | 'L' from the club's point of view; null on a bye. */
  result: 'W' | 'D' | 'L' | null
  selected: boolean
  event: EventOutcome | null
  injuryPickedUp: string | null
}

/** Start a season: pay the wages, build the fixtures. */
export function beginSeason(career: PlayerCareer, world: World): CareerRun {
  const paid = creditSeasonSalary(career)
  const leagueId = paid.contract.leagueId
  const synced = syncCareerToWorld(world, paid)

  return {
    career: paid,
    world: synced,
    season: createSeason(synced.seed, paid.season, leagueId, teamsInLeague(synced, leagueId)),
    log: [],
    wheelPending: false,
  }
}

/** The round at which the wheel is offered, for this run's league. */
export function wheelRoundFor(run: CareerRun): number {
  return wheelRound(totalRounds(run.season))
}

/**
 * Play one round.
 *
 * The event for the round is resolved *before* the match, so a washout re-weights the match
 * it applies to rather than the next one.
 */
export function playRound(run: CareerRun): CareerRun {
  if (isRegularSeasonComplete(run.season)) return run

  const round = run.season.roundsPlayed + 1
  const clubId = run.career.contract.clubId
  const rng = rngFor(run.career.seed, 'career-round', run.career.season, round)

  // Between-round event.
  const eventsFired = run.log.filter((e) => e.event !== null).length
  const rolled = rollEvent(rng, 'player_career', eventsFired)
  const event = rolled ? resolveEvent(rolled, rng) : null

  let career = run.career
  if (event) {
    if (event.effects.length > 0) career = attachEffects(career, event.effects)
    if (event.weeksSuspended > 0) {
      career = {
        ...career,
        injury: {
          label: event.event.name,
          weeksRemaining: event.weeksSuspended,
          seasonEnding: false,
        },
      }
    }
  }

  const world = syncCareerToWorld(run.world, career)
  const season = { ...run.season, teams: teamsInLeague(world, run.season.leagueId) }

  const modifiersFor = (fixture: Fixture): MatchModifiers | undefined => {
    const involvesPlayer = fixture.homeId === clubId || fixture.awayId === clubId
    const base: MatchModifiers = {}
    if (event?.statWeightOverride) base.statWeightOverride = event.statWeightOverride
    if (event) base.conditions = event.event.name
    if (!involvesPlayer) return Object.keys(base).length > 0 ? base : undefined
    return { ...base, ...playerClubModifiers(career, fixture.homeId === clubId) }
  }

  const played = simulateRound(season, { modifiersFor })
  const match =
    played.results.find(
      (r) => r.round === round && (r.home.teamId === clubId || r.away.teamId === clubId),
    ) ?? null

  const outcome = applyRound(career, match, rng)
  career = outcome.career
  if (match) career = creditMatchEarnings(career, match)

  const entry: RoundLogEntry = {
    round,
    match,
    line: outcome.line,
    result: match ? clubResult(match, clubId) : null,
    selected: outcome.line !== null,
    event,
    injuryPickedUp: outcome.injuryPickedUp,
  }

  return {
    career,
    world: syncCareerToWorld(world, career),
    season: played,
    log: [...run.log, entry],
    // Offer the wheel once, at the midpoint, and only if it has not been used.
    wheelPending: round === wheelRound(totalRounds(played)) && !career.wheelSpunThisSeason,
  }
}

/** Take the spin. Positives are permanent, negatives temporary — never the other way round. */
export function takeWheelSpin(run: CareerRun): { run: CareerRun; result: SpinResult } {
  const rng = rngFor(run.career.seed, 'wheel', run.career.season)
  const result = spin(
    {
      stats: run.career.stats,
      position: run.career.position,
      ovr: run.career.ovr,
      traits: run.career.traits,
      isCaptain: run.career.isCaptain,
      salary: run.career.contract.salary,
      form: run.career.form,
      morale: run.career.morale,
      injury: run.career.injury,
      effects: run.career.effects,
    },
    rng,
  )

  const career: PlayerCareer = {
    ...run.career,
    stats: result.target.stats,
    ovr: result.target.ovr,
    traits: result.target.traits,
    isCaptain: result.target.isCaptain,
    contract: { ...run.career.contract, salary: result.target.salary },
    form: result.target.form,
    morale: result.target.morale,
    injury: result.target.injury,
    effects: result.target.effects,
    wheelSpunThisSeason: true,
  }

  return {
    run: { ...run, career, world: syncCareerToWorld(run.world, career), wheelPending: false },
    result,
  }
}

/** Decline the spin. It is genuinely skippable (SPEC §3). */
export function skipWheelSpin(run: CareerRun): CareerRun {
  return {
    ...run,
    career: { ...run.career, wheelSpunThisSeason: true },
    wheelPending: false,
  }
}

/**
 * Sim to the end of the regular season, yielding after every round.
 *
 * Stops early if the wheel comes up, so an optional decision is never skipped past.
 */
export function* runToSeasonEnd(run: CareerRun): Generator<CareerRun, CareerRun, void> {
  let current = run
  while (!isRegularSeasonComplete(current.season)) {
    current = playRound(current)
    yield current
    if (current.wheelPending) return current
  }
  return current
}

export interface SeasonClose {
  run: CareerRun
  summary: SeasonSummary
}

/** Play the finals and close the season out. */
export function closeSeason(run: CareerRun): SeasonClose {
  const withFinals = runFinals(run.season)
  const rng = rngFor(run.career.seed, 'progression', run.career.season)

  let career = run.career
  const clubId = career.contract.clubId

  // Finals appearances count towards the career like any other match.
  for (const final of withFinals.finals) {
    if (final.home.teamId !== clubId && final.away.teamId !== clubId) continue
    const line = playerLine(final)
    if (!line) continue
    career = {
      ...career,
      careerCaps: career.careerCaps + 1,
      careerTries: career.careerTries + line.tries,
      careerPoints: career.careerPoints + line.tries * 5 + line.kickPoints,
    }
    career = creditMatchEarnings(career, final)
  }

  if (withFinals.championId === clubId) {
    const club = findTeam(run.world, clubId)
    career = {
      ...career,
      trophies: [
        ...career.trophies,
        {
          season: career.season,
          name: getLeague(withFinals.leagueId).name,
          type: 'league',
          clubOrNation: club?.name ?? clubId,
        },
      ],
    }
  }

  const summary = endSeason(career, withFinals, rng)

  // SPEC §4: reconciliation is checked at every season boundary.
  assertReconciled(summary.career.ledger, `season ${career.season}`)

  return {
    run: { ...run, career: summary.career, season: withFinals },
    summary,
  }
}

/** Every round the player's club has played, for the dashboard match log. */
export function matchLog(run: CareerRun): RoundLogEntry[] {
  return run.log.filter((entry) => entry.match !== null)
}

export { PLAYER_ID }
