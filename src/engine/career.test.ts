import { describe, it, expect, beforeAll } from 'vitest'
import {
  PLAYER_ID,
  STARTING_OVR_RANGE,
  acceptOffer,
  advanceSeason,
  buildOriginDraft,
  buildSeasonPreview,
  buildStartingStats,
  careerAsPlayer,
  createCareer,
  generateTransferOffers,
  isFinalSeason,
  placeCareerInWorld,
  seasonsRemaining,
} from './career'
import {
  beginSeason,
  closeSeason,
  playRound,
  runToSeasonEnd,
  skipWheelSpin,
  takeWheelSpin,
  wheelRoundFor,
  type CareerRun,
} from './careerRun'
import { createWorld, findTeam, randomStartingClub, teamsInLeague } from './world'
import { balance, grossEarnings, reconcile, totalSpent } from './economy'
import { computeOvr } from './ovr'
import { isRegularSeasonComplete, totalRounds } from './season'
import { createRng, rngFor } from './rng'
import { KEY_STAT_CREATION_BONUS, POSITIONS, getLeague, loadTeams } from '../data'
import { CAREER_SEASONS } from '../types/career'
import type { TeamDef, StatKey } from '../types/core'
import type { World } from './world'

let defs: readonly TeamDef[]
let world: World

beforeAll(async () => {
  defs = await loadTeams()
  world = createWorld(1234, defs)
})

function newCareer(seed = 7, position: (typeof POSITIONS)['OC']['id'] = 'OC') {
  const rng = rngFor(seed, 'start')
  const club = randomStartingClub(world, rng)
  const career = createCareer(seed, {
    name: 'Test Player',
    position,
    archetypeId: 'wonderkid',
    nationId: 'eng',
  }, club)
  return { career, world: placeCareerInWorld(world, career), club }
}

describe('origin draft', () => {
  it('offers a locked choice per key stat, from real players at that position', () => {
    const pool = defs.flatMap((d) => d.roster)
    const draft = buildOriginDraft(createRng(1), 'FH', pool)

    expect(draft.map((r) => r.stat)).toEqual(POSITIONS.FH.keyStats)
    for (const round of draft) {
      expect(round.options).toHaveLength(3)
      for (const card of round.options) {
        expect(card.stat).toBe(round.stat)
        expect(card.playerName.length).toBeGreaterThan(0)
        expect(card.value).toBeGreaterThan(0)
      }
    }
  })

  it('offers distinct cards within a round', () => {
    const pool = defs.flatMap((d) => d.roster)
    for (let seed = 0; seed < 20; seed++) {
      for (const round of buildOriginDraft(createRng(seed), 'N8', pool)) {
        const names = round.options.map((o) => o.playerName)
        expect(new Set(names).size).toBe(names.length)
      }
    }
  })
})

describe('player creation', () => {
  it('starts inside the SPEC §3 range of 55-65 OVR', () => {
    for (let seed = 0; seed < 200; seed++) {
      for (const archetype of ['wonderkid', 'late_bloomer', 'iron_man', 'journeyman']) {
        const { ovr } = buildStartingStats(createRng(seed), 'IC', archetype)
        expect(ovr).toBeGreaterThanOrEqual(STARTING_OVR_RANGE[0] - 1)
        expect(ovr).toBeLessThanOrEqual(STARTING_OVR_RANGE[1] + 1)
      }
    }
  })

  it('applies the §2.6 key-stat lift', () => {
    const { stats } = buildStartingStats(createRng(3), 'LHP', 'iron_man')
    const def = POSITIONS.LHP
    const others = (Object.entries(stats) as [StatKey, number][])
      .filter(([s]) => !def.keyStats.includes(s))
      .map(([, v]) => v)
    const baseline = others.reduce((a, b) => a + b, 0) / others.length

    for (const key of def.keyStats) {
      const gap = stats[key]! - baseline
      expect(gap).toBeGreaterThanOrEqual(KEY_STAT_CREATION_BONUS[0] - 1)
      expect(gap).toBeLessThanOrEqual(KEY_STAT_CREATION_BONUS[1] + 1)
    }
  })

  it('honours stats locked in the origin draft', () => {
    const { stats } = buildStartingStats(createRng(4), 'FB', 'wonderkid', { PAC: 88 })
    // Shifting is additive, so a locked stat stays the standout even after normalising.
    const values = Object.values(stats)
    expect(stats.PAC).toBe(Math.max(...values))
  })

  it('starts at a random tier-2 club, never tier 1', () => {
    for (let seed = 0; seed < 100; seed++) {
      const club = randomStartingClub(world, rngFor(seed, 'start'))
      expect(getLeague(club.leagueId).tier).toBe(2)
    }
  })

  it('starts in season 1 of 20 with an empty record', () => {
    const { career } = newCareer()
    expect(career.season).toBe(1)
    expect(seasonsRemaining(career)).toBe(19)
    expect(career.retired).toBe(false)
    expect(career.history).toHaveLength(0)
    expect(career.careerCaps).toBe(0)
    expect(grossEarnings(career.ledger)).toBe(0)
  })

  it('puts the player into their club squad as an ordinary member', () => {
    const { career, world: placed, club } = newCareer()
    const team = findTeam(placed, club.id)!
    const inSquad = team.squad.find((p) => p.id === PLAYER_ID)
    expect(inSquad).toBeDefined()
    expect(inSquad!.name).toBe(career.name)
    expect(inSquad!.ovr).toBe(career.ovr)
    // And only in one squad.
    const appearances = placed.teams.filter((t) => t.squad.some((p) => p.id === PLAYER_ID))
    expect(appearances).toHaveLength(1)
  })

  it('keeps the cached OVR consistent with the stat block', () => {
    const { career } = newCareer()
    expect(career.ovr).toBe(computeOvr(career.stats, career.position))
    expect(careerAsPlayer(career).ovr).toBe(career.ovr)
  })
})

