/**
 * The store is the seam between the pure engine and React, and it is where the *order* of
 * operations lives — wages before a ball is kicked, the wheel at the midpoint, reconciliation
 * at the season boundary. These tests drive a career through the real store, so what they
 * prove is what the game does when someone taps the buttons.
 */

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { useGame } from './gameStore'
import { isRegularSeasonComplete, totalRounds } from '../engine/season'
import { balance, grossEarnings, reconcile } from '../engine/economy'
import { CAREER_SEASONS } from '../types/career'

/** localStorage and requestAnimationFrame do not exist in a node test environment. */
function installBrowserStubs() {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  })
  // Run callbacks synchronously so "sim to season end" completes within a test.
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    cb()
    return 0
  })
  return data
}

beforeAll(() => {
  installBrowserStubs()
})

beforeEach(async () => {
  useGame.setState({
    screen: 'menu',
    run: null,
    rival: null,
    simming: false,
    lastSpin: null,
    lastSummary: null,
    offers: [],
    newAchievements: [],
  })
  await useGame.getState().init()
})

function start(name = 'Test Player') {
  useGame.getState().startCareer({
    name,
    position: 'OC',
    archetypeId: 'wonderkid',
    nationId: 'eng',
  })
  // startCareer loads teams asynchronously.
  return vi.waitFor(() => {
    const run = useGame.getState().run
    if (!run) throw new Error('career not started')
    return run
  })
}

describe('boot', () => {
  it('is ready with a world and no career', () => {
    const state = useGame.getState()
    expect(state.ready).toBe(true)
    expect(state.world).not.toBeNull()
    expect(state.world!.teams).toHaveLength(99)
  })
})

describe('starting a career', () => {
  it('creates a career, places the player in a squad, and shows the preview', async () => {
    const run = await start()
    const state = useGame.getState()

    expect(state.screen).toBe('preview')
    expect(run.career.season).toBe(1)
    expect(run.career.ovr).toBeGreaterThanOrEqual(54)
    expect(run.career.ovr).toBeLessThanOrEqual(66)
    expect(state.rival).not.toBeNull()

    // The player really is in their club's squad.
    const club = state.world!.teams.find((t) => t.id === run.career.contract.clubId)!
    expect(club.squad.some((p) => p.id === 'player')).toBe(true)
  })

  it('has banked nothing before a round has been played', async () => {
    // Wages accrue by the round now; they used to be credited as an annual lump the moment
    // the season began, which meant a career had money before it had played any rugby.
    const run = await start()
    expect(grossEarnings(run.career.ledger)).toBe(0)
  })

  it('banks a week of wages for each round played', async () => {
    const run = await start()
    const weekly = run.career.contract.salary

    useGame.getState().nextRound()
    expect(grossEarnings(useGame.getState().run!.career.ledger)).toBeGreaterThanOrEqual(weekly)
  })

  it('starts in a tier-2 league — tier 1 has to be earned', async () => {
    const run = await start()
    const tierTwo = ['shute_shield', 'npc', 'rfu_championship', 'pro_d2']
    expect(tierTwo).toContain(run.career.contract.leagueId)
  })
})

describe('playing rounds', () => {
  it('advances a round and logs it', async () => {
    await start()
    useGame.getState().nextRound()

    const run = useGame.getState().run!
    expect(run.season.roundsPlayed).toBe(1)
    expect(run.log).toHaveLength(1)
  })

  it('stops at the wheel and shows the wheel screen', async () => {
    await start()
    const game = useGame.getState()

    for (let i = 0; i < 40; i++) {
      const run = useGame.getState().run!
      if (run.wheelPending || isRegularSeasonComplete(run.season)) break
      game.nextRound()
    }

    const run = useGame.getState().run!
    expect(run.wheelPending).toBe(true)
    expect(useGame.getState().screen).toBe('wheel')
  })

  it('sim to season end runs to completion without blocking', async () => {
    await start()
    const game = useGame.getState()

    game.simToSeasonEnd()
    // Stops at the wheel, which is a decision the player is entitled to make.
    if (useGame.getState().run!.wheelPending) {
      game.skipWheel()
      useGame.getState().simToSeasonEnd()
    }

    const run = useGame.getState().run!
    expect(isRegularSeasonComplete(run.season)).toBe(true)
    expect(run.season.roundsPlayed).toBe(totalRounds(run.season))
    expect(useGame.getState().simming).toBe(false)
  })
})

describe('the wheel', () => {
  async function reachWheel() {
    await start()
    const game = useGame.getState()
    for (let i = 0; i < 40; i++) {
      if (useGame.getState().run!.wheelPending) break
      game.nextRound()
    }
    return useGame.getState().run!
  }

  it('never takes anything permanent when spun', async () => {
    const before = await reachWheel()
    useGame.getState().spinWheel()
    const after = useGame.getState().run!.career

    for (const [stat, value] of Object.entries(before.career.stats)) {
      expect(after.stats[stat as keyof typeof after.stats]!).toBeGreaterThanOrEqual(value!)
    }
    expect(after.ovr).toBeGreaterThanOrEqual(before.career.ovr)
    expect(after.contract.salary).toBeGreaterThanOrEqual(before.career.contract.salary)
    expect(useGame.getState().lastSpin).not.toBeNull()
  })

  it('changes nothing when skipped', async () => {
    const before = await reachWheel()
    useGame.getState().skipWheel()
    const after = useGame.getState().run!.career

    expect(after.stats).toEqual(before.career.stats)
    expect(after.ovr).toBe(before.career.ovr)
    expect(after.wheelSpunThisSeason).toBe(true)
    expect(useGame.getState().screen).toBe('dashboard')
  })
})

