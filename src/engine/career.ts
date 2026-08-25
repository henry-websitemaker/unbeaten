/**
 * Player Career: creation, the season loop, and Summer Plans.
 *
 * The player is an ordinary member of their club's squad, so selection, ratings and try
 * scoring all run through the same code that handles everyone else. Nothing here gives the
 * player a private path through the match engine.
 */

import { KEY_STAT_CREATION_BONUS, POSITIONS, getLeague } from '../data'
import { computeOvr } from './ovr'
import { applyKeyStatBonus, rollStats, shiftToOvr, selectBestXV } from './generate'
import {
  createLedger,
  createLifestyleState,
  credit,
  expectedSalary,
  lifestyleEffects,
  winBonus,
} from './economy'
import {
  applyClubMove,
  applySeasonProgression,
  clubMoveDirection,
  getArchetype,
} from './progression'
import { advanceEffects, applySlumpReduction, totalEffects } from './events'
import { advanceInjury, rollMatchInjury } from './injuries'
import { rngFor, type Rng } from './rng'
import { currentLadder, resultsForTeam, type SeasonState } from './season'
import {
  computeInternationals,
  computeSeasonAwards,
  recentFormRating,
  type InternationalOutcome,
  type SeasonAwards,
} from './seasonClose'
import { ladderRow } from './ladder'
import { findTeam, joinClub, teamsInLeague, updatePlayer, type World } from './world'
import { CAREER_SEASONS, type PlayerCareer, type SeasonRecord, type SquadRole, type TransferOffer } from '../types/career'
import type { LeagueId, Player, PositionId, StatBlock, StatKey, Team } from '../types/core'
import type { MatchModifiers, MatchResult, PlayerMatchLine } from '../types/match'

export const PLAYER_ID = 'player'

/** SPEC §3: a random low-tier start at OVR 55-65. */
export const STARTING_OVR_RANGE: [number, number] = [55, 65]

// ---------------------------------------------------------------------------
// Origin draft
// ---------------------------------------------------------------------------

/** One stat card, lifted from a real player's stat block. */
export interface OriginCard {
  playerName: string
  stat: StatKey
  value: number
}

export interface OriginDraftRound {
  stat: StatKey
  options: OriginCard[]
}

/**
 * Build the origin draft: stat cards pulled from real stars, one stat locked at a time.
 *
 * Cards come from actual players at the same position in the recovered data, so the numbers
 * on offer are the numbers real players have.
 */
export function buildOriginDraft(
  rng: Rng,
  position: PositionId,
  pool: readonly { name: string; position: PositionId; stats: StatBlock }[],
  optionsPerRound = 3,
): OriginDraftRound[] {
  const def = POSITIONS[position]
  const samePosition = pool.filter((p) => p.position === position)
  const candidates = samePosition.length >= optionsPerRound ? samePosition : pool

  // One locked choice per key stat — the three that define the position.
  return def.keyStats.map((stat) => {
    const withStat = candidates.filter((p) => p.stats[stat] !== undefined)
    const source = withStat.length >= optionsPerRound ? withStat : candidates
    const picked = rng.shuffle(source).slice(0, optionsPerRound)

    return {
      stat,
      options: picked.map((p) => ({
        playerName: p.name,
        stat,
        value: p.stats[stat] ?? rng.int(60, 80),
      })),
    }
  })
}

export interface CreateCareerOptions {
  name: string
  position: PositionId
  archetypeId: string
  nationId: string
  /** Stats locked during the origin draft. */
  lockedStats?: Partial<Record<StatKey, number>>
}

/**
 * Build the player's stat block.
 *
 * The §2.6 key-stat rule is applied first — key stats start +4..+6 above everything else —
 * then any stats locked in the origin draft are written over the top, then the whole block
 * is shifted to the archetype's starting OVR. Shifting is additive, so both the draft picks'
 * relative standing and the key-stat gaps survive it.
 */
