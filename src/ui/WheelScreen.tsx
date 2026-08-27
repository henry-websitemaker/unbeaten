/**
 * The mid-season wheel (SPEC §3).
 *
 * Optional and skippable. The odds are stated up front, and so is the guarantee that
 * matters: a bad spin costs form, fitness or morale, never anything permanent.
 */

import { useCallback, useMemo, useState } from 'react'
import { Button, Card, Screen } from './components'
import { WheelSpinner } from './WheelSpinner'
import { useGame } from '../store/gameStore'
import { WHEEL_OUTCOMES, WHEEL_TARGET_ODDS } from '../engine/wheel'

export default function WheelScreen() {
  const go = useGame((s) => s.go)
  const spinWheel = useGame((s) => s.spinWheel)
  const skipWheel = useGame((s) => s.skipWheel)
  const lastSpin = useGame((s) => s.lastSpin)

  // The result is decided the moment `spinWheel` runs; this only controls whether the wheel
  // has finished turning, so the reveal follows the landing rather than pre-empting it.
  const [revealed, setRevealed] = useState(false)
  const onLanded = useCallback(() => setRevealed(true), [])

  const positive = Math.round(WHEEL_TARGET_ODDS.positive * 100)
  const negative = Math.round(WHEEL_TARGET_ODDS.negative * 100)
  const neutral = Math.round(WHEEL_TARGET_ODDS.neutral * 100)

  const segments = useMemo(
    () =>
      WHEEL_OUTCOMES.map((outcome) => ({
        label: outcome.label,
        tone:
          outcome.type === 'positive'
            ? ('good' as const)
            : outcome.type === 'negative'
              ? ('bad' as const)
              : ('neutral' as const),
      })),
    [],
  )

  // Spun, but still turning.
  if (lastSpin && !revealed) {
    const landingOn = WHEEL_OUTCOMES.findIndex((o) => o.id === lastSpin.outcome.id)

    return (
      <Screen title="Halfway" subtitle="Round and round">
        <div className="py-6">
          <WheelSpinner
            segments={segments}
            targetIndex={Math.max(0, landingOn)}
            spinning
            onLanded={onLanded}
          />
        </div>
        <p className="text-center text-sm text-pitch-500">
          Whatever it lands on, you cannot lose what you have already earned.
        </p>
      </Screen>
    )
  }

  if (lastSpin) {
    const tone =
      lastSpin.outcome.type === 'positive'
        ? 'border-turf-600 bg-turf-500/10'
        : lastSpin.outcome.type === 'negative'
          ? 'border-loss/40 bg-loss/10'
          : 'border-pitch-700 bg-pitch-900'

    return (
      <Screen title="Halfway" subtitle="The spin is in">
        <div className={`rounded-2xl border p-6 text-center ${tone}`}>
          <p className="text-xs font-semibold uppercase tracking-wider text-pitch-500">
            {lastSpin.outcome.type}
          </p>
          <p className="mt-2 text-2xl font-black text-white">{lastSpin.outcome.label}</p>
          <p className="mt-2 text-sm text-pitch-400">{lastSpin.description}</p>
        </div>

        {lastSpin.outcome.type === 'negative' && (
          <p className="mt-4 text-center text-xs text-pitch-500">
            Temporary. Your stats, OVR and traits are untouched.
          </p>
        )}

        <div className="mt-8">
          <Button full onClick={() => go('dashboard')}>
            Back to the season
          </Button>
        </div>
      </Screen>
    )
  }

  return (
    <Screen title="Halfway" subtitle="One spin, if you want it">
      <Card>
        <p className="text-lg font-bold text-white">Take the gamble?</p>
        <p className="mt-2 text-sm text-pitch-500">
          One spin, once a season. You can walk away and nothing happens.
        </p>

        <div className="mt-4 flex gap-2">
          <Odds label="Good" pct={positive} className="bg-turf-500/15 text-turf-400" />
          <Odds label="Bad" pct={negative} className="bg-loss/15 text-loss" />
          <Odds label="Nothing" pct={neutral} className="bg-pitch-700 text-pitch-400" />
        </div>

        <p className="mt-4 rounded-xl bg-pitch-800/60 p-3 text-xs text-pitch-400">
          Anything good you win is permanent — stats, OVR, traits, the captaincy. Anything bad
          is temporary: form, a knock, a bruised ego. You cannot lose what you have already
          earned.
        </p>
      </Card>

      <div className="mt-8 flex flex-col gap-2">
        <Button full onClick={spinWheel}>
          Spin
        </Button>
        <Button full variant="ghost" onClick={skipWheel}>
          Walk away
        </Button>
      </div>
    </Screen>
  )
}

function Odds({ label, pct, className }: { label: string; pct: number; className: string }) {
  return (
    <div className={`flex-1 rounded-xl px-3 py-2 text-center ${className}`}>
      <p className="nums text-xl font-bold">{pct}%</p>
      <p className="text-[11px] font-medium uppercase tracking-wide opacity-70">{label}</p>
    </div>
  )
}
