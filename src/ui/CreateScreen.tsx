/**
 * Forge Your Player (SPEC §3).
 *
 * Four steps: name, position group, position, then the origin draft — stat cards pulled
 * from real players, locking one stat at a time — and finally the starting archetype.
 */

import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Screen, SectionTitle } from './components'
import { useGame } from '../store/gameStore'
import { buildOriginDraft, type OriginCard } from '../engine/career'
import { ARCHETYPE_LIST } from '../engine/progression'
import { positionsInGroup } from '../engine/ovr'
import { NATIONS } from '../engine/internationals'
import { POSITIONS, TIER_TWO_LEAGUES, loadTeams } from '../data'
import { formatMoney } from '../engine/economy'
import { createRng, seedFromString } from '../engine/rng'
import type { LeagueId, PositionGroup, PositionId, RosterEntry, StatKey } from '../types/core'

const GROUPS: { id: PositionGroup; name: string; blurb: string }[] = [
  { id: 'FWD', name: 'Forward', blurb: 'Set piece, collisions, the hard yards.' },
  { id: 'HLF', name: 'Half back', blurb: 'The game runs through you.' },
  { id: 'BCK', name: 'Back', blurb: 'Space, pace and finishing.' },
]

/** What each second-tier league is actually like to play in (SPEC §3). */
const LEAGUE_BLURB: Record<string, string> = {
  npc: 'Short, ferocious and played at pace. Ten rounds means every week is a trial — there is nowhere to hide and no time to find form.',
  shute_shield: 'Sydney club rugby. Expansive, unstructured and watched by more selectors than the crowd suggests. Good place to be noticed.',
  rfu_championship:
    'England\'s second tier. Long, physical, forward-dominated and unforgiving in February. Survive it and nothing surprises you.',
  pro_d2:
    'Thirty rounds of French rugby. The longest season in the game, brutal away from home, and the promotion race runs to the final weekend.',
}

function LeagueFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-pitch-800/60 px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wider text-pitch-500">{label}</p>
      <p className="nums truncate text-xs font-semibold text-white">{value}</p>
    </div>
  )
}

