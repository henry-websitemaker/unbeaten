/**
 * Flavour: the pre-match news line and the season verdict (SPEC §3).
 *
 * Both are derived from state that already exists rather than rolled independently, so what
 * the game says about you is always true. A news line that announced a derby in a round with
 * no derby, or called a poor season World Class, would be worse than no line at all.
 */

import { getLeague } from '../data'
import { getNation } from './internationals'
import type { PlayerCareer, SeasonRecord } from '../types/career'
import type { Rng } from './rng'

// ---------------------------------------------------------------------------
// Pre-match news
// ---------------------------------------------------------------------------

export interface NewsContext {
  career: PlayerCareer
  opponentName: string
  isHome: boolean
  round: number
  totalRounds: number
  /** Set when the fixture is a listed rivalry. */
  derbyName?: string
  /** The club's league position going in, if the table has one yet. */
  ladderPosition?: number
  teamCount?: number
}

/**
 * One line of build-up.
 *
 * Ordered by how much the reader would care: a derby beats a run of form, a run of form beats
 * a title race, and the generic lines only appear when nothing else is true.
 */
export function preMatchNews(context: NewsContext, rng: Rng): string {
  const { career, opponentName, isHome, round, totalRounds } = context
  const venue = isHome ? 'at home to' : 'away to'
  const league = getLeague(career.contract.leagueId)

  const lines: string[] = []

  if (context.derbyName) {
    lines.push(`${context.derbyName} week. Nobody in either squad needs the team talk.`)
    lines.push(`${context.derbyName}. Form goes out of the window for this one.`)
  }

  if (career.injury) {
    lines.push(`The medical staff are still not happy. ${career.injury.label} is being managed day to day.`)
  }

  if (career.form >= 78) {
    lines.push(`The press have noticed you. Every preview this week leads on your form.`)
    lines.push(`You are the name on the opposition analyst's whiteboard, ${venue} ${opponentName}.`)
  } else if (career.form <= 42) {
    lines.push(`A quiet run of games has the local paper asking questions about your place.`)
    lines.push(`The coach was asked about you in the press conference. He changed the subject.`)
  }

  if (career.isCaptain) {
    lines.push(`You lead them out ${venue} ${opponentName}.`)
  }

  const remaining = totalRounds - round
  if (context.ladderPosition && context.teamCount) {
    if (context.ladderPosition === 1 && remaining <= 4) {
      lines.push(`Top of the ${league.name} with ${remaining} to play. Everyone is watching now.`)
    } else if (context.ladderPosition >= context.teamCount - 1 && remaining <= 6) {
      lines.push(`${remaining} rounds left and the table makes grim reading. Something has to change.`)
    }
  }

  if (career.internationalCaps > 0 && career.form >= 70) {
    lines.push(`${getNation(career.nationId).name} selectors are in the stand.`)
  }

  if (round === 1) {
    lines.push(`Round one. Everything is still possible, ${venue} ${opponentName}.`)
  }
  if (remaining === 0) {
    lines.push(`The last round of the regular season, ${venue} ${opponentName}.`)
  }

  // Generic build-up, always available so there is never an empty line.
  lines.push(`${league.name}, round ${round}. ${isHome ? 'Home' : 'Away'} to ${opponentName}.`)
  lines.push(`A working week, ${venue} ${opponentName}. No fuss, no headlines.`)

  return rng.pick(lines)
}

// ---------------------------------------------------------------------------
// Season verdict
// ---------------------------------------------------------------------------

export type SeasonVerdict = 'World Class' | 'Solid' | 'Steady Performer' | 'Quiet Season'

export interface VerdictResult {
  verdict: SeasonVerdict
  line: string
}

/**
 * The banner the season review opens with.
 *
 * Driven by what the player actually did — rating first, because it is the one number that
 * survives a bad side, then involvement, because a brilliant six games is not a season.
 */
export function seasonVerdict(record: SeasonRecord, totalRounds: number): VerdictResult {
  const involvement = totalRounds > 0 ? record.appearances / totalRounds : 0
  const rating = record.avgRating

  if (involvement < 0.25 || record.appearances === 0) {
    return {
      verdict: 'Quiet Season',
      line:
        record.appearances === 0
          ? 'A season watched from the stand. It happens; it should not happen twice.'
          : `${record.appearances} appearances. Not the season you wanted.`,
    }
  }

  if (rating >= 7.4 && involvement >= 0.6) {
    return {
      verdict: 'World Class',
      line: `${record.avgRating.toFixed(1)} across ${record.appearances} games. Nobody had a better year in this shirt.`,
    }
  }

  if (rating >= 6.8) {
    return {
      verdict: 'Solid',
      line: `${record.avgRating.toFixed(1)} across ${record.appearances} games. A season the coach can build on.`,
    }
  }

  if (rating >= 6.0) {
    return {
      verdict: 'Steady Performer',
      line: `${record.appearances} games, ${record.avgRating.toFixed(1)} average. You did your job.`,
    }
  }

  return {
    verdict: 'Quiet Season',
    line: `${record.appearances} games at ${record.avgRating.toFixed(1)}. There is more in you than that.`,
  }
}
