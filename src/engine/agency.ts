/**
 * Match agency (SPEC §3).
 *
 * "At most two skippable, stat-driven decisions per match." All three words matter:
 *
 * - **At most two.** `MAX_DECISIONS_PER_MATCH` is the hard cap and a test holds it.
 * - **Skippable.** Declining is a genuine no-op — no modifier, no effect, no penalty. The
 *   safe option is always available and always positive, so a decision is never a trap.
 * - **Stat-driven.** The odds come from the stats the call actually tests, and are shown to
 *   the player *before* they choose.
 *
 * A decision reaches the match through the hooks `MatchModifiers` already exposes — a rating
 * bonus for the player and a strength nudge for the club — and a failed call costs form or
 * morale through a `TemporaryEffect`. It can never touch stats, OVR or traits. That is the
 * same guarantee the wheel makes, and it is tested the same way.
 *
 * Which situations a player is offered is decided by their stat block rather than a hardcoded
 * list of positions: a prop is never asked to take a shot at goal because a prop has no KCK.
 */

import type { TemporaryEffect } from '../types/career'
import type { StatBlock, StatKey } from '../types/core'
import type { MatchModifiers } from '../types/match'
import type { Rng } from './rng'

/** SPEC §3 caps this at two. */
export const MAX_DECISIONS_PER_MATCH = 2

/** The odds are never a certainty and never hopeless. */
export const MIN_SUCCESS_CHANCE = 0.25
export const MAX_SUCCESS_CHANCE = 0.9

/** How sharply the odds respond to being better than the moment demands. */
const ODDS_SCALE = 8

export interface DecisionEffect {
  /** Added to the player's match rating. */
  ratingBonus?: number
  /** Added to the club's effective strength for this match. */
  clubStrengthDelta?: number
  /** A temporary knock — form or morale, expiring. Never anything permanent. */
  formModifier?: number
  moraleModifier?: number
  /** Matches the knock lasts. */
  matches?: number
}

export interface DecisionOptionDef {
  id: string
  label: string
  detail: string
  /**
   * The stats the call is judged on. Empty means it always comes off — the safe option.
   */
  stats: readonly StatKey[]
  /** The stat level at which this is an even-money call. */
  difficulty: number
  onSuccess: DecisionEffect
  successLabel: string
  onFailure: DecisionEffect
  failureLabel: string
}

export interface SituationDef {
  id: string
  title: string
  prompt: string
  options: readonly DecisionOptionDef[]
}

/**
 * The situations.
 *
 * Every one offers a safe option that costs nothing, so declining and playing it safe are
 * both real choices rather than punishments.
 */
