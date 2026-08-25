/**
 * Summer Plans (SPEC §3 and §4).
 *
 * Two things and no others: the lifestyle shop, and the destination choice. There is no
 * training step — §2.5 removed it, and §2.7 says it must be gone rather than hidden.
 *
 * Every destination card shows the OVR consequence *before* the choice is made.
 */

import { useState } from 'react'
import { Button, Card, Screen, SectionTitle, Stat } from './components'
import { useGame } from '../store/gameStore'
import { LIFESTYLE_ITEMS, balance, formatMoney, owns } from '../engine/economy'
import { getLeague } from '../data'
import type { TransferOffer } from '../types/career'

const ROLE_LABEL: Record<string, string> = {
  star: 'Star man',
  starter: 'First choice',
  squad: 'Squad player',
  fringe: 'Fringe',
}

export default function SummerScreen() {
  const run = useGame((s) => s.run)
  const offers = useGame((s) => s.offers)
  const buyLifestyle = useGame((s) => s.buyLifestyle)
  const chooseDestination = useGame((s) => s.chooseDestination)
  const beginNextSeason = useGame((s) => s.beginNextSeason)

  const [error, setError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)

  if (!run) return null
  const { career } = run
  const available = balance(career.ledger)

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
                      <p className="truncate font-bold text-white">{offer.clubName}</p>
                      <p className="truncate text-xs text-pitch-500">
                        {league.name} · Tier {offer.tier}
                      </p>
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
                    <Detail label="Role" value={ROLE_LABEL[offer.squadRole] ?? offer.squadRole} />
                  </div>

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
