import { describe, it, expect, beforeAll } from 'vitest'
import {
  DEFAULT_GAME_PLAN,
  SCHEMA_VERSION,
  buildHallOfFameEntry,
  careerScore,
  clearSave,
  emptySave,
  hallOfFameView,
  loadSave,
  migrate,
  rankedHallOfFame,
  recordCareer,
  unrankedHallOfFame,
  writeSave,
  type HallOfFameEntry,
  type StorageLike,
} from './persistence'
import {
  buildDraft,
  buildDraftedTeam,
  draftStrength,
  selectableLeagues,
  startQuickSeason,
  summariseQuickSeason,
  QUICK_SEASON_TEAM_ID,
} from './quickSeason'
import { createWorld } from './world'
import { simulateSeason } from './season'
import { createLedger, credit } from './economy'
import { createRng } from './rng'
import { LEAGUE_LIST, getLeague, loadTeams } from '../data'
import { CAREER_SEASONS, type PlayerCareer } from '../types/career'
import type { TeamDef } from '../types/core'
import type { World } from './world'

let world: World
beforeAll(async () => {
  const defs: readonly TeamDef[] = await loadTeams()
  world = createWorld(9, defs)
})

function memoryStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  }
}

function career(seasons: number, retired: boolean): PlayerCareer {
  let ledger = createLedger()
  ledger = credit(ledger, 1, 'salary', 'Wages', 2_000_000)

  return {
    seed: 1,
    name: `Player ${seasons}`,
    position: 'OC',
    archetypeId: 'wonderkid',
    nationId: 'eng',
    age: 18 + seasons,
    stats: {},
    ovr: 82,
    traits: [],
    season: seasons,
    round: 0,
    contract: { clubId: 'c', leagueId: 'premiership', salary: 100_000, years: 2, yearsServed: 1 },
    ledger,
    lifestyle: { purchases: [] },
    form: 70,
    morale: 70,
    isCaptain: false,
    injury: null,
    effects: [],
    training: [],
    gamePlan: 'balanced_flair',
    history: Array.from({ length: seasons }, (_, i) => ({
      season: i + 1,
      clubId: 'c',
      clubName: 'Club',
      leagueId: 'premiership' as const,
      appearances: 20,
      tries: 5,
      points: 25,
      avgRating: 7,
      motm: 1,
      ladderPosition: 3,
      championship: false,
      salary: 100_000,
      ovrStart: 70,
      ovrEnd: 75,
      internationalCaps: 2,
      injuries: 0,
    })),
    trophies: [],
    awards: [],
    achievements: [],
    careerCaps: seasons * 20,
    careerTries: seasons * 5,
    careerPoints: seasons * 25,
    internationalCaps: seasons * 2,
    internationalTries: 0,
    rivalId: null,
    retired,
    wheelSpunThisSeason: false,
  }
}

describe('SPEC §2.2 — the Hall of Fame ranks only completed 20-season careers', () => {
  it('ranks a finished 20-season career', () => {
    const entry = buildHallOfFameEntry(career(CAREER_SEASONS, true), 'a')
    expect(entry.ranked).toBe(true)
    expect(entry.seasonsPlayed).toBe(CAREER_SEASONS)
    expect(entry.unrankedReason).toBeUndefined()
  })

  it('does not rank an unfinished career, and says why', () => {
    const entry = buildHallOfFameEntry(career(12, false), 'b')
    expect(entry.ranked).toBe(false)
    expect(entry.unrankedReason).toContain('12 of 20')
  })

  it('does not rank a 20-season career that was never retired', () => {
    expect(buildHallOfFameEntry(career(CAREER_SEASONS, false), 'c').ranked).toBe(false)
  })

  it('separates the ranked table from the unranked section', () => {
    const entries = [
      buildHallOfFameEntry(career(CAREER_SEASONS, true), 'full'),
      buildHallOfFameEntry(career(9, false), 'short'),
    ]
    expect(rankedHallOfFame(entries).map((e) => e.id)).toEqual(['full'])
    expect(unrankedHallOfFame(entries).map((e) => e.id)).toEqual(['short'])
  })

  it('orders the ranked table by career score', () => {
    const good = buildHallOfFameEntry(career(CAREER_SEASONS, true), 'good')
    const better: HallOfFameEntry = { ...good, id: 'better', careerScore: good.careerScore + 500 }
    expect(rankedHallOfFame([good, better]).map((e) => e.id)).toEqual(['better', 'good'])
  })

  it('scores against a 20-season denominator, not the seasons actually played', () => {
    const base = {
      name: 'x',
      position: 'OC' as const,
      nationId: 'eng',
      appearances: 200,
      tries: 50,
      points: 250,
      internationalCaps: 40,
      trophies: 3,
      earnings: 5_000_000,
      peakOvr: 88,
    }
    // The same totals score identically whether recorded over 10 seasons or 20 — which is
    // exactly why a 10-season entry must not be ranked against a 20-season one.
    const overTen = careerScore({ ...base, seasonsPlayed: 10 })
    const overTwenty = careerScore({ ...base, seasonsPlayed: CAREER_SEASONS })
    expect(overTen).toBe(overTwenty)
  })
})

