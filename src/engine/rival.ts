/**
 * The rival.
 *
 * One AI player, generated alongside the career, who is deliberately close enough in
 * ability that the comparison stays live for twenty seasons. SPEC §3 wants a head-to-head
 * view throughout and a verdict at retirement.
 */

import { generatePlayer } from './generate'
import { generateName, regionForLeague } from './names'
import { getLeague } from '../data'
import { rngFor } from './rng'
import type { LeagueId, PositionId, StatBlock } from '../types/core'
import type { PlayerCareer } from '../types/career'

export interface Rival {
  id: string
  name: string
  position: PositionId
  nationId: string
  clubName: string
  leagueId: LeagueId
  age: number
  stats: StatBlock
  ovr: number
  caps: number
  tries: number
  internationalCaps: number
  trophies: number
  /** Season-by-season, mirroring the player's own history. */
  history: { season: number; ovr: number; caps: number; tries: number; avgRating: number }[]
}

/**
 * Create the rival at career creation.
 *
 * Same position, so the comparison is like-for-like, and a shade stronger at the start —
 * they were the one everybody was talking about.
 */
export function createRival(
  seed: number,
  position: PositionId,
  startingOvr: number,
  leagueId: LeagueId,
): Rival {
  const rng = rngFor(seed, 'rival')
  const player = generatePlayer(rng, 'rival', {
    position,
    leagueId,
    targetOvr: Math.min(70, startingOvr + rng.int(1, 4)),
    age: 19,
    name: generateName(rng, regionForLeague(rng, leagueId)),
  })

  return {
    id: 'rival',
    name: player.name,
    position,
    nationId: 'unknown',
    clubName: getLeague(leagueId).name,
    leagueId,
    age: player.age,
    stats: player.stats,
    ovr: player.ovr,
    caps: 0,
    tries: 0,
    internationalCaps: 0,
    trophies: 0,
    history: [],
  }
}

/**
 * Advance the rival one season.
 *
 * Their trajectory is independent of the player's — they are not rubber-banded to stay
 * level, because a rival you cannot decisively beat is not a rival.
 */
export function advanceRival(rival: Rival, seed: number, season: number): Rival {
  const rng = rngFor(seed, 'rival-season', season)

  // A career arc of their own, peaking around 28.
  const yearsToPeak = 28 - rival.age
  const growth =
    yearsToPeak > 0 ? rng.float(0.6, 2.4) : rng.float(-2.6, -0.2) * (rival.age > 32 ? 1.5 : 1)

  const ovr = Math.max(40, Math.min(95, Math.round(rival.ovr + growth)))
  const appearances = rng.int(10, 24)
  const avgRating = Math.max(4, Math.min(9.6, rng.gaussian(5.6 + ovr * 0.025, 0.5)))
  const tries = Math.max(0, Math.round(rng.gaussian(appearances * (ovr - 55) * 0.008, 2)))

  // Test recognition once they are genuinely good.
  const internationalCaps = ovr >= 76 ? rng.int(2, 9) : 0
  const trophies = rng.bool(Math.max(0, (ovr - 70) / 120)) ? 1 : 0

  return {
    ...rival,
    age: rival.age + 1,
    ovr,
    caps: rival.caps + appearances,
    tries: rival.tries + tries,
    internationalCaps: rival.internationalCaps + internationalCaps,
    trophies: rival.trophies + trophies,
    history: [
      ...rival.history,
      { season, ovr, caps: appearances, tries, avgRating: Math.round(avgRating * 100) / 100 },
    ],
  }
}

export interface HeadToHead {
  metric: string
  player: number
  rival: number
  playerAhead: boolean
}

export function headToHead(career: PlayerCareer, rival: Rival): HeadToHead[] {
  const rows: [string, number, number][] = [
    ['OVR', career.ovr, rival.ovr],
    ['Appearances', career.careerCaps, rival.caps],
    ['Tries', career.careerTries, rival.tries],
    ['Test caps', career.internationalCaps, rival.internationalCaps],
    ['Trophies', career.trophies.length, rival.trophies],
  ]

  return rows.map(([metric, player, rivalValue]) => ({
    metric,
    player,
    rival: rivalValue,
    playerAhead: player >= rivalValue,
  }))
}

export interface RivalVerdict {
  playerWon: boolean
  categoriesWon: number
  categoriesTotal: number
  verdict: string
}

/** The verdict at retirement (SPEC §3). */
export function rivalVerdict(career: PlayerCareer, rival: Rival): RivalVerdict {
  const rows = headToHead(career, rival)
  const won = rows.filter((r) => r.playerAhead).length

  let verdict: string
  if (won === rows.length) {
    verdict = `You beat ${rival.name} in every category. There was never really an argument.`
  } else if (won > rows.length / 2) {
    verdict = `You finish ahead of ${rival.name} on ${won} of ${rows.length} counts. History will call it yours.`
  } else if (won === rows.length / 2) {
    verdict = `Nothing separates you and ${rival.name}. Two careers, one argument, no answer.`
  } else if (won > 0) {
    verdict = `${rival.name} edges it, ${rows.length - won} categories to ${won}. You will hear about it.`
  } else {
    verdict = `${rival.name} beat you at everything. Somebody has to be the other one.`
  }

  return { playerWon: won > rows.length / 2, categoriesWon: won, categoriesTotal: rows.length, verdict }
}
