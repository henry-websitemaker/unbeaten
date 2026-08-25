/**
 * Saves, schema versioning, and the Hall of Fame.
 *
 * SPEC §2.2 is the important part: the Hall of Fame ranks **only legitimate completed
 * 20-season careers**. Entries stored under any other format — the 10-season paths that
 * §2.7 deletes — must be migrated *out* of the ranked table rather than silently left in it
 * competing against careers twice their length. Unfinished careers still appear, but in a
 * clearly separate, unranked section.
 */

import { CAREER_SEASONS, type PlayerCareer } from '../types/career'
import { grossEarnings } from './economy'
import type { PositionId } from '../types/core'
import type { ManagerCareer } from './teamCareer'

/** Bump this whenever the stored shape changes, and add a step to MIGRATIONS. */
export const SCHEMA_VERSION = 3

export const STORAGE_KEY = 'unbeaten:save:v1'

export interface HallOfFameEntry {
  id: string
  name: string
  position: PositionId
  nationId: string
  /** How many seasons the career actually ran. */
  seasonsPlayed: number
  appearances: number
  tries: number
  points: number
  internationalCaps: number
  trophies: number
  earnings: number
  peakOvr: number
  /** Composite score. Only meaningful for completed careers. */
  careerScore: number
  /**
   * Whether this entry competes in the ranked table.
   *
   * False for anything that is not a completed 20-season career — an unfinished run, or an
   * entry stored under a superseded career length.
   */
  ranked: boolean
  /** Why an entry is unranked, shown in the unranked section. */
  unrankedReason?: string
}

export interface SaveState {
  schemaVersion: number
  playerCareer: PlayerCareer | null
  managerCareer: ManagerCareer | null
  hallOfFame: HallOfFameEntry[]
  /** Separate save slots per career mode (SPEC §3). */
  slots: {
    player: PlayerCareer | null
    manager: ManagerCareer | null
  }
}

export function emptySave(): SaveState {
  return {
    schemaVersion: SCHEMA_VERSION,
    playerCareer: null,
    managerCareer: null,
    hallOfFame: [],
    slots: { player: null, manager: null },
  }
}

// ---------------------------------------------------------------------------
// Career scoring
// ---------------------------------------------------------------------------

/**
 * Career score.
 *
 * SPEC §2.1 says the maths assumes a 20-season denominator, so per-season rates are
 * computed against `CAREER_SEASONS` rather than against however many seasons were actually
 * played. That is precisely why a 10-season entry cannot be ranked alongside a full one:
 * under this formula a short career is not merely worse, it is measured wrongly.
 */
export function careerScore(entry: Omit<HallOfFameEntry, 'careerScore' | 'ranked' | 'id'>): number {
  const perSeason = (value: number) => value / CAREER_SEASONS

  return Math.round(
    perSeason(entry.appearances) * 8 +
      perSeason(entry.tries) * 26 +
      perSeason(entry.internationalCaps) * 18 +
      entry.trophies * 40 +
      entry.peakOvr * 6 +
      perSeason(entry.earnings) / 25_000,
  )
}

export function buildHallOfFameEntry(career: PlayerCareer, id: string): HallOfFameEntry {
  const seasonsPlayed = career.history.length
  const peakOvr = career.history.reduce((best, h) => Math.max(best, h.ovrEnd), career.ovr)
  const complete = career.retired && seasonsPlayed >= CAREER_SEASONS

  const base = {
    name: career.name,
    position: career.position,
    nationId: career.nationId,
    seasonsPlayed,
    appearances: career.careerCaps,
    tries: career.careerTries,
    points: career.careerPoints,
    internationalCaps: career.internationalCaps,
    trophies: career.trophies.length,
    earnings: grossEarnings(career.ledger),
    peakOvr,
  }

  const entry: HallOfFameEntry = {
    id,
    ...base,
    careerScore: careerScore(base),
    ranked: complete,
  }

  if (!complete) {
    entry.unrankedReason =
      seasonsPlayed >= CAREER_SEASONS
        ? 'Career not formally retired'
        : `Unfinished — ${seasonsPlayed} of ${CAREER_SEASONS} seasons`
  }

  return entry
}

