/** Quick Season: draft an XV, sim one season, chase the perfect record. No saves. */

import { useMemo, useState } from 'react'
import { Button, Card, ClubPill, ResultChip, Screen, ScrollX, SectionTitle, Stat } from './components'
import { useGame } from '../store/gameStore'
import {
  buildDraft,
  buildDraftedTeam,
  draftStrength,
  selectableLeagues,
  startQuickSeason,
  summariseQuickSeason,
  QUICK_SEASON_TEAM_ID,
} from '../engine/quickSeason'
import { currentLadder, resultsForTeam, chipFor, simulateSeason } from '../engine/season'
import { createRng } from '../engine/rng'
import { POSITIONS } from '../data'
import type { Player } from '../types/core'
import type { LeagueId } from '../types/core'
import type { SeasonState } from '../engine/season'

export default function QuickSeasonScreen() {
  const world = useGame((s) => s.world)
  const go = useGame((s) => s.go)

  const [leagueId, setLeagueId] = useState<LeagueId | null>(null)
  const [seed] = useState(() => Math.floor(Math.random() * 1_000_000))
  const [picks, setPicks] = useState<Player[]>([])
  const [slot, setSlot] = useState(0)
  const [season, setSeason] = useState<SeasonState | null>(null)

  const draft = useMemo(
    () => (world ? buildDraft(world, createRng(seed)) : []),
    [world, seed],
  )

  if (!world) return null

  // --- result ---
  if (season) {
    const summary = summariseQuickSeason(season)
    const results = resultsForTeam(season, QUICK_SEASON_TEAM_ID)
    const ladder = currentLadder(season)
    const position = ladder.find((r) => r.teamId === QUICK_SEASON_TEAM_ID)?.position ?? 0

    return (
      <Screen
        title={summary.perfect ? 'Unbeaten' : 'Season over'}
        subtitle={`${summary.wins} of ${summary.target}`}
        footer={
          <div className="flex flex-col gap-2">
            <Button
              full
              onClick={() => {
                setSeason(null)
                setPicks([])
                setSlot(0)
                setLeagueId(null)
              }}
            >
              Go again
            </Button>
            <Button full variant="ghost" onClick={() => go('menu')}>
              Menu
            </Button>
          </div>
        }
      >
        <div
          className={`rounded-2xl border p-6 text-center ${
            summary.perfect
              ? 'border-gold/40 bg-gold/10'
              : 'border-pitch-700 bg-pitch-900'
          }`}
        >
          <p className="nums text-5xl font-black text-white">
            {summary.wins}
            <span className="text-2xl text-pitch-500">/{summary.target}</span>
          </p>
          <p className="mt-2 text-sm text-pitch-400">{summary.shareText}</p>
        </div>

        <SectionTitle>Final position</SectionTitle>
        <Card>
          <Stat label="Finished" value={`${position} of ${ladder.length}`} />
          <Stat label="Champions" value={summary.champion ? 'Yes' : 'No'} />
        </Card>

        <SectionTitle>Every match</SectionTitle>
        <div className="flex flex-wrap gap-1.5">
          {results.map((r, i) => (
            <ResultChip key={i} result={chipFor(r, QUICK_SEASON_TEAM_ID)} />
          ))}
        </div>
      </Screen>
    )
  }

  // --- league choice ---
  if (!leagueId) {
    return (
      <Screen title="Quick Season" subtitle="Pick your league" onBack={() => go('menu')}>
        <div className="flex flex-col gap-2">
          {selectableLeagues().map((league) => (
            <Card key={league.id} onClick={() => setLeagueId(league.id)}>
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-semibold text-white">{league.name}</p>
                <p className="nums shrink-0 text-xs text-pitch-500">{league.rounds} rounds</p>
              </div>
              <p className="mt-0.5 text-xs text-pitch-600">Tier {league.tier}</p>
            </Card>
          ))}
        </div>
      </Screen>
    )
  }

  // --- draft ---
  const current = draft[slot]
  const done = slot >= draft.length

  if (!done && current) {
    const def = POSITIONS[current.slot]
    return (
      <Screen
        title={`Draft your ${def.name}`}
        subtitle={`Shirt ${def.number} · ${slot + 1} of ${draft.length}`}
        onBack={() => (slot === 0 ? setLeagueId(null) : setSlot(slot - 1))}
      >
        <div className="flex flex-col gap-3">
          {current.options.map((player) => (
            <Card
              key={player.id}
              onClick={() => {
                setPicks([...picks.slice(0, slot), player])
                setSlot(slot + 1)
              }}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-white">{player.name}</p>
                  <p className="text-xs text-pitch-500">
                    {POSITIONS[player.position].name} · age {player.age}
                  </p>
                </div>
                <p className="nums shrink-0 text-3xl font-black text-turf-400">{player.ovr}</p>
              </div>
            </Card>
          ))}
        </div>
      </Screen>
    )
  }

  // --- confirm ---
  const xv = buildDraftedTeam(picks, leagueId)
  return (
    <Screen
      title="Your XV"
      subtitle={`Overall ${draftStrength(xv)}`}
      onBack={() => setSlot(draft.length - 1)}
      footer={
        <Button
          full
          onClick={() => {
            const setup = startQuickSeason(world, seed, leagueId, xv)
            setSeason(simulateSeason(setup.season))
          }}
        >
          Play the season
        </Button>
      }
    >
      <div className="mb-4">
        <ClubPill club="Your XV" />
      </div>

      <ScrollX>
        <table className="w-full min-w-[340px] border-collapse text-sm">
          <tbody>
            {picks.map((player, i) => (
              <tr key={player.id} className="border-b border-pitch-850">
                <td className="nums py-2 pr-3 text-pitch-600">{POSITIONS[draft[i]!.slot].number}</td>
                <td className="py-2 pr-3 text-white">{player.name}</td>
                <td className="nums py-2 text-right font-semibold text-turf-400">{player.ovr}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollX>
    </Screen>
  )
}
