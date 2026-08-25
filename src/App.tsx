/**
 * Root shell.
 *
 * Screens are lazily loaded so the entry chunk carries only the menu (SPEC §6). The heavy
 * data — `teams.json` at 190KB — is dynamically imported by the store, so it never lands in
 * the entry chunk either.
 */

import { Suspense, lazy, useEffect } from 'react'
import { useGame } from './store/gameStore'
import MenuScreen from './ui/MenuScreen'

const CreateScreen = lazy(() => import('./ui/CreateScreen'))
const DashboardScreen = lazy(() => import('./ui/DashboardScreen'))
const TableScreen = lazy(() => import('./ui/TableScreen'))
const WheelScreen = lazy(() => import('./ui/WheelScreen'))
const SummerScreen = lazy(() => import('./ui/SummerScreen'))
const QuickSeasonScreen = lazy(() => import('./ui/QuickSeasonScreen'))
const TeamCareerScreen = lazy(() => import('./ui/TeamCareerScreen'))

const MyPlayerScreen = lazy(() =>
  import('./ui/PlayerScreens').then((m) => ({ default: m.MyPlayerScreen })),
)
const AchievementsScreen = lazy(() =>
  import('./ui/PlayerScreens').then((m) => ({ default: m.AchievementsScreen })),
)
const RivalScreen = lazy(() =>
  import('./ui/PlayerScreens').then((m) => ({ default: m.RivalScreen })),
)
const PreviewScreen = lazy(() =>
  import('./ui/ReviewScreens').then((m) => ({ default: m.PreviewScreen })),
)
const SeasonReviewScreen = lazy(() =>
  import('./ui/ReviewScreens').then((m) => ({ default: m.SeasonReviewScreen })),
)
const CareerEndScreen = lazy(() =>
  import('./ui/ReviewScreens').then((m) => ({ default: m.CareerEndScreen })),
)
const HallOfFameScreen = lazy(() =>
  import('./ui/ReviewScreens').then((m) => ({ default: m.HallOfFameScreen })),
)
const TrophyCabinetScreen = lazy(() =>
  import('./ui/ReviewScreens').then((m) => ({ default: m.TrophyCabinetScreen })),
)

function Loading() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-pitch-950">
      <p className="text-sm text-pitch-500">Loading…</p>
    </div>
  )
}

export default function App() {
  const screen = useGame((s) => s.screen)
  const ready = useGame((s) => s.ready)
  const init = useGame((s) => s.init)

  useEffect(() => {
    void init()
  }, [init])

  if (!ready) return <Loading />

  return (
    <Suspense fallback={<Loading />}>
      {screen === 'menu' && <MenuScreen />}
      {screen === 'create' && <CreateScreen />}
      {screen === 'preview' && <PreviewScreen />}
      {screen === 'dashboard' && <DashboardScreen />}
      {screen === 'table' && <TableScreen />}
      {screen === 'wheel' && <WheelScreen />}
      {screen === 'summer' && <SummerScreen />}
      {screen === 'my-player' && <MyPlayerScreen />}
      {screen === 'achievements' && <AchievementsScreen />}
      {screen === 'rival' && <RivalScreen />}
      {screen === 'season-review' && <SeasonReviewScreen />}
      {screen === 'career-end' && <CareerEndScreen />}
      {screen === 'hall-of-fame' && <HallOfFameScreen />}
      {screen === 'trophies' && <TrophyCabinetScreen />}
      {screen === 'quick-season' && <QuickSeasonScreen />}
      {screen === 'team-career' && <TeamCareerScreen />}
    </Suspense>
  )
}