export function buildStartingStats(
  rng: Rng,
  position: PositionId,
  archetypeId: string,
  lockedStats?: Partial<Record<StatKey, number>>,
): { stats: StatBlock; ovr: number } {
  const archetype = getArchetype(archetypeId)

  let stats = applyKeyStatBonus(rng, rollStats(rng, position), position, KEY_STAT_CREATION_BONUS)

  if (lockedStats) {
    stats = { ...stats }
    for (const [stat, value] of Object.entries(lockedStats) as [StatKey, number][]) {
      if (stats[stat] !== undefined) stats[stat] = value
    }
  }

  const [minStart, maxStart] = archetype.startOvrRange
  const [floor, ceiling] = STARTING_OVR_RANGE
  const target = Math.max(floor, Math.min(ceiling, rng.int(minStart, maxStart)))

  const shifted = shiftToOvr(stats, position, target)
  return { stats: shifted, ovr: computeOvr(shifted, position) }
}

export function createCareer(
  seed: number,
  options: CreateCareerOptions,
  startingClub: Team,
): PlayerCareer {
  const rng = rngFor(seed, 'creation')
  const archetype = getArchetype(options.archetypeId)
  const { stats, ovr } = buildStartingStats(rng, options.position, options.archetypeId, options.lockedStats)

  const league = getLeague(startingClub.leagueId)
  const salary = Math.round(
    expectedSalary(startingClub.leagueId, ovr, 0.8) * archetype.startingSalaryMultiplier,
  )
  const years = Math.max(1, 2 + (archetype.contractLengthModifier ?? 0))

  return {
    seed,
    name: options.name,
    position: options.position,
    archetypeId: options.archetypeId,
    nationId: options.nationId,

    age: archetype.startAge,
    stats,
    ovr,
    traits: [],

    season: 1,
    round: 0,

    contract: {
      clubId: startingClub.id,
      leagueId: league.id,
      salary,
      years,
      yearsServed: 0,
    },
    ledger: createLedger(),
    lifestyle: createLifestyleState(),

    form: 60,
    morale: 65,
    isCaptain: false,

    injury: null,
    effects: [],

    history: [],
    trophies: [],
    awards: [],
    achievements: [],

    careerCaps: 0,
    careerTries: 0,
    careerPoints: 0,
    internationalCaps: 0,
    internationalTries: 0,

    rivalId: null,
    retired: false,
    wheelSpunThisSeason: false,
  }
}

/** The player as a squad member, for insertion into their club. */
export function careerAsPlayer(career: PlayerCareer): Player {
  return {
    id: PLAYER_ID,
    name: career.name,
    position: career.position,
    age: career.age,
    stats: career.stats,
    ovr: career.ovr,
  }
}

export function placeCareerInWorld(world: World, career: PlayerCareer): World {
  return joinClub(world, career.contract.clubId, careerAsPlayer(career))
}

export function syncCareerToWorld(world: World, career: PlayerCareer): World {
  return updatePlayer(world, careerAsPlayer(career))
}

// ---------------------------------------------------------------------------
// Availability and selection
// ---------------------------------------------------------------------------

export function isPlayerAvailable(career: PlayerCareer): boolean {
  return career.injury === null
}

/**
 * How form, morale and any "Dropped" penalty nudge the player's selection chances.
 *
 * Deliberately separate from ability: this moves whether the player is *picked*, not how
 * good they are once they are on the pitch.
 */
export function selectionAdjustment(career: PlayerCareer): number {
  const totals = totalEffects(career.effects)
  const formSwing = (career.form - 60) * 0.06
  const moraleSwing = (career.morale - 60) * 0.03
  return formSwing + moraleSwing - totals.selectionPenalty * 0.2
}

/** Build the match modifiers for the player's own club. */
export function playerClubModifiers(
  career: PlayerCareer,
  isHome: boolean,
): MatchModifiers {
  const adjust = new Map<string, number>([[PLAYER_ID, selectionAdjustment(career)]])
  const unavailable = isPlayerAvailable(career) ? undefined : new Set([PLAYER_ID])

  const effects = lifestyleEffects(career.lifestyle, career.season)
  const ratingBonus = new Map<string, number>()
  if (effects.bigMatchRatingBonus > 0) {
    ratingBonus.set(PLAYER_ID, effects.bigMatchRatingBonus)
  }
  if (career.traits.includes('clutch')) {
    ratingBonus.set(PLAYER_ID, (ratingBonus.get(PLAYER_ID) ?? 0) + 0.3)
  }

  const mods: MatchModifiers = {}
  if (isHome) {
    mods.selectionAdjustHome = adjust
    if (unavailable) mods.unavailableHome = unavailable
  } else {
    mods.selectionAdjustAway = adjust
    if (unavailable) mods.unavailableAway = unavailable
  }
  if (ratingBonus.size > 0) mods.ratingBonus = ratingBonus
  return mods
}