describe('finishing a season', () => {
  async function playSeason() {
    await start()
    const game = useGame.getState()
    for (let i = 0; i < 60; i++) {
      const run = useGame.getState().run!
      if (isRegularSeasonComplete(run.season)) break
      if (run.wheelPending) game.skipWheel()
      else game.nextRound()
    }
    useGame.getState().finishSeason()
  }

  it('produces a season review with transfer offers', async () => {
    await playSeason()
    const state = useGame.getState()

    expect(state.screen).toBe('season-review')
    expect(state.lastSummary).not.toBeNull()
    expect(state.run!.career.history).toHaveLength(1)
    expect(state.offers.length).toBeGreaterThan(0)
  })

  it('always offers the option to stay, at zero OVR change', async () => {
    await playSeason()
    const stay = useGame.getState().offers.find((o) => o.direction === 'stay')
    expect(stay).toBeDefined()
    expect(stay!.ovrChangeRange).toEqual([0, 0])
  })

  it('keeps the ledger reconciled at the season boundary', async () => {
    await playSeason()
    const r = reconcile(useGame.getState().run!.career.ledger)
    expect(r.ok).toBe(true)
    expect(r.spent + r.balance).toBe(r.gross)
  })

  it('persists the career so it survives a reload', async () => {
    await playSeason()
    const name = useGame.getState().run!.career.name

    // Wipe in-memory state and boot again, exactly as a page refresh would.
    useGame.setState({ run: null, rival: null, ready: false })
    await useGame.getState().init()

    const restored = useGame.getState().run
    expect(restored).not.toBeNull()
    expect(restored!.career.name).toBe(name)
    expect(restored!.career.history).toHaveLength(1)
  })
})

describe('summer plans', () => {
  it('refuses a purchase the player cannot afford, with a reason', async () => {
    await start()
    const message = useGame.getState().buyLifestyle('elite_agent')
    expect(message).toContain('costs')
  })

  it('actually deducts an affordable purchase', async () => {
    await start()

    // Give the career enough money to shop with.
    const run = useGame.getState().run!
    useGame.setState({
      run: {
        ...run,
        career: {
          ...run.career,
          ledger: {
            entries: [
              ...run.career.ledger.entries,
              { season: 1, type: 'sponsor', label: 'Windfall', amount: 5_000_000 },
            ],
          },
        },
      },
    })

    const before = balance(useGame.getState().run!.career.ledger)
    const error = useGame.getState().buyLifestyle('personal_trainer')

    expect(error).toBeNull()
    expect(balance(useGame.getState().run!.career.ledger)).toBe(before - 500_000)
  })

  it('applies a chosen destination', async () => {
    await start()
    const game = useGame.getState()
    for (let i = 0; i < 60; i++) {
      const run = useGame.getState().run!
      if (isRegularSeasonComplete(run.season)) break
      if (run.wheelPending) game.skipWheel()
      else game.nextRound()
    }
    useGame.getState().finishSeason()

    const move = useGame.getState().offers.find((o) => o.direction !== 'stay')
    if (!move) return

    useGame.getState().chooseDestination(move)
    expect(useGame.getState().run!.career.contract.clubId).toBe(move.clubId)
    expect(useGame.getState().run!.career.contract.salary).toBe(move.salary)
  })
})

describe('retirement', () => {
  it('retires after season 20 and records a ranked Hall of Fame entry', async () => {
    await start('Marathon Man')

    for (let season = 1; season <= CAREER_SEASONS; season++) {
      const game = useGame.getState()
      for (let i = 0; i < 60; i++) {
        const run = useGame.getState().run!
        if (isRegularSeasonComplete(run.season)) break
        if (run.wheelPending) game.skipWheel()
        else game.nextRound()
      }
      useGame.getState().finishSeason()
      useGame.getState().beginNextSeason()
    }

    const state = useGame.getState()
    expect(state.run!.career.retired).toBe(true)
    expect(state.run!.career.history).toHaveLength(CAREER_SEASONS)
    expect(state.screen).toBe('career-end')

    const entry = state.save.hallOfFame.find((e) => e.name === 'Marathon Man')
    expect(entry).toBeDefined()
    expect(entry!.ranked).toBe(true)
    expect(entry!.seasonsPlayed).toBe(CAREER_SEASONS)

    // A retired career must not be resumed on the next boot.
    await useGame.getState().init()
    expect(useGame.getState().run).toBeNull()
  }, 180_000)
})

describe('abandoning', () => {
  it('clears the career and returns to the menu', async () => {
    await start()
    useGame.getState().abandonCareer()

    expect(useGame.getState().run).toBeNull()
    expect(useGame.getState().screen).toBe('menu')

    await useGame.getState().init()
    expect(useGame.getState().run).toBeNull()
  })
})