export default function CreateScreen() {
  const go = useGame((s) => s.go)
  const startCareer = useGame((s) => s.startCareer)

  const [step, setStep] = useState(0)
  const [name, setName] = useState('')
  const [group, setGroup] = useState<PositionGroup | null>(null)
  const [position, setPosition] = useState<PositionId | null>(null)
  const [locked, setLocked] = useState<Partial<Record<StatKey, number>>>({})
  const [draftIndex, setDraftIndex] = useState(0)
  const [nationId, setNationId] = useState('eng')
  const [leagueId, setLeagueId] = useState<LeagueId | null>(null)
  const [pool, setPool] = useState<RosterEntry[]>([])

  useEffect(() => {
    loadTeams().then((teams) => setPool(teams.flatMap((t) => t.roster)))
  }, [])

  const draft = useMemo(() => {
    if (!position || pool.length === 0) return []
    return buildOriginDraft(createRng(seedFromString(`${name}:${position}`)), position, pool)
  }, [position, pool, name])

  const back = () => {
    if (step === 0) go('menu')
    else setStep(step - 1)
  }

  return (
    <Screen title="Forge your player" subtitle={`Step ${step + 1} of 6`} onBack={back}>
      {step === 0 && (
        <>
          <SectionTitle>What are you called?</SectionTitle>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            maxLength={28}
            autoFocus
            className="w-full rounded-2xl border border-pitch-700 bg-pitch-900 px-4 py-3 text-lg text-white outline-none placeholder:text-pitch-600 focus:border-turf-600"
          />

          <SectionTitle>Where are you from?</SectionTitle>
          <div className="grid grid-cols-2 gap-2">
            {NATIONS.map((nation) => (
              <button
                key={nation.id}
                onClick={() => setNationId(nation.id)}
                className={`rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                  nationId === nation.id
                    ? 'border-turf-500 bg-turf-500/10 text-white'
                    : 'border-pitch-700 bg-pitch-900 text-pitch-500 hover:border-pitch-600'
                }`}
              >
                {nation.name}
              </button>
            ))}
          </div>

          <div className="mt-8">
            <Button full disabled={name.trim().length < 2} onClick={() => setStep(1)}>
              Continue
            </Button>
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <SectionTitle>Pick your archetype card</SectionTitle>
          <div className="flex flex-col gap-3">
            {GROUPS.map((g) => (
              <Card
                key={g.id}
                selected={group === g.id}
                onClick={() => {
                  setGroup(g.id)
                  setPosition(null)
                }}
              >
                <p className="text-lg font-bold text-white">{g.name}</p>
                <p className="mt-0.5 text-sm text-pitch-500">{g.blurb}</p>
                <p className="mt-2 text-xs text-pitch-600">
                  {positionsInGroup(g.id)
                    .map((p) => POSITIONS[p].name)
                    .join(' · ')}
                </p>
              </Card>
            ))}
          </div>

          <div className="mt-8">
            <Button full disabled={!group} onClick={() => setStep(2)}>
              Continue
            </Button>
          </div>
        </>
      )}

      {step === 2 && group && (
        <>
          <SectionTitle>Which shirt?</SectionTitle>
          <p className="mb-3 text-sm text-pitch-500">
            Eligibility is strict. A hooker only ever plays hooker.
          </p>
          <div className="flex flex-col gap-2">
            {positionsInGroup(group).map((p) => {
              const def = POSITIONS[p]
              return (
                <Card key={p} selected={position === p} onClick={() => setPosition(p)}>
                  <div className="flex items-center gap-3">
                    <span className="nums flex size-9 shrink-0 items-center justify-center rounded-lg bg-pitch-800 text-sm font-bold text-turf-400">
                      {def.number}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-white">{def.name}</p>
                      <p className="truncate text-xs text-pitch-500">
                        Key: {def.keyStats.join(' · ')}
                      </p>
                    </div>
                  </div>
                </Card>
              )
            })}
          </div>

          <div className="mt-8">
            <Button
              full
              disabled={!position}
              onClick={() => {
                setLocked({})
                setDraftIndex(0)
                setStep(3)
              }}
            >
              Continue
            </Button>
          </div>
        </>
      )}

      {step === 3 && position && (
        <OriginDraft
          cards={draft[draftIndex]?.options ?? []}
          stat={draft[draftIndex]?.stat}
          index={draftIndex}
          total={draft.length}
          onPick={(card) => {
            const next = { ...locked, [card.stat]: card.value }
            setLocked(next)
            if (draftIndex + 1 >= draft.length) setStep(4)
            else setDraftIndex(draftIndex + 1)
          }}
        />
      )}

      {step === 4 && position && (
        <>
          <SectionTitle>Choose your league</SectionTitle>
          <p className="mb-3 text-sm text-pitch-500">
            Where you start decides the budget behind you, the way the game is played, and how
            hard it is to break into a side. The club within it is still the luck of the draw.
          </p>
          <p className="mb-3 rounded-xl border border-pitch-800 bg-pitch-900/60 px-3 py-2 text-xs text-pitch-500">
            These are the second tier. The elite leagues are not on this list — at your level
            you would never be picked, and a season in the stand is not a season. Earn it.
          </p>

          <div className="flex flex-col gap-3">
            {TIER_TWO_LEAGUES.map((league) => (
              <Card
                key={league.id}
                selected={leagueId === league.id}
                onClick={() => setLeagueId(league.id)}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-bold text-white">{league.name}</p>
                  <p className="nums shrink-0 text-xs text-turf-400">
                    {league.rounds} rounds
                  </p>
                </div>
                <p className="mt-1 text-sm text-pitch-500">{LEAGUE_BLURB[league.id]}</p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <LeagueFact label="Budget" value={formatMoney(league.wageBudgetBase)} />
                  <LeagueFact label="Clubs" value={String(league.teamCount)} />
                  <LeagueFact
                    label="Finals"
                    value={league.finalsFormat === 'none' ? 'None' : 'Yes'}
                  />
                </div>
              </Card>
            ))}
          </div>

          <div className="mt-8">
            <Button full disabled={!leagueId} onClick={() => setStep(5)}>
              Continue
            </Button>
          </div>
        </>
      )}

      {step === 5 && position && (
        <>
          <SectionTitle>Choose your path</SectionTitle>
          <div className="flex flex-col gap-3">
            {ARCHETYPE_LIST.map((archetype) => (
              <Card
                key={archetype.id}
                onClick={() =>
                  startCareer({
                    name: name.trim(),
                    position,
                    archetypeId: archetype.id,
                    nationId,
                    leagueId: leagueId ?? undefined,
                    lockedStats: locked,
                  })
                }
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-lg font-bold text-white">{archetype.name}</p>
                  <p className="nums shrink-0 text-xs text-pitch-500">
                    Starts at {archetype.startAge}
                  </p>
                </div>
                <p className="mt-1 text-sm text-pitch-500">{archetype.description}</p>
                <p className="nums mt-2 text-xs text-turf-400">
                  Peaks around {archetype.growthCurve.peakAge}
                </p>
              </Card>
            ))}
          </div>
        </>
      )}
    </Screen>
  )
}

function OriginDraft({
  cards,
  stat,
  index,
  total,
  onPick,
}: {
  cards: OriginCard[]
  stat?: StatKey
  index: number
  total: number
  onPick: (card: OriginCard) => void
}) {
  if (cards.length === 0) {
    return <p className="py-12 text-center text-sm text-pitch-500">Building your draft…</p>
  }

  return (
    <>
      <SectionTitle>
        Origin draft — lock your {stat} ({index + 1} of {total})
      </SectionTitle>
      <p className="mb-3 text-sm text-pitch-500">
        Take a number off a player who already has it. Whatever you lock is yours.
      </p>

      <div className="flex flex-col gap-3">
        {cards.map((card, i) => (
          <Card key={`${card.playerName}:${i}`} onClick={() => onPick(card)}>
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="truncate font-semibold text-white">{card.playerName}</p>
                <p className="text-xs text-pitch-500">{card.stat}</p>
              </div>
              <p className="nums shrink-0 text-3xl font-black text-turf-400">{card.value}</p>
            </div>
          </Card>
        ))}
      </div>
    </>
  )
}
