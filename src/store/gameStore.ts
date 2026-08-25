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
  playRound,
  skipWheelSpin,
  takeWheelSpin,
  type CareerRun,
} from '../engine/careerRun'
import { canPurchase, purchase } from '../engine/economy'
import { evaluateAchievements, newlyUnlocked } from '../engine/achievements'
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
import type { SeasonSummary } from '../engine/career'
import type { PlayerCareer, TransferOffer } from '../types/career'

export type Screen =
  | 'menu'
  | 'create'
  | 'preview'
  | 'dashboard'
  | 'table'
  | 'wheel'
  | 'summer'
  | 'my-player'
  | 'achievements'
  | 'rival'
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
  lastSummary: SeasonSummary | null
  offers: TransferOffer[]
  newAchievements: string[]

  init: () => Promise<void>
  go: (screen: Screen) => void
  startCareer: (options: CreateCareerOptions) => void
  nextRound: () => void
  simToSeasonEnd: () => void
  spinWheel: () => void
  skipWheel: () => void
  finishSeason: () => void
  buyLifestyle: (itemId: string) => string | null
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
      const club = randomStartingClub(world, rngFor(seed, 'start'))
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
      })
    })
  },

  nextRound() {
    const { run } = get()
    if (!run || isRegularSeasonComplete(run.season)) return

    const next = playRound(run)
    set({ run: next, screen: next.wheelPending ? 'wheel' : 'dashboard' })
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
    set({ run: null, rival: null, save, screen: 'menu' })
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
