/**
 * Summer Plans (SPEC §3, §2.8 and §4).
 *
 * In order: what the career has earned, where it might go next, the one thing to work on
 * before the season starts, and what the money can buy.
 *
 * Destinations arrive through a spin — the offers were already decided by the seed, so the
 * wheel reveals who came calling rather than choosing for you. Every card still shows its OVR
 * consequence before the choice is made, which SPEC §2.5 requires of all of them, Mystery Club
 * included.
 */

import { useState, type ReactNode } from 'react'
import { Button, Card, SQUAD_ROLE_LABEL, Screen, SectionTitle, Stat } from './components'
import { WheelSpinner } from './WheelSpinner'
import { useGame } from '../store/gameStore'
import {
  LIFESTYLE_ITEMS,
  balance,
  formatMoney,
  grossEarnings,
  owns,
  totalSpent,
} from '../engine/economy'
import {
  trainingGainForSeason,
  trainingOptions,
  type TrainingOption,
} from '../engine/training'
import { getLeague } from '../data'
import type { PlayerCareer, TransferOffer } from '../types/career'
import type { StatKey } from '../types/core'

export default function SummerScreen() {
  const run = useGame((s) => s.run)
  const offers = useGame((s) => s.offers)
  const buyLifestyle = useGame((s) => s.buyLifestyle)
  const chooseTraining = useGame((s) => s.chooseTraining)
  const chooseDestination = useGame((s) => s.chooseDestination)
  const beginNextSeason = useGame((s) => s.beginNextSeason)

  const [error, setError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)
  const [spinning, setSpinning] = useState(false)
  const [spun, setSpun] = useState(false)

  if (!run) return null
  const { career } = run

  const available = balance(career.ledger)
  const earned = grossEarnings(career.ledger)
  const spent = totalSpent(career.ledger)
  const trained = career.training.find((t) => t.season === career.season)

  // This season's figure — one definite number, from the curve in `training.json`.
  const gain = trainingGainForSeason(career.season)

  // Shirt order rather than best-first: the grid is a picture of the player, and a stat block
  // that reshuffles every summer is unreadable.
  const options = trainingOptions(career.stats, career.position, career.season)

  const pick = (offer: TransferOffer) => {
    chooseDestination(offer)
    setChosen(offer.clubId)
  }

  return (
    <Screen
      title="Summer plans"
      subtitle={`After season ${career.season}`}
      footer={
        <Button full disabled={offers.length > 0 && !chosen} onClick={beginNextSeason}>
          {offers.length > 0 && !chosen ? 'Choose a destination first' : 'Start next season'}
        </Button>
      }
    >
      <div className="rounded-2xl border border-turf-600/40 bg-turf-500/5 p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-turf-400">
          Career earnings
        </p>
        <p className="nums mt-1 text-3xl font-black text-white">{formatMoney(earned)}</p>
        <div className="mt-2 flex items-baseline justify-between gap-3 text-xs text-pitch-500">
          <span className="nums">{formatMoney(available)} in the bank</span>
          <span className="nums">{formatMoney(spent)} spent</span>
        </div>
      </div>

      {offers.length > 0 && (
        <>
          <SectionTitle>Your options</SectionTitle>

          {spun ? (
            <>
              <p className="mb-3 text-sm text-pitch-500">
                Stepping up sharpens you. Dropping down blunts you. You are told which before
                you decide.
              </p>
              <div className="flex flex-col gap-3">
                {offers.map((offer) => (
                  <OfferCard
                    key={offer.clubId}
                    offer={offer}
                    currentWage={career.contract.salary}
                    isChosen={chosen === offer.clubId}
                    locked={chosen !== null}
                    onPick={() => pick(offer)}
                  />
                ))}
              </div>
            </>
          ) : (
            <>
              <p className="mb-3 text-sm text-pitch-500">
                Your agent has been working the phones. Spin to see who has come in for you.
              </p>
              <div className="py-4">
                <WheelSpinner
                  segments={offers.map((offer) => ({
                    label: offer.mystery ? 'Mystery Club' : offer.clubName,
                    tone:
                      offer.direction === 'up'
                        ? 'good'
                        : offer.direction === 'down'
                          ? 'bad'
                          : 'neutral',
                  }))}
                  targetIndex={Math.max(0, offers.length - 1)}
                  spinning={spinning}
                  onLanded={() => setSpun(true)}
                />
              </div>
              <Button full disabled={spinning} onClick={() => setSpinning(true)}>
                {spinning ? 'Spinning…' : 'Spin the transfer window'}
              </Button>
            </>
          )}
        </>
      )}

      <SectionTitle>Pre-season training</SectionTitle>
      <p className="mb-3 text-sm text-pitch-500">
        <span className="font-semibold text-white">
          +{gain} to one attribute before next season.
        </span>{' '}
        One pick, and it does not carry over.
      </p>

      <TrainingGrid
        options={options}
        trainedStat={trained?.statKey}
        done={trained !== undefined}
        onPick={(stat) => setError(chooseTraining(stat))}
      />

      {trained && (
        <p className="mt-2 text-xs text-pitch-600">
          {trained.statKey ?? 'That'} is done for this summer. The next pick comes next year.
        </p>
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

      <LifestyleShop
        career={career}
        available={available}
        onBuy={(id) => setError(buyLifestyle(id))}
      />

      {offers.length === 0 && (
        <>
          <SectionTitle>Contract</SectionTitle>
          <Card>
            <Stat label="Club" value={career.contract.clubId.split(':')[1] ?? '—'} />
            <Stat label="Weekly wage" value={`${formatMoney(career.contract.salary)}/wk`} />
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

/**
 * One destination.
 *
 * Exported so it can be rendered on its own: the cards sit behind the transfer spin, and a
 * static render of the whole screen never reaches them — which would quietly drop the SPEC
 * §2.5 assertion that the OVR consequence is shown before the choice.
 */
export function OfferCard({
  offer,
  currentWage,
  isChosen,
  locked,
  onPick,
}: {
  offer: TransferOffer
  currentWage: number
  isChosen: boolean
  locked: boolean
  onPick: () => void
}) {
  const league = getLeague(offer.leagueId)
  const wageDelta = offer.salary - currentWage

  return (
    <button
      disabled={locked}
      onClick={onPick}
      className={`w-full rounded-2xl border p-4 text-left transition ${
        isChosen
          ? 'border-turf-500 bg-turf-500/10'
          : locked
            ? 'border-pitch-800 bg-pitch-900/40 opacity-40'
            : 'border-pitch-700 bg-pitch-900 hover:border-pitch-500'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {offer.mystery ? (
            <>
              <p className="truncate font-bold text-gold">Mystery Club</p>
              <p className="truncate text-xs text-pitch-500">Revealed when the season starts</p>
            </>
          ) : (
            <>
              <p className="truncate font-bold text-white">{offer.clubName}</p>
              <p className="truncate text-xs text-pitch-500">
                Tier {offer.tier} · {league.name}
              </p>
            </>
          )}
        </div>

        <div className="shrink-0 text-right">
          <p className="text-[10px] uppercase tracking-wider text-pitch-500">Squad OVR</p>
          <p className="nums text-sm font-bold">
            {offer.direction === 'stay' ? (
              <span className="text-pitch-500">±0</span>
            ) : (
              <span className={offer.direction === 'up' ? 'text-turf-400' : 'text-loss'}>
                {offer.direction === 'up' ? '+' : ''}
                {offer.ovrChangeRange[0]} to {offer.ovrChangeRange[1] > 0 ? '+' : ''}
                {offer.ovrChangeRange[1]}
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <Detail label="Weekly wage" value={`${formatMoney(offer.salary)}/wk`} />
        <Detail
          label="Change"
          value={
            wageDelta === 0 ? (
              <span className="text-pitch-500">±0</span>
            ) : (
              // A pay cut is called a pay cut.
              <span className={wageDelta > 0 ? 'text-turf-400' : 'text-loss'}>
                {wageDelta > 0 ? '+' : '−'}
                {formatMoney(Math.abs(wageDelta))}
              </span>
            )
          }
        />
        <Detail label="Contract" value={`${offer.years} yr`} />
      </div>

      <p className="mt-2 text-[11px] text-pitch-600">
        {SQUAD_ROLE_LABEL[offer.squadRole]}
        {offer.direction === 'stay' && ' · stay where you are'}
      </p>

      {offer.mystery && (
        <p className="mt-2 text-xs text-gold/80">
          They will not say who. You know what the move does to you, not where it takes you —
          and they are paying for the secrecy.
        </p>
      )}
    </button>
  )
}

/** All eleven stats at a glance, in shirt order, with what each pick is worth. */
export function TrainingGrid({
  options,
  trainedStat,
  done,
  onPick,
}: {
  options: TrainingOption[]
  trainedStat?: StatKey
  done: boolean
  onPick: (stat: StatKey) => void
}) {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
      {options.map((option) => {
        const isChosen = trainedStat === option.stat
        return (
          <button
            key={option.stat}
            disabled={done}
            title={`${option.block.name} — ${option.block.flavour}`}
            onClick={() => onPick(option.stat)}
            className={`rounded-xl border p-2.5 text-left transition ${
              isChosen
                ? 'border-turf-500 bg-turf-500/15'
                : done
                  ? 'border-pitch-800 bg-pitch-900/40 opacity-40'
                  : option.isKeyStat
                    ? 'border-turf-500/70 bg-pitch-900 hover:border-turf-400'
                    : 'border-pitch-700 bg-pitch-900 hover:border-pitch-500'
            }`}
          >
            <div className="flex items-baseline justify-between gap-1">
              <span
                className={`text-[11px] font-bold ${
                  option.isKeyStat ? 'text-turf-400' : 'text-pitch-500'
                }`}
              >
                {option.stat}
              </span>
              {/* Key stats are starred as well as outlined: colour alone is not something
                  everyone can read. */}
              {option.isKeyStat && <span className="text-[10px] text-turf-400">★</span>}
            </div>

            <p className="nums text-2xl font-black leading-tight text-white">{option.current}</p>

            <p
              className={`nums text-[11px] font-semibold ${
                option.ovrDelta > 0 ? 'text-turf-400' : 'text-pitch-600'
              }`}
            >
              {option.ovrDelta > 0 ? `+${option.ovrDelta} OVR` : '±0 OVR'}
            </p>
          </button>
        )
      })}
    </div>
  )
}

function LifestyleShop({
  career,
  available,
  onBuy,
}: {
  career: PlayerCareer
  available: number
  onBuy: (itemId: string) => void
}) {
  return (
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
            onClick={() => onBuy(item.id)}
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
  )
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg bg-pitch-800/60 px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wider text-pitch-500">{label}</p>
      <p className="nums truncate text-xs font-semibold text-white">{value}</p>
    </div>
  )
}
