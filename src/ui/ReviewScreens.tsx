/** Season preview, season review, career end, hall of fame and trophy cabinet. */

import {
  Button,
  Card,
  ClubPill,
  Empty,
  OvrDelta,
  Screen,
  ScrollX,
  SectionTitle,
  Stat,
  TierBadge,
} from './components'
import { useGame } from '../store/gameStore'
import { formatMoney, grossEarnings } from '../engine/economy'
import { currentLadder, isPerfectSeason, perfectSeasonTarget } from '../engine/season'
import { ACHIEVEMENT_DEFS } from '../engine/achievements'
import { rivalVerdict } from '../engine/rival'
import { hallOfFameView } from '../engine/persistence'
import { buildSeasonPreview } from '../engine/career'
import { getLeague, POSITIONS } from '../data'
import { CAREER_SEASONS } from '../types/career'

const ROLE_LABEL: Record<string, string> = {
  star: 'Star man',
  starter: 'First choice',
  squad: 'Squad player',
  fringe: 'Fringe',
}

export function PreviewScreen() {
  const run = useGame((s) => s.run)
  const world = useGame((s) => s.world)
  const go = useGame((s) => s.go)

  if (!run || !world) return null
  const preview = buildSeasonPreview(run.career, world)
  const target = perfectSeasonTarget(run.season, run.career.contract.clubId)

  return (
    <Screen
      title={`Season ${run.career.season}`}
      subtitle={`of ${CAREER_SEASONS}`}
      footer={
        <Button full onClick={() => go('dashboard')}>
          Get started
        </Button>
      }
    >
      <div className="mb-4">
        <ClubPill club={preview.clubName} league={preview.leagueName} />
      </div>

      <Card>
        <Stat label="League" value={preview.leagueName} />
        <Stat label="Standard" value={`${preview.leagueDifficulty} (tier ${preview.tier})`} />
        <Stat label="Salary" value={`${formatMoney(preview.salary)}/yr`} />
        <Stat label="Contract" value={`${preview.contractYearsRemaining} yr remaining`} />
        <Stat label="Squad role" value={ROLE_LABEL[preview.squadRole] ?? preview.squadRole} />
        <Stat label="Coach expects" value={preview.coachExpectation} />
        <Stat label="Your OVR" value={preview.ovr} />
        <Stat label="Form" value={preview.form} />
      </Card>

      <div className="mt-4 rounded-2xl border border-turf-600/40 bg-turf-500/5 p-4 text-center">
        <p className="text-xs font-semibold uppercase tracking-wider text-turf-400">
          The perfect season
        </p>
        <p className="nums mt-1 text-3xl font-black text-white">{target}</p>
        <p className="mt-1 text-xs text-pitch-500">
          wins from {target} to go unbeaten and take the title
        </p>
      </div>
    </Screen>
  )
}

