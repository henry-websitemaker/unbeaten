/**
 * Summer Plans (SPEC §3 and §4).
 *
 * Two things and no others: the lifestyle shop, and the destination choice. There is no
 * training step — §2.5 removed it, and §2.7 says it must be gone rather than hidden.
 *
 * Every destination card shows the OVR consequence *before* the choice is made.
 */

import { useState } from 'react'
import { Button, Card, SQUAD_ROLE_LABEL, Screen, SectionTitle, Stat } from './components'
import { useGame } from '../store/gameStore'
import { LIFESTYLE_ITEMS, balance, formatMoney, owns } from '../engine/economy'
import { trainingOptions } from '../engine/training'
import { getLeague } from '../data'
import type { TransferOffer } from '../types/career'

export default function SummerScreen() {
  const run = useGame((s) => s.run)
  const offers = useGame((s) => s.offers)
  const buyLifestyle = useGame((s) => s.buyLifestyle)
  const chooseTraining = useGame((s) => s.chooseTraining)
  const chooseDestination = useGame((s) => s.chooseDestination)
  const beginNextSeason = useGame((s) => s.beginNextSeason)

  const [error, setError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)

  if (!run) return null
  const { career } = run
  const available = balance(career.ledger)
  const trained = career.training.find((t) => t.season === career.season)
  // Sorted by what each pick is worth, so the strongest options lead — the list is long and
  // a player should not have to scan eleven cards to find the one that matters.
  const options = [...trainingOptions(career.stats, career.position)].sort(
    (a, b) => b.ovrDelta - a.ovrDelta || b.current - a.current,
  )

  const pick = (offer: TransferOffer) => {
    chooseDestination(offer)
    setChosen(offer.clubId)
  }

  return (
    <Screen
      title="Summer plans"
      subtitle={`${formatMoney(available)} in the bank`}
      footer={
        <Button full disabled={offers.length > 0 && !chosen} onClick={beginNextSeason}>
          {offers.length > 0 && !chosen ? 'Choose a destination first' : 'Start next season'}
        </Button>
      }
    >
      <SectionTitle>Pre-season</SectionTitle>
      <p className="mb-3 text-sm text-pitch-500">
        One thing to work on before the season starts. Pick the stat — you only get one, and
        it does not carry over.
      </p>

      <div className="flex flex-col gap-2">
        {options.map((option) => {
          const isChosen = trained?.statKey === option.stat
          const done = trained !== undefined

          return (
            <button
              key={option.stat}
              disabled={done}
              onClick={() => setError(chooseTraining(option.stat))}
              className={`rounded-2xl border p-3 text-left transition ${
                isChosen
                  ? 'border-turf-500 bg-turf-500/10'
                  : done
                    ? 'border-pitch-800 bg-pitch-900/40 opacity-40'
                    : option.isKeyStat
                      ? 'border-turf-600/40 bg-pitch-900 hover:border-turf-600'
                      : 'border-pitch-700 bg-pitch-900 hover:border-pitch-500'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-12 shrink-0">
                  <p
                    className={`text-xs font-bold ${
                      option.isKeyStat ? 'text-turf-400' : 'text-pitch-500'
                    }`}
                  >
                    {option.stat}
                  </p>
                  <p className="nums text-lg font-bold text-white">{option.current}</p>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-white">
                    {option.block.name}
                    {option.isKeyStat && (
                      <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-turf-400">
                        key
                      </span>
                    )}
                  </p>
                  <p className="truncate text-[11px] text-pitch-500">{option.block.flavour}</p>
                </div>

                {/* The consequence up front, the way destination cards do it (SPEC §2.5). */}
                <div className="shrink-0 text-right">
                  <p
                    className={`nums text-sm font-bold ${
                      option.ovrDelta > 0 ? 'text-turf-400' : 'text-pitch-600'
                    }`}
                  >
                    {option.ovrDelta > 0 ? `+${option.ovrDelta}` : '±0'}
                  </p>
                  <p className="text-[10px] uppercase tracking-wider text-pitch-600">OVR</p>
                </div>
              </div>

              {isChosen && (
                <p className="nums mt-2 text-[11px] font-semibold uppercase tracking-wide text-turf-400">
                  Worked on this summer
                </p>
              )}
            </button>
          )
        })}
      </div>

      {trained && (
        <p className="mt-2 text-xs text-pitch-600">
          {trained.statKey ?? 'That'} is done for this summer. The next pick comes next year.
        </p>
      )}

      {offers.length > 0 && (
        <>
          <SectionTitle>Where next?</SectionTitle>
          <p className="mb-3 text-sm text-pitch-500">
            Stepping up sharpens you. Dropping down blunts you. You are told which before you
            decide.
          </p>

          <div className="flex flex-col gap-3">
            {offers.map((offer) => {
              const league = getLeague(offer.leagueId)
              const isChosen = chosen === offer.clubId
              return (
                <Card
                  key={offer.clubId}
                  selected={isChosen}
                  onClick={chosen ? undefined : () => pick(offer)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {offer.mystery ? (
                        <>
                          <p className="truncate font-bold text-gold">Mystery Club</p>
                          <p className="truncate text-xs text-pitch-500">
                            Revealed when the season starts
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="truncate font-bold text-white">{offer.clubName}</p>
                          <p className="truncate text-xs text-pitch-500">
                            {league.name} · Tier {offer.tier}
                          </p>
                        </>
                      )}
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-[10px] uppercase tracking-wider text-pitch-500">OVR</p>
                      <p className="nums text-sm font-bold">
                        {offer.direction === 'stay' ? (
                          <span className="text-pitch-500">±0</span>
                        ) : (
                          <span
                            className={
                              offer.direction === 'up' ? 'text-turf-400' : 'text-loss'
                            }
                          >
                            {offer.direction === 'up' ? '+' : ''}
                            {offer.ovrChangeRange[0]} to {offer.ovrChangeRange[1] > 0 ? '+' : ''}
                            {offer.ovrChangeRange[1]}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <Detail label="Salary" value={formatMoney(offer.salary)} />
                    <Detail label="Length" value={`${offer.years} yr`} />
                    <Detail label="Role" value={SQUAD_ROLE_LABEL[offer.squadRole]} />
                  </div>

                  {offer.mystery && (
                    // SPEC §2.5 still requires the OVR consequence up front, so the move's
                    // effect is on the card above — only the destination is withheld.
                    <p className="mt-2 text-xs text-gold/80">
                      They will not say who. You know what the move does to you, not where it
                      takes you — and they are paying for the secrecy.
                    </p>
                  )}

                  {offer.direction === 'stay' && (
                    <p className="mt-2 text-xs text-pitch-600">Stay where you are.</p>
                  )}
                </Card>
              )
            })}
          </div>
        </>
      )}

      <SectionTitle>Lifestyle</SectionTitle>
      <p className="mb-3 text-sm text-pitch-500">
        Spending here really does come out of what you have earned.
      </p>

      {error && (
        <p className="mb-3 rounded-xl border border-loss/30 bg-loss/10 px-3 py-2 text-xs text-loss">
          {error}
        </p>
      )}

      <div className="flex flex-col gap-2">
        {LIFESTYLE_ITEMS.map((item) => {
          const alreadyOwned = !item.repeatable && owns(career.lifestyle, item.id)
          const boughtThisSummer =
            item.repeatable &&
            career.lifestyle.purchases.some(
              (p) => p.itemId === item.id && p.season === career.season,
            )
          const affordable = available >= item.cost
          const disabled = alreadyOwned || boughtThisSummer || !affordable

          return (
            <button
              key={item.id}
              disabled={disabled}
              onClick={() => setError(buyLifestyle(item.id))}
              className={`rounded-2xl border p-4 text-left transition ${
                disabled
                  ? 'border-pitch-800 bg-pitch-900/40 opacity-50'
                  : 'border-pitch-700 bg-pitch-900 hover:border-turf-600'
              }`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="font-semibold text-white">{item.name}</p>
                <p className="nums shrink-0 text-sm font-bold text-turf-400">
                  {formatMoney(item.cost)}
                </p>
              </div>
              <p className="mt-1 text-xs text-pitch-500">{item.description}</p>
              {alreadyOwned && (
                <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-turf-400">
                  Owned
                </p>
              )}
              {boughtThisSummer && (
                <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-turf-400">
                  Booked for this season
                </p>
              )}
              {!alreadyOwned && !boughtThisSummer && !affordable && (
                <p className="mt-2 text-[11px] text-pitch-600">
                  {formatMoney(item.cost - available)} short
                </p>
              )}
            </button>
          )
        })}
      </div>

      {offers.length === 0 && (
        <>
          <SectionTitle>Contract</SectionTitle>
          <Card>
            <Stat label="Club" value={career.contract.clubId.split(':')[1] ?? '—'} />
            <Stat label="Salary" value={formatMoney(career.contract.salary)} />
            <Stat
              label="Years left"
              value={Math.max(0, career.contract.years - career.contract.yearsServed)}
            />
          </Card>
        </>
      )}
    </Screen>
  )
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-pitch-800/60 px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wider text-pitch-500">{label}</p>
      <p className="nums truncate text-xs font-semibold text-white">{value}</p>
    </div>
  )
}
