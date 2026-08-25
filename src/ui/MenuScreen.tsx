import { Button, Card } from './components'
import { useGame } from '../store/gameStore'
import { CAREER_SEASONS } from '../types/career'

export default function MenuScreen() {
  // One selector per value. Zustand v5 compares with Object.is, so a selector that returns
  // a fresh object is never equal to the last one and re-renders on every store change.
  const save = useGame((s) => s.save)
  const career = useGame((s) => s.run?.career ?? null)
  const go = useGame((s) => s.go)

  const inProgress = career && !career.retired ? career : null
  const rankedCount = save.hallOfFame.filter((e) => e.ranked).length

  return (
    <div className="min-h-dvh bg-pitch-950">
      <div className="mx-auto flex min-h-dvh max-w-md flex-col px-5 py-10">
        <header className="mb-10">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-turf-500">
            Rugby Career
          </p>
          <h1 className="mt-1 text-5xl font-black tracking-tight text-white">Unbeaten</h1>
          <p className="mt-3 text-sm text-pitch-500">
            {CAREER_SEASONS} seasons. One perfect record.
          </p>
        </header>

        <nav className="flex flex-1 flex-col gap-3">
          {inProgress && (
            <Card onClick={() => go('dashboard')} className="border-turf-600 bg-turf-500/5">
              <p className="text-xs font-semibold uppercase tracking-wider text-turf-400">
                Continue
              </p>
              <p className="mt-1 text-lg font-bold text-white">{inProgress.name}</p>
              <p className="nums mt-0.5 text-sm text-pitch-500">
                Season {inProgress.season}/{CAREER_SEASONS} · {inProgress.ovr} OVR
              </p>
            </Card>
          )}

          <MenuItem
            title="Player Career"
            description={`Forge a player. ${CAREER_SEASONS} seasons, one club at a time.`}
            onClick={() => go('create')}
            primary={!inProgress}
          />
          <MenuItem
            title="Team Career"
            description="Take a club, a budget and a board that wants results."
            onClick={() => go('team-career')}
          />
          <MenuItem
            title="Quick Season"
            description="Draft an XV. One season. Chase the perfect record."
            onClick={() => go('quick-season')}
          />

          <div className="mt-2 grid grid-cols-2 gap-3">
            <MenuItem title="Trophy Cabinet" compact onClick={() => go('trophies')} />
            <MenuItem title="Hall of Fame" compact onClick={() => go('hall-of-fame')} />
          </div>
        </nav>

        <footer className="mt-8 text-center">
          <p className="nums text-[11px] text-pitch-600">
            {rankedCount} ranked career{rankedCount === 1 ? '' : 's'}
          </p>
        </footer>
      </div>
    </div>
  )
}

function MenuItem({
  title,
  description,
  onClick,
  primary,
  compact,
}: {
  title: string
  description?: string
  onClick: () => void
  primary?: boolean
  compact?: boolean
}) {
  if (compact) {
    return (
      <Button variant="secondary" onClick={onClick} full>
        {title}
      </Button>
    )
  }

  return (
    <Card onClick={onClick} className={primary ? 'border-turf-600' : ''}>
      <p className="text-lg font-bold text-white">{title}</p>
      {description && <p className="mt-1 text-sm text-pitch-500">{description}</p>}
    </Card>
  )
}
