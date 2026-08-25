/**
 * The two screens that had engines but no way in: season awards and internationals.
 *
 * Both prefer the season just closed (`lastSummary`) but fall back to what the career itself
 * carries, so they still say something useful after a mid-career reload when there is no
 * summary in memory.
 */

import { Button, Card, Empty, Screen, ScrollX, SectionTitle, Stat } from './components'
import { selectionOutlook, useGame } from '../store/gameStore'
import { POSITIONS } from '../data'
import { PLAYER_ID } from '../engine/career'
import { getNation, isWorldCupSeason } from '../engine/internationals'
import type { WorldPlayerNominee } from '../engine/awards'

// ---------------------------------------------------------------------------
// Awards
// ---------------------------------------------------------------------------

export function AwardsScreen() {
  const run = useGame((s) => s.run)
  const summary = useGame((s) => s.lastSummary)
  const go = useGame((s) => s.go)

  if (!run) return null

  if (!summary) {
    return (
      <Screen title="Awards" onBack={() => go('dashboard')}>
        <Empty>Awards are handed out at the end of a season. Go and win some.</Empty>
        <Honours />
      </Screen>
    )
  }

  const { awards, record } = summary
  const { worldPlayer } = awards

  return (
    <Screen
      title="Awards"
      subtitle={`Season ${record.season}`}
      onBack={() => go('season-review')}
      footer={
        <Button full onClick={() => go('season-review')}>
          Back to the review
        </Button>
      }
    >
      <SectionTitle>World Player of the Year</SectionTitle>
      {worldPlayer.nominees.length === 0 ? (
        <Empty>No shortlist this season.</Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {worldPlayer.nominees.map((nominee, index) => (
            <Nominee
              key={nominee.playerId}
              nominee={nominee}
              rank={index + 1}
              won={worldPlayer.winner?.playerId === nominee.playerId}
            />
          ))}
        </div>
      )}
      {worldPlayer.playerNominated && !worldPlayer.playerWon && (
        <p className="mt-2 text-xs text-pitch-500">
          On the shortlist, which most players never manage.
        </p>
      )}

      <SectionTitle>The league</SectionTitle>
      {awards.league.length === 0 ? (
        <Empty>Nothing was awarded this season.</Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {awards.league
            .filter((award) => award.id !== 'team_of_season')
            .map((award) => {
              const mine = award.winnerId === PLAYER_ID
              return (
                <div
                  key={award.id}
                  className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${
                    mine ? 'border-gold/40 bg-gold/10' : 'border-pitch-700 bg-pitch-900'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs uppercase tracking-wider text-pitch-500">
                      {award.name}
                    </p>
                    <p
                      className={`truncate text-sm font-semibold ${
                        mine ? 'text-gold' : 'text-white'
                      }`}
                    >
                      {award.winnerName}
                    </p>
                  </div>
                  <span className="nums shrink-0 text-sm font-bold text-white">{award.value}</span>
                </div>
              )
            })}
        </div>
      )}

      {(awards.nearMissTries || awards.nearMissPoints) && (
        <>
          <SectionTitle>So close</SectionTitle>
          <div className="flex flex-col gap-2">
            {[awards.nearMissTries, awards.nearMissPoints]
              .filter((miss): miss is NonNullable<typeof miss> => miss !== null)
              .map((miss) => (
                <p
                  key={miss.awardId}
                  className="rounded-xl border border-pitch-700 bg-pitch-900 px-3 py-2.5 text-sm text-pitch-400"
                >
                  <span className="nums font-semibold text-white">
                    {miss.placed === 2 ? '2nd' : '3rd'}
                  </span>{' '}
                  — {miss.message}
                </p>
              ))}
          </div>
        </>
      )}

      <TeamOfTheSeason
        squad={awards.league.find((a) => a.id === 'team_of_season')?.squad ?? []}
      />

      <Honours />
    </Screen>
  )
}

function Nominee({
  nominee,
  rank,
  won,
}: {
  nominee: WorldPlayerNominee
  rank: number
  won: boolean
}) {
  return (
    <div
      className={`rounded-xl border px-3 py-3 ${
        won
          ? 'border-gold/50 bg-gold/10'
          : nominee.isPlayer
            ? 'border-turf-600/50 bg-turf-500/5'
            : 'border-pitch-700 bg-pitch-900'
      }`}
    >
      <div className="flex items-baseline gap-3">
        <span className="nums w-5 shrink-0 text-sm font-bold text-pitch-600">{rank}</span>
        <p
          className={`min-w-0 flex-1 truncate font-semibold ${won ? 'text-gold' : 'text-white'}`}
        >
          {nominee.playerName}
          {nominee.isPlayer && (
            <span className="ml-1.5 text-[10px] font-bold uppercase tracking-wide text-turf-400">
              you
            </span>
          )}
        </p>
        {won && (
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-gold">
            Winner
          </span>
        )}
      </div>
      <p className="mt-1 pl-8 text-xs text-pitch-500">{nominee.justification}</p>
    </div>
  )
}

function TeamOfTheSeason({
  squad,
}: {
  squad: { slot: string; playerId: string; playerName: string }[]
}) {
  if (squad.length === 0) return null

  const ordered = [...squad].sort(
    (a, b) =>
      (POSITIONS[a.slot as keyof typeof POSITIONS]?.number ?? 99) -
      (POSITIONS[b.slot as keyof typeof POSITIONS]?.number ?? 99),
  )

  return (
    <>
      <SectionTitle>Team of the Season</SectionTitle>
      <ScrollX>
        <table className="w-full min-w-[300px] border-collapse text-sm">
          <tbody>
            {ordered.map((entry) => {
              const def = POSITIONS[entry.slot as keyof typeof POSITIONS]
              const mine = entry.playerId === PLAYER_ID
              return (
                <tr key={entry.slot} className="border-b border-pitch-850">
                  <td className="nums py-2 pr-3 text-pitch-600">{def?.number ?? '—'}</td>
                  <td className="py-2 pr-3 text-xs text-pitch-500">{def?.name ?? entry.slot}</td>
                  <td
                    className={`py-2 text-right font-medium ${mine ? 'text-gold' : 'text-white'}`}
                  >
                    {entry.playerName}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </ScrollX>
    </>
  )
}

/** Everything the player has ever won, so the screen is worth opening mid-career too. */
function Honours() {
  const career = useGame((s) => s.run?.career ?? null)
  if (!career || career.awards.length === 0) return null

  return (
    <>
      <SectionTitle>Your honours</SectionTitle>
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
  )
}

// ---------------------------------------------------------------------------
// Internationals
// ---------------------------------------------------------------------------

export function InternationalsScreen() {
  const run = useGame((s) => s.run)
  const summary = useGame((s) => s.lastSummary)
  const go = useGame((s) => s.go)

  if (!run) return null

  const outlook = selectionOutlook(run)
  const { career } = run
  const nation = getNation(career.nationId)
  const intl = summary?.internationals ?? null
  const testTrophies = career.trophies.filter((t) => t.type === 'international')

  return (
    <Screen
      title={nation.name}
      subtitle={`${career.internationalCaps} cap${career.internationalCaps === 1 ? '' : 's'}`}
      onBack={() => go(summary ? 'season-review' : 'dashboard')}
    >
      {/* Where you stand, right now. */}
      {outlook && (
        <div
          className={`rounded-2xl border p-4 ${
            outlook.selected
              ? 'border-turf-600/50 bg-turf-500/10'
              : 'border-pitch-700 bg-pitch-900'
          }`}
        >
          <p className="text-xs font-semibold uppercase tracking-wider text-pitch-500">
            {summary ? 'This season' : 'As things stand'}
          </p>
          <p
            className={`mt-1 text-sm font-semibold ${
              outlook.selected ? 'text-turf-400' : 'text-white'
            }`}
          >
            {outlook.reason}
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Gauge
              label="Form needed"
              value={outlook.threshold.toFixed(1)}
              sub={`${nation.name} standard`}
            />
            <Gauge
              label="OVR floor"
              value={Math.round(outlook.ovrFloor)}
              sub={`you are ${career.ovr}`}
            />
          </div>
        </div>
      )}

      {intl?.season && (
        <>
          <SectionTitle>Your test season</SectionTitle>
          <Card>
            <Stat label="Caps won" value={intl.caps} />
            <Stat label="Tries" value={intl.tries} />
          </Card>

          <SectionTitle>Tournaments</SectionTitle>
          <div className="flex flex-col gap-2">
            {intl.season.competitions.map((competition) => (
              <div
                key={competition.id}
                className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 ${
                  competition.won
                    ? 'border-gold/40 bg-gold/10'
                    : 'border-pitch-700 bg-pitch-900'
                }`}
              >
                <p
                  className={`truncate text-sm font-semibold ${
                    competition.won ? 'text-gold' : 'text-white'
                  }`}
                >
                  {competition.name}
                </p>
                <span className="shrink-0 text-xs text-pitch-500">
                  {competition.won ? 'Won' : 'Played'}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {intl?.worldCup && (
        <>
          <SectionTitle>The World Cup</SectionTitle>
          <div className="rounded-2xl border border-gold/30 bg-gold/5 p-4 text-center">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gold">
              Champions
            </p>
            <p className="mt-1 text-2xl font-black text-white">
              {getNation(intl.worldCup.championId).name}
            </p>
            <p className="mt-2 text-xs text-pitch-500">
              beat {getNation(
                intl.worldCup.finalistIds[0] === intl.worldCup.championId
                  ? intl.worldCup.finalistIds[1]
                  : intl.worldCup.finalistIds[0],
              ).name}{' '}
              in the final
            </p>
          </div>

          <ScrollX>
            <table className="mt-3 w-full min-w-[300px] border-collapse text-sm">
              <tbody>
                {intl.worldCup.ties
                  .filter((tie) => tie.round !== 'play-off')
                  .map((tie, index) => (
                    <tr key={`${tie.round}:${index}`} className="border-b border-pitch-850">
                      <td className="py-2 pr-3 text-[11px] uppercase tracking-wider text-pitch-600">
                        {tie.round}
                      </td>
                      <td className="py-2 pr-3 font-medium text-white">
                        {getNation(tie.winnerId).name}
                      </td>
                      <td className="py-2 text-right text-xs text-pitch-500">
                        beat {getNation(tie.loserId).name}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </ScrollX>
        </>
      )}

      {!intl && isWorldCupSeason(career.season) && (
        <p className="mt-4 rounded-2xl border border-gold/30 bg-gold/5 p-4 text-center text-sm text-gold">
          A World Cup year. Finish the season in form and you could be on the plane.
        </p>
      )}

      <SectionTitle>Career</SectionTitle>
      <Card>
        <Stat label="Test caps" value={career.internationalCaps} />
        <Stat label="Test tries" value={career.internationalTries} />
        <Stat label="Test silverware" value={testTrophies.length} />
      </Card>

      {testTrophies.length > 0 && (
        <div className="mt-2 flex flex-col gap-2">
          {testTrophies.map((trophy, index) => (
            <div
              key={`${trophy.season}:${index}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-gold/25 bg-gold/5 px-3 py-2.5"
            >
              <p className="truncate text-sm font-semibold text-white">{trophy.name}</p>
              <span className="nums shrink-0 text-xs text-gold">S{trophy.season}</span>
            </div>
          ))}
        </div>
      )}
    </Screen>
  )
}

function Gauge({
  label,
  value,
  sub,
}: {
  label: string
  value: string | number
  sub: string
}) {
  return (
    <div className="rounded-xl bg-pitch-800/60 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-pitch-500">{label}</p>
      <p className="nums text-lg font-bold text-white">{value}</p>
      <p className="truncate text-[10px] text-pitch-600">{sub}</p>
    </div>
  )
}
