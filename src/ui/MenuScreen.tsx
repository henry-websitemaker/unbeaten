import { Card } from './components'
import { useGame } from '../store/gameStore'
import { LEAGUE_LIST } from '../data'
import { CAREER_SEASONS } from '../types/career'

/** The two modes, and what each one actually offers. */
const MODES = [
  {
    id: 'player' as const,
    title: 'Player Career',
    tagline: 'Twenty seasons. One perfect record.',
    features: [
      ['🏉', 'Forge a player and earn your way up from the second tier'],
      ['📈', 'Develop through match form, pre-season work and the years'],
      ['🌍', 'Test caps, World Cups and a world ranking every season'],
      ['🏆', 'League titles, domestic cups and the Champions Cup'],
    ],
    available: true,
  },
  {
    id: 'team' as const,
    title: 'Team Career',
    tagline: 'A club, a budget and a board that wants results.',
    features: [
      ['💷', 'Wage budgets, gate receipts and prize money'],
      ['✍️', 'Sign, release and build a squad inside the cap'],
      ['🪑', 'Board expectations, points deductions and the sack'],
    ],
    available: false,
  },
]

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
        <header className="mb-8 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-turf-500">
            Rugby Career Sim
          </p>
          <h1 className="font-display mt-1 text-7xl font-extrabold uppercase leading-none tracking-tight text-white">
            Unbeaten
          </h1>
          <p className="mt-3 text-sm text-pitch-500">Choose your path to glory</p>
        </header>

        <nav className="flex flex-1 flex-col gap-4">
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

          {MODES.map((mode) => (
            <ModeCard
              key={mode.id}
              mode={mode}
              onClick={mode.id === 'player' ? () => go('create') : undefined}
            />
          ))}

          <div className="mt-1 grid grid-cols-2 gap-3">
            <SmallLink label="Trophy Cabinet" onClick={() => go('trophies')} />
            <SmallLink label="Hall of Fame" onClick={() => go('hall-of-fame')} />
          </div>
        </nav>

        <footer className="mt-8 border-t border-pitch-800 pt-5">
          <div className="grid grid-cols-4 gap-2 text-center">
            <Fact value={String(LEAGUE_LIST.length)} label="Real Leagues" />
            <Fact value={String(CAREER_SEASONS)} label="Seasons" />
            <Fact value="99" label="Real Clubs" />
            <Fact value="★" label="Hall of Fame" />
          </div>
          {rankedCount > 0 && (
            <p className="nums mt-4 text-center text-[11px] text-pitch-600">
              {rankedCount} ranked career{rankedCount === 1 ? '' : 's'}
            </p>
          )}
        </footer>
      </div>
    </div>
  )
}

function ModeCard({
  mode,
  onClick,
}: {
  mode: (typeof MODES)[number]
  onClick?: () => void
}) {
  const Tag = onClick ? 'button' : 'div'

  return (
    <Tag
      onClick={onClick}
      className={`w-full rounded-2xl border p-5 text-left transition ${
        mode.available
          ? 'border-turf-600 bg-turf-500/5 hover:border-turf-400'
          : 'border-pitch-800 bg-pitch-900/40'
      }`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <p
          className={`font-display text-3xl font-bold uppercase tracking-tight ${
            mode.available ? 'text-white' : 'text-pitch-600'
          }`}
        >
          {mode.title}
        </p>
        {!mode.available && (
          <span className="shrink-0 rounded-md bg-pitch-800 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-pitch-500">
            Coming Soon
          </span>
        )}
      </div>

      <p className={`mt-1 text-sm ${mode.available ? 'text-pitch-400' : 'text-pitch-600'}`}>
        {mode.tagline}
      </p>

      <ul className="mt-3 flex flex-col gap-1.5">
        {mode.features.map(([emoji, text]) => (
          <li key={text} className="flex items-start gap-2 text-xs">
            {/* Decorative — the text beside it already says everything. */}
            <span aria-hidden="true" className="shrink-0">
              {emoji}
            </span>
            <span className={mode.available ? 'text-pitch-400' : 'text-pitch-600'}>{text}</span>
          </li>
        ))}
      </ul>
    </Tag>
  )
}

function SmallLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="rounded-xl border border-pitch-700 bg-pitch-900 px-4 py-3 text-sm font-semibold text-white transition hover:border-pitch-500"
    >
      {label}
    </button>
  )
}

function Fact({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <p className="nums font-display text-2xl font-bold text-turf-400">{value}</p>
      <p className="text-[10px] uppercase tracking-wider text-pitch-600">{label}</p>
    </div>
  )
}
