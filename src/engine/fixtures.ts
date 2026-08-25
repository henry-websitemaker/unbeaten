/**
 * Fixture generation.
 *
 * SPEC §2.3: season length comes from `leagues.json` and nowhere else. The recovered data
 * contains three genuinely different shapes, and all three have to work from the same code:
 *
 *   - NPC        12 clubs, 10 rounds  — *shorter* than one full round-robin (11), so truncated
 *   - Premiership 10 clubs, 18 rounds — exactly a double round-robin (2 x 9)
 *   - Pro D2     14 clubs, 30 rounds  — *longer* than a double round-robin (26), so extended
 *
 * Odd club counts (Super Rugby's 11) give one club a bye each round, so a club plays fewer
 * matches than the league has rounds. That is realistic and callers must not assume otherwise.
 */

import type { LeagueDef } from '../types/core'
import type { Rng } from './rng'

export interface Fixture {
  /** 1-based. */
  round: number
  homeId: string
  awayId: string
}

const BYE = '__bye__'

type Pairing = readonly [string, string]

/**
 * One full round-robin as unoriented pairings, via the circle method.
 * Every club meets every other exactly once. Who hosts is decided later.
 */
function roundRobinPairings(ids: readonly string[]): Pairing[][] {
  const list = ids.slice()
  // A phantom club gives the odd one out a bye.
  if (list.length % 2 === 1) list.push(BYE)

  const n = list.length
  if (n < 2) return []

  const rounds: Pairing[][] = []
  const arr = list.slice()

  for (let r = 0; r < n - 1; r++) {
    const round: Pairing[] = []
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i]!
      const b = arr[n - 1 - i]!
      if (a === BYE || b === BYE) continue
      round.push([a, b])
    }
    rounds.push(round)

    // Rotate everything except the first entry.
    const rest = arr.slice(1)
    rest.unshift(rest.pop()!)
    for (let i = 0; i < rest.length; i++) arr[i + 1] = rest[i]!
  }

  return rounds
}

interface OrientedFixture {
  homeId: string
  awayId: string
}

/**
 * Build the regular season for a league.
 *
 * `league.rounds` is authoritative: the schedule is filled from repeated round-robin legs
 * and then cut to exactly that many rounds, whatever that means for this club count.
 *
 * Legs come in pairs. The first leg of a pair is oriented greedily — whichever club has the
 * smaller home surplus hosts — and the second is its exact mirror, so every pair meets once
 * at each ground and both clubs come out perfectly balanced.
 *
 * The subtlety is that a mirror leg is only correct if it actually *finishes*. Most leagues
 * here stop part-way through a leg: URC plays 18 rounds of a 15-round cycle, so its last
 * three rounds would be three reverse fixtures and nothing else, pushing those clubs to
 * 7 home / 11 away. So a leg that will be cut short is oriented greedily instead of
 * mirrored, which costs nothing — a truncated leg has no reverse fixtures to preserve.
 */
