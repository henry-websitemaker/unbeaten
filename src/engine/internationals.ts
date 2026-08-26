/**
 * Test rugby.
 *
 * Selection is form-based rather than OVR-only, with the bar scaling by nation strength —
 * SPEC §3 is explicit that a hot streak at a smaller club can force a call-up, and that
 * breaking into New Zealand is harder than breaking into Italy.
 *
 * World Cups land in seasons 4, 8, 12, 16 and 20, which is read from `internationals.json`
 * rather than assumed.
 */

import { INTERNATIONALS } from '../data'
import type { LeagueId } from '../types/core'
import type { Rng } from './rng'

export interface Nation {
  id: string
  name: string
  hemisphere: 'north' | 'south'
  /**
   * Which annual championship a nation belongs to.
   *
   * Regions rather than hemispheres because the two disagree: Georgia, Romania and Spain are
   * all northern, and picking the Six Nations field by hemisphere would quietly enrol them
   * in it. A nation plays in exactly one regional championship.
   */
  region: string
  strength: number
  feederLeagues: LeagueId[]
}

export interface Competition {
  id: string
  name: string
  hemisphere: 'north' | 'south' | 'both'
  /** Set on the regional championships. Absent on the Autumn tests and the World Cup. */
  region?: string
  frequency: string
  matches: number
  prestige: number
  trophyType?: string
  worldCupSeasons?: number[]
}

interface InternationalsData {
  selection: {
    formWindowMatches: number
    minAvgRatingForDebut: number
    minOvrForDebut: number
    squadSize: number
  }
  competitions: Competition[]
  nations: Nation[]
}

const DATA = INTERNATIONALS as unknown as InternationalsData

export const NATIONS: readonly Nation[] = DATA.nations
export const COMPETITIONS: readonly Competition[] = DATA.competitions
export const SELECTION_RULES = DATA.selection

export const WORLD_CUP = COMPETITIONS.find((c) => c.id === 'world_cup')!
export const WORLD_CUP_SEASONS: readonly number[] = WORLD_CUP.worldCupSeasons ?? []

/** How many nations reach a World Cup. The bracket seeds 1-4 into the quarters. */
export const WORLD_CUP_FIELD_SIZE = 12

/**
 * The nations that actually contest a World Cup: the strongest twelve.
 *
 * The regional championships brought in ten more nations, every one of them weaker than the
 * twelve already here, so this field is unchanged by their arrival — which is what keeps the
 * SPEC §2.4 World Cup targets measuring the same tournament they were tuned against. If a
 * future nation is strong enough to displace one of the twelve, it qualifies on merit and
 * those targets should be re-measured rather than the field pinned.
 */
export const WORLD_CUP_FIELD: readonly Nation[] = [...DATA.nations]
  .sort((a, b) => b.strength - a.strength)
  .slice(0, WORLD_CUP_FIELD_SIZE)

export function getNation(id: string): Nation {
  const nation = NATIONS.find((n) => n.id === id)
  if (!nation) throw new Error(`Unknown nation: ${id}`)
  return nation
}

export function isWorldCupSeason(season: number): boolean {
  return WORLD_CUP_SEASONS.includes(season)
}

/** The nations a player at this club could realistically represent. */
export function nationsForLeague(leagueId: LeagueId): Nation[] {
  return NATIONS.filter((n) => n.feederLeagues.includes(leagueId))
}

