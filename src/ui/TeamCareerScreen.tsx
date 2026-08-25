/**
 * Team Career — the manager mode.
 *
 * The budget is enforced by the engine, not by this screen: a signing that would break it
 * is refused with the exact shortfall, and any trophy protects you from the sack whatever
 * the league table says.
 */

import { useMemo, useState } from 'react'
import {
  Button,
  Card,
  ClubPill,
  Empty,
  ProgressBar,
  ResultChip,
  Screen,
  ScrollX,
  SectionTitle,
  Stat,
} from './components'
import { useGame } from '../store/gameStore'
import {
  affordableTargets,
  boardExpectation,
  canSign,
  createManagerCareer,
  pointsDeduction,
  releasePlayer,
  reviewManagerSeason,
  signPlayer,
  squadWageBill,
  wageBudget,
  weeklyWage,
} from '../engine/teamCareer'
import { squadStrength } from '../engine/generate'
import { chipFor, createSeason, currentLadder, resultsForTeam, simulateSeason } from '../engine/season'
import { formatMoney } from '../engine/economy'
import { createRng } from '../engine/rng'
import { teamsInLeague } from '../engine/world'
import { LEAGUE_LIST, POSITIONS, getLeague } from '../data'
import type { LeagueId, Player, Team } from '../types/core'
import type { SeasonState } from '../engine/season'
import type { ManagerCareer } from '../engine/teamCareer'