/** The ranked table: completed 20-season careers only, best first. */
export function rankedHallOfFame(entries: readonly HallOfFameEntry[]): HallOfFameEntry[] {
  return entries
    .filter((e) => e.ranked)
    .sort((a, b) => b.careerScore - a.careerScore || a.name.localeCompare(b.name))
}

/** Everything else, shown separately and clearly marked. */
export function unrankedHallOfFame(entries: readonly HallOfFameEntry[]): HallOfFameEntry[] {
  return entries
    .filter((e) => !e.ranked)
    .sort((a, b) => b.seasonsPlayed - a.seasonsPlayed || a.name.localeCompare(b.name))
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

type Migration = (state: Record<string, unknown>) => Record<string, unknown>

/**
 * Step 1 -> 2: entries used to store `seasons`; the field is now `seasonsPlayed`.
 */
const migrateV1toV2: Migration = (state) => {
  const entries = Array.isArray(state.hallOfFame) ? state.hallOfFame : []

  return {
    ...state,
    schemaVersion: 2,
    hallOfFame: entries.map((raw) => {
      const entry = raw as Record<string, unknown>
      const seasonsPlayed =
        (entry.seasonsPlayed as number | undefined) ??
        (entry.seasons as number | undefined) ??
        (entry.careerLength as number | undefined) ??
        0

      const { seasons: _seasons, careerLength: _careerLength, ...rest } = entry
      void _seasons
      void _careerLength
      return { ...rest, seasonsPlayed }
    }),
  }
}

/**
 * Step 2 -> 3: enforce SPEC §2.2.
 *
 * Anything that is not a completed 20-season career is moved out of the ranked table. This
 * is the migration the spec explicitly asks to be covered by a test against a store
 * containing old-format entries.
 */
const migrateV2toV3: Migration = (state) => {
  const entries = Array.isArray(state.hallOfFame) ? state.hallOfFame : []

  return {
    ...state,
    schemaVersion: 3,
    hallOfFame: entries.map((raw) => {
      const entry = raw as Record<string, unknown>
      const seasonsPlayed = (entry.seasonsPlayed as number | undefined) ?? 0
      const ranked = seasonsPlayed === CAREER_SEASONS

      const migrated: Record<string, unknown> = { ...entry, ranked }
      if (!ranked) {
        migrated.unrankedReason =
          seasonsPlayed > CAREER_SEASONS
            ? `Superseded format — ${seasonsPlayed} seasons`
            : `Unfinished — ${seasonsPlayed} of ${CAREER_SEASONS} seasons`
      } else {
        delete migrated.unrankedReason
      }
      return migrated
    }),
  }
}

/** Indexed by the version they upgrade *from*. */
const MIGRATIONS: Record<number, Migration> = {
  1: migrateV1toV2,
  2: migrateV2toV3,
}

export interface MigrationReport {
  from: number
  to: number
  /** Entries moved out of the ranked table. */
  demoted: number
  steps: number[]
}

export interface LoadResult {
  state: SaveState
  report: MigrationReport
}

/**
 * Bring a stored save up to the current schema.
 *
 * Unrecognised or corrupt input yields a fresh save rather than throwing — losing a save is
 * bad, but refusing to start the game is worse.
 */
export function migrate(raw: unknown): LoadResult {
  const fresh = emptySave()

  if (!raw || typeof raw !== 'object') {
    return { state: fresh, report: { from: 0, to: SCHEMA_VERSION, demoted: 0, steps: [] } }
  }

  let state = { ...(raw as Record<string, unknown>) }
  const from = typeof state.schemaVersion === 'number' ? state.schemaVersion : 1

  const rankedBefore = countRanked(state)
  const steps: number[] = []

  let version = from
  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version]
    if (!step) break
    state = step(state)
    steps.push(version)
    version = typeof state.schemaVersion === 'number' ? state.schemaVersion : version + 1
  }

  state.schemaVersion = SCHEMA_VERSION
  const rankedAfter = countRanked(state)

  return {
    state: normalise(state),
    report: {
      from,
      to: SCHEMA_VERSION,
      demoted: Math.max(0, rankedBefore - rankedAfter),
      steps,
    },
  }
}