export const SITUATIONS: readonly SituationDef[] = [
  {
    id: 'kick_at_goal',
    title: 'Penalty, 42 metres out',
    prompt: 'Into the wind, three points on offer, or the corner and a shot at seven.',
    options: [
      {
        id: 'take_the_three',
        label: 'Take the three',
        detail: 'Simple, and nobody ever got dropped for it.',
        stats: [],
        difficulty: 0,
        onSuccess: { ratingBonus: 0.15, clubStrengthDelta: 0.4 },
        successLabel: 'Straight through the middle. Three points.',
        onFailure: {},
        failureLabel: '',
      },
      {
        id: 'go_for_the_corner',
        label: 'Kick to the corner',
        detail: 'Backs yourself to find touch five metres out.',
        stats: ['KCK'],
        difficulty: 72,
        onSuccess: { ratingBonus: 0.7, clubStrengthDelta: 1.6 },
        successLabel: 'Dead on the five-metre line, and the maul does the rest.',
        onFailure: { formModifier: -5, matches: 2 },
        failureLabel: 'Straight into the in-goal. Twenty-two drop-out, nothing gained.',
      },
    ],
  },
  {
    id: 'lineout_call',
    title: 'Your call at the lineout',
    prompt: 'Five metres out, one point behind, the clock in the red.',
    options: [
      {
        id: 'front_ball',
        label: 'Front ball',
        detail: 'The safe throw. Secure it and go through the phases.',
        stats: [],
        difficulty: 0,
        onSuccess: { ratingBonus: 0.15, clubStrengthDelta: 0.4 },
        successLabel: 'Clean take at the front, and the pack sets itself.',
        onFailure: {},
        failureLabel: '',
      },
      {
        id: 'back_of_the_lineout',
        label: 'Throw to the tail',
        detail: 'Longer, riskier, and it puts you over the line if it lands.',
        stats: ['LNO'],
        difficulty: 74,
        onSuccess: { ratingBonus: 0.8, clubStrengthDelta: 1.8 },
        successLabel: 'Right over the tail, driven, and grounded.',
        onFailure: { formModifier: -6, matches: 2 },
        failureLabel: 'Overthrown. Scrappy ball and the chance is gone.',
      },
    ],
  },
  {
    id: 'scrum_shove',
    title: 'Scrum on their line',
    prompt: 'The eight is set and their tighthead is struggling.',
    options: [
      {
        id: 'use_it',
        label: 'Use it',
        detail: 'Get the ball away and play what is in front of you.',
        stats: [],
        difficulty: 0,
        onSuccess: { ratingBonus: 0.15, clubStrengthDelta: 0.4 },
        successLabel: 'Quick ball away and the backs go through their shapes.',
        onFailure: {},
        failureLabel: '',
      },
      {
        id: 'shove',
        label: 'Hold it and shove',
        detail: 'Go after the pushover, and the penalty if it comes.',
        stats: ['SCR'],
        difficulty: 73,
        onSuccess: { ratingBonus: 0.75, clubStrengthDelta: 1.7 },
        successLabel: 'Marched them back ten metres. Penalty, and a word from the referee.',
        onFailure: { formModifier: -5, moraleModifier: -4, matches: 2 },
        failureLabel: 'Wheeled and turned over. Scrum the other way.',
      },
    ],
  },
  {
    id: 'break_or_pass',
    title: 'A gap opens',
    prompt: 'Their winger has come in and there is grass outside him.',
    options: [
      {
        id: 'give_the_pass',
        label: 'Give the pass',
        detail: 'The right ball, and the support runner is screaming for it.',
        stats: [],
        difficulty: 0,
        onSuccess: { ratingBonus: 0.2, clubStrengthDelta: 0.4 },
        successLabel: 'Hands it on and the move goes on.',
        onFailure: {},
        failureLabel: '',
      },
      {
        id: 'back_yourself',
        label: 'Back yourself',
        detail: 'Take him on the outside and go.',
        stats: ['PAC', 'EVA'],
        difficulty: 74,
        onSuccess: { ratingBonus: 0.9, clubStrengthDelta: 1.5 },
        successLabel: 'Gone. Nobody laid a hand on you.',
        onFailure: { formModifier: -5, matches: 2 },
        failureLabel: 'Shut down in the tackle, and the support runner is furious.',
      },
    ],
  },
  {
    id: 'big_hit',
    title: 'Their ten has the ball',
    prompt: 'He is standing flat and you can get off the line at him.',
    options: [
      {
        id: 'hold_the_line',
        label: 'Hold the line',
        detail: 'Stay connected and make the tackle that is on.',
        stats: [],
        difficulty: 0,
        onSuccess: { ratingBonus: 0.15, clubStrengthDelta: 0.4 },
        successLabel: 'Solid, low, and the line stays intact.',
        onFailure: {},
        failureLabel: '',
      },
      {
        id: 'shoot_out_of_the_line',
        label: 'Shoot out of the line',
        detail: 'Take his head off and the ball with it.',
        stats: ['TCK'],
        difficulty: 74,
        onSuccess: { ratingBonus: 0.85, clubStrengthDelta: 1.5 },
        successLabel: 'Dumped him. The ball spills and the crowd is up.',
        onFailure: { formModifier: -6, moraleModifier: -4, matches: 2 },
        failureLabel: 'He steps inside you and there is nobody behind.',
      },
    ],
  },
  {
    id: 'ruck_decision',
    title: 'Ball on the deck',
    prompt: 'Their nine is over it and the referee is watching the ruck.',
    options: [
      {
        id: 'clear_out',
        label: 'Clear him out',
        detail: 'The percentage play. Secure your own ball.',
        stats: [],
        difficulty: 0,
        onSuccess: { ratingBonus: 0.15, clubStrengthDelta: 0.4 },
        successLabel: 'Cleaned out, ball secured, on to the next phase.',
        onFailure: {},
        failureLabel: '',
      },
      {
        id: 'go_for_the_jackal',
        label: 'Go for the jackal',
        detail: 'Get over it, get your hands on it, and win the penalty.',
        stats: ['RUK'],
        difficulty: 74,
        onSuccess: { ratingBonus: 0.85, clubStrengthDelta: 1.6 },
        successLabel: 'Over the ball, hands on, and the arm goes up.',
        onFailure: { formModifier: -5, matches: 2 },
        failureLabel: 'Penalised for holding on. Three points the other way.',
      },
    ],
  },
  {
    id: 'tap_and_go',
    title: 'Penalty in front of the posts',
    prompt: 'Two minutes left, seven behind, and the referee has his arm out.',
    options: [
      {
        id: 'set_the_scrum',
        label: 'Scrum',
        detail: 'Keep the pressure on and back the pack.',
        stats: [],
        difficulty: 0,
        onSuccess: { ratingBonus: 0.2, clubStrengthDelta: 0.5 },
        successLabel: 'Scrum set, pressure maintained.',
        onFailure: {},
        failureLabel: '',
      },
      {
        id: 'tap_it',
        label: 'Tap and go',
        detail: 'They are not set. Take it quickly and see what is on.',
        stats: ['VIS', 'HND'],
        difficulty: 73,
        onSuccess: { ratingBonus: 0.9, clubStrengthDelta: 1.7 },
        successLabel: 'Caught them cold. Over in the corner before they had a line.',
        onFailure: { formModifier: -5, moraleModifier: -5, matches: 2 },
        failureLabel: 'Isolated, turned over, and the chance has gone with it.',
      },
    ],
  },
  {
    id: 'play_on',
    title: 'You have taken a knock',
    prompt: 'Nothing is torn, but the leg is not right and there are twenty minutes left.',
    options: [
      {
        id: 'take_the_change',
        label: 'Signal to the bench',
        detail: 'Come off, take no chances.',
        stats: [],
        difficulty: 0,
        onSuccess: {},
        successLabel: 'Off you come. Nothing gained, nothing lost.',
        onFailure: {},
        failureLabel: '',
      },
      {
        id: 'play_through_it',
        label: 'Play through it',
        detail: 'Run it off. The side needs you on the pitch.',
        stats: ['FIT'],
        difficulty: 75,
        onSuccess: { ratingBonus: 0.7, clubStrengthDelta: 1.2 },
        successLabel: 'Ran it off, and saw the game out.',
        onFailure: { formModifier: -8, matches: 3 },
        failureLabel: 'It went from bad to worse. You should have come off.',
      },
    ],
  },
  {
    id: 'carry_into_traffic',
    title: 'One out from the ruck',
    prompt: 'Three defenders in front of you and the forwards are slow to fold.',
    options: [
      {
        id: 'take_the_contact',
        label: 'Take the contact',
        detail: 'Get over the gainline and present it.',
        stats: [],
        difficulty: 0,
        onSuccess: { ratingBonus: 0.15, clubStrengthDelta: 0.4 },
        successLabel: 'Two metres, ball back, nothing flashy.',
        onFailure: {},
        failureLabel: '',
      },
      {
        id: 'power_through',
        label: 'Go through him',
        detail: 'Pick the smallest one and run over the top of him.',
        stats: ['CAR'],
        difficulty: 74,
        onSuccess: { ratingBonus: 0.8, clubStrengthDelta: 1.5 },
        successLabel: 'Straight through the chest and ten metres upfield.',
        onFailure: { formModifier: -5, matches: 2 },
        failureLabel: 'Held up, driven back, and the ball is slow.',
      },
    ],
  },
]

