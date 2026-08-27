/**
 * Whole careers, end to end — the slow half of the career tests.
 *
 * Twenty seasons each, and every season close now simulates the entire world (seven more
 * leagues and nine cups), so these run in tens of seconds rather than tenths. They are
 * progression tests in everything but name, so they belong with `npm run test:balance`. The
 * per-season and per-round behaviour they build on stays in `career.test.ts`.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import {
  acceptOffer,
  advanceSeason,
  createCareer,
  generateTransferOffers,
  isFinalSeason,
  placeCareerInWorld,
} from './career'
import {
  beginSeason,
  closeSeason,
  playRound,
  skipWheelSpin,
  takeWheelSpin,
  type CareerRun,
} from './careerRun'
import { balance, grossEarnings, reconcile, totalSpent } from './economy'
import { createWorld, randomStartingClub } from './world'
import { isRegularSeasonComplete } from './season'
import { rngFor } from './rng'
import { loadTeams } from '../data'
import { CAREER_SEASONS } from '../types/career'
import type { PositionId, TeamDef } from '../types/core'
import type { World } from './world'

let defs: readonly TeamDef[]
let world: World

beforeAll(async () => {
  defs = await loadTeams()
  world = createWorld(1234, defs)
}, 60_000)

function newCareer(seed = 7, position: PositionId = 'OC') {
  const club = randomStartingClub(world, rngFor(seed, 'start'), position)
  const career = createCareer(
    seed,
    { name: 'Test Player', position, archetypeId: 'wonderkid', nationId: 'eng' },
    club,
  )
  return { career, world: placeCareerInWorld(world, career) }
}

describe('a complete 20-season career', () => {
  it('runs end to end and retires at season 20', () => {
    let { career, world: placed } = newCareer(2026, 'OC')

    for (let season = 1; season <= CAREER_SEASONS; season++) {
      expect(career.season).toBe(season)

      let run: CareerRun = beginSeason(career, placed)
      while (!isRegularSeasonComplete(run.season)) {
        run = playRound(run)
        if (run.wheelPending) {
          run = season % 2 === 0 ? takeWheelSpin(run).run : skipWheelSpin(run)
        }
      }

      const { run: closed, summary } = closeSeason(run)
      career = summary.career
      placed = closed.world

      // The ledger reconciles at every season boundary (SPEC §4).
      const r = reconcile(career.ledger)
      expect(r.ok).toBe(true)
      expect(r.spent + r.balance).toBe(r.gross)

      expect(summary.record.season).toBe(season)
      expect(career.history).toHaveLength(season)

      if (!isFinalSeason(career)) {
        const offers = generateTransferOffers(career, placed, rngFor(career.seed, 'offers', season))
        const chosen = offers[season % offers.length]!
        career = acceptOffer(career, chosen, rngFor(career.seed, 'move', season)).career
        placed = placeCareerInWorld(placed, career)
      }

      career = advanceSeason(career)
    }

    expect(career.retired).toBe(true)
    expect(career.season).toBe(CAREER_SEASONS)
    expect(career.history).toHaveLength(CAREER_SEASONS)
    expect(career.age).toBe(18 + CAREER_SEASONS)
    expect(career.careerCaps).toBeGreaterThan(0)
    expect(grossEarnings(career.ledger)).toBeGreaterThan(0)
    expect(balance(career.ledger)).toBe(grossEarnings(career.ledger) - totalSpent(career.ledger))
  }, 120_000)

  it('produces a career arc that rises and then falls', () => {
    let { career, world: placed } = newCareer(4242, 'WL')

    for (let season = 1; season <= CAREER_SEASONS; season++) {
      let run: CareerRun = beginSeason(career, placed)
      while (!isRegularSeasonComplete(run.season)) {
        run = playRound(run)
        if (run.wheelPending) run = skipWheelSpin(run)
      }
      const { run: closed, summary } = closeSeason(run)
      career = summary.career
      placed = closed.world
      career = advanceSeason(career)
    }

    const ovrs = career.history.map((h) => h.ovrEnd)
    const peak = Math.max(...ovrs)
    const peakIndex = ovrs.indexOf(peak)

    expect(peak).toBeGreaterThan(ovrs[0]!)
    // The peak is not the very last season — there is a decline.
    expect(peakIndex).toBeLessThan(ovrs.length - 1)
    expect(ovrs[ovrs.length - 1]!).toBeLessThan(peak)
  }, 120_000)
})
