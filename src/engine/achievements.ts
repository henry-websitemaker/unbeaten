/**
 * Achievements.
 *
 * `achievements.json` stores its unlock conditions as JavaScript *source strings* —
 * `"e=>e.careerTries>=10"` — because that is how they survived the minified bundle. Running
 * them would mean `eval` or `new Function` on data, with no type safety and no way for the
 * compiler to catch a renamed field.
 *
 * So the strings are treated as documentation, and each id is backed by a real typed
 * predicate here. A test asserts the registry's keys are exactly the ids in the JSON, which
 * means an achievement cannot be added to the data without someone implementing it.
 */

import { ACHIEVEMENTS } from '../data'
import { grossEarnings } from './economy'
import type { PlayerCareer } from '../types/career'

export type AchievementTier = 'bronze' | 'silver' | 'gold' | 'legend'

export interface AchievementDef {
  id: string
  name: string
  tier: AchievementTier
  /** The original source string. Kept for reference; never executed. */
  check: string
}

export const ACHIEVEMENT_DEFS = ACHIEVEMENTS as unknown as AchievementDef[]

/** SPEC §3: the grid has four categories. */
export type AchievementCategory = 'milestones' | 'feats' | 'journey' | 'legend'

/** Everything a predicate is allowed to look at. */
export interface AchievementContext {
  careerTries: number
  careerCaps: number
  internationalCaps: number
  careerEarnings: number
  /** Best single-season MOTM count. */
  bestSeasonMOTM: number
  /** True if the player has ever finished top of a league's try-scoring chart. */
  wonTryScoringChart: boolean
  isCaptain: boolean
  awardTypes: string[]
  trophies: { type: string; name: string }[]
  history: { clubName: string; leagueId: string }[]
}

export function buildContext(career: PlayerCareer): AchievementContext {
  const motmBySeason = career.history.map((h) => h.motm)

  return {
    careerTries: career.careerTries,
    careerCaps: career.careerCaps,
    internationalCaps: career.internationalCaps,
    careerEarnings: grossEarnings(career.ledger),
    bestSeasonMOTM: motmBySeason.length > 0 ? Math.max(...motmBySeason) : 0,
    wonTryScoringChart: career.awards.some((a) => a.type === 'top_try_scorer'),
    isCaptain: career.isCaptain,
    awardTypes: career.awards.map((a) => a.type),
    trophies: career.trophies.map((t) => ({ type: t.type, name: t.name })),
    history: career.history.map((h) => ({ clubName: h.clubName, leagueId: h.leagueId })),
  }
}

type Predicate = (context: AchievementContext) => boolean

function distinctClubs(context: AchievementContext): number {
  return new Set(context.history.map((h) => h.clubName)).size
}

function distinctLeagues(context: AchievementContext): number {
  return new Set(context.history.map((h) => h.leagueId)).size
}

function longestSpellAtOneClub(context: AchievementContext): number {
  const bySeason = new Map<string, number>()
  for (const entry of context.history) {
    bySeason.set(entry.clubName, (bySeason.get(entry.clubName) ?? 0) + 1)
  }
  let longest = 0
  for (const seasons of bySeason.values()) longest = Math.max(longest, seasons)
  return longest
}

/**
 * The registry. Every id in `achievements.json` must appear here, and nothing else may.
 */
export const PREDICATES: Record<string, Predicate> = {
  tries_10: (e) => e.careerTries >= 10,
  tries_50: (e) => e.careerTries >= 50,
  tries_100: (e) => e.careerTries >= 100,

  apps_50: (e) => e.careerCaps >= 50,
  apps_100: (e) => e.careerCaps >= 100,
  apps_200: (e) => e.careerCaps >= 200,

  caps_10: (e) => e.internationalCaps >= 10,
  caps_50: (e) => e.internationalCaps >= 50,
  caps_100: (e) => e.internationalCaps >= 100,
  test_debut: (e) => e.internationalCaps >= 1,

  earnings_1m: (e) => e.careerEarnings >= 1_000_000,
  earnings_5m: (e) => e.careerEarnings >= 5_000_000,
  earnings_10m: (e) => e.careerEarnings >= 10_000_000,

  motm_5: (e) => e.bestSeasonMOTM >= 5,
  motm_10: (e) => e.bestSeasonMOTM >= 10,

  top_scorer: (e) => e.wonTryScoringChart,
  world_player: (e) => e.awardTypes.includes('world_player'),
  captain: (e) => e.isCaptain,

  journeys_3: (e) => distinctClubs(e) >= 3,
  journeys_5: (e) => distinctLeagues(e) >= 3,
  decade: (e) => longestSpellAtOneClub(e) >= 10,

  trophy_1: (e) => e.trophies.length >= 1,
  trophy_5: (e) => e.trophies.length >= 5,
  trophy_10: (e) => e.trophies.length >= 10,

  wc_winner: (e) =>
    e.trophies.some((t) => t.type === 'international' && t.name === 'World Cup'),

  legend: (e) => e.careerCaps >= 200 && e.trophies.length >= 5 && e.internationalCaps >= 50,
}

/** Which grid category an achievement belongs to (SPEC §3). */
export const CATEGORIES: Record<string, AchievementCategory> = {
  tries_10: 'milestones',
  tries_50: 'milestones',
  tries_100: 'milestones',
  apps_50: 'milestones',
  apps_100: 'milestones',
  apps_200: 'milestones',
  earnings_1m: 'milestones',
  earnings_5m: 'milestones',
  earnings_10m: 'milestones',

  motm_5: 'feats',
  motm_10: 'feats',
  top_scorer: 'feats',
  world_player: 'feats',
  captain: 'feats',

  test_debut: 'journey',
  caps_10: 'journey',
  caps_50: 'journey',
  caps_100: 'journey',
  journeys_3: 'journey',
  journeys_5: 'journey',
  decade: 'journey',

  trophy_1: 'legend',
  trophy_5: 'legend',
  trophy_10: 'legend',
  wc_winner: 'legend',
  legend: 'legend',
}

export interface AchievementStatus extends AchievementDef {
  category: AchievementCategory
  unlocked: boolean
}

/** Evaluate every achievement against a career. */
export function evaluateAchievements(career: PlayerCareer): AchievementStatus[] {
  const context = buildContext(career)
  return ACHIEVEMENT_DEFS.map((def) => ({
    ...def,
    category: CATEGORIES[def.id] ?? 'milestones',
    unlocked: PREDICATES[def.id]?.(context) ?? false,
  }))
}

/** The ids newly unlocked since the career last checked. */
export function newlyUnlocked(career: PlayerCareer): string[] {
  const already = new Set(career.achievements)
  return evaluateAchievements(career)
    .filter((a) => a.unlocked && !already.has(a.id))
    .map((a) => a.id)
}

export function groupByCategory(
  statuses: readonly AchievementStatus[],
): Record<AchievementCategory, AchievementStatus[]> {
  const grid: Record<AchievementCategory, AchievementStatus[]> = {
    milestones: [],
    feats: [],
    journey: [],
    legend: [],
  }
  for (const status of statuses) grid[status.category].push(status)
  return grid
}