export function playerLine(result: MatchResult): PlayerMatchLine | undefined {
  return result.players.find((p) => p.playerId === PLAYER_ID)
}

export function playerWasSelected(result: MatchResult): boolean {
  return playerLine(result) !== undefined
}

/** Did the player's club win, draw or lose? */
export function clubResult(result: MatchResult, clubId: string): 'W' | 'D' | 'L' {
  if (result.winnerId === null) return 'D'
  return result.winnerId === clubId ? 'W' : 'L'
}

// ---------------------------------------------------------------------------
// Round-by-round updates
// ---------------------------------------------------------------------------

export interface RoundOutcome {
  career: PlayerCareer
  /** The player's own club's match, if it had one this round. */
  match: MatchResult | null
  line: PlayerMatchLine | null
  /** Set when the player picked up a knock. */
  injuryPickedUp: string | null
}

/**
 * Fold one round's result into the career: appearances, tries, form, morale, injuries.
 */
export function applyRound(
  career: PlayerCareer,
  match: MatchResult | null,
  rng: Rng,
): RoundOutcome {
  let next: PlayerCareer = { ...career, round: career.round + 1 }

  // Recover from an existing injury regardless of whether the club played.
  next.injury = advanceInjury(next.injury)

  if (!match) {
    return { career: next, match: null, line: null, injuryPickedUp: null }
  }

  const line = playerLine(match)
  if (!line) {
    // Not selected. Morale drifts down; the player stays fresh.
    next = {
      ...next,
      morale: clamp(next.morale - 3, 0, 100),
      effects: advanceEffects(next.effects),
    }
    return { career: next, match, line: null, injuryPickedUp: null }
  }

  const outcome = clubResult(match, next.contract.clubId)
  const ratingSwing = (line.rating - 6.5) * 4
  const resultSwing = outcome === 'W' ? 5 : outcome === 'D' ? 0 : -4

  const lifestyle = lifestyleEffects(next.lifestyle, next.season)
  const archetype = getArchetype(next.archetypeId)

  const injury = rollMatchInjury(rng, {
    riskMultiplier: (archetype.injuryRiskMultiplier ?? 1) * lifestyle.injuryRiskMultiplier,
    recoveryWeeksReduction: lifestyle.recoveryWeeksReduction,
    fitness: next.stats.FIT ?? 70,
  })

  next = {
    ...next,
    careerCaps: next.careerCaps + 1,
    careerTries: next.careerTries + line.tries,
    careerPoints: next.careerPoints + line.tries * 5 + line.kickPoints,
    form: clamp(next.form + ratingSwing * 0.6, 0, 100),
    morale: clamp(next.morale + resultSwing + ratingSwing * 0.3, 0, 100),
    effects: advanceEffects(next.effects),
    injury: injury ?? next.injury,
  }

  return {
    career: next,
    match,
    line,
    injuryPickedUp: injury ? injury.label : null,
  }
}

