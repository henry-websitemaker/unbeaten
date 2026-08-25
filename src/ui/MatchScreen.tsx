/**
 * Match agency (SPEC §3).
 *
 * At most two calls, and every one of them is optional. The odds come from the stats the
 * call is actually judged on and are shown *before* the choice, so a gamble is a gamble the
 * player took knowingly rather than one the game took for them.
 *
 * Walking away costs nothing: "Get on with it" plays the match with whatever has been
 * decided so far, which may be nothing at all.
 */

import { Button, Card, Screen, SectionTitle } from './components'
import { useGame } from '../store/gameStore'
import type { OfferedDecision, ResolvedDecision } from '../engine/agency'

export default function MatchScreen() {
  const run = useGame((s) => s.run)
  const pending = useGame((s) => s.pendingDecisions)
  const resolved = useGame((s) => s.resolvedDecisions)
  const decide = useGame((s) => s.decide)
  const playMatch = useGame((s) => s.nextRound)

  if (!run) return null

  const round = run.season.roundsPlayed + 1
  const outstanding = pending.filter(
    (d) => !resolved.some((r) => r.situationId === d.situationId),
  )
  const allDecided = outstanding.length === 0

  return (
    <Screen
      title={`Round ${round}`}
      subtitle={allDecided ? 'Over to the referee' : 'A call to make'}
      footer={
        <Button full onClick={playMatch}>
          {allDecided ? 'Play the match' : 'Get on with it'}
        </Button>
      }
    >
      {!allDecided && (
        <p className="mb-4 text-sm text-pitch-500">
          Your call. The percentages are what your attributes give you — take the safe option
          or back yourself, and either way nothing you have earned is at stake.
        </p>
      )}

      <div className="flex flex-col gap-4">
        {pending.map((decision) => {
          const taken = resolved.find((r) => r.situationId === decision.situationId)
          return taken ? (
            <Outcome key={decision.situationId} decision={decision} resolved={taken} />
          ) : (
            <Choice
              key={decision.situationId}
              decision={decision}
              onPick={(optionId) => decide(decision.situationId, optionId)}
            />
          )
        })}
      </div>

      {allDecided && (
        <p className="mt-6 text-center text-xs text-pitch-600">
          Eighty minutes to play. What happens now is out of your hands.
        </p>
      )}
    </Screen>
  )
}

function Choice({
  decision,
  onPick,
}: {
  decision: OfferedDecision
  onPick: (optionId: string) => void
}) {
  return (
    <div>
      <SectionTitle>{decision.title}</SectionTitle>
      <p className="mb-3 text-sm text-pitch-400">{decision.prompt}</p>

      <div className="flex flex-col gap-2">
        {decision.options.map((option) => {
          const certain = option.stats.length === 0
          return (
            <Card key={option.id} onClick={() => onPick(option.id)}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-white">{option.label}</p>
                  <p className="mt-0.5 text-xs text-pitch-500">{option.detail}</p>
                </div>

                <div className="shrink-0 text-right">
                  {certain ? (
                    <p className="text-xs font-semibold uppercase tracking-wide text-pitch-500">
                      Safe
                    </p>
                  ) : (
                    <>
                      <p
                        className={`nums text-xl font-black ${
                          option.chance >= 0.6 ? 'text-turf-400' : 'text-gold'
                        }`}
                      >
                        {Math.round(option.chance * 100)}%
                      </p>
                      <p className="text-[10px] uppercase tracking-wider text-pitch-600">
                        {option.stats.join(' · ')}
                      </p>
                    </>
                  )}
                </div>
              </div>
            </Card>
          )
        })}
      </div>
    </div>
  )
}

function Outcome({
  decision,
  resolved,
}: {
  decision: OfferedDecision
  resolved: ResolvedDecision
}) {
  // A safe option that simply worked has no drama to report.
  const quiet = resolved.outcome.length === 0

  return (
    <div>
      <SectionTitle>{decision.title}</SectionTitle>
      <div
        className={`rounded-2xl border p-4 ${
          quiet
            ? 'border-pitch-700 bg-pitch-900'
            : resolved.succeeded
              ? 'border-turf-600/50 bg-turf-500/10'
              : 'border-loss/40 bg-loss/10'
        }`}
      >
        <div className="flex items-baseline justify-between gap-3">
          <p className="truncate text-sm font-semibold text-white">{resolved.optionLabel}</p>
          <p className="nums shrink-0 text-xs text-pitch-500">
            {Math.round(resolved.chance * 100)}%
          </p>
        </div>
        {!quiet && (
          <p
            className={`mt-1.5 text-sm ${
              resolved.succeeded ? 'text-turf-400' : 'text-loss'
            }`}
          >
            {resolved.outcome}
          </p>
        )}
        {!resolved.succeeded && (
          <p className="mt-2 text-[11px] text-pitch-500">
            Costs you form for a couple of games. Nothing permanent.
          </p>
        )}
      </div>
    </div>
  )
}