// ---------------------------------------------------------------------------
// Odds
// ---------------------------------------------------------------------------

function meanStat(stats: StatBlock, keys: readonly StatKey[]): number {
  if (keys.length === 0) return 0
  let total = 0
  for (const key of keys) total += stats[key] ?? 0
  return total / keys.length
}

/**
 * The chance an option comes off, from the stats it actually tests.
 *
 * A logistic on the gap between the player and the moment, clamped at both ends: a great
 * player is never certain and a poor one is never without a chance.
 */
export function successChance(stats: StatBlock, option: DecisionOptionDef): number {
  if (option.stats.length === 0) return 1
  const level = meanStat(stats, option.stats)
  const raw = 1 / (1 + Math.exp(-(level - option.difficulty) / ODDS_SCALE))
  return Math.min(MAX_SUCCESS_CHANCE, Math.max(MIN_SUCCESS_CHANCE, raw))
}

/** A situation is only offered to a player whose position is judged on those stats. */
export function isEligible(stats: StatBlock, situation: SituationDef): boolean {
  return situation.options.every((option) =>
    option.stats.every((stat) => stats[stat] !== undefined),
  )
}

export function situationsFor(stats: StatBlock): SituationDef[] {
  return SITUATIONS.filter((situation) => isEligible(stats, situation))
}