describe('season preview', () => {
  it('shows everything SPEC §3 asks for', () => {
    const { career, world: placed } = newCareer()
    const preview = buildSeasonPreview(career, placed)

    expect(preview.clubName.length).toBeGreaterThan(0)
    expect(preview.leagueName.length).toBeGreaterThan(0)
    expect(preview.tier).toBe(2)
    expect(preview.salary).toBeGreaterThan(0)
    expect(preview.contractYearsRemaining).toBeGreaterThan(0)
    expect(['star', 'starter', 'squad', 'fringe']).toContain(preview.squadRole)
    expect(preview.coachExpectation.length).toBeGreaterThan(0)
    expect(preview.leagueDifficulty).toBe('Developing')
    expect(preview.ovr).toBe(career.ovr)
  })
})

describe('playing a season', () => {
  it('plays every round and keeps a log', () => {
    const { career, world: placed } = newCareer()
    let run = beginSeason(career, placed)
    const rounds = getLeague(run.season.leagueId).rounds

    while (!isRegularSeasonComplete(run.season)) {
      run = playRound(run)
      if (run.wheelPending) run = skipWheelSpin(run)
    }

    expect(run.season.roundsPlayed).toBe(rounds)
    expect(run.log).toHaveLength(rounds)
    expect(run.career.round).toBe(rounds)
  })

  it('accrues wages by the round and win bonuses as they are earned', () => {
    const { career, world: placed } = newCareer()
    let run = beginSeason(career, placed)

    // Nothing is paid before a round has been played — wages used to arrive as a lump here.
    expect(grossEarnings(run.career.ledger)).toBe(0)

    while (!isRegularSeasonComplete(run.season)) {
      run = playRound(run)
      if (run.wheelPending) run = skipWheelSpin(run)
    }

    const seasonWages = career.contract.salary * totalRounds(run.season)
    const wins = run.log.filter((e) => e.result === 'W').length

    // Wages for every round, plus a bonus for each win on top.
    expect(grossEarnings(run.career.ledger)).toBeGreaterThanOrEqual(seasonWages)
    if (wins > 0) expect(grossEarnings(run.career.ledger)).toBeGreaterThan(seasonWages)
  })

  it('accumulates caps and tries only from matches actually played', () => {
    const { career, world: placed } = newCareer()
    let run = beginSeason(career, placed)
    while (!isRegularSeasonComplete(run.season)) {
      run = playRound(run)
      if (run.wheelPending) run = skipWheelSpin(run)
    }

    const selected = run.log.filter((e) => e.selected)
    const tries = selected.reduce((total, e) => total + (e.line?.tries ?? 0), 0)
    expect(run.career.careerCaps).toBe(selected.length)
    expect(run.career.careerTries).toBe(tries)
  })

  it('does not select an injured player', () => {
    const { career, world: placed } = newCareer()
    let run = beginSeason({ ...career, injury: { label: 'Knock', weeksRemaining: 40, seasonEnding: true } }, placed)

    while (!isRegularSeasonComplete(run.season)) {
      run = playRound(run)
      if (run.wheelPending) run = skipWheelSpin(run)
    }

    expect(run.career.careerCaps).toBe(0)
    expect(run.log.every((e) => !e.selected)).toBe(true)
  })
})

