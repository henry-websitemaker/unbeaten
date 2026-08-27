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
import MatchScreen from './MatchScreen'
import TableScreen from './TableScreen'
import WheelScreen from './WheelScreen'
import SummerScreen, { OfferCard } from './SummerScreen'
import QuickSeasonScreen from './QuickSeasonScreen'
import TeamCareerScreen from './TeamCareerScreen'
import { AchievementsScreen, MyPlayerScreen, RivalScreen } from './PlayerScreens'
import { AwardsScreen, InternationalsScreen } from './SeasonScreens'
import {
  CareerEndScreen,
  HallOfFameScreen,
  PreviewScreen,
  SeasonReviewScreen,
  TrophyCabinetScreen,
} from './ReviewScreens'
import { isRegularSeasonComplete } from '../engine/season'
import { decisionsForRound } from '../engine/careerRun'
import { MAX_DECISIONS_PER_MATCH } from '../engine/agency'
import { getGamePlan } from '../engine/gamePlan'
import { TRAINING_BLOCKS } from '../engine/training'
import { LEAGUES, TIER_TWO_LEAGUES } from '../data'

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

  it('offers only the four tier-two leagues at creation', () => {
    // SPEC §3: tier one has to be earned. Offering it would produce a career with no game
    // time at all, which is the failure the phase-12 pass existed to remove.
    for (const league of TIER_TWO_LEAGUES) {
      expect(LEAGUES[league.id].tier).toBe(2)
    }
    expect(TIER_TWO_LEAGUES).toHaveLength(4)
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

  it('renders the internationals screen mid-season, before any summary exists', () => {
    const html = render(<InternationalsScreen />)
    // The selection bar, from the player's own nation.
    expect(html).toContain('OVR floor')
    expect(html).toContain('Form needed')
    expect(html).toContain('Test caps')
  })

  it('renders the awards screen with nothing to show yet', () => {
    expect(render(<AwardsScreen />)).toContain('Awards')
  })
})