export function SeasonReviewScreen() {
  const run = useGame((s) => s.run)
  const summary = useGame((s) => s.lastSummary)
  const newAchievements = useGame((s) => s.newAchievements)
  const go = useGame((s) => s.go)
  const beginNextSeason = useGame((s) => s.beginNextSeason)

  if (!run || !summary) return null

  const { record } = summary
  const league = getLeague(record.leagueId)
  const ladder = currentLadder(run.season)
  const perfect = isPerfectSeason(run.season, run.career.contract.clubId)
  const isFinal = run.career.season >= CAREER_SEASONS

  return (
    <Screen
      title={`Season ${record.season} review`}
      subtitle={record.clubName}
      footer={
        <Button full onClick={() => (isFinal ? beginNextSeason() : go('summer'))}>
          {isFinal ? 'Hang up your boots' : 'Summer plans'}
        </Button>
      }
    >
      {perfect && (
        <div className="mb-4 rounded-2xl border border-gold/40 bg-gold/10 p-4 text-center">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-gold">Unbeaten</p>
          <p className="mt-1 text-sm text-white">
            Played everything. Won everything. Nobody laid a glove on you.
          </p>
        </div>
      )}

      {record.championship && !perfect && (
        <div className="mb-4 rounded-2xl border border-turf-600/50 bg-turf-500/10 p-4 text-center">
          <p className="text-sm font-bold text-turf-400">{league.name} champions</p>
        </div>
      )}

      <Card>
        <Stat label="Finished" value={`${ordinal(record.ladderPosition)} of ${ladder.length}`} />
        <Stat label="Appearances" value={record.appearances} />
        <Stat label="Tries" value={record.tries} />
        <Stat label="Points" value={record.points} />
        <Stat label="Average rating" value={record.avgRating.toFixed(2)} />
        <Stat label="Player of the match" value={record.motm} />
      </Card>

      <SectionTitle>Development</SectionTitle>
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider text-pitch-500">OVR</p>
            <p className="nums text-2xl font-bold text-white">
              {record.ovrStart} → {record.ovrEnd}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs uppercase tracking-wider text-pitch-500">Change</p>
            <p className="nums text-2xl font-bold">
              <OvrDelta delta={summary.ovrDelta} />
            </p>
          </div>
        </div>

        <div className="mt-3 border-t border-pitch-800 pt-3">
          <Stat label="From how you played" value={<OvrDelta delta={summary.breakdown.performance} />} />
          <Stat label="From age" value={<OvrDelta delta={summary.breakdown.age} />} />
          <Stat
            label="Phase"
            value={
              summary.breakdown.phase === 'developing'
                ? 'Still developing'
                : summary.breakdown.phase === 'peak'
                  ? 'At your peak'
                  : 'Past your peak'
            }
          />
        </div>
      </Card>

      {newAchievements.length > 0 && (
        <>
          <SectionTitle>Unlocked</SectionTitle>
          <div className="flex flex-col gap-2">
            {newAchievements.map((id) => {
              const def = ACHIEVEMENT_DEFS.find((a) => a.id === id)
              if (!def) return null
              return (
                <div
                  key={id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-pitch-600 bg-pitch-900 px-3 py-2.5"
                >
                  <span className="truncate text-sm font-medium text-white">{def.name}</span>
                  <TierBadge tier={def.tier} />
                </div>
              )
            })}
          </div>
        </>
      )}

      <SectionTitle>Earnings</SectionTitle>
      <Card>
        <Stat label="This season" value={formatMoney(record.salary)} />
        <Stat label="Career total" value={formatMoney(grossEarnings(run.career.ledger))} />
      </Card>
    </Screen>
  )
}

export function CareerEndScreen() {
  const run = useGame((s) => s.run)
  const rival = useGame((s) => s.rival)
  const go = useGame((s) => s.go)
  const abandon = useGame((s) => s.abandonCareer)

  if (!run) return null
  const { career } = run
  const verdict = rival ? rivalVerdict(career, rival) : null

  const bestOvr = career.history.reduce((best, h) => Math.max(best, h.ovrEnd), career.ovr)

  return (
    <Screen
      title="Time"
      subtitle={`${career.name} · ${POSITIONS[career.position].name}`}
      footer={
        <div className="flex flex-col gap-2">
          <Button full onClick={() => go('hall-of-fame')}>
            Hall of Fame
          </Button>
          <Button full variant="ghost" onClick={abandon}>
            Back to the menu
          </Button>
        </div>
      }
    >
      <div className="rounded-2xl border border-pitch-700 bg-pitch-900 p-6 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-pitch-500">
          {CAREER_SEASONS} seasons
        </p>
        <p className="nums mt-2 text-5xl font-black text-white">{career.careerCaps}</p>
        <p className="mt-1 text-sm text-pitch-500">appearances</p>
      </div>

      <SectionTitle>The numbers</SectionTitle>
      <Card>
        <Stat label="Tries" value={career.careerTries} />
        <Stat label="Points" value={career.careerPoints} />
        <Stat label="Test caps" value={career.internationalCaps} />
        <Stat label="Trophies" value={career.trophies.length} />
        <Stat label="Peak OVR" value={bestOvr} />
        <Stat label="Career earnings" value={formatMoney(grossEarnings(career.ledger))} />
      </Card>

      {career.trophies.length > 0 && (
        <>
          <SectionTitle>Silverware</SectionTitle>
          <div className="flex flex-col gap-2">
            {career.trophies.map((trophy, i) => (
              <div
                key={`${trophy.season}:${i}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-gold/25 bg-gold/5 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{trophy.name}</p>
                  <p className="truncate text-xs text-pitch-500">{trophy.clubOrNation}</p>
                </div>
                <span className="nums shrink-0 text-xs text-gold">S{trophy.season}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {verdict && (
        <>
          <SectionTitle>The rival</SectionTitle>
          <p className="rounded-2xl bg-pitch-900 p-4 text-sm text-pitch-400">{verdict.verdict}</p>
        </>
      )}

      <SectionTitle>Clubs</SectionTitle>
      <ScrollX>
        <table className="w-full min-w-[380px] border-collapse text-sm">
          <tbody>
            {career.history.map((h) => (
              <tr key={h.season} className="border-b border-pitch-850">
                <td className="nums py-2 pr-3 text-pitch-600">S{h.season}</td>
                <td className="py-2 pr-3 text-white">{h.clubName}</td>
                <td className="nums py-2 text-right text-pitch-500">
                  {h.appearances} apps · {h.tries}t
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollX>
    </Screen>
  )
}

export function HallOfFameScreen() {
  const save = useGame((s) => s.save)
  const go = useGame((s) => s.go)
  const { ranked, unranked } = hallOfFameView(save)

  return (
    <Screen
      title="Hall of Fame"
      subtitle={`${ranked.length} completed career${ranked.length === 1 ? '' : 's'}`}
      onBack={() => go('menu')}
    >
      <SectionTitle>Ranked</SectionTitle>
      <p className="mb-3 text-xs text-pitch-600">
        Only careers played out over the full {CAREER_SEASONS} seasons are ranked.
      </p>

      {ranked.length === 0 ? (
        <Empty>Nobody has gone the distance yet.</Empty>
      ) : (
        <ol className="flex flex-col gap-2">
          {ranked.map((entry, index) => (
            <li
              key={entry.id}
              className="flex items-center gap-3 rounded-xl border border-pitch-700 bg-pitch-900 px-3 py-3"
            >
              <span className="nums w-6 shrink-0 text-center text-sm font-bold text-turf-400">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-white">{entry.name}</p>
                <p className="nums truncate text-xs text-pitch-500">
                  {entry.appearances} apps · {entry.tries} tries · {entry.trophies} trophies
                </p>
              </div>
              <span className="nums shrink-0 text-sm font-bold text-white">
                {entry.careerScore}
              </span>
            </li>
          ))}
        </ol>
      )}

      {unranked.length > 0 && (
        <>
          <SectionTitle>Unranked</SectionTitle>
          <p className="mb-3 text-xs text-pitch-600">
            Careers that did not run the full {CAREER_SEASONS} seasons. Kept for the record,
            not ranked against those that did.
          </p>
          <ol className="flex flex-col gap-2">
            {unranked.map((entry) => (
              <li
                key={entry.id}
                className="rounded-xl border border-dashed border-pitch-700 bg-pitch-900/40 px-3 py-3"
              >
                <p className="truncate font-medium text-pitch-400">{entry.name}</p>
                <p className="truncate text-xs text-pitch-600">
                  {entry.unrankedReason ?? `${entry.seasonsPlayed} seasons`}
                </p>
              </li>
            ))}
          </ol>
        </>
      )}
    </Screen>
  )
}

export function TrophyCabinetScreen() {
  const run = useGame((s) => s.run)
  const save = useGame((s) => s.save)
  const go = useGame((s) => s.go)

  const trophies = run?.career.trophies ?? save.playerCareer?.trophies ?? []

  return (
    <Screen title="Trophy cabinet" onBack={() => go('menu')}>
      {trophies.length === 0 ? (
        <Empty>Empty. Go and win something.</Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {trophies.map((trophy, i) => (
            <div
              key={`${trophy.season}:${i}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-gold/25 bg-gold/5 px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold text-white">{trophy.name}</p>
                <p className="truncate text-xs text-pitch-500">{trophy.clubOrNation}</p>
              </div>
              <span className="nums shrink-0 text-xs font-medium text-gold">
                Season {trophy.season}
              </span>
            </div>
          ))}
        </div>
      )}
    </Screen>
  )
}

function ordinal(n: number): string {
  const suffix =
    n % 100 >= 11 && n % 100 <= 13
      ? 'th'
      : n % 10 === 1
        ? 'st'
        : n % 10 === 2
          ? 'nd'
          : n % 10 === 3
            ? 'rd'
            : 'th'
  return `${n}${suffix}`
}