// ---------------------------------------------------------------------------
// Rolling and resolving
// ---------------------------------------------------------------------------

export interface OfferedOption extends DecisionOptionDef {
  /** Shown on the card before the player chooses (SPEC §3: stat-driven). */
  chance: number
}

export interface OfferedDecision {
  situationId: string
  title: string
  prompt: string
  options: OfferedOption[]
}

/**
 * Which decisions this match presents. Between zero and `MAX_DECISIONS_PER_MATCH`.
 */
export function rollDecisions(rng: Rng, stats: StatBlock): OfferedDecision[] {
  const eligible = situationsFor(stats)
  if (eligible.length === 0) return []

  const count = Math.min(
    MAX_DECISIONS_PER_MATCH,
    rng.bool(0.35) ? 0 : rng.bool(0.7) ? 1 : 2,
    eligible.length,
  )

  const pool = [...eligible]
  const chosen: OfferedDecision[] = []
  for (let i = 0; i < count; i++) {
    const index = rng.int(0, pool.length - 1)
    const situation = pool.splice(index, 1)[0]!
    chosen.push({
      situationId: situation.id,
      title: situation.title,
      prompt: situation.prompt,
      options: situation.options.map((option) => ({
        ...option,
        chance: successChance(stats, option),
      })),
    })
  }
  return chosen
}

export interface ResolvedDecision {
  situationId: string
  optionId: string
  optionLabel: string
  chance: number
  succeeded: boolean
  /** The line to show the player afterwards, and in the match log. */
  outcome: string
  effect: DecisionEffect
}

/** Take a decision. Deterministic for a given rng stream. */
export function resolveDecision(
  rng: Rng,
  stats: StatBlock,
  situationId: string,
  optionId: string,
): ResolvedDecision | null {
  const situation = SITUATIONS.find((s) => s.id === situationId)
  const option = situation?.options.find((o) => o.id === optionId)
  if (!situation || !option) return null

  const chance = successChance(stats, option)
  const succeeded = option.stats.length === 0 ? true : rng.bool(chance)

  return {
    situationId,
    optionId,
    optionLabel: option.label,
    chance,
    succeeded,
    outcome: succeeded ? option.successLabel : option.failureLabel,
    effect: succeeded ? option.onSuccess : option.onFailure,
  }
}

// ---------------------------------------------------------------------------
// Feeding the match
// ---------------------------------------------------------------------------

/**
 * Turn resolved decisions into match modifiers.
 *
 * Only the rating bonus and the club's strength move, both for this match alone. Nothing
 * here can reach a stat, an OVR or a trait.
 */
export function agencyModifiers(
  decisions: readonly ResolvedDecision[],
  playerId: string,
  isHome: boolean,
): MatchModifiers {
  let rating = 0
  let strength = 0
  for (const decision of decisions) {
    rating += decision.effect.ratingBonus ?? 0
    strength += decision.effect.clubStrengthDelta ?? 0
  }

  const mods: MatchModifiers = {}
  if (rating !== 0) mods.ratingBonus = new Map([[playerId, rating]])
  if (strength !== 0) {
    if (isHome) mods.homeStrengthDelta = strength
    else mods.awayStrengthDelta = strength
  }
  return mods
}

/**
 * The temporary cost of a call that did not come off.
 *
 * Form and morale only, with a match counter — the same shape the between-round events use,
 * so it expires through the machinery that already exists.
 */
export function agencyEffects(decisions: readonly ResolvedDecision[]): TemporaryEffect[] {
  const effects: TemporaryEffect[] = []
  for (const decision of decisions) {
    const { formModifier, moraleModifier, matches } = decision.effect
    if (!formModifier && !moraleModifier) continue
    effects.push({
      id: `agency:${decision.situationId}:${decision.optionId}`,
      label: decision.optionLabel,
      ...(formModifier ? { formModifier } : {}),
      ...(moraleModifier ? { moraleModifier } : {}),
      matchesRemaining: matches ?? 2,
    })
  }
  return effects
}
