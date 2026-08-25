/**
 * Match simulation.
 *
 * Rugby union scoring, so the model works in tries first and points second: a match is
 * decided by how often each side breaks the other down, then converted into a scoreline via
 * goal-kicking. That keeps `W 31-17 · 2 tries · rating 8.4` internally consistent — the
 * tries in the match log really are the tries that produced the score.
 *
 * Everything is derived from the seeded RNG for the fixture's coordinates, so replaying a
 * round after a save/reload gives byte-identical results.
 */

import { getLeague } from '../data'
import { selectBestXV, type Selection } from './generate'
import { rngFor, type Rng } from './rng'
import type { LeagueId, PositionId, StatKey, Team } from '../types/core'
import type {
  MatchModifiers,
  MatchResult,
  PlayerMatchLine,
  TeamMatchLine,
} from '../types/match'

/** Line-breaking, running and distribution. */
const ATTACK_STATS: readonly StatKey[] = ['PAC', 'EVA', 'HND', 'CAR', 'VIS']
/** Stopping the other lot. */
const DEFENCE_STATS: readonly StatKey[] = ['TCK', 'RUK', 'FIT']
/** Scrum and lineout — the platform everything else is built on. */
const SET_PIECE_STATS: readonly StatKey[] = ['SCR', 'LNO']

/** Average tries per side per match, before any strength difference. */
const BASE_TRIES = 3.0
/** Home advantage, in effective strength points. */
const HOME_ADVANTAGE = 2.5
/** How much a point of strength difference is worth in expected tries. */
const TRIES_PER_STRENGTH_POINT = 0.085
/** Spread of the try count around its expectation. */
const TRY_VARIANCE = 1.25

const TRY_POINTS = 5
const CONVERSION_POINTS = 2
const PENALTY_POINTS = 3

/**
 * Relative likelihood of scoring a try by shirt. Wings and the fullback finish most of
 * them; props and locks score from close range and score few.
 */
const TRY_WEIGHTS: Record<PositionId, number> = {
  WL: 4.0,
  WR: 4.0,
  FB: 2.6,
  OC: 2.2,
  IC: 1.6,
  N8: 1.5,
  SH: 1.3,
  BF: 1.2,
  OF: 1.2,
  FH: 1.0,
  HOO: 1.0,
  LK1: 0.7,
  LK2: 0.7,
  LHP: 0.6,
  THP: 0.6,
}

/** Mean of the listed stats across an XV, with optional weather re-weighting. */
function facet(
  xv: readonly Selection[],
  stats: readonly StatKey[],
  overrides?: Partial<Record<StatKey, number>>,
): number {
  let sum = 0
  let weight = 0

  for (const selection of xv) {
    // Playing out of position degrades everything a player contributes.
    const penalty = selection.outOfPosition ? 0.8 : 1
    for (const stat of stats) {
      const value = selection.player.stats[stat]
      if (value === undefined) continue
      const w = overrides?.[stat] ?? 1
      sum += value * w * penalty
      weight += w
    }
  }

  return weight === 0 ? 50 : sum / weight
}

export interface TeamRating {
  attack: number
  defence: number
  setPiece: number
  overall: number
}

/**
 * Break a club down into the three facets that decide a match.
 *
 * `physicalityBias` shifts what a league rewards: the Premiership and RFU Championship
 * lean forward, so set piece counts for more there than in Super Rugby or the NPC.
 */
export function rateTeam(
  xv: readonly Selection[],
  leagueId: LeagueId,
  overrides?: Partial<Record<StatKey, number>>,
): TeamRating {
  const league = getLeague(leagueId)

  const attack = facet(xv, ATTACK_STATS, overrides)
  const defence = facet(xv, DEFENCE_STATS, overrides)
  const setPiece = facet(xv, SET_PIECE_STATS, overrides)

  let attackWeight = 0.42
  let defenceWeight = 0.34
  let setPieceWeight = 0.24

  if (league.physicalityBias === 'forward') {
    attackWeight -= 0.07
    setPieceWeight += 0.07
  } else if (league.physicalityBias === 'back') {
    attackWeight += 0.07
    setPieceWeight -= 0.07
  }

  return {
    attack,
    defence,
    setPiece,
    overall: attack * attackWeight + defence * defenceWeight + setPiece * setPieceWeight,
  }
}

/** Expected tries for the attacking side against this defence. */
function expectedTries(attacker: TeamRating, defender: TeamRating, strengthDelta: number): number {
  const edge = attacker.attack - defender.defence + strengthDelta
  // Platform matters: a side going backwards at scrum time creates less.
  const platform = (attacker.setPiece - defender.setPiece) * 0.25
  return Math.max(0.25, BASE_TRIES + (edge + platform) * TRIES_PER_STRENGTH_POINT)
}

