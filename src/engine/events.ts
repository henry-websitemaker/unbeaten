/**
 * Between-round events, from `events.json`.
 *
 * Roughly one round in four throws something at the player — a citing, a call from a rival
 * club, a washout. They are what stops a season being twenty identical rounds.
 */

import { EVENTS } from '../data'
import type { Rng } from './rng'
import type { StatKey } from '../types/core'
import type { TemporaryEffect } from '../types/career'

export type EventMode = 'player_career' | 'team_career'

export interface GameEvent {
  id: string
  name: string
  weight: number
  /** Present on events that only make sense in one mode. */
  mode?: string
  effect: {
    weeksSuspended?: [number, number]
    moraleModifier?: number
    formModifier?: number
    squadMoraleModifier?: number
    opponentMoraleModifier?: number
    matches?: number
    triggersMidSeasonOffer?: boolean
    opensEmergencySigning?: boolean
    statWeightOverride?: Partial<Record<StatKey, number>>
    cashBonus?: boolean
  }
}

interface EventData {
  rules: { chancePerRound: number; maxPerSeason: number }
  events: GameEvent[]
}

const DATA = EVENTS as unknown as EventData

export const ALL_EVENTS: readonly GameEvent[] = DATA.events
export const EVENT_RULES = DATA.rules

/** Events available in a given mode — some are manager-only. */
export function eventsForMode(mode: EventMode): GameEvent[] {
  return ALL_EVENTS.filter((e) => !e.mode || e.mode === mode)
}

/**
 * Decide whether an event fires this round, and which.
 *
 * `firedThisSeason` enforces the per-season cap from the data, so a bad run of luck cannot
 * bury the player under six citings.
 */
export function rollEvent(
  rng: Rng,
  mode: EventMode,
  firedThisSeason: number,
): GameEvent | null {
  if (firedThisSeason >= EVENT_RULES.maxPerSeason) return null
  if (!rng.bool(EVENT_RULES.chancePerRound)) return null

  const pool = eventsForMode(mode)
  if (pool.length === 0) return null
  return rng.weighted(pool, (e) => e.weight)
}

export interface EventOutcome {
  event: GameEvent
  /** A suspension, if this event carries one. */
  weeksSuspended: number
  /** Temporary form/morale effects to attach to the player. */
  effects: TemporaryEffect[]
  /** Weather-style re-weighting to apply to the next match. */
  statWeightOverride?: Partial<Record<StatKey, number>>
  /** Signals for the career layer to act on. */
  triggersMidSeasonOffer: boolean
  cashBonus: boolean
  /** One line for the match log. */
  description: string
}

export function resolveEvent(event: GameEvent, rng: Rng): EventOutcome {
  const effects: TemporaryEffect[] = []
  const e = event.effect

  if (e.formModifier !== undefined || e.moraleModifier !== undefined) {
    const temporary: TemporaryEffect = {
      id: event.id,
      label: event.name,
      matchesRemaining: e.matches ?? 2,
    }
    if (e.formModifier !== undefined) temporary.formModifier = e.formModifier
    if (e.moraleModifier !== undefined) temporary.moraleModifier = e.moraleModifier
    effects.push(temporary)
  }

  const weeksSuspended = e.weeksSuspended
    ? rng.int(e.weeksSuspended[0], e.weeksSuspended[1])
    : 0

  const outcome: EventOutcome = {
    event,
    weeksSuspended,
    effects,
    triggersMidSeasonOffer: e.triggersMidSeasonOffer === true,
    cashBonus: e.cashBonus === true,
    description: describe(event, weeksSuspended),
  }

  if (e.statWeightOverride) outcome.statWeightOverride = e.statWeightOverride
  return outcome
}

function describe(event: GameEvent, weeksSuspended: number): string {
  if (weeksSuspended > 0) {
    return `${event.name} — ${weeksSuspended} week${weeksSuspended === 1 ? '' : 's'} suspended`
  }
  return event.name
}

// ---------------------------------------------------------------------------
// Temporary effects
// ---------------------------------------------------------------------------

/** Tick every attached effect down by one match, dropping those that have run out. */
export function advanceEffects(effects: readonly TemporaryEffect[]): TemporaryEffect[] {
  return effects
    .map((e) => ({ ...e, matchesRemaining: e.matchesRemaining - 1 }))
    .filter((e) => e.matchesRemaining > 0)
}

export interface EffectTotals {
  form: number
  morale: number
  selectionPenalty: number
}

/** Combined modifier from everything currently attached. */
export function totalEffects(effects: readonly TemporaryEffect[]): EffectTotals {
  const totals: EffectTotals = { form: 0, morale: 0, selectionPenalty: 0 }
  for (const effect of effects) {
    totals.form += effect.formModifier ?? 0
    totals.morale += effect.moraleModifier ?? 0
    totals.selectionPenalty += effect.selectionPenalty ?? 0
  }
  return totals
}

/**
 * Shorten a form slump.
 *
 * The Sports Psychologist halves slump duration, so this is applied when the effect is
 * attached rather than every time it ticks.
 */
export function applySlumpReduction(
  effects: readonly TemporaryEffect[],
  slumpDurationMultiplier: number,
): TemporaryEffect[] {
  if (slumpDurationMultiplier >= 1) return [...effects]
  return effects.map((effect) => {
    const isSlump = (effect.formModifier ?? 0) < 0 || (effect.moraleModifier ?? 0) < 0
    if (!isSlump) return { ...effect }
    return {
      ...effect,
      matchesRemaining: Math.max(1, Math.round(effect.matchesRemaining * slumpDurationMultiplier)),
    }
  })
}