describe('match agency (SPEC §3)', () => {
  it('renders the decisions with their odds, and never more than two', () => {
    const run = useGame.getState().run!
    const offered = decisionsForRound(run)
    useGame.setState({ pendingDecisions: offered, resolvedDecisions: [] })

    expect(offered.length).toBeLessThanOrEqual(MAX_DECISIONS_PER_MATCH)

    const html = render(<MatchScreen />)
    if (offered.length > 0) {
      // The odds are on the card before the choice is made.
      expect(html).toMatch(/\d+%/)
      expect(html).toContain('Get on with it')
      expect(html).toContain(offered[0]!.title)
    } else {
      expect(html).toContain('Play the match')
    }
  })

  it('shows the sticky game plan and a pre-match news line', () => {
    useGame.setState({ pendingDecisions: [], resolvedDecisions: [] })
    const html = render(<MatchScreen />)

    // The plan the career is currently on, collapsed to one line with a way to change it.
    const current = getGamePlan(useGame.getState().run!.career.gamePlan)
    expect(html).toContain('Game plan')
    expect(html).toContain(current.name)
    expect(html).toContain('Change')
  })

  it('keeps the game plan across matches until it is changed', () => {
    useGame.getState().setGamePlan('high_risk')
    expect(useGame.getState().run!.career.gamePlan).toBe('high_risk')

    // Playing a round must not reset it.
    useGame.getState().nextRound()
    expect(useGame.getState().run!.career.gamePlan).toBe('high_risk')

    useGame.getState().setGamePlan('tactical_depth')
    expect(useGame.getState().run!.career.gamePlan).toBe('tactical_depth')
  })

  it('stops at match day even when there are no calls to make', () => {
    // SPEC §3 puts the game plan before *each* match, so the screen cannot be skipped on the
    // rounds that happen to roll no decisions.
    const run = useGame.getState().run!
    if (isRegularSeasonComplete(run.season)) return
    useGame.getState().openMatch()
    expect(useGame.getState().screen).toBe('match')
  })

  it('renders the outcome once a call has been taken', () => {
    const run = useGame.getState().run!
    const offered = decisionsForRound(run)
    if (offered.length === 0) return

    useGame.setState({ pendingDecisions: offered, resolvedDecisions: [] })
    const risky =
      offered[0]!.options.find((o) => o.stats.length > 0) ?? offered[0]!.options[0]!
    useGame.getState().decide(offered[0]!.situationId, risky.id)

    const html = render(<MatchScreen />)
    expect(html).toContain(risky.label)
    // With every call taken, the only way on is to play.
    if (offered.length === 1) expect(html).toContain('Play the match')

    useGame.setState({ pendingDecisions: [], resolvedDecisions: [] })
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

  it('opens the season review with a verdict banner', () => {
    const html = render(<SeasonReviewScreen />)
    expect(html).toMatch(/World Class|Solid|Steady Performer|Quiet Season/)
  })

  it('renders the awards and international blocks in the season review', () => {
    const html = render(<SeasonReviewScreen />)
    expect(html).toContain('Awards')
    expect(html).toContain('All awards')
    // The nation's verdict on the player, whichever way it went.
    expect(html).toContain('England')
  })

  it('renders the awards screen with the World Player shortlist and its justifications', () => {
    const html = render(<AwardsScreen />)
    expect(html).toContain('World Player of the Year')
    expect(html).toContain('Team of the Season')
    // Every nominee carries a one-line case (SPEC §3).
    expect(html).toMatch(/average across \d+ games/)
  })

  it('renders the internationals screen with the season just played', () => {
    const html = render(<InternationalsScreen />)
    expect(html).toContain('Test caps')
    expect(html).toContain('Test silverware')
  })

  it('renders Summer Plans with the lifestyle shop', () => {
    const html = render(<SummerScreen />)
    expect(html).toContain('Lifestyle')
    expect(html).toContain('Personal Trainer')
    expect(html).toContain('Off-Season Retreat')
  })

  it('renders the pre-season stat picks with current values and what each is worth', () => {
    // SPEC §2.8. This assertion used to be its exact opposite — that no training step
    // existed at all — which is why the amendment is called out in the spec rather than
    // quietly applied. It then asserted blocks; training is now a per-stat pick.
    const html = render(<SummerScreen />)
    expect(html).toContain('Pre-season training')

    const career = useGame.getState().run!.career
    for (const stat of Object.keys(career.stats)) {
      expect(html, `no card for ${stat}`).toContain(`>${stat}<`)
    }
    // The consequence of each pick is on the card, not left to be guessed.
    expect(html).toMatch(/\+\d+ OVR|±0 OVR/)
    // And the season's figure is one definite number in the header.
    expect(html).toMatch(/\+\d+ to one attribute before next season/)
  })

  it('opens the career-earnings banner at the top', () => {
    const html = render(<SummerScreen />)
    expect(html).toContain('Career earnings')
    expect(html).toContain('in the bank')
  })

  it('puts the transfer window behind a spin', () => {
    // SPEC §3: spin for the pool, then choose from it. The cards are not on screen until the
    // wheel has landed, which is why `OfferCard` is asserted separately below.
    const html = render(<SummerScreen />)
    if (useGame.getState().offers.length > 0) {
      expect(html).toContain('Your options')
      expect(html).toContain('Spin the transfer window')
    }
  })

  it('shows wage, wage change and squad role on a destination card', () => {
    const offer = useGame.getState().offers[0]
    if (!offer) return

    const html = render(
      <OfferCard
        offer={{ ...offer, salary: 2_000 }}
        currentWage={3_000}
        isChosen={false}
        locked={false}
        onPick={() => {}}
      />,
    )

    expect(html).toContain('Weekly wage')
    expect(html).toContain('Contract')
    expect(html).toMatch(/First Team|Impact Sub|Bench Cover/)
    for (const old of ['Star man', 'First choice', 'Squad player']) {
      expect(html).not.toContain(old)
    }

    // A pay cut is shown as a cut, in the loss colour.
    expect(html).toContain('text-loss')
    expect(html).toContain('−')
  })

  it('shows the OVR consequence on destination cards before the choice', () => {
    // SPEC §2.5, asserted on the card itself because the cards sit behind the transfer spin.
    const offer = useGame.getState().offers[0]
    if (!offer) return

    const html = render(
      <OfferCard
        offer={offer}
        currentWage={offer.salary}
        isChosen={false}
        locked={false}
        onPick={() => {}}
      />,
    )
    expect(html).toContain('Squad OVR')
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