describe('the mid-season wheel', () => {
  it('is offered exactly once, at the midpoint', () => {
    const { career, world: placed } = newCareer()
    let run = beginSeason(career, placed)
    const expected = wheelRoundFor(run)
    const offeredAt: number[] = []

    while (!isRegularSeasonComplete(run.season)) {
      run = playRound(run)
      if (run.wheelPending) {
        offeredAt.push(run.season.roundsPlayed)
        run = skipWheelSpin(run)
      }
    }

    expect(offeredAt).toEqual([expected])
  })

  it('is genuinely skippable and changes nothing when skipped', () => {
    const { career, world: placed } = newCareer()
    let run = beginSeason(career, placed)
    while (!run.wheelPending && !isRegularSeasonComplete(run.season)) run = playRound(run)

    const before = run.career
    const after = skipWheelSpin(run).career
    expect(after.stats).toEqual(before.stats)
    expect(after.ovr).toBe(before.ovr)
    expect(after.wheelSpunThisSeason).toBe(true)
  })

  it('never costs anything permanent when taken', () => {
    for (let seed = 0; seed < 40; seed++) {
      const { career, world: placed } = newCareer(seed)
      let run: CareerRun = beginSeason(career, placed)
      while (!run.wheelPending && !isRegularSeasonComplete(run.season)) run = playRound(run)
      if (!run.wheelPending) continue

      const before = run.career
      const { run: after } = takeWheelSpin(run)

      for (const stat of Object.keys(before.stats) as StatKey[]) {
        expect(after.career.stats[stat]!).toBeGreaterThanOrEqual(before.stats[stat]!)
      }
      expect(after.career.ovr).toBeGreaterThanOrEqual(before.ovr)
      expect(after.career.contract.salary).toBeGreaterThanOrEqual(before.contract.salary)
      expect(after.career.traits.length).toBeGreaterThanOrEqual(before.traits.length)
    }
    // Forty careers played up to the midpoint before a single spin is taken. ~2.5s alone,
    // but it shares workers with the rest of the suite, so it gets an explicit budget.
  }, 60_000)
})

describe('runToSeasonEnd generator — no UI freeze', () => {
  it('yields once per round so the caller can paint between them', () => {
    const { career, world: placed } = newCareer()
    let run = beginSeason(career, placed)

    let yields = 0
    const gen = runToSeasonEnd(run)
    let step = gen.next()
    while (!step.done) {
      yields++
      run = step.value
      step = gen.next()
    }

    expect(yields).toBeGreaterThan(0)
    // It stops at the wheel rather than skipping the decision.
    expect(run.wheelPending || isRegularSeasonComplete(run.season)).toBe(true)
  })
})

describe('transfer offers — SPEC §2.5 consequences shown up front', () => {
  it('always offers the option to stay, at zero OVR change', () => {
    const { career, world: placed } = newCareer()
    const offers = generateTransferOffers(career, placed, createRng(1))
    const stay = offers.find((o) => o.direction === 'stay' && o.clubId === career.contract.clubId)
    expect(stay).toBeDefined()
    expect(stay!.ovrChangeRange).toEqual([0, 0])
  })

  it('labels each destination with the right direction and range', () => {
    const { career, world: placed } = newCareer()
    for (let seed = 0; seed < 30; seed++) {
      for (const offer of generateTransferOffers(career, placed, createRng(seed))) {
        const tier = getLeague(offer.leagueId).tier
        expect(offer.tier).toBe(tier)
        if (offer.direction === 'up') {
          expect(tier).toBe(1)
          expect(offer.ovrChangeRange).toEqual([1, 3])
        } else if (offer.direction === 'down') {
          expect(offer.ovrChangeRange).toEqual([-3, -1])
        } else {
          expect(offer.ovrChangeRange).toEqual([0, 0])
        }
      }
    }
  })

  it('gives the Journeyman and Elite Agent more offers', () => {
    const { career, world: placed } = newCareer()
    const plain = generateTransferOffers({ ...career, archetypeId: 'iron_man' }, placed, createRng(2))
    const journeyman = generateTransferOffers(
      { ...career, archetypeId: 'journeyman' },
      placed,
      createRng(2),
    )
    expect(journeyman.length).toBeGreaterThan(plain.length)
  })

  it('applies the rolled OVR change on acceptance, inside the advertised range', () => {
    const { career, world: placed } = newCareer()
    const offers = generateTransferOffers(career, placed, createRng(3))

    for (const offer of offers) {
      const { career: after, ovrDelta } = acceptOffer(career, offer, createRng(4))
      expect(ovrDelta).toBeGreaterThanOrEqual(offer.ovrChangeRange[0])
      expect(ovrDelta).toBeLessThanOrEqual(offer.ovrChangeRange[1])
      expect(after.contract.clubId).toBe(offer.clubId)
      expect(after.contract.salary).toBe(offer.salary)
      expect(after.ovr).toBe(computeOvr(after.stats, after.position))
    }
  })
})

// The two whole-career tests — twenty seasons each, and every season close now simulates the
// entire world — live in `career.slow.test.ts` so `npm test` stays quick.
