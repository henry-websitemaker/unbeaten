/**
 * The dashboard (SPEC §3).
 *
 * The 38-0-0 layout: four stat cards, the green club pill, a match log with coloured result
 * chips, and the two actions. Every result reads `W 31-17 · 2 tries · rating 8.4`.
 */

import {
  Button,
  ClubPill,
  Empty,
  ProgressBar,
  ResultChip,
  Screen,
  SectionTitle,
  StatCard,
} from './components'
import { useGame } from '../store/gameStore'
import { formatMoney, balance } from '../engine/economy'
import { isRegularSeasonComplete, totalRounds } from '../engine/season'
import { getLeague } from '../data'
import { CAREER_SEASONS } from '../types/career'
import type { RoundLogEntry } from '../engine/careerRun'

export default function DashboardScreen() {
  const run = useGame((s) => s.run)
  const go = useGame((s) => s.go)
  const nextRound = useGame((s) => s.nextRound)
  const simToSeasonEnd = useGame((s) => s.simToSeasonEnd)
  const finishSeason = useGame((s) => s.finishSeason)
  const simming = useGame((s) => s.simming)

  if (!run) return null

  const { career, season } = run
  const league = getLeague(season.leagueId)
  const rounds = totalRounds(season)
  const complete = isRegularSeasonComplete(season)

  const played = run.log.filter((e) => e.selected)
  const tries = played.reduce((total, e) => total + (e.line?.tries ?? 0), 0)
  const avgRating =
    played.length === 0
      ? 0
      : played.reduce((total, e) => total + (e.line?.rating ?? 0), 0) / played.length

  const club = season.teams.find((t) => t.id === career.contract.clubId)

  return (
    <Screen
      title={`Season ${career.season}/${CAREER_SEASONS}`}
      subtitle={`Round ${season.roundsPlayed} of ${rounds} · ${league.name}`}
      onBack={() => go('menu')}
      footer={
        <div className="flex flex-col gap-2">
          {complete ? (
            <Button full onClick={finishSeason}>
              {league.finalsFormat === 'none' ? 'End the season' : 'Play the finals'}
            </Button>
          ) : (
            <>
              <Button full onClick={nextRound} disabled={simming}>
                Play next match
              </Button>
              <Button full variant="secondary" onClick={simToSeasonEnd} disabled={simming}>
                {simming ? `Simulating… round ${season.roundsPlayed}` : 'Sim to season end'}
              </Button>
            </>
          )}
        </div>
      }
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <ClubPill club={club?.name ?? 'Club'} league={league.name} />
        {career.isCaptain && (
          <span className="shrink-0 rounded-md bg-gold/15 px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-gold">
            Captain
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCard label="OVR" value={career.ovr} sub={`Age ${career.age}`} />
        <StatCard
          label="Apps"
          value={played.length}
          sub={`${tries} ${tries === 1 ? 'try' : 'tries'}`}
        />
        <StatCard
          label="Rating"
          value={avgRating === 0 ? '—' : avgRating.toFixed(1)}
          sub="season average"
          tone={avgRating >= 7 ? 'good' : avgRating > 0 && avgRating < 6 ? 'bad' : 'default'}
        />
        <StatCard
          label="Balance"
          value={formatMoney(balance(career.ledger))}
          sub={formatMoney(career.contract.salary) + '/yr'}
        />
      </div>

      <div className="mt-4">
        <ProgressBar value={season.roundsPlayed} max={rounds} />
      </div>

      {career.injury && (
        <div className="mt-4 rounded-2xl border border-loss/30 bg-loss/10 p-3">
          <p className="text-sm font-semibold text-loss">{career.injury.label}</p>
          <p className="nums mt-0.5 text-xs text-loss/70">
            {career.injury.weeksRemaining} week
            {career.injury.weeksRemaining === 1 ? '' : 's'} out
          </p>
        </div>
      )}

      <SectionTitle
        action={
          <button
            onClick={() => go('table')}
            className="text-xs font-semibold text-turf-400 hover:text-turf-300"
          >
            League table →
          </button>
        }
      >
        Match log
      </SectionTitle>

      {run.log.length === 0 ? (
        <Empty>No matches played yet. Get out there.</Empty>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {[...run.log].reverse().map((entry) => (
            <LogRow key={entry.round} entry={entry} clubId={career.contract.clubId} />
          ))}
        </ol>
      )}

      <div className="mt-6 grid grid-cols-3 gap-2">
        <Button variant="secondary" onClick={() => go('my-player')}>
          My Player
        </Button>
        <Button variant="secondary" onClick={() => go('achievements')}>
          Feats
        </Button>
        <Button variant="secondary" onClick={() => go('rival')}>
          Rival
        </Button>
      </div>
    </Screen>
  )
}

function LogRow({ entry, clubId }: { entry: RoundLogEntry; clubId: string }) {
  if (!entry.match) {
    return (
      <li className="flex items-center gap-3 rounded-xl border border-pitch-800 bg-pitch-900/50 px-3 py-2">
        <span className="nums w-6 shrink-0 text-xs text-pitch-600">{entry.round}</span>
        <span className="text-sm text-pitch-600">Bye</span>
        {entry.event && (
          <span className="ml-auto truncate text-xs text-pitch-600">{entry.event.description}</span>
        )}
      </li>
    )
  }

  const isHome = entry.match.home.teamId === clubId
  const own = isHome ? entry.match.home : entry.match.away
  const other = isHome ? entry.match.away : entry.match.home
  const result = entry.result ?? 'D'

  return (
    <li className="rounded-xl border border-pitch-800 bg-pitch-900 px-3 py-2.5">
      <div className="flex items-center gap-3">
        <span className="nums w-6 shrink-0 text-xs text-pitch-600">{entry.round}</span>
        <ResultChip result={result} />
        <span className="nums shrink-0 text-sm font-semibold text-white">
          {own.score}–{other.score}
        </span>

        {entry.selected && entry.line ? (
          <span className="nums ml-auto truncate text-xs text-pitch-500">
            {entry.line.tries > 0 && (
              <span className="text-turf-400">
                {entry.line.tries} {entry.line.tries === 1 ? 'try' : 'tries'} ·{' '}
              </span>
            )}
            rating {entry.line.rating.toFixed(1)}
          </span>
        ) : (
          <span className="ml-auto shrink-0 text-xs text-pitch-600">Not selected</span>
        )}
      </div>

      {(entry.match.derbyName || entry.event || entry.injuryPickedUp) && (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 pl-9 text-[11px]">
          {entry.match.derbyName && (
            <span className="text-gold">{entry.match.derbyName}</span>
          )}
          {entry.event && <span className="text-pitch-500">{entry.event.description}</span>}
          {entry.injuryPickedUp && <span className="text-loss">{entry.injuryPickedUp}</span>}
        </div>
      )}
    </li>
  )
}
