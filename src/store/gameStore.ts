/**
 * Game state.
 *
 * The engine is pure; this is the only place mutation and I/O live. The world is *not*
 * persisted — it is 99 clubs of generated squads and would dwarf a localStorage quota — so
 * only the career and its seed are saved, and the world is rebuilt deterministically on
 * load. That is the whole reason the RNG derives its streams instead of consuming one.
 */

import { create } from 'zustand'
import { loadTeams } from '../data'
import {
  acceptOffer,
  advanceSeason,
  buildSeasonPreview,
  createCareer,
  generateTransferOffers,
  isFinalSeason,
  placeCareerInWorld,
  type CreateCareerOptions,
} from '../engine/career'
import {
  beginSeason,
  closeSeason,
  decisionsForRound,
  playRound,
  skipWheelSpin,
  takeWheelSpin,
  type CareerRun,
} from '../engine/careerRun'
import {
  resolveDecision,
  type OfferedDecision,
  type ResolvedDecision,
} from '../engine/agency'
import { canPurchase, purchase } from '../engine/economy'
import { applyTraining, blockForStat, picksAvailable } from '../engine/training'
import { evaluateAchievements, newlyUnlocked } from '../engine/achievements'
import { assessSelection } from '../engine/internationals'
import { recentFormRating } from '../engine/seasonClose'
import { advanceRival, createRival, type Rival } from '../engine/rival'
import { isRegularSeasonComplete, totalRounds } from '../engine/season'
import { createWorld, randomStartingClub, type World } from '../engine/world'
import {
  emptySave,
  loadSave,
  recordCareer,
  writeSave,
  type SaveState,
} from '../engine/persistence'
import { rngFor, seedFromString } from '../engine/rng'
import type { SpinResult } from '../engine/wheel'
import type { CareerSeasonSummary } from '../engine/careerRun'
import type { GamePlanId, PlayerCareer, TransferOffer } from '../types/career'
import type { StatKey } from '../types/core'

export type Screen =
  | 'menu'
  | 'create'
  | 'preview'
  | 'dashboard'
  | 'match'
  | 'table'
  | 'wheel'
  | 'summer'
  | 'my-player'
  | 'achievements'
  | 'rival'
  | 'awards'
  | 'internationals'
  | 'season-review'
  | 'career-end'
  | 'hall-of-fame'
  | 'trophies'
  | 'quick-season'
  | 'team-career'

interface GameState {
  screen: Screen
  ready: boolean
  world: World | null
  run: CareerRun | null
  rival: Rival | null
  save: SaveState

  /** Set while "Sim to season end" is running. */
  simming: boolean
  lastSpin: SpinResult | null
  lastSummary: CareerSeasonSummary | null
  offers: TransferOffer[]
  newAchievements: string[]

  /** The calls this match is offering, and the ones already taken (SPEC §3). */
  pendingDecisions: OfferedDecision[]
  resolvedDecisions: ResolvedDecision[]

  init: () => Promise<void>
  go: (screen: Screen) => void
  startCareer: (options: CreateCareerOptions) => void
  /** The dashboard button: ask for any calls first, then play. */
  openMatch: () => void
  decide: (situationId: string, optionId: string) => void
  /** Plays the round with whatever has been decided. */
  nextRound: () => void
  simToSeasonEnd: () => void
  spinWheel: () => void
  skipWheel: () => void
  finishSeason: () => void
  buyLifestyle: (itemId: string) => string | null
  /** Work on one stat this summer (SPEC §2.8). One pick per season. */
  chooseTraining: (stat: StatKey) => string | null
  /** Set the game plan. It sticks until changed (SPEC §3). */
  setGamePlan: (plan: GamePlanId) => void
  chooseDestination: (offer: TransferOffer) => void
  beginNextSeason: () => void
  abandonCareer: () => void
}