function rollTries(rng: Rng, expected: number, variance: number): number {
  return Math.max(0, Math.round(rng.gaussian(expected, variance)))
}

/** The designated goal-kicker: the best boot among the shirts that usually take them. */
function kickerFor(xv: readonly Selection[]): Selection | undefined {
  const candidates = xv.filter((s) => s.slot === 'FH' || s.slot === 'FB' || s.slot === 'OC')
  const pool = candidates.length > 0 ? candidates : xv
  return pool.reduce<Selection | undefined>((best, s) => {
    const kick = s.player.stats.KCK ?? 0
    const bestKick = best?.player.stats.KCK ?? -1
    return kick > bestKick ? s : best
  }, undefined)
}

function conversionRate(kicker: Selection | undefined): number {
  const kck = kicker?.player.stats.KCK ?? 55
  // KCK 50 -> ~58%, KCK 90 -> ~82%.
  return Math.max(0.4, Math.min(0.9, 0.58 + (kck - 50) * 0.006))
}

/** Distribute a side's tries across its XV, weighted by shirt. */
function assignTryScorers(rng: Rng, xv: readonly Selection[], tries: number): Map<string, number> {
  const out = new Map<string, number>()
  if (tries <= 0 || xv.length === 0) return out

  for (let i = 0; i < tries; i++) {
    const scorer = rng.weighted(xv, (s) => {
      const base = TRY_WEIGHTS[s.slot] ?? 1
      // A sharper player in the shirt finishes more of what comes their way.
      return base * (0.6 + s.rating / 100)
    })
    out.set(scorer.player.id, (out.get(scorer.player.id) ?? 0) + 1)
  }

  return out
}

/**
 * Individual rating out of 10.
 *
 * Built from three things a viewer would actually notice: how the team went, how the player
 * rates against the level of the match, and what they personally did with the ball.
 */
function ratePerformance(
  rng: Rng,
  selection: Selection,
  opponentOverall: number,
  teamMargin: number,
  tries: number,
  kickPoints: number,
  bonus: number,
): number {
  let rating = 6.0

  // Quality relative to the opposition.
  rating += (selection.rating - opponentOverall) * 0.055

  // Team result, capped so a thrashing does not hand everyone a 10.
  rating += Math.max(-1.4, Math.min(1.4, teamMargin * 0.045))

  rating += tries * 0.85
  rating += kickPoints * 0.055

  if (selection.outOfPosition) rating -= 0.4

  rating += rng.gaussian(0, 0.55)
  rating += bonus

  return Math.max(1, Math.min(10, Math.round(rating * 10) / 10))
}

/** Ladder bonus points. Both thresholds come from the league data, never hardcoded. */
export function bonusPointsFor(
  leagueId: LeagueId,
  tries: number,
  score: number,
  opponentScore: number,
): number {
  const league = getLeague(leagueId)
  let points = 0

  // Scoring at least `tryBonus` tries.
  if (tries >= league.bonusPoints.tryBonus) points += 1
  // Losing by at most `losingBonus` points.
  const margin = opponentScore - score
  if (margin > 0 && margin <= league.bonusPoints.losingBonus) points += 1

  return points
}

export interface SimulateMatchArgs {
  seed: number
  season: number
  round: number
  home: Team
  away: Team
  modifiers?: MatchModifiers
}

/**
 * Simulate one match.
 *
 * Deterministic for a given `(seed, season, round, homeId, awayId)`, so the same fixture
 * always plays out the same way however many times the season is replayed.
 */