/** Nations ranked strongest first — used for the "outside the top 6" balance target. */
export function nationsByStrength(): Nation[] {
  return [...NATIONS].sort((a, b) => b.strength - a.strength)
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export interface SelectionInput {
  nationId: string
  ovr: number
  /** Mean rating across the recent form window. */
  formRating: number
  /** Already capped players face a lower bar than an uncapped one. */
  existingCaps: number
}

/**
 * The rating a player must be averaging to force their way in.
 *
 * Scales with nation strength, so the same form that gets you into Samoa will not get you
 * into New Zealand. An established international is judged a little more kindly.
 */
export function selectionThreshold(nation: Nation, existingCaps: number): number {
  const base = SELECTION_RULES.minAvgRatingForDebut
  // Italy (74) sits ~0.4 below the bar that New Zealand (95) sets.
  const strengthPenalty = (nation.strength - 80) * 0.02
  const establishedDiscount = Math.min(0.5, existingCaps * 0.01)
  return base + strengthPenalty - establishedDiscount
}

/** The OVR floor, likewise scaled by nation. */
export function ovrFloor(nation: Nation, existingCaps: number): number {
  const base = SELECTION_RULES.minOvrForDebut
  const strengthPenalty = (nation.strength - 80) * 0.25
  const establishedDiscount = Math.min(6, existingCaps * 0.2)
  return base + strengthPenalty - establishedDiscount
}

export interface SelectionVerdict {
  selected: boolean
  threshold: number
  ovrFloor: number
  reason: string
}

export function assessSelection(input: SelectionInput): SelectionVerdict {
  const nation = getNation(input.nationId)
  const threshold = selectionThreshold(nation, input.existingCaps)
  const floor = ovrFloor(nation, input.existingCaps)

  if (input.ovr < floor) {
    return {
      selected: false,
      threshold,
      ovrFloor: floor,
      reason: `${nation.name} are not looking below ${Math.round(floor)} OVR.`,
    }
  }

  if (input.formRating < threshold) {
    return {
      selected: false,
      threshold,
      ovrFloor: floor,
      reason: `Needs ${threshold.toFixed(1)} average form; you are on ${input.formRating.toFixed(1)}.`,
    }
  }

  return {
    selected: true,
    threshold,
    ovrFloor: floor,
    reason: `Named in the ${nation.name} squad.`,
  }
}

/** Does a nation contest this competition at all? */
export function isInField(nation: Nation, competition: Competition): boolean {
  if (competition.id === 'world_cup') {
    return WORLD_CUP_FIELD.some((n) => n.id === nation.id)
  }
  // A regional championship is decided by region, never by hemisphere.
  if (competition.region) return competition.region === nation.region
  if (competition.hemisphere === 'both') return true
  return competition.hemisphere === nation.hemisphere
}

/** The competitions a nation plays in a given season. */
export function competitionsForSeason(nation: Nation, season: number): Competition[] {
  return COMPETITIONS.filter((competition) => {
    if (competition.id === 'world_cup') {
      return isWorldCupSeason(season) && isInField(nation, competition)
    }
    return isInField(nation, competition)
  })
}

// ---------------------------------------------------------------------------
// Simulating a tournament
// ---------------------------------------------------------------------------

/**
 * Probability the first nation beats the second.
 *
 * A logistic curve on the strength gap. The scale is what controls how upset-prone test
 * rugby is, and it is tuned against the SPEC §2.4 targets: the big four take 65-80% of
 * World Cups between them, nobody exceeds 30%, and a nation outside the top six reaches a
 * final often enough to matter.
 */
export const STRENGTH_SCALE = 10.5

/**
 * How much a nation's form varies between tournaments.
 *
 * Together with `STRENGTH_SCALE` this is what keeps the World Cup honest. The top four
 * seeds are also the four strongest nations *and* get a bye to the quarter-finals, which
 * compounds their advantage — without meaningful tournament form they take well over 80%
 * of titles, above the SPEC §2.4 ceiling.
 */
export const TOURNAMENT_FORM_SD = 5.5

export function winProbability(a: Nation, b: Nation, aAdvantage = 0): number {
  const gap = a.strength - b.strength + aAdvantage
  return 1 / (1 + Math.exp(-gap / STRENGTH_SCALE))
}

export interface TournamentResult {
  championId: string
  finalistIds: [string, string]
  semiFinalistIds: string[]
  /** Every knockout tie, in order. */
  ties: { round: string; winnerId: string; loserId: string }[]
}

/**
 * A World Cup: seeds 1-4 go straight to the quarter-finals, seeds 5-12 play a round first.
 *
 * Form is rolled per nation per tournament, so the same seeding does not produce the same
 * winner every cycle — which is what keeps a shock run possible.
 */
export function simulateWorldCup(
  rng: Rng,
  nations: readonly Nation[] = WORLD_CUP_FIELD,
): TournamentResult {
  // Tournament form: a nation can arrive in poor shape or peaking.
  const withForm = nations.map((nation) => ({
    nation,
    form: rng.gaussian(0, TOURNAMENT_FORM_SD),
  }))
  const seeded = [...withForm].sort(
    (a, b) => b.nation.strength + b.form - (a.nation.strength + a.form),
  )

  const ties: TournamentResult['ties'] = []
  const play = (
    a: { nation: Nation; form: number },
    b: { nation: Nation; form: number },
    round: string,
  ) => {
    const p = winProbability(a.nation, b.nation, a.form - b.form)
    const aWins = rng.bool(p)
    const winner = aWins ? a : b
    const loser = aWins ? b : a
    ties.push({ round, winnerId: winner.nation.id, loserId: loser.nation.id })
    return winner
  }

  const byes = seeded.slice(0, 4)
  const playOff = seeded.slice(4, 12)

  // Play-off round: 5v12, 6v11, 7v10, 8v9.
  const qualifiers: typeof seeded = []
  for (let i = 0; i < playOff.length / 2; i++) {
    const a = playOff[i]
    const b = playOff[playOff.length - 1 - i]
    if (!a || !b) continue
    qualifiers.push(play(a, b, 'play-off'))
  }

  const quarterField = [...byes, ...qualifiers]
  const semiField: typeof seeded = []
  for (let i = 0; i < quarterField.length / 2; i++) {
    const a = quarterField[i]
    const b = quarterField[quarterField.length - 1 - i]
    if (!a || !b) continue
    semiField.push(play(a, b, 'quarter-final'))
  }

  const finalField: typeof seeded = []
  for (let i = 0; i < semiField.length / 2; i++) {
    const a = semiField[i]
    const b = semiField[semiField.length - 1 - i]
    if (!a || !b) continue
    finalField.push(play(a, b, 'semi-final'))
  }

  const first = finalField[0]
  const second = finalField[1]
  if (!first || !second) {
    const only = first ?? second ?? seeded[0]!
    return {
      championId: only.nation.id,
      finalistIds: [only.nation.id, only.nation.id],
      semiFinalistIds: semiField.map((s) => s.nation.id),
      ties,
    }
  }

  const champion = play(first, second, 'final')

  return {
    championId: champion.nation.id,
    finalistIds: [first.nation.id, second.nation.id],
    semiFinalistIds: semiField.map((s) => s.nation.id),
    ties,
  }
}

/** An annual tournament — Six Nations, Rugby Championship, Autumn Tests. */
export function simulateAnnualCompetition(
  rng: Rng,
  competition: Competition,
  nations: readonly Nation[],
): { winnerId: string } {
  const contenders = nations.filter((n) => isInField(n, competition))
  if (contenders.length === 0) return { winnerId: nations[0]?.id ?? '' }

  // Strength plus a season's form decides it.
  const scored = contenders.map((nation) => ({
    nation,
    score: nation.strength + rng.gaussian(0, 5),
  }))
  scored.sort((a, b) => b.score - a.score)
  return { winnerId: scored[0]!.nation.id }
}

export interface InternationalSeason {
  caps: number
  tries: number
  competitions: { id: string; name: string; won: boolean }[]
  worldCup: TournamentResult | null
}

/**
 * Play out a player's international season once selected.
 */
export function simulateInternationalSeason(
  rng: Rng,
  nation: Nation,
  season: number,
  playerAttackRating: number,
): InternationalSeason {
  const competitions = competitionsForSeason(nation, season)
  let caps = 0
  let tries = 0
  const played: InternationalSeason['competitions'] = []
  let worldCup: TournamentResult | null = null

  for (const competition of competitions) {
    if (competition.id === 'world_cup') {
      worldCup = simulateWorldCup(rng)
      // A nation knocked out early plays fewer matches.
      const runLength = worldCup.ties.filter(
        (t) => t.winnerId === nation.id || t.loserId === nation.id,
      ).length
      caps += Math.max(3, runLength + 2)
      played.push({
        id: competition.id,
        name: competition.name,
        won: worldCup.championId === nation.id,
      })
    } else {
      caps += competition.matches
      const result = simulateAnnualCompetition(rng, competition, NATIONS)
      played.push({
        id: competition.id,
        name: competition.name,
        won: result.winnerId === nation.id,
      })
    }
  }

  // Try-scoring at test level, driven by how much of an attacking threat the player is.
  const expectedTries = caps * Math.max(0, (playerAttackRating - 55) / 220)
  for (let i = 0; i < caps; i++) {
    if (rng.bool(Math.min(0.45, expectedTries / Math.max(1, caps)))) tries++
  }

  return { caps, tries, competitions: played, worldCup }
}