export function generateFixtures(
  league: LeagueDef,
  teamIds: readonly string[],
  rng: Rng,
): Fixture[] {
  if (teamIds.length < 2) return []

  // Shuffled so the same clubs do not open against each other in every career.
  const firstLeg = roundRobinPairings(rng.shuffle(teamIds))
  if (firstLeg.length === 0) return []

  const surplus = new Map<string, number>()
  const surplusOf = (id: string) => surplus.get(id) ?? 0

  const record = (home: string, away: string): OrientedFixture => {
    surplus.set(home, surplusOf(home) + 1)
    surplus.set(away, surplusOf(away) - 1)
    return { homeId: home, awayId: away }
  }

  const orientGreedily = (round: readonly Pairing[]): OrientedFixture[] =>
    round.map(([a, b]) => (surplusOf(a) <= surplusOf(b) ? record(a, b) : record(b, a)))

  const mirror = (round: readonly OrientedFixture[]): OrientedFixture[] =>
    round.map((f) => record(f.awayId, f.homeId))

  // Leg pairs 0 and 1 share the opening draw so every club meets every other twice.
  // Later pairs are reshuffled, so an extended season does not replay its opening rounds.
  const patternCache = new Map<number, Pairing[][]>()
  const patternForLeg = (legIndex: number): Pairing[][] => {
    const pair = Math.floor(legIndex / 2)
    if (pair === 0) return firstLeg
    let pattern = patternCache.get(pair)
    if (!pattern) {
      pattern = roundRobinPairings(rng.shuffle(teamIds))
      patternCache.set(pair, pattern)
    }
    return pattern
  }

  const rounds: OrientedFixture[][] = []
  const legRounds: OrientedFixture[][][] = []
  let legIndex = 0

  while (rounds.length < league.rounds) {
    const pattern = patternForLeg(legIndex)
    if (pattern.length === 0) break

    const remaining = league.rounds - rounds.length
    const legCompletes = pattern.length <= remaining
    const previousLeg = legRounds[legIndex - 1]
    const isMirrorLeg = legIndex % 2 === 1 && legCompletes && previousLeg !== undefined

    const thisLeg: OrientedFixture[][] = []
    for (let r = 0; r < pattern.length && rounds.length < league.rounds; r++) {
      const source = isMirrorLeg ? previousLeg[r] : undefined
      const oriented = source ? mirror(source) : orientGreedily(pattern[r]!)
      thisLeg.push(oriented)
      rounds.push(oriented)
    }

    legRounds[legIndex] = thisLeg
    legIndex++
  }

  const fixtures: Fixture[] = []
  rounds.forEach((round, index) => {
    for (const f of round) {
      fixtures.push({ round: index + 1, homeId: f.homeId, awayId: f.awayId })
    }
  })

  return rebalance(fixtures)
}

/**
 * Repair pass over home/away allocation.
 *
 * Greedy orientation decides each pairing against only the two clubs involved, so surplus
 * still drifts across a leg — a club at +1 facing one at +3 correctly hosts, and ends up at
 * +2. Over 15 rounds that compounds.
 *
 * Flipping any fixture where the host's surplus already exceeds the visitor's by 2 or more
 * moves both two steps towards even, which strictly reduces total imbalance, so this
 * converges rather than oscillating. In a true double round-robin every club is already at
 * zero and nothing is touched — which is what keeps the once-at-each-ground property.
 */
function rebalance(fixtures: readonly Fixture[], maxPasses = 12): Fixture[] {
  const out = fixtures.map((f) => ({ ...f }))
  const surplus = new Map<string, number>()
  const surplusOf = (id: string) => surplus.get(id) ?? 0

  for (const f of out) {
    surplus.set(f.homeId, surplusOf(f.homeId) + 1)
    surplus.set(f.awayId, surplusOf(f.awayId) - 1)
  }

  for (let pass = 0; pass < maxPasses; pass++) {
    let improved = false

    for (const f of out) {
      if (surplusOf(f.homeId) - surplusOf(f.awayId) < 2) continue

      surplus.set(f.homeId, surplusOf(f.homeId) - 2)
      surplus.set(f.awayId, surplusOf(f.awayId) + 2)
      const previousHome = f.homeId
      f.homeId = f.awayId
      f.awayId = previousHome
      improved = true
    }

    if (!improved) break
  }

  return out
}

/** Group fixtures by round, indexed 1..league.rounds. */
export function fixturesByRound(fixtures: readonly Fixture[]): Map<number, Fixture[]> {
  const out = new Map<number, Fixture[]>()
  for (const f of fixtures) {
    const list = out.get(f.round) ?? []
    list.push(f)
    out.set(f.round, list)
  }
  return out
}

/** Every fixture involving one club, in round order. */
export function fixturesForTeam(fixtures: readonly Fixture[], teamId: string): Fixture[] {
  return fixtures
    .filter((f) => f.homeId === teamId || f.awayId === teamId)
    .sort((a, b) => a.round - b.round)
}

/**
 * How many matches a club actually plays in the regular season.
 *
 * With an odd club count this is fewer than `league.rounds`, because of byes — appearance
 * counts and career records must use this rather than the round count.
 */
export function matchCountForTeam(fixtures: readonly Fixture[], teamId: string): number {
  return fixturesForTeam(fixtures, teamId).length
}

/** Rounds in which a club has no fixture. */
export function byeRounds(
  fixtures: readonly Fixture[],
  teamId: string,
  totalRounds: number,
): number[] {
  const playing = new Set(fixturesForTeam(fixtures, teamId).map((f) => f.round))
  const out: number[] = []
  for (let r = 1; r <= totalRounds; r++) if (!playing.has(r)) out.push(r)
  return out
}
