/**
 * Match agency (SPEC §3).
 *
 * The three properties the spec actually names — at most two, skippable, stat-driven — plus
 * the one it implies: a call that goes wrong must not cost anything permanent. That last one
 * is the wheel's invariant, and it is tested the same way: exhaustively, over every option.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  MAX_DECISIONS_PER_MATCH,
  MAX_SUCCESS_CHANCE,
  MIN_SUCCESS_CHANCE,
  SITUATIONS,
  agencyEffects,
  agencyModifiers,
  isEligible,
  resolveDecision,
  rollDecisions,
  situationsFor,
  successChance,
} from './agency'
import {
  PLAYER_ID,
  createCareer,
  placeCareerInWorld,
} from './career'
import { beginSeason, decisionsForRound, playRound } from './careerRun'
import { createWorld, randomStartingClub } from './world'
import { createRng, rngFor } from './rng'
import { POSITIONS, loadTeams } from '../data'
import type { PositionId, StatBlock, StatKey, TeamDef } from '../types/core'
import type { World } from './world'

let defs: readonly TeamDef[]
let world: World

beforeAll(async () => {
  defs = await loadTeams()
  world = createWorld(1234, defs)
}, 60_000)

const ALL_POSITIONS = Object.keys(POSITIONS) as PositionId[]

function statsFor(position: PositionId, level: number): StatBlock {
  const block: StatBlock = {}
  for (const stat of Object.keys(POSITIONS[position].statRanges) as StatKey[]) {
    block[stat] = level
  }
  return block
}

function newCareer(seed = 7, position: PositionId = 'OC') {
  const club = randomStartingClub(world, rngFor(seed, 'start'))
  const career = createCareer(
    seed,
    { name: 'Test Player', position, archetypeId: 'wonderkid', nationId: 'eng' },
    club,
  )
  return { career, world: placeCareerInWorld(world, career) }
}

// ---------------------------------------------------------------------------
// At most two
// ---------------------------------------------------------------------------

describe('SPEC §3 — at most two decisions per match', () => {
  it('never offers more than the cap, over ten thousand matches', () => {
    const stats = statsFor('FH', 70)
    for (let seed = 0; seed < 10_000; seed++) {
      const offered = rollDecisions(createRng(seed), stats)
      expect(offered.length).toBeLessThanOrEqual(MAX_DECISIONS_PER_MATCH)
    }
  })

  it('never offers the same situation twice in one match', () => {
    const stats = statsFor('FH', 70)
    for (let seed = 0; seed < 2_000; seed++) {
      const ids = rollDecisions(createRng(seed), stats).map((d) => d.situationId)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('sometimes offers none, sometimes one, sometimes two', () => {
    const stats = statsFor('FH', 70)
    const counts = new Set<number>()
    for (let seed = 0; seed < 500; seed++) {
      counts.add(rollDecisions(createRng(seed), stats).length)
    }
    expect([...counts].sort()).toEqual([0, 1, 2])
  })
})

// ---------------------------------------------------------------------------
// Stat-driven
// ---------------------------------------------------------------------------

describe('SPEC §3 — stat-driven odds', () => {
  it('gives a better player better odds on the same call', () => {
    for (const situation of SITUATIONS) {
      for (const option of situation.options) {
        if (option.stats.length === 0) continue
        const weak: StatBlock = {}
        const strong: StatBlock = {}
        for (const stat of option.stats) {
          weak[stat] = 50
          strong[stat] = 90
        }
        expect(successChance(strong, option)).toBeGreaterThan(successChance(weak, option))
      }
    }
  })

  it('keeps every risky call inside the clamps — never certain, never hopeless', () => {
    for (const situation of SITUATIONS) {
      for (const option of situation.options) {
        if (option.stats.length === 0) continue
        for (const level of [1, 20, 50, 75, 99]) {
          const stats: StatBlock = {}
          for (const stat of option.stats) stats[stat] = level
          const chance = successChance(stats, option)
          expect(chance).toBeGreaterThanOrEqual(MIN_SUCCESS_CHANCE)
          expect(chance).toBeLessThanOrEqual(MAX_SUCCESS_CHANCE)
        }
      }
    }
  })

  it('makes the safe option a certainty, so playing it safe is never a gamble', () => {
    for (const situation of SITUATIONS) {
      const safe = situation.options.filter((o) => o.stats.length === 0)
      expect(safe.length).toBeGreaterThan(0)
      for (const option of safe) {
        expect(successChance({}, option)).toBe(1)
        // A safe option cannot have a downside to land on.
        expect(option.onFailure).toEqual({})
      }
    }
  })

  it('only asks a player to make calls their position is judged on', () => {
    // A prop has no KCK, and is never asked to kick at goal.
    for (const position of ALL_POSITIONS) {
      const stats = statsFor(position, 70)
      for (const situation of situationsFor(stats)) {
        expect(isEligible(stats, situation)).toBe(true)
        for (const option of situation.options) {
          for (const stat of option.stats) {
            expect(stats[stat]).toBeDefined()
          }
        }
      }
    }
  })

  it('finds at least one situation for every position in the data', () => {
    for (const position of ALL_POSITIONS) {
      expect(situationsFor(statsFor(position, 70)).length).toBeGreaterThan(0)
    }
  })
})

// ---------------------------------------------------------------------------
// Nothing permanent
// ---------------------------------------------------------------------------

describe('a call that goes wrong never costs anything permanent', () => {
  it('produces only expiring form and morale effects, over every option', () => {
    const stats = statsFor('FH', 60)
    for (const situation of SITUATIONS) {
      for (const option of situation.options) {
        for (let seed = 0; seed < 200; seed++) {
          const resolved = resolveDecision(createRng(seed), stats, situation.id, option.id)
          expect(resolved).not.toBeNull()

          for (const effect of agencyEffects([resolved!])) {
            // Only form and morale, and only for a bounded number of matches.
            expect(effect.matchesRemaining).toBeGreaterThan(0)
            expect(effect.selectionPenalty).toBeUndefined()
            expect(Object.keys(effect).sort()).toEqual(
              Object.keys(effect)
                .filter((k) =>
                  ['id', 'label', 'formModifier', 'moraleModifier', 'matchesRemaining'].includes(k),
                )
                .sort(),
            )
          }
        }
      }
    }
  })

  it('leaves stats, OVR and traits untouched through a real round', () => {
    const { career, world: placed } = newCareer(31, 'FH')
    const run = beginSeason(career, placed)

    // Take the riskiest call available and force it through the round.
    const offered = rollDecisions(createRng(1), run.career.stats)
    const decisions = offered
      .map((d) => {
        const risky = d.options.find((o) => o.stats.length > 0) ?? d.options[0]!
        return resolveDecision(createRng(99), run.career.stats, d.situationId, risky.id)
      })
      .filter((d): d is NonNullable<typeof d> => d !== null)

    const after = playRound(run, decisions)

    expect(after.career.stats).toEqual(run.career.stats)
    expect(after.career.ovr).toBe(run.career.ovr)
    expect(after.career.traits).toEqual(run.career.traits)
    expect(after.career.isCaptain).toBe(run.career.isCaptain)
    expect(after.career.contract.salary).toBe(run.career.contract.salary)
  })
})

// ---------------------------------------------------------------------------
// Skippable
// ---------------------------------------------------------------------------

describe('SPEC §3 — decisions are genuinely skippable', () => {
  it('reaches exactly the same state when declined as when never offered', () => {
    const { career, world: placed } = newCareer(77, 'OC')
    const run = beginSeason(career, placed)

    const declined = playRound(run, [])
    const never = playRound(run)

    expect(declined.career).toEqual(never.career)
    expect(declined.season.results).toEqual(never.season.results)
    expect(declined.log[0]?.decisions).toEqual([])
  })

  it('offers nothing to an injured player', () => {
    const { career, world: placed } = newCareer(78, 'OC')
    const run = beginSeason(career, placed)
    const injured = {
      ...run,
      career: {
        ...run.career,
        injury: { label: 'Hamstring', weeksRemaining: 3, seasonEnding: false },
      },
    }
    expect(decisionsForRound(injured)).toEqual([])
  })

  it('offers the same calls however many times the screen is opened', () => {
    const { career, world: placed } = newCareer(79, 'WL')
    const run = beginSeason(career, placed)
    expect(decisionsForRound(run)).toEqual(decisionsForRound(run))
  })
})

// ---------------------------------------------------------------------------
// Reaching the match
// ---------------------------------------------------------------------------

describe('decisions reach the match', () => {
  it('turns a successful call into a rating bonus for the player and nobody else', () => {
    const stats = statsFor('FH', 95)
    const situation = SITUATIONS.find((s) => s.id === 'kick_at_goal')!
    const risky = situation.options.find((o) => o.stats.length > 0)!

    let success = null
    for (let seed = 0; seed < 200 && !success; seed++) {
      const resolved = resolveDecision(createRng(seed), stats, situation.id, risky.id)
      if (resolved?.succeeded) success = resolved
    }
    expect(success).not.toBeNull()

    const home = agencyModifiers([success!], PLAYER_ID, true)
    expect(home.ratingBonus?.get(PLAYER_ID)).toBeGreaterThan(0)
    expect(home.ratingBonus?.size).toBe(1)
    expect(home.homeStrengthDelta).toBeGreaterThan(0)
    expect(home.awayStrengthDelta).toBeUndefined()

    const away = agencyModifiers([success!], PLAYER_ID, false)
    expect(away.awayStrengthDelta).toBeGreaterThan(0)
    expect(away.homeStrengthDelta).toBeUndefined()
  })

  it('is a no-op for an empty set of decisions', () => {
    expect(agencyModifiers([], PLAYER_ID, true)).toEqual({})
    expect(agencyEffects([])).toEqual([])
  })

  it('records what was decided in the match log', () => {
    const { career, world: placed } = newCareer(80, 'OC')
    const run = beginSeason(career, placed)
    const offered = decisionsForRound(run)

    const decisions = offered
      .map((d) => resolveDecision(createRng(5), run.career.stats, d.situationId, d.options[0]!.id))
      .filter((d): d is NonNullable<typeof d> => d !== null)

    const after = playRound(run, decisions)
    expect(after.log[0]?.decisions).toHaveLength(decisions.length)
    for (const decision of after.log[0]!.decisions) {
      expect(decision.optionLabel.length).toBeGreaterThan(0)
      expect(decision.chance).toBeGreaterThan(0)
    }
  })

  it('refuses an option that does not belong to the situation', () => {
    expect(resolveDecision(createRng(1), statsFor('FH', 70), 'kick_at_goal', 'nonsense')).toBeNull()
    expect(resolveDecision(createRng(1), statsFor('FH', 70), 'nonsense', 'take_the_three')).toBeNull()
  })
})
