/**
 * Render smoke tests.
 *
 * Without a browser in the loop, the risk is a screen that typechecks and then throws the
 * moment it renders — a bad selector, an undefined lookup, a missing guard. Rendering each
 * one to static markup with `react-dom/server` catches exactly that, needs no DOM
 * implementation, and adds no dependency.
 *
 * They are not a substitute for looking at the thing; they are a guarantee that nothing
 * crashes on the way there.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'

/**
 * Zustand v5 implements its hook with `useSyncExternalStore`, and passes `getInitialState`
 * as the *server* snapshot. Under `react-dom/server` every selector therefore reads the
 * state as it was at store creation — `world` null, no career — so every screen would
 * render its empty guard and these tests would pass while proving nothing.
 *
 * This replaces only the subscription mechanism, reading current state synchronously. The
 * store, its actions and its real state are untouched.
 */
vi.mock('../store/gameStore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store/gameStore')>()
  const useGame = <T,>(selector: (state: ReturnType<typeof actual.useGame.getState>) => T): T =>
    selector(actual.useGame.getState())
  return { ...actual, useGame: Object.assign(useGame, actual.useGame) }
})

import { useGame } from '../store/gameStore'
import MenuScreen from './MenuScreen'
import CreateScreen from './CreateScreen'
import DashboardScreen from './DashboardScreen'
import TableScreen from './TableScreen'
import WheelScreen from './WheelScreen'
import SummerScreen from './SummerScreen'
import QuickSeasonScreen from './QuickSeasonScreen'
import TeamCareerScreen from './TeamCareerScreen'
import { AchievementsScreen, MyPlayerScreen, RivalScreen } from './PlayerScreens'
import {
  CareerEndScreen,
  HallOfFameScreen,
  PreviewScreen,
  SeasonReviewScreen,
  TrophyCabinetScreen,
} from './ReviewScreens'
import { isRegularSeasonComplete } from '../engine/season'

function render(element: ReactElement): string {
  return renderToStaticMarkup(element)
}

beforeAll(async () => {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  })
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    cb()
    return 0
  })

  await useGame.getState().init()

  useGame.getState().startCareer({
    name: 'Render Test',
    position: 'OC',
    archetypeId: 'wonderkid',
    nationId: 'eng',
  })
  await vi.waitFor(() => {
    if (!useGame.getState().run) throw new Error('not started')
  })
}, 60_000)

describe('screens that need no career', () => {
  it('renders the menu', () => {
    expect(render(<MenuScreen />)).toContain('Unbeaten')
  })

  it('renders player creation', () => {
    expect(render(<CreateScreen />)).toContain('Forge your player')
  })

  it('renders the Hall of Fame', () => {
    expect(render(<HallOfFameScreen />)).toContain('Hall of Fame')
  })

  it('renders the trophy cabinet', () => {
    expect(render(<TrophyCabinetScreen />)).toContain('Trophy cabinet')
  })

  it('renders Quick Season', () => {
    expect(render(<QuickSeasonScreen />)).toContain('Quick Season')
  })

  it('renders Team Career', () => {
    expect(render(<TeamCareerScreen />)).toContain('Team Career')
  })
})

describe('screens during a season', () => {
  it('renders the season preview with the perfect-season target', () => {
    const html = render(<PreviewScreen />)
    expect(html).toContain('The perfect season')
    expect(html).toContain('Coach expects')
  })

  it('renders the dashboard in the 38-0-0 layout', () => {
    const html = render(<DashboardScreen />)
    // Four stat cards, the two actions, and the match log.
    expect(html).toContain('OVR')
    expect(html).toContain('Apps')
    expect(html).toContain('Rating')
    expect(html).toContain('Balance')
    expect(html).toContain('Play next match')
    expect(html).toContain('Sim to season end')
    expect(html).toContain('Match log')
  })

  it('renders the league table', () => {
    expect(render(<TableScreen />)).toContain('Pts')
  })

  it('renders the wheel with its odds and its guarantee', () => {
    const html = render(<WheelScreen />)
    expect(html).toContain('50%')
    expect(html).toContain('35%')
    expect(html).toContain('15%')
    expect(html).toContain('cannot lose what you have already')
  })

  it('renders My Player', () => {
    expect(render(<MyPlayerScreen />)).toContain('Attributes')
  })

  it('renders the achievement grid with all four categories', () => {
    const html = render(<AchievementsScreen />)
    for (const category of ['Milestones', 'Feats', 'Journey', 'Legend']) {
      expect(html).toContain(category)
    }
  })

  it('renders the rival head-to-head', () => {
    expect(render(<RivalScreen />)).toContain('Head to head')
  })
})

describe('screens after a match log has built up', () => {
  beforeAll(() => {
    const game = useGame.getState()
    for (let i = 0; i < 6; i++) {
      const run = useGame.getState().run!
      if (isRegularSeasonComplete(run.season)) break
      if (run.wheelPending) game.skipWheel()
      else game.nextRound()
    }
  })

  it('renders result chips in the match log', () => {
    const html = render(<DashboardScreen />)
    expect(html).toMatch(/>[WDL]</)
  })

  it('renders the table with the player club highlighted', () => {
    expect(render(<TableScreen />)).toContain('turf-500/10')
  })
})

describe('end-of-season screens', () => {
  beforeAll(() => {
    const game = useGame.getState()
    for (let i = 0; i < 60; i++) {
      const run = useGame.getState().run!
      if (isRegularSeasonComplete(run.season)) break
      if (run.wheelPending) game.skipWheel()
      else game.nextRound()
    }
    useGame.getState().finishSeason()
  }, 60_000)

  it('renders the season review with the OVR breakdown', () => {
    const html = render(<SeasonReviewScreen />)
    expect(html).toContain('Development')
    expect(html).toContain('From how you played')
    expect(html).toContain('From age')
  })

  it('renders Summer Plans with the lifestyle shop and no training step', () => {
    const html = render(<SummerScreen />)
    expect(html).toContain('Lifestyle')
    expect(html).toContain('Personal Trainer')
    expect(html).toContain('Off-Season Retreat')
    // SPEC §2.7: there is no training step to render.
    expect(html).not.toContain('Training')
  })

  it('shows the OVR consequence on destination cards before the choice', () => {
    const html = render(<SummerScreen />)
    expect(html).toContain('Where next?')
    expect(html).toContain('OVR')
    // Either a step-up range, a step-down range, or the stay option.
    expect(html).toMatch(/±0|to \+|to -/)
  })

  it('renders the career-end summary', () => {
    const run = useGame.getState().run!
    useGame.setState({ run: { ...run, career: { ...run.career, retired: true } } })
    const html = render(<CareerEndScreen />)
    expect(html).toContain('The numbers')
    expect(html).toContain('Career earnings')
  })
})