describe('SPEC §2.2 — migrating a store that contains old-format entries', () => {
  /** A save written by the superseded build: 10-season careers, no `ranked` flag. */
  const legacyStore = {
    schemaVersion: 1,
    hallOfFame: [
      { name: 'Ten Season Ted', seasons: 10, appearances: 180, tries: 40, trophies: 2, peakOvr: 84 },
      { name: 'Full Career Fran', seasons: 20, appearances: 320, tries: 90, trophies: 5, peakOvr: 91 },
      { name: 'Quit Early Quinn', careerLength: 4, appearances: 60, tries: 8, trophies: 0, peakOvr: 70 },
    ],
  }

  it('migrates old entries out of the ranked table', () => {
    const { state, report } = migrate(legacyStore)

    expect(report.from).toBe(1)
    expect(report.to).toBe(SCHEMA_VERSION)
    expect(report.steps).toEqual([1, 2, 3, 4])

    const ranked = rankedHallOfFame(state.hallOfFame)
    expect(ranked.map((e) => e.name)).toEqual(['Full Career Fran'])

    const unranked = unrankedHallOfFame(state.hallOfFame)
    expect(unranked.map((e) => e.name).sort()).toEqual(['Quit Early Quinn', 'Ten Season Ted'])
  })

  it('reports how many entries were demoted', () => {
    // All three were effectively ranked before; only one survives.
    expect(migrate(legacyStore).report.demoted).toBe(2)
  })

  /**
   * SPEC §2.8 restored pre-season training and §3 made the game plan sticky, so v4 adds two
   * fields a career saved before them does not have. Left undefined, the Summer screen would
   * throw reading the training log and every match would be played with no plan.
   */
  it('gives a career saved before training and game plans both of them', () => {
    const v3Career = {
      seed: 1,
      name: 'Mid Career Mo',
      position: 'OC',
      season: 7,
      // No `training`, no `gamePlan` — this save predates both.
    }

    const { state, report } = migrate({
      schemaVersion: 3,
      playerCareer: v3Career,
      slots: { player: v3Career, manager: null },
      hallOfFame: [],
    })

    expect(report.steps).toEqual([3, 4])
    for (const career of [state.playerCareer, state.slots.player]) {
      expect(career).not.toBeNull()
      expect(career!.training).toEqual([])
      expect(career!.gamePlan).toBe(DEFAULT_GAME_PLAN)
    }
  })

  it('does not overwrite training or a game plan that is already there', () => {
    const career = {
      seed: 2,
      name: 'Already Migrated',
      training: [{ season: 3, blockId: 'gym', ovrDelta: 1 }],
      gamePlan: 'high_risk',
    }

    const { state } = migrate({
      schemaVersion: 3,
      playerCareer: career,
      slots: { player: career, manager: null },
      hallOfFame: [],
    })

    expect(state.playerCareer!.gamePlan).toBe('high_risk')
    expect(state.playerCareer!.training).toHaveLength(1)
  })

  /**
   * v5 made training a per-stat pick. Records written under v4 name a block and no stat,
   * because there was not one to name.
   */
  it('leaves a block-era training record without inventing a stat for it', () => {
    const career = {
      seed: 3,
      name: 'Block Era Bob',
      gamePlan: 'balanced_flair',
      training: [
        { season: 1, blockId: 'gym', ovrDelta: 2 },
        { season: 2, blockId: 'film', ovrDelta: 1 },
      ],
    }

    const { state, report } = migrate({
      schemaVersion: 4,
      playerCareer: career,
      slots: { player: career, manager: null },
      hallOfFame: [],
    })

    expect(report.steps).toEqual([4])
    const training = state.playerCareer!.training
    expect(training).toHaveLength(2)
    for (const record of training) {
      // The career really did a block; guessing which stat it "was" would write a fact into
      // the save that never happened.
      expect(record.statKey).toBeUndefined()
      expect(record.blockId.length).toBeGreaterThan(0)
    }
  })

  it('keeps a per-stat training record exactly as written', () => {
    const career = {
      seed: 4,
      name: 'Stat Era Sam',
      gamePlan: 'balanced_flair',
      training: [{ season: 1, statKey: 'KCK', blockId: 'film', ovrDelta: 2 }],
    }

    const { state } = migrate({
      schemaVersion: 4,
      playerCareer: career,
      slots: { player: career, manager: null },
      hallOfFame: [],
    })

    expect(state.playerCareer!.training[0]!.statKey).toBe('KCK')
  })

  it('survives a v3 save with no career in it at all', () => {
    const { state } = migrate({ schemaVersion: 3, playerCareer: null, hallOfFame: [] })
    expect(state.playerCareer).toBeNull()
    expect(state.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('explains why each demoted entry is unranked', () => {
    const { state } = migrate(legacyStore)
    const ted = state.hallOfFame.find((e) => e.name === 'Ten Season Ted')!
    expect(ted.ranked).toBe(false)
    expect(ted.unrankedReason).toContain('10 of 20')
  })

  it('renames the old seasons and careerLength fields', () => {
    const { state } = migrate(legacyStore)
    expect(state.hallOfFame.find((e) => e.name === 'Ten Season Ted')!.seasonsPlayed).toBe(10)
    expect(state.hallOfFame.find((e) => e.name === 'Quit Early Quinn')!.seasonsPlayed).toBe(4)
  })

  it('keeps the surviving entry intact', () => {
    const fran = migrate(legacyStore).state.hallOfFame.find((e) => e.name === 'Full Career Fran')!
    expect(fran.appearances).toBe(320)
    expect(fran.tries).toBe(90)
    expect(fran.trophies).toBe(5)
    expect(fran.ranked).toBe(true)
  })

  it('is idempotent — migrating an already-current save changes nothing', () => {
    const once = migrate(legacyStore).state
    const twice = migrate(once)
    expect(twice.state.hallOfFame).toEqual(once.hallOfFame)
    expect(twice.report.demoted).toBe(0)
    expect(twice.report.steps).toEqual([])
  })
})

describe('save loading is defensive', () => {
  it('returns a fresh save for missing, corrupt or nonsense data', () => {
    for (const input of [null, undefined, 'nonsense', 42, []]) {
      const { state } = migrate(input)
      expect(state.schemaVersion).toBe(SCHEMA_VERSION)
    }
  })

  it('survives unparseable JSON in storage', () => {
    const storage = memoryStorage()
    storage.setItem('unbeaten:save:v1', '{ not json')
    expect(loadSave(storage).state.schemaVersion).toBe(SCHEMA_VERSION)
  })

  it('fills in fields a hand-edited save is missing', () => {
    const { state } = migrate({ schemaVersion: SCHEMA_VERSION, hallOfFame: [{ name: 'Partial' }] })
    const entry = state.hallOfFame[0]!
    expect(entry.appearances).toBe(0)
    expect(entry.position).toBeDefined()
    expect(entry.id).toContain('Partial')
  })

  it('round-trips a save through storage', () => {
    const storage = memoryStorage()
    let state = emptySave()
    state = recordCareer(state, career(CAREER_SEASONS, true), 'hero')

    writeSave(storage, state)
    const loaded = loadSave(storage).state

    expect(loaded.hallOfFame).toHaveLength(1)
    expect(loaded.hallOfFame[0]!.name).toBe('Player 20')
    expect(loaded.hallOfFame[0]!.ranked).toBe(true)
  })

  it('replaces rather than duplicates when the same career is recorded twice', () => {
    let state = emptySave()
    state = recordCareer(state, career(CAREER_SEASONS, true), 'hero')
    state = recordCareer(state, career(CAREER_SEASONS, true), 'hero')
    expect(state.hallOfFame).toHaveLength(1)
  })

  it('clears a save', () => {
    const storage = memoryStorage()
    writeSave(storage, emptySave())
    clearSave(storage)
    expect(storage.getItem('unbeaten:save:v1')).toBeNull()
  })

  it('keeps separate slots per career mode', () => {
    const state = emptySave()
    expect(state.slots.player).toBeNull()
    expect(state.slots.manager).toBeNull()
  })

  it('exposes the split view the Hall of Fame screen renders', () => {
    let state = emptySave()
    state = recordCareer(state, career(CAREER_SEASONS, true), 'full')
    state = recordCareer(state, career(7, false), 'part')

    const view = hallOfFameView(state)
    expect(view.ranked).toHaveLength(1)
    expect(view.unranked).toHaveLength(1)
  })
})

describe('Quick Season', () => {
  it('offers every league', () => {
    expect(selectableLeagues()).toHaveLength(LEAGUE_LIST.length)
  })

  it('drafts three candidates for each of the fifteen shirts', () => {
    const draft = buildDraft(world, createRng(1))
    expect(draft).toHaveLength(15)
    for (const pick of draft) {
      expect(pick.options).toHaveLength(3)
      for (const option of pick.options) {
        expect(option.name.length).toBeGreaterThan(0)
      }
    }
  })

  it('keeps the league the right size by displacing a club, not adding one', () => {
    const draft = buildDraft(world, createRng(2))
    const xv = buildDraftedTeam(draft.map((p) => p.options[0]!), 'premiership')
    const setup = startQuickSeason(world, 3, 'premiership', xv)

    expect(setup.season.teams).toHaveLength(getLeague('premiership').teamCount)
    expect(setup.season.teams.some((t) => t.id === QUICK_SEASON_TEAM_ID)).toBe(true)
  })

  it('plays a full season and reports against a reachable target', () => {
    const draft = buildDraft(world, createRng(4))
    const xv = buildDraftedTeam(draft.map((p) => p.options[0]!), 'npc')
    const setup = startQuickSeason(world, 5, 'npc', xv)
    const played = simulateSeason(setup.season)

    const summary = summariseQuickSeason(played)
    expect(summary.target).toBeGreaterThan(0)
    expect(summary.wins).toBeLessThanOrEqual(summary.target)
    expect(summary.shareText).toContain('Bunnings NPC')
  })

  it('only calls a season perfect if it really was', () => {
    const draft = buildDraft(world, createRng(6))
    const xv = buildDraftedTeam(draft.map((p) => p.options[0]!), 'shute_shield')
    const played = simulateSeason(startQuickSeason(world, 7, 'shute_shield', xv).season)

    const summary = summariseQuickSeason(played)
    if (summary.perfect) {
      expect(summary.wins).toBe(summary.target)
      expect(summary.champion).toBe(true)
      expect(summary.shareText).toContain('Unbeaten')
    } else {
      expect(summary.wins).toBeLessThan(summary.target)
    }
  })

  it('reports the drafted XV strength', () => {
    const draft = buildDraft(world, createRng(8))
    const xv = buildDraftedTeam(draft.map((p) => p.options[0]!), 'top_14')
    const strength = draftStrength(xv)
    expect(strength).toBeGreaterThan(40)
    expect(strength).toBeLessThan(99)
  })

  it('works in every league in the data', () => {
    for (const league of LEAGUE_LIST) {
      const draft = buildDraft(world, createRng(league.id.length))
      const xv = buildDraftedTeam(draft.map((p) => p.options[0]!), league.id)
      const setup = startQuickSeason(world, 11, league.id, xv)
      expect(setup.season.teams).toHaveLength(league.teamCount)
    }
  })
})