/** Attach new temporary effects, shortening slumps if the psychologist is on the books. */
export function attachEffects(
  career: PlayerCareer,
  effects: readonly import('../types/career').TemporaryEffect[],
): PlayerCareer {
  const lifestyle = lifestyleEffects(career.lifestyle, career.season)
  const adjusted = applySlumpReduction(effects, lifestyle.slumpDurationMultiplier)
  return { ...career, effects: [...career.effects, ...adjusted] }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

// ---------------------------------------------------------------------------
// Season boundaries
// ---------------------------------------------------------------------------

/** Match-day earnings, credited as they are actually earned. */
export function creditMatchEarnings(
  career: PlayerCareer,
  match: MatchResult,
): PlayerCareer {
  if (clubResult(match, career.contract.clubId) !== 'W') return career
  return {
    ...career,
    ledger: credit(
      career.ledger,
      career.season,
      'win_bonus',
      'Win bonus',
      winBonus(career.contract.leagueId),
    ),
  }
}

/** Salary is paid at the start of each season. */
export function creditSeasonSalary(career: PlayerCareer): PlayerCareer {
  return {
    ...career,
    ledger: credit(
      career.ledger,
      career.season,
      'salary',
      `Wages, season ${career.season}`,
      career.contract.salary,
    ),
  }
}

export interface SeasonSummary {
  career: PlayerCareer
  record: SeasonRecord
  ovrDelta: number
  breakdown: { performance: number; age: number; phase: string }
  /** SPEC §3: the test season, whether or not the player was in it. */
  internationals: InternationalOutcome
  /** SPEC §3: the league awards, the near miss, and World Player of the Year. */
  awards: SeasonAwards
}

/**
 * Close out a season: build the record, apply progression, age the player.
 *
 * Progression is the only place OVR moves at a season boundary, and it is driven purely by
 * how the player actually played (SPEC §2.5).
 *
 * The order matters. Internationals run first, because World Player of the Year scores on
 * test caps and would judge the player on a season they had not finished yet.
 */
export function endSeason(
  career: PlayerCareer,
  season: SeasonState,
  rng: Rng,
): SeasonSummary {
  const clubId = career.contract.clubId
  const club = season.teams.find((t) => t.id === clubId)
  const results = resultsForTeam(season, clubId)

  const lines = results
    .map((r) => playerLine(r))
    .filter((line): line is PlayerMatchLine => line !== undefined)

  const appearances = lines.length
  const tries = lines.reduce((total, l) => total + l.tries, 0)
  const points = lines.reduce((total, l) => total + l.tries * 5 + l.kickPoints, 0)
  const avgRating =
    appearances === 0 ? 0 : lines.reduce((total, l) => total + l.rating, 0) / appearances
  const motm = results.filter((r) => r.motmPlayerId === PLAYER_ID).length

  const ladder = currentLadder(season)
  const position = ladderRow(ladder, clubId)?.position ?? ladder.length

  // --- internationals (SPEC §3) ---
  const internationals = computeInternationals({
    seed: career.seed,
    season: career.season,
    nationId: career.nationId,
    ovr: career.ovr,
    formRating: recentFormRating(lines.map((l) => l.rating)),
    existingCaps: career.internationalCaps,
  })

  // --- awards (SPEC §3) ---
  const awards = computeSeasonAwards({
    seed: career.seed,
    season: career.season,
    leagueId: season.leagueId,
    results: season.results,
    teams: season.teams,
    playerId: PLAYER_ID,
    playerCandidate:
      appearances === 0
        ? null
        : {
            playerName: career.name,
            clubName: club?.name ?? clubId,
            leagueId: season.leagueId,
            appearances,
            tries,
            // Counted with this season's caps included, which is why internationals run first.
            internationalCaps: career.internationalCaps + internationals.caps,
            avgRating: Math.round(avgRating * 100) / 100,
            // This season's silverware only. The simulated elite pool is scored on a single
            // season, so a career total here would hand the award to whoever had been
            // playing longest.
            trophies:
              (season.championId === clubId ? 1 : 0) + internationals.trophies.length,
          },
  })

  const lifestyle = lifestyleEffects(career.lifestyle, career.season)
  const progression = applySeasonProgression({
    stats: career.stats,
    position: career.position,
    age: career.age,
    archetype: getArchetype(career.archetypeId),
    avgRating: appearances > 0 ? avgRating : 5.5,
    appearances,
    matchGrowthMultiplier: lifestyle.matchGrowthMultiplier,
    rng,
  })

  const record: SeasonRecord = {
    season: career.season,
    clubId,
    clubName: club?.name ?? clubId,
    leagueId: season.leagueId,
    appearances,
    tries,
    points,
    avgRating: Math.round(avgRating * 100) / 100,
    motm,
    ladderPosition: position,
    championship: season.championId === clubId,
    salary: career.contract.salary,
    ovrStart: career.ovr,
    ovrEnd: progression.ovr,
    internationalCaps: internationals.caps,
    injuries: 0,
  }

  const next: PlayerCareer = {
    ...career,
    stats: progression.stats,
    ovr: progression.ovr,
    age: career.age + 1,
    history: [...career.history, record],
    internationalCaps: career.internationalCaps + internationals.caps,
    internationalTries: career.internationalTries + internationals.tries,
    trophies: [...career.trophies, ...internationals.trophies],
    awards: [...career.awards, ...awards.playerWins],
    contract: { ...career.contract, yearsServed: career.contract.yearsServed + 1 },
    // A new season starts fresh: temporary effects and the wheel both reset.
    effects: [],
    injury: null,
    wheelSpunThisSeason: false,
    round: 0,
    form: lifestyle.startSeasonInPeakForm ? 85 : clamp(career.form, 45, 75),
    morale: clamp(career.morale, 45, 80),
  }

  return {
    career: next,
    record,
    ovrDelta: progression.ovrDelta,
    breakdown: progression.breakdown,
    internationals,
    awards,
  }
}

/** Move to the next season, or retire at 20 (SPEC §2.1). */
export function advanceSeason(career: PlayerCareer): PlayerCareer {
  if (career.season >= CAREER_SEASONS) {
    return { ...career, retired: true }
  }
  return { ...career, season: career.season + 1 }
}

export function isFinalSeason(career: PlayerCareer): boolean {
  return career.season >= CAREER_SEASONS
}

export function seasonsRemaining(career: PlayerCareer): number {
  return Math.max(0, CAREER_SEASONS - career.season)
}

// ---------------------------------------------------------------------------
// Summer Plans — transfers
// ---------------------------------------------------------------------------

export function squadRoleFor(career: PlayerCareer, club: Team): SquadRole {
  const xv = selectBestXV(club)
  const squadOvrs = club.squad.map((p) => p.ovr).sort((a, b) => b - a)
  const rank = squadOvrs.filter((o) => o > career.ovr).length

  if (rank === 0) return 'star'
  if (xv.length > 0 && rank < 8) return 'starter'
  if (rank < 18) return 'squad'
  return 'fringe'
}

const ROLE_SALARY_FACTOR: Record<SquadRole, number> = {
  star: 1.2,
  starter: 1,
  squad: 0.75,
  fringe: 0.55,
}

/**
 * Generate the Summer Plans destination cards.
 *
 * Every card carries the OVR consequence of taking it (SPEC §2.5), shown *before* the
 * choice is made — stepping up a tier is +1 to +3, staying is nothing, dropping down is
 * -1 to -3. Staying put is always offered, so "no move" is a real option rather than the
 * absence of one.
 */
export function generateTransferOffers(
  career: PlayerCareer,
  world: World,
  rng: Rng,
): TransferOffer[] {
  const lifestyle = lifestyleEffects(career.lifestyle, career.season)
  const archetype = getArchetype(career.archetypeId)

  const baseOffers = 2
  const extra = (archetype.extraOffersPerWindow ?? 0) + lifestyle.extraOffersPerWindow
  const wanted = baseOffers + extra

  const currentClub = findTeam(world, career.contract.clubId)
  const currentTier = currentClub ? getLeague(currentClub.leagueId).tier : 2

  // Interest scales with how good the player is relative to a club's squad.
  const candidates = world.teams
    .filter((t) => t.id !== career.contract.clubId)
    .map((club) => {
      const league = getLeague(club.leagueId)
      const squadAvg = club.squad.reduce((a, p) => a + p.ovr, 0) / Math.max(1, club.squad.length)
      return { club, league, gap: career.ovr - squadAvg }
    })
    // A club will not sign someone far below its level.
    .filter((c) => c.gap > -6)

  if (candidates.length === 0) return [stayOffer(career, world)]

  const chosen: typeof candidates = []
  const pool = [...candidates]
  for (let i = 0; i < wanted && pool.length > 0; i++) {
    // Weighted so the better the season, the better the clubs that come calling.
    const pick = rng.weighted(pool, (c) => Math.max(0.1, 6 + c.gap))
    chosen.push(pick)
    pool.splice(pool.indexOf(pick), 1)
  }

  const offers = chosen.map(({ club, league }) => {
    const role = squadRoleFor(career, club)
    const direction = clubMoveDirection(currentTier, league.tier)
    const salary = Math.round(
      expectedSalary(league.id, career.ovr, ROLE_SALARY_FACTOR[role]) *
        lifestyle.futureSalaryMultiplier,
    )

    return {
      clubId: club.id,
      clubName: club.name,
      leagueId: league.id,
      leagueName: league.name,
      tier: league.tier,
      salary,
      years: Math.max(1, rng.int(2, 4) + (archetype.contractLengthModifier ?? 0)),
      squadRole: role,
      direction,
      ovrChangeRange: ovrRangeFor(direction),
    } satisfies TransferOffer
  })

  return [stayOffer(career, world), ...offers]
}

function stayOffer(career: PlayerCareer, world: World): TransferOffer {
  const club = findTeam(world, career.contract.clubId)
  const league = getLeague(career.contract.leagueId)
  return {
    clubId: career.contract.clubId,
    clubName: club?.name ?? 'Current club',
    leagueId: league.id,
    leagueName: league.name,
    tier: league.tier,
    salary: career.contract.salary,
    years: Math.max(1, career.contract.years - career.contract.yearsServed),
    squadRole: club ? squadRoleFor(career, club) : 'squad',
    direction: 'stay',
    ovrChangeRange: [0, 0],
  }
}

function ovrRangeFor(direction: TransferOffer['direction']): [number, number] {
  if (direction === 'up') return [1, 3]
  if (direction === 'down') return [-3, -1]
  return [0, 0]
}

export interface TransferResult {
  career: PlayerCareer
  ovrDelta: number
}

/** Accept an offer. The rolled OVR change is returned for the season review. */
export function acceptOffer(
  career: PlayerCareer,
  offer: TransferOffer,
  rng: Rng,
): TransferResult {
  const move = applyClubMove(career.stats, career.position, offer.direction, rng)

  return {
    career: {
      ...career,
      stats: move.stats,
      ovr: move.ovr,
      contract: {
        clubId: offer.clubId,
        leagueId: offer.leagueId,
        salary: offer.salary,
        years: offer.years,
        yearsServed: 0,
      },
      // A new club, a new dressing room.
      isCaptain: offer.clubId === career.contract.clubId ? career.isCaptain : false,
    },
    ovrDelta: move.ovrDelta,
  }
}

// ---------------------------------------------------------------------------
// Season preview
// ---------------------------------------------------------------------------

export interface SeasonPreview {
  clubName: string
  leagueName: string
  leagueId: LeagueId
  tier: 1 | 2
  salary: number
  contractYearsRemaining: number
  squadRole: SquadRole
  coachExpectation: string
  leagueDifficulty: string
  ovr: number
  form: number
  perfectTarget: number
}

/** Everything the season preview screen shows (SPEC §3). */
export function buildSeasonPreview(career: PlayerCareer, world: World): SeasonPreview {
  const club = findTeam(world, career.contract.clubId)
  const league = getLeague(career.contract.leagueId)
  const role = club ? squadRoleFor(career, club) : 'squad'

  const rivals = teamsInLeague(world, league.id)
  const squadAvg = (t: Team) => t.squad.reduce((a, p) => a + p.ovr, 0) / Math.max(1, t.squad.length)
  const ranked = [...rivals].sort((a, b) => squadAvg(b) - squadAvg(a))
  const clubRank = club ? ranked.findIndex((t) => t.id === club.id) + 1 : ranked.length

  return {
    clubName: club?.name ?? 'Unknown',
    leagueName: league.name,
    leagueId: league.id,
    tier: league.tier,
    salary: career.contract.salary,
    contractYearsRemaining: Math.max(0, career.contract.years - career.contract.yearsServed),
    squadRole: role,
    coachExpectation: expectationFor(clubRank, rivals.length),
    leagueDifficulty: league.tier === 1 ? 'Elite' : 'Developing',
    ovr: career.ovr,
    form: Math.round(career.form),
    perfectTarget: league.perfectTarget,
  }
}

function expectationFor(rank: number, total: number): string {
  if (total === 0) return 'Compete'
  const share = rank / total
  if (share <= 0.2) return 'Win the title'
  if (share <= 0.45) return 'Reach the finals'
  if (share <= 0.75) return 'Finish mid-table'
  return 'Avoid the bottom'
}
