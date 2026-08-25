/** My Player, the achievement grid, and the rival head-to-head. */

import {
  Card,
  Empty,
  Screen,
  ScrollX,
  SectionTitle,
  Stat,
  TierBadge,
} from './components'
import { useGame } from '../store/gameStore'
import { formatMoney, grossEarnings, balance, totalSpent } from '../engine/economy'
import { evaluateAchievements, groupByCategory } from '../engine/achievements'
import { headToHead, rivalVerdict } from '../engine/rival'
import { TRAITS } from '../engine/wheel'
import { LIFESTYLE_ITEMS } from '../engine/economy'
import { POSITIONS, getLeague } from '../data'
import { getNation } from '../engine/internationals'
import { CAREER_SEASONS } from '../types/career'
import type { StatKey } from '../types/core'

export function MyPlayerScreen() {
  const run = useGame((s) => s.run)
  const go = useGame((s) => s.go)
  if (!run) return null

  const { career } = run
  const def = POSITIONS[career.position]
  const keyStats = new Set<StatKey>(def.keyStats)
  const owned = LIFESTYLE_ITEMS.filter((item) =>
    career.lifestyle.purchases.some((p) => p.itemId === item.id),
  )

  return (
    <Screen
      title={career.name}
      subtitle={`${def.name} · ${getNation(career.nationId).name}`}
      onBack={() => go('dashboard')}
    >
      <div className="flex items-center gap-4 rounded-2xl border border-pitch-700 bg-pitch-900 p-4">
        <div className="flex size-16 shrink-0 flex-col items-center justify-center rounded-2xl bg-turf-500/15">
          <span className="nums text-2xl font-black text-turf-400">{career.ovr}</span>
          <span className="text-[10px] font-medium uppercase text-turf-400/60">OVR</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="nums text-sm text-white">
            Age {career.age} · Season {career.season}/{CAREER_SEASONS}
          </p>
          <p className="nums mt-0.5 text-xs text-pitch-500">
            Form {Math.round(career.form)} · Morale {Math.round(career.morale)}
          </p>
          {career.isCaptain && (
            <span className="mt-1.5 inline-block rounded bg-gold/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-gold">
              Captain
            </span>
          )}
        </div>
      </div>

      <SectionTitle>Attributes</SectionTitle>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {(Object.keys(career.stats) as StatKey[]).map((stat) => {
          const value = career.stats[stat] ?? 0
          const isKey = keyStats.has(stat)
          return (
            <div
              key={stat}
              className={`rounded-xl border px-3 py-2 ${
                isKey ? 'border-turf-600/50 bg-turf-500/5' : 'border-pitch-700 bg-pitch-900'
              }`}
            >
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-medium text-pitch-500">{stat}</span>
                <span
                  className={`nums text-lg font-bold ${isKey ? 'text-turf-400' : 'text-white'}`}
                >
                  {value}
                </span>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-pitch-800">
                <div
                  className={`h-full rounded-full ${isKey ? 'bg-turf-500' : 'bg-pitch-500'}`}
                  style={{ width: `${value}%` }}
                />
              </div>
            </div>
          )
        })}
      </div>
      <p className="mt-2 text-xs text-pitch-600">
        Highlighted attributes are the ones your shirt is judged on.
      </p>

      {career.traits.length > 0 && (
        <>
          <SectionTitle>Traits</SectionTitle>
          <div className="flex flex-col gap-2">
            {career.traits.map((id) => {
              const trait = TRAITS.find((t) => t.id === id)
              return (
                <div key={id} className="rounded-xl border border-pitch-700 bg-pitch-900 px-3 py-2">
                  <p className="text-sm font-semibold text-white">{trait?.name ?? id}</p>
                  <p className="text-xs text-pitch-500">{trait?.description}</p>
                </div>
              )
            })}
          </div>
        </>
      )}

      {owned.length > 0 && (
        <>
          <SectionTitle>Lifestyle</SectionTitle>
          <div className="flex flex-wrap gap-2">
            {owned.map((item) => (
              <span
                key={item.id}
                className="rounded-lg bg-turf-500/15 px-2.5 py-1 text-xs font-medium text-turf-400"
              >
                {item.name}
              </span>
            ))}
          </div>
        </>
      )}

      <SectionTitle>Career</SectionTitle>
      <Card>
        <Stat label="Appearances" value={career.careerCaps} />
        <Stat label="Tries" value={career.careerTries} />
        <Stat label="Points" value={career.careerPoints} />
        <Stat label="Test caps" value={career.internationalCaps} />
        <Stat label="Test tries" value={career.internationalTries} />
        <Stat label="Trophies" value={career.trophies.length} />
      </Card>

      {career.awards.length > 0 && (
        <>
          <SectionTitle>Honours</SectionTitle>
          <div className="flex flex-col gap-2">
            {[...career.awards].reverse().map((award, index) => (
              <div
                key={`${award.season}:${award.type}:${index}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-gold/25 bg-gold/5 px-3 py-2.5"
              >
                <p className="truncate text-sm font-medium text-white">{award.name}</p>
                <span className="nums shrink-0 text-xs text-gold">S{award.season}</span>
              </div>
            ))}
          </div>
        </>
      )}

      <SectionTitle>Money</SectionTitle>
      <Card>
        <Stat label="Earned" value={formatMoney(grossEarnings(career.ledger))} />
        <Stat label="Spent" value={formatMoney(totalSpent(career.ledger))} />
        <Stat label="Balance" value={formatMoney(balance(career.ledger))} />
      </Card>

      {career.history.length > 0 && (
        <>
          <SectionTitle>Season by season</SectionTitle>
          <ScrollX>
            <table className="w-full min-w-[460px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-pitch-700 text-left text-[11px] uppercase tracking-wider text-pitch-500">
                  <th className="py-2 pr-2 font-medium">S</th>
                  <th className="py-2 pr-3 font-medium">Club</th>
                  <th className="nums py-2 px-2 text-right font-medium">Apps</th>
                  <th className="nums py-2 px-2 text-right font-medium">T</th>
                  <th className="nums py-2 px-2 text-right font-medium">Rat</th>
                  <th className="nums py-2 pl-2 text-right font-medium">OVR</th>
                </tr>
              </thead>
              <tbody>
                {career.history.map((h) => (
                  <tr key={h.season} className="border-b border-pitch-850">
                    <td className="nums py-2 pr-2 text-pitch-500">{h.season}</td>
                    <td className="py-2 pr-3 text-white">
                      <span className="block max-w-[140px] truncate">{h.clubName}</span>
                      <span className="block text-[11px] text-pitch-600">
                        {getLeague(h.leagueId).name}
                        {h.championship && <span className="text-gold"> · Champions</span>}
                      </span>
                    </td>
                    <td className="nums py-2 px-2 text-right text-white">{h.appearances}</td>
                    <td className="nums py-2 px-2 text-right text-white">{h.tries}</td>
                    <td className="nums py-2 px-2 text-right text-pitch-500">
                      {h.avgRating.toFixed(1)}
                    </td>
                    <td className="nums py-2 pl-2 text-right font-semibold text-white">
                      {h.ovrEnd}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollX>
        </>
      )}
    </Screen>
  )
}

const CATEGORY_LABELS = {
  milestones: 'Milestones',
  feats: 'Feats',
  journey: 'Journey',
  legend: 'Legend',
} as const

export function AchievementsScreen() {
  const run = useGame((s) => s.run)
  const go = useGame((s) => s.go)
  if (!run) return null

  const all = evaluateAchievements(run.career)
  const grid = groupByCategory(all)
  const unlocked = all.filter((a) => a.unlocked).length

  return (
    <Screen
      title="Feats"
      subtitle={`${unlocked} of ${all.length} unlocked`}
      onBack={() => go('dashboard')}
    >
      {(Object.keys(CATEGORY_LABELS) as (keyof typeof CATEGORY_LABELS)[]).map((category) => (
        <div key={category}>
          <SectionTitle>{CATEGORY_LABELS[category]}</SectionTitle>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {grid[category].map((achievement) => (
              <div
                key={achievement.id}
                className={`rounded-xl border px-3 py-2.5 ${
                  achievement.unlocked
                    ? 'border-pitch-600 bg-pitch-900'
                    : 'border-pitch-800 bg-pitch-900/40'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <p
                    className={`truncate text-sm font-medium ${
                      achievement.unlocked ? 'text-white' : 'text-pitch-600'
                    }`}
                  >
                    {achievement.name}
                  </p>
                  {achievement.unlocked ? (
                    <TierBadge tier={achievement.tier} />
                  ) : (
                    <span className="shrink-0 text-xs text-pitch-700">Locked</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </Screen>
  )
}

export function RivalScreen() {
  const run = useGame((s) => s.run)
  const rival = useGame((s) => s.rival)
  const go = useGame((s) => s.go)

  if (!run) return null
  if (!rival) {
    return (
      <Screen title="Rival" onBack={() => go('dashboard')}>
        <Empty>No rival on record.</Empty>
      </Screen>
    )
  }

  const rows = headToHead(run.career, rival)
  const verdict = rivalVerdict(run.career, rival)

  return (
    <Screen
      title="Head to head"
      subtitle={`${run.career.name} vs ${rival.name}`}
      onBack={() => go('dashboard')}
    >
      <div className="mb-4 grid grid-cols-2 gap-2">
        <div className="rounded-2xl border border-turf-600/50 bg-turf-500/5 p-3 text-center">
          <p className="truncate text-sm font-bold text-white">{run.career.name}</p>
          <p className="nums mt-1 text-3xl font-black text-turf-400">{run.career.ovr}</p>
        </div>
        <div className="rounded-2xl border border-pitch-700 bg-pitch-900 p-3 text-center">
          <p className="truncate text-sm font-bold text-white">{rival.name}</p>
          <p className="nums mt-1 text-3xl font-black text-pitch-400">{rival.ovr}</p>
        </div>
      </div>

      <Card>
        {rows.map((row) => (
          <div
            key={row.metric}
            className="flex items-center justify-between gap-3 border-b border-pitch-800 py-2.5 last:border-0"
          >
            <span
              className={`nums w-16 text-right text-sm font-bold ${
                row.playerAhead ? 'text-turf-400' : 'text-pitch-500'
              }`}
            >
              {row.player}
            </span>
            <span className="flex-1 text-center text-xs uppercase tracking-wider text-pitch-500">
              {row.metric}
            </span>
            <span
              className={`nums w-16 text-left text-sm font-bold ${
                !row.playerAhead ? 'text-loss' : 'text-pitch-500'
              }`}
            >
              {row.rival}
            </span>
          </div>
        ))}
      </Card>

      <p className="mt-4 rounded-2xl bg-pitch-900 p-4 text-sm text-pitch-400">{verdict.verdict}</p>
    </Screen>
  )
}