function countRanked(state: Record<string, unknown>): number {
  const entries = Array.isArray(state.hallOfFame) ? state.hallOfFame : []
  return entries.filter((raw) => {
    const entry = raw as Record<string, unknown>
    // Before v3 there was no `ranked` flag — every stored entry was treated as ranked.
    return entry.ranked === undefined ? true : entry.ranked === true
  }).length
}

/** Fill in anything a partial or hand-edited save is missing. */
function normalise(state: Record<string, unknown>): SaveState {
  const fresh = emptySave()
  const entries = Array.isArray(state.hallOfFame) ? state.hallOfFame : []
  const slots = (state.slots as SaveState['slots'] | undefined) ?? fresh.slots

  return {
    schemaVersion: SCHEMA_VERSION,
    playerCareer: (state.playerCareer as PlayerCareer | null) ?? null,
    managerCareer: (state.managerCareer as ManagerCareer | null) ?? null,
    hallOfFame: entries.map((raw) => {
      const entry = raw as Record<string, unknown>
      const seasonsPlayed = (entry.seasonsPlayed as number | undefined) ?? 0
      return {
        id: (entry.id as string | undefined) ?? `legacy:${seasonsPlayed}:${entry.name ?? 'unknown'}`,
        name: (entry.name as string | undefined) ?? 'Unknown',
        position: (entry.position as PositionId | undefined) ?? 'FB',
        nationId: (entry.nationId as string | undefined) ?? 'unknown',
        seasonsPlayed,
        appearances: (entry.appearances as number | undefined) ?? 0,
        tries: (entry.tries as number | undefined) ?? 0,
        points: (entry.points as number | undefined) ?? 0,
        internationalCaps: (entry.internationalCaps as number | undefined) ?? 0,
        trophies: (entry.trophies as number | undefined) ?? 0,
        earnings: (entry.earnings as number | undefined) ?? 0,
        peakOvr: (entry.peakOvr as number | undefined) ?? 0,
        careerScore: (entry.careerScore as number | undefined) ?? 0,
        ranked: entry.ranked === true,
        ...(entry.unrankedReason ? { unrankedReason: entry.unrankedReason as string } : {}),
      }
    }),
    slots: {
      player: slots.player ?? null,
      manager: slots.manager ?? null,
    },
  }
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** Load and migrate. Never throws — a corrupt save yields a fresh one. */
export function loadSave(storage: StorageLike, key = STORAGE_KEY): LoadResult {
  let raw: unknown = null
  try {
    const text = storage.getItem(key)
    raw = text ? JSON.parse(text) : null
  } catch {
    raw = null
  }
  return migrate(raw)
}

export function writeSave(storage: StorageLike, state: SaveState, key = STORAGE_KEY): void {
  storage.setItem(key, JSON.stringify({ ...state, schemaVersion: SCHEMA_VERSION }))
}

export function clearSave(storage: StorageLike, key = STORAGE_KEY): void {
  storage.removeItem(key)
}

/** Add a finished career to the Hall of Fame. */
export function recordCareer(state: SaveState, career: PlayerCareer, id: string): SaveState {
  const entry = buildHallOfFameEntry(career, id)
  return {
    ...state,
    hallOfFame: [...state.hallOfFame.filter((e) => e.id !== id), entry],
  }
}

/** A leaderboard-safe view: ranked table plus the separate unranked section. */
export function hallOfFameView(state: SaveState): {
  ranked: HallOfFameEntry[]
  unranked: HallOfFameEntry[]
} {
  return {
    ranked: rankedHallOfFame(state.hallOfFame),
    unranked: unrankedHallOfFame(state.hallOfFame),
  }
}