function storage() {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function persist(save: SaveState): void {
  const store = storage()
  if (store) {
    try {
      writeSave(store, save)
    } catch {
      // A full or unavailable quota must not take the game down.
    }
  }
}

export const useGame = create<GameState>((set, get) => ({
  screen: 'menu',
  ready: false,
  world: null,
  run: null,
  rival: null,
  save: emptySave(),
  simming: false,
  lastSpin: null,
  lastSummary: null,
  offers: [],
  newAchievements: [],
  pendingDecisions: [],
  resolvedDecisions: [],

  async init() {
    const defs = await loadTeams()
    const store = storage()
    const save = store ? loadSave(store).state : emptySave()

    let world: World | null = null
    let run: CareerRun | null = null
    let rival: Rival | null = null

    const saved = save.slots.player ?? save.playerCareer
    if (saved && !saved.retired) {
      // Rebuild the world from the career's own seed, then resume.
      world = placeCareerInWorld(createWorld(saved.seed, defs), saved)
      run = beginSeason(saved, world)
      rival = createRival(saved.seed, saved.position, 60, saved.contract.leagueId)
      for (let s = 1; s < saved.season; s++) rival = advanceRival(rival, saved.seed, s)
    } else {
      world = createWorld(seedFromString('preview'), defs)
    }

    set({ ready: true, world, run, rival, save })
  },

  go(screen) {
    set({ screen })
  },

  startCareer(options) {
    // Entropy comes from the caller's clock here and nowhere else — the engine itself never
    // reads the time, which is what keeps every result reproducible from the seed.
    const seed = seedFromString(`${options.name}:${Date.now()}`)

    // A fresh world built for this career's seed.
    loadTeams().then((teamDefs) => {
      const world = createWorld(seed, teamDefs)
      const club = randomStartingClub(
        world,
        rngFor(seed, 'start'),
        options.position,
        options.leagueId,
      )
      const career = createCareer(seed, options, club)
      const placed = placeCareerInWorld(world, career)
      const rival = createRival(seed, career.position, career.ovr, club.leagueId)

      set({
        world: placed,
        run: beginSeason(career, placed),
        rival,
        screen: 'preview',
        lastSpin: null,
        lastSummary: null,
        offers: [],
        newAchievements: [],
        pendingDecisions: [],
        resolvedDecisions: [],
      })
    })
  },

  /**
   * The dashboard's "Play next match".
   *
   * If the match has calls to make, stop and ask — that is the whole point of match agency.
   * Otherwise go straight to the whistle. `nextRound` is left alone as the thing that
   * actually plays a round, so anything driving the season forward keeps working.
   */
  openMatch() {
    const { run } = get()
    if (!run || isRegularSeasonComplete(run.season)) return

    // Always stop at match day, even when there are no calls to make: SPEC §3 puts the game
    // plan before *each* match, and routing straight past it on the ~35% of rounds that roll
    // no decisions would make the plan settable only sometimes. With a sticky plan and no
    // decisions the screen is one tap — the news, the plan you are already on, and play.
    set({
      pendingDecisions: decisionsForRound(run),
      resolvedDecisions: [],
      screen: 'match',
    })
  },

  /**
   * Take one of the calls on offer.
   *
   * Each decision resolves on its own rng stream, keyed by the round and the situation, so
   * the result does not depend on the order the player worked through them.
   */
  decide(situationId, optionId) {
    const state = get()
    if (!state.run) return
    if (state.resolvedDecisions.some((d) => d.situationId === situationId)) return

    const { career, season } = state.run
    const resolved = resolveDecision(
      rngFor(career.seed, 'agency-resolve', career.season, season.roundsPlayed + 1, situationId),
      career.stats,
      situationId,
      optionId,
    )
    if (!resolved) return

    set({ resolvedDecisions: [...state.resolvedDecisions, resolved] })
  },

  /**
   * Play the round with whatever was decided.
   *
   * Deciding nothing is the neutral path, which is what makes agency skippable and what
   * "Sim to season end" and the tests both rely on.
   */
  nextRound() {
    const state = get()
    if (!state.run || isRegularSeasonComplete(state.run.season)) return

    const next = playRound(state.run, state.resolvedDecisions)
    set({
      run: next,
      pendingDecisions: [],
      resolvedDecisions: [],
      screen: next.wheelPending ? 'wheel' : 'dashboard',
    })
  },

  /**
   * Sim to the end of the season without freezing the UI (SPEC §6).
   *
   * Rounds are played one animation frame at a time rather than in a loop, so the browser
   * keeps painting and the progress is visible. It stops at the wheel, which is a decision
   * the player is entitled to make.
   */
  simToSeasonEnd() {
    const state = get()
    if (!state.run || state.simming) return

    set({ simming: true })

    const step = () => {
      const current = get()
      if (!current.run || !current.simming) {
        set({ simming: false })
        return
      }

      if (isRegularSeasonComplete(current.run.season)) {
        set({ simming: false })
        return
      }

      const next = playRound(current.run)
      set({ run: next })

      if (next.wheelPending) {
        set({ simming: false, screen: 'wheel' })
        return
      }

      requestAnimationFrame(step)
    }

    requestAnimationFrame(step)
  },

  spinWheel() {
    const { run } = get()
    if (!run) return
    const { run: next, result } = takeWheelSpin(run)
    set({ run: next, lastSpin: result })
  },

  skipWheel() {
    const { run } = get()
    if (!run) return
    set({ run: skipWheelSpin(run), lastSpin: null, screen: 'dashboard' })
  },

  finishSeason() {
    const state = get()
    if (!state.run) return

    const { run, summary } = closeSeason(state.run)
    const unlocked = newlyUnlocked(summary.career)
    const career: PlayerCareer = {
      ...summary.career,
      achievements: [...summary.career.achievements, ...unlocked],
    }

    const rival = state.rival ? advanceRival(state.rival, career.seed, career.season) : null
    const offers =
      isFinalSeason(career) || !state.world
        ? []
        : generateTransferOffers(career, state.world, rngFor(career.seed, 'offers', career.season))

    const save: SaveState = {
      ...state.save,
      playerCareer: career,
      slots: { ...state.save.slots, player: career },
    }
    persist(save)

    set({
      run: { ...run, career },
      rival,
      offers,
      lastSummary: { ...summary, career },
      newAchievements: unlocked,
      save,
      pendingDecisions: [],
      resolvedDecisions: [],
      screen: 'season-review',
    })
  },

  buyLifestyle(itemId) {
    const state = get()
    if (!state.run) return 'No career in progress.'

    const { career } = state.run
    const check = canPurchase(career.ledger, career.lifestyle, itemId, career.season)
    if (!check.ok) return check.message

    const result = purchase(career.ledger, career.lifestyle, itemId, career.season)
    const next: PlayerCareer = {
      ...career,
      ledger: result.ledger,
      lifestyle: result.lifestyle,
    }

    const save: SaveState = {
      ...state.save,
      playerCareer: next,
      slots: { ...state.save.slots, player: next },
    }
    persist(save)

    set({ run: { ...state.run, career: next }, save })
    return null
  },

  chooseTraining(stat) {
    const state = get()
    if (!state.run) return 'No career in progress.'

    const { career } = state.run
    if (picksAvailable(career.training, career.season) === 0) {
      return 'No pre-season picks left. You earn another next summer.'
    }
    if (career.stats[stat] === undefined) {
      return 'That is not something your position is rated on.'
    }

    const result = applyTraining(career.stats, career.position, stat, career.season)
    const next: PlayerCareer = {
      ...career,
      stats: result.stats,
      ovr: result.ovr,
      training: [
        ...career.training,
        {
          season: career.season,
          statKey: stat,
          blockId: blockForStat(stat).id,
          ovrDelta: result.ovrDelta,
        },
      ],
    }

    const save: SaveState = {
      ...state.save,
      playerCareer: next,
      slots: { ...state.save.slots, player: next },
    }
    persist(save)

    set({ run: { ...state.run, career: next }, save })
    return null
  },

  setGamePlan(plan) {
    const state = get()
    if (!state.run) return
    const career: PlayerCareer = { ...state.run.career, gamePlan: plan }

    // Persisted immediately: the plan is sticky, so it has to survive a reload the same way
    // the rest of the career does.
    const save: SaveState = {
      ...state.save,
      playerCareer: career,
      slots: { ...state.save.slots, player: career },
    }
    persist(save)

    set({ run: { ...state.run, career }, save })
  },

  chooseDestination(offer) {
    const state = get()
    if (!state.run || !state.world) return

    const { career, ovrDelta } = acceptOffer(
      state.run.career,
      offer,
      rngFor(state.run.career.seed, 'move', state.run.career.season),
    )
    void ovrDelta

    const world = placeCareerInWorld(state.world, career)
    set({ world, run: { ...state.run, career, world }, offers: [] })
  },

  beginNextSeason() {
    const state = get()
    if (!state.run || !state.world) return

    const career = advanceSeason(state.run.career)

    if (career.retired) {
      const save = recordCareer(
        { ...state.save, playerCareer: career, slots: { ...state.save.slots, player: null } },
        career,
        `${career.name}:${career.seed}`,
      )
      persist(save)
      set({ run: { ...state.run, career }, save, screen: 'career-end' })
      return
    }

    const world = placeCareerInWorld(state.world, career)
    const save: SaveState = {
      ...state.save,
      playerCareer: career,
      slots: { ...state.save.slots, player: career },
    }
    persist(save)

    set({
      world,
      run: beginSeason(career, world),
      save,
      lastSpin: null,
      lastSummary: null,
      offers: [],
      newAchievements: [],
      pendingDecisions: [],
      resolvedDecisions: [],
      screen: 'preview',
    })
  },

  abandonCareer() {
    const state = get()
    const save: SaveState = {
      ...state.save,
      playerCareer: null,
      slots: { ...state.save.slots, player: null },
    }
    persist(save)
    set({
      run: null,
      rival: null,
      save,
      pendingDecisions: [],
      resolvedDecisions: [],
      screen: 'menu',
    })
  },
}))

/** Convenience selectors used across screens. */
export function useCareer(): PlayerCareer | null {
  return useGame((s) => s.run?.career ?? null)
}

// Returned as scalars, not an object. A selector that builds a fresh object every call is
// never referentially equal, so zustand re-renders on every store change, forever.
export function useRoundsPlayed(): number {
  return useGame((s) => s.run?.season.roundsPlayed ?? 0)
}

export function useTotalRounds(): number {
  return useGame((s) => (s.run ? totalRounds(s.run.season) : 0))
}

export function usePreview() {
  return useGame((s) => (s.run && s.world ? buildSeasonPreview(s.run.career, s.world) : null))
}

export function useAchievements() {
  return useGame((s) => (s.run ? evaluateAchievements(s.run.career) : []))
}

/**
 * Where the player stands with their nation right now.
 *
 * A plain function rather than a hook: a hook defined in this module would call the real
 * `useGame` even when a test has mocked the module for its importers, which is the trap
 * `screens.test.tsx` documents at the top. Screens call this with the run they already hold.
 */
export function selectionOutlook(run: CareerRun | null) {
  if (!run) return null
  const { career, log } = run
  const ratings = log.filter((e) => e.line).map((e) => e.line!.rating)
  return assessSelection({
    nationId: career.nationId,
    ovr: career.ovr,
    formRating: recentFormRating(ratings),
    existingCaps: career.internationalCaps,
  })
}