export function simulateMatch(args: SimulateMatchArgs): MatchResult {
  const { seed, season, round, home, away } = args
  const mods = args.modifiers ?? {}
  const leagueId = home.leagueId

  const rng = rngFor(seed, 'match', season, round, home.id, away.id)

  const homeXV = selectBestXV(home, mods.unavailableHome, mods.selectionAdjustHome)
  const awayXV = selectBestXV(away, mods.unavailableAway, mods.selectionAdjustAway)

  const homeRating = rateTeam(homeXV, leagueId, mods.statWeightOverride)
  const awayRating = rateTeam(awayXV, leagueId, mods.statWeightOverride)

  // A derby lifts the weaker side and widens the range of plausible results.
  const derby = mods.derbyIntensity ?? 0
  const underdogLift = derby > 0 ? (derby / 10) * 2.5 : 0
  const homeIsUnderdog = homeRating.overall < awayRating.overall

  const homeDelta =
    HOME_ADVANTAGE +
    (mods.homeStrengthDelta ?? 0) +
    (homeIsUnderdog ? underdogLift : 0)
  const awayDelta = (mods.awayStrengthDelta ?? 0) + (homeIsUnderdog ? 0 : underdogLift)

  const variance = TRY_VARIANCE + derby * 0.06

  const homeTries = rollTries(
    rng,
    expectedTries(homeRating, awayRating, homeDelta - awayDelta),
    variance,
  )
  const awayTries = rollTries(
    rng,
    expectedTries(awayRating, homeRating, awayDelta - homeDelta),
    variance,
  )

  const homeKicker = kickerFor(homeXV)
  const awayKicker = kickerFor(awayXV)

  const homeConversions = countConversions(rng, homeTries, conversionRate(homeKicker))
  const awayConversions = countConversions(rng, awayTries, conversionRate(awayKicker))

  // Penalty goals: a tighter, more physical contest yields more of them.
  const homePenalties = rollPenalties(rng, homeRating, awayRating)
  const awayPenalties = rollPenalties(rng, awayRating, homeRating)

  const homeScore =
    homeTries * TRY_POINTS + homeConversions * CONVERSION_POINTS + homePenalties * PENALTY_POINTS
  const awayScore =
    awayTries * TRY_POINTS + awayConversions * CONVERSION_POINTS + awayPenalties * PENALTY_POINTS

  const homeScorers = assignTryScorers(rng, homeXV, homeTries)
  const awayScorers = assignTryScorers(rng, awayXV, awayTries)

  const players: PlayerMatchLine[] = [
    ...buildLines(
      rng,
      homeXV,
      home.id,
      homeScorers,
      homeKicker,
      homeConversions * CONVERSION_POINTS + homePenalties * PENALTY_POINTS,
      awayRating.overall,
      homeScore - awayScore,
      mods.ratingBonus,
    ),
    ...buildLines(
      rng,
      awayXV,
      away.id,
      awayScorers,
      awayKicker,
      awayConversions * CONVERSION_POINTS + awayPenalties * PENALTY_POINTS,
      homeRating.overall,
      awayScore - homeScore,
      mods.ratingBonus,
    ),
  ]

  const homeLine: TeamMatchLine = {
    teamId: home.id,
    score: homeScore,
    tries: homeTries,
    conversions: homeConversions,
    penalties: homePenalties,
    bonusPoints: bonusPointsFor(leagueId, homeTries, homeScore, awayScore),
  }
  const awayLine: TeamMatchLine = {
    teamId: away.id,
    score: awayScore,
    tries: awayTries,
    conversions: awayConversions,
    penalties: awayPenalties,
    bonusPoints: bonusPointsFor(leagueId, awayTries, awayScore, homeScore),
  }

  const winnerId = homeScore === awayScore ? null : homeScore > awayScore ? home.id : away.id

  const result: MatchResult = {
    season,
    round,
    leagueId,
    home: homeLine,
    away: awayLine,
    winnerId,
    motmPlayerId: pickMotm(players, winnerId),
    players,
  }

  if (mods.derbyName) result.derbyName = mods.derbyName
  if (mods.conditions) result.conditions = mods.conditions

  return result
}

function countConversions(rng: Rng, tries: number, rate: number): number {
  let made = 0
  for (let i = 0; i < tries; i++) if (rng.bool(rate)) made++
  return made
}

function rollPenalties(rng: Rng, attacker: TeamRating, defender: TeamRating): number {
  // Sides that dominate the set piece win more penalties.
  const expected = 2.1 + (attacker.setPiece - defender.setPiece) * 0.03
  return Math.max(0, Math.round(rng.gaussian(Math.max(0.3, expected), 1.1)))
}

function buildLines(
  rng: Rng,
  xv: readonly Selection[],
  teamId: string,
  scorers: ReadonlyMap<string, number>,
  kicker: Selection | undefined,
  kickPointsTotal: number,
  opponentOverall: number,
  margin: number,
  ratingBonus: ReadonlyMap<string, number> | undefined,
): PlayerMatchLine[] {
  return xv.map((selection) => {
    const tries = scorers.get(selection.player.id) ?? 0
    const kickPoints = kicker && kicker.player.id === selection.player.id ? kickPointsTotal : 0
    const bonus = ratingBonus?.get(selection.player.id) ?? 0

    return {
      playerId: selection.player.id,
      playerName: selection.player.name,
      teamId,
      slot: selection.slot,
      rating: ratePerformance(
        rng,
        selection,
        opponentOverall,
        margin,
        tries,
        kickPoints,
        bonus,
      ),
      tries,
      kickPoints,
      outOfPosition: selection.outOfPosition,
    }
  })
}

/** Player of the match — the best performer, with the winning side favoured on a tie. */
function pickMotm(players: readonly PlayerMatchLine[], winnerId: string | null): string {
  let best = players[0]!
  for (const line of players) {
    if (line.rating > best.rating) {
      best = line
      continue
    }
    if (line.rating === best.rating && winnerId !== null) {
      if (line.teamId === winnerId && best.teamId !== winnerId) best = line
    }
  }
  return best.playerId
}
