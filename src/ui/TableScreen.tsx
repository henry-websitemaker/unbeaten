/** The separate full-screen league table SPEC §3 asks for. */

import { Screen, ScrollX } from './components'
import { useGame } from '../store/gameStore'
import { currentLadder } from '../engine/season'
import { getLeague } from '../data'

export default function TableScreen() {
  const run = useGame((s) => s.run)
  const go = useGame((s) => s.go)
  if (!run) return null

  const league = getLeague(run.season.leagueId)
  const ladder = currentLadder(run.season)
  const finalsCutoff =
    league.finalsFormat === 'none' ? 0 : Math.min(league.teamCount, 2 ** league.finalsRounds)

  return (
    <Screen
      title={league.name}
      subtitle={`Round ${run.season.roundsPlayed} of ${league.rounds}`}
      onBack={() => go('dashboard')}
    >
      <ScrollX>
        <table className="w-full min-w-[520px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-pitch-700 text-left text-[11px] uppercase tracking-wider text-pitch-500">
              <th className="py-2 pr-2 font-medium">#</th>
              <th className="py-2 pr-3 font-medium">Club</th>
              <th className="nums py-2 px-2 text-right font-medium">P</th>
              <th className="nums py-2 px-2 text-right font-medium">W</th>
              <th className="nums py-2 px-2 text-right font-medium">D</th>
              <th className="nums py-2 px-2 text-right font-medium">L</th>
              <th className="nums py-2 px-2 text-right font-medium">PD</th>
              <th className="nums py-2 px-2 text-right font-medium">BP</th>
              <th className="nums py-2 pl-2 text-right font-medium">Pts</th>
            </tr>
          </thead>
          <tbody>
            {ladder.map((row) => {
              const club = run.season.teams.find((t) => t.id === row.teamId)
              const isPlayer = row.teamId === run.career.contract.clubId
              const inFinals = finalsCutoff > 0 && row.position <= finalsCutoff

              return (
                <tr
                  key={row.teamId}
                  className={`border-b border-pitch-850 ${
                    isPlayer ? 'bg-turf-500/10' : ''
                  }`}
                >
                  <td className="nums py-2 pr-2 text-pitch-500">
                    <span className="flex items-center gap-1.5">
                      {inFinals && <span className="size-1.5 rounded-full bg-turf-500" />}
                      {row.position}
                    </span>
                  </td>
                  <td
                    className={`py-2 pr-3 font-medium ${
                      isPlayer ? 'text-turf-400' : 'text-white'
                    }`}
                  >
                    {club?.name ?? row.teamId}
                  </td>
                  <td className="nums py-2 px-2 text-right text-pitch-500">{row.played}</td>
                  <td className="nums py-2 px-2 text-right text-white">{row.won}</td>
                  <td className="nums py-2 px-2 text-right text-pitch-500">{row.drawn}</td>
                  <td className="nums py-2 px-2 text-right text-pitch-500">{row.lost}</td>
                  <td
                    className={`nums py-2 px-2 text-right ${
                      row.pointsDifference > 0 ? 'text-turf-400' : 'text-pitch-500'
                    }`}
                  >
                    {row.pointsDifference > 0 ? '+' : ''}
                    {row.pointsDifference}
                  </td>
                  <td className="nums py-2 px-2 text-right text-pitch-500">{row.bonusPoints}</td>
                  <td className="nums py-2 pl-2 text-right font-bold text-white">{row.points}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </ScrollX>

      <p className="mt-4 text-xs text-pitch-600">
        4 for a win, 2 for a draw. A bonus point for {league.bonusPoints.tryBonus} tries, and
        another for losing by {league.bonusPoints.losingBonus} or fewer.
        {finalsCutoff > 0 && ` Top ${finalsCutoff} reach the finals.`}
      </p>
    </Screen>
  )
}