export default function TeamCareerScreen() {
  const world = useGame((s) => s.world)
  const go = useGame((s) => s.go)

  const [leagueId, setLeagueId] = useState<LeagueId | null>(null)
  const [club, setClub] = useState<Team | null>(null)
  const [manager, setManager] = useState<ManagerCareer | null>(null)
  const [season, setSeason] = useState<SeasonState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [seed] = useState(() => Math.floor(Math.random() * 1_000_000))

  const market = useMemo(() => {
    if (!world || !club) return []
    return world.teams
      .filter((t) => t.id !== club.id)
      .flatMap((t) => t.squad)
      .slice(0, 400)
  }, [world, club])

  if (!world) return null

  // --- choose a league ---
  if (!leagueId) {
    return (
      <Screen title="Team Career" subtitle="Pick a league" onBack={() => go('menu')}>
        <div className="flex flex-col gap-2">
          {LEAGUE_LIST.map((league) => (
            <Card key={league.id} onClick={() => setLeagueId(league.id)}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-semibold text-white">{league.name}</p>
                <p className="nums shrink-0 text-xs text-turf-400">
                  {formatMoney(league.wageBudgetBase)}/wk
                </p>
              </div>
              <p className="mt-0.5 text-xs text-pitch-600">
                Tier {league.tier} · {league.teamCount} clubs · {league.rounds} rounds
              </p>
            </Card>
          ))}
        </div>
      </Screen>
    )
  }

  // --- choose a club ---
  if (!club) {
    const clubs = [...teamsInLeague(world, leagueId)].sort(
      (a, b) => squadStrength(b) - squadStrength(a),
    )
    return (
      <Screen
        title={getLeague(leagueId).name}
        subtitle="Who will have you?"
        onBack={() => setLeagueId(null)}
      >
        <div className="flex flex-col gap-2">
          {clubs.map((team, index) => {
            const expectation = boardExpectation(index + 1, clubs.length)
            return (
              <Card
                key={team.id}
                onClick={() => {
                  setClub(team)
                  setManager(createManagerCareer(seed, team, index + 1))
                }}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate font-semibold text-white">{team.name}</p>
                  <p className="nums shrink-0 text-xs text-pitch-500">
                    {Math.round(squadStrength(team))} OVR
                  </p>
                </div>
                <p className="mt-0.5 text-xs text-pitch-600">
                  Board expects: {expectation.description.toLowerCase()}
                </p>
              </Card>
            )
          })}
        </div>
      </Screen>
    )
  }

  if (!manager) return null

  const budget = wageBudget(club.leagueId)
  const bill = squadWageBill(club)
  const deduction = pointsDeduction(club)

  // --- season result ---
  if (season) {
    const ladder = currentLadder(season)
    const review = reviewManagerSeason(
      { ...manager, deduction },
      ladder,
      club.name,
      season.championId,
    )
    const results = resultsForTeam(season, club.id)

    return (
      <Screen
        title={review.verdict.sacked ? 'Sacked' : 'Season over'}
        subtitle={`${ordinal(review.position)} of ${ladder.length}`}
        footer={
          <Button
            full
            onClick={() => {
              if (review.verdict.sacked) {
                setClub(null)
                setManager(null)
                setLeagueId(null)
              } else {
                setManager({ ...review.manager, season: review.manager.season + 1 })
              }
              setSeason(null)
            }}
          >
            {review.verdict.sacked ? 'Find another club' : 'Next season'}
          </Button>
        }
      >
        <div
          className={`rounded-2xl border p-5 text-center ${
            review.verdict.savedByTrophy
              ? 'border-gold/40 bg-gold/10'
              : review.verdict.sacked
                ? 'border-loss/40 bg-loss/10'
                : 'border-turf-600/40 bg-turf-500/5'
          }`}
        >
          <p className="text-sm text-white">{review.verdict.reason}</p>
          {review.verdict.savedByTrophy && (
            <p className="mt-2 text-xs font-semibold uppercase tracking-wider text-gold">
              Saved by silverware
            </p>
          )}
        </div>

        {deduction > 0 && (
          <p className="mt-3 rounded-xl border border-loss/30 bg-loss/10 px-3 py-2 text-xs text-loss">
            {deduction} point{deduction === 1 ? '' : 's'} deducted for exceeding the wage budget.
          </p>
        )}

        <SectionTitle>Every match</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {results.map((r, i) => (
            <ResultChip key={i} result={chipFor(r, club.id)} />
          ))}
        </div>

        <SectionTitle>Final table</SectionTitle>
        <ScrollX>
          <table className="w-full min-w-[320px] border-collapse text-sm">
            <tbody>
              {ladder.map((row) => {
                const team = season.teams.find((t) => t.id === row.teamId)
                return (
                  <tr
                    key={row.teamId}
                    className={`border-b border-pitch-850 ${
                      row.teamId === club.id ? 'bg-turf-500/10' : ''
                    }`}
                  >
                    <td className="nums py-2 pr-3 text-pitch-600">{row.position}</td>
                    <td className="py-2 pr-3 text-white">{team?.name}</td>
                    <td className="nums py-2 text-right font-bold text-white">{row.points}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </ScrollX>
      </Screen>
    )
  }

  // --- squad building ---
  const targets = affordableTargets(club, market, createRng(seed + manager.season), 8)

  return (
    <Screen
      title={club.name}
      subtitle={`Season ${manager.season} · ${manager.expectation.description}`}
      onBack={() => go('menu')}
      footer={
        <Button
          full
          onClick={() => {
            const field = teamsInLeague(world, club.leagueId).map((t) =>
              t.id === club.id ? club : t,
            )
            setSeason(simulateSeason(createSeason(seed, manager.season, club.leagueId, field)))
          }}
        >
          Play the season
        </Button>
      }
    >
      <div className="mb-4">
        <ClubPill club={club.name} league={getLeague(club.leagueId).name} />
      </div>

      <Card>
        <Stat label="Wage bill" value={`${formatMoney(bill)}/wk`} />
        <Stat label="Budget" value={`${formatMoney(budget)}/wk`} />
        <Stat
          label="Headroom"
          value={
            <span className={bill > budget ? 'text-loss' : 'text-turf-400'}>
              {formatMoney(budget - bill)}
            </span>
          }
        />
        <Stat label="Squad" value={`${club.squad.length} players`} />
        <div className="mt-2">
          <ProgressBar value={Math.min(bill, budget)} max={budget} />
        </div>
      </Card>

      {deduction > 0 && (
        <p className="mt-3 rounded-xl border border-loss/30 bg-loss/10 px-3 py-2 text-xs text-loss">
          Over budget. {deduction} point{deduction === 1 ? '' : 's'} will be deducted.
        </p>
      )}

      {error && (
        <p className="mt-3 rounded-xl border border-loss/30 bg-loss/10 px-3 py-2 text-xs text-loss">
          {error}
        </p>
      )}

      <SectionTitle>Transfer targets</SectionTitle>
      {targets.length === 0 ? (
        <Empty>Nothing you can afford.</Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {targets.map((player) => (
            <SignRow
              key={player.id}
              player={player}
              club={club}
              onSign={() => {
                const check = canSign(club, player)
                if (!check.ok) {
                  setError(check.message)
                  return
                }
                setError(null)
                setClub(signPlayer(club, player))
              }}
            />
          ))}
        </div>
      )}

      <SectionTitle>Your squad</SectionTitle>
      <ScrollX>
        <table className="w-full min-w-[380px] border-collapse text-sm">
          <tbody>
            {[...club.squad]
              .sort((a, b) => b.ovr - a.ovr)
              .map((player) => (
                <tr key={player.id} className="border-b border-pitch-850">
                  <td className="py-2 pr-3 text-white">
                    <span className="block max-w-[150px] truncate">{player.name}</span>
                    <span className="text-[11px] text-pitch-600">
                      {POSITIONS[player.position].name}
                    </span>
                  </td>
                  <td className="nums py-2 px-2 text-right text-turf-400">{player.ovr}</td>
                  <td className="nums py-2 px-2 text-right text-pitch-500">
                    {formatMoney(weeklyWage(club.leagueId, player.ovr))}
                  </td>
                  <td className="py-2 pl-2 text-right">
                    <button
                      onClick={() => setClub(releasePlayer(club, player.id))}
                      className="text-xs text-loss hover:underline"
                    >
                      Release
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </ScrollX>
    </Screen>
  )
}

function SignRow({
  player,
  club,
  onSign,
}: {
  player: Player
  club: Team
  onSign: () => void
}) {
  const check = canSign(club, player)
  const wage = weeklyWage(club.leagueId, player.ovr)

  return (
    <div className="flex items-center gap-3 rounded-xl border border-pitch-700 bg-pitch-900 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-white">{player.name}</p>
        <p className="nums truncate text-xs text-pitch-500">
          {POSITIONS[player.position].name} · {formatMoney(wage)}/wk
        </p>
      </div>
      <span className="nums shrink-0 text-sm font-bold text-turf-400">{player.ovr}</span>
      <button
        onClick={onSign}
        disabled={!check.ok}
        className="shrink-0 rounded-lg bg-turf-500 px-3 py-1.5 text-xs font-semibold text-pitch-950 transition hover:bg-turf-400 disabled:opacity-30"
      >
        Sign
      </button>
    </div>
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
