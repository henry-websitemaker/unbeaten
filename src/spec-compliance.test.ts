/**
 * SPEC §2.7 guard.
 *
 * The spec is explicit that the superseded systems must be *deleted, not disabled*. In a
 * rebuild there is nothing to delete, so the risk is the opposite one: quietly
 * reintroducing them. This scans the source tree and fails if any of them reappear.
 *
 * It also pins the two global rules that are easy to violate one file at a time — the fixed
 * 20-season career, and league lengths never being written as literals.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LEAGUE_LIST } from './data'
import { CAREER_SEASONS } from './types/career'

const SRC = fileURLToPath(new URL('.', import.meta.url))

function sourceFiles(dir = SRC): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full))
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

/**
 * Comments are stripped before scanning.
 *
 * The question is whether a banned *system* exists, not whether the word appears. Prose
 * like "manual training is gone" is the code documenting its own compliance, and flagging
 * it would push the next person to delete the explanation rather than the system.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1 ')
}

function scannableFiles(): { path: string; text: string }[] {
  return sourceFiles()
    .filter((path) => !path.endsWith('spec-compliance.test.ts'))
    .map((path) => ({
      // Normalised so assertions read the same on Windows and CI.
      path: relative(SRC, path).replaceAll('\\', '/'),
      text: readFileSync(path, 'utf8'),
    }))
}

/** Implementation files only — a test may legitimately name a system in order to ban it. */
function implementationFiles(): { path: string; text: string }[] {
  return scannableFiles()
    .filter((file) => !file.path.includes('.test.'))
    .map((file) => ({ path: file.path, text: stripComments(file.text) }))
}

describe('SPEC §2.7 — superseded systems must not exist', () => {
  const banned: { label: string; pattern: RegExp }[] = [
    { label: 'manual training / Summer Plans attribute step', pattern: /\btraining\b|\btrainPlayer\b|\bTrainingScreen\b/i },
    { label: 'points shop', pattern: /points?[-_ ]?shop|spendPoints|skillPoints/i },
    { label: 'development environment model', pattern: /development[-_ ]?environment|devEnvironment/i },
    { label: '10-season career path', pattern: /10[-_ ]?season|tenSeason/i },
    { label: 'Long Career toggle', pattern: /long[-_ ]?career/i },
  ]

  for (const { label, pattern } of banned) {
    it(`has no trace of ${label}`, () => {
      const offenders = implementationFiles()
        .filter((file) => pattern.test(file.text))
        .map((file) => file.path)
      expect(offenders, `${label} reappeared in: ${offenders.join(', ')}`).toEqual([])
    })
  }

  it('has no permanent-loss wheel outcome in the data', async () => {
    const { WHEEL } = await import('./data')
    const outcomes = (WHEEL as { outcomes: { type: string; permanent: boolean }[] }).outcomes
    for (const outcome of outcomes) {
      if (outcome.type === 'negative') expect(outcome.permanent).toBe(false)
    }
  })
})

describe('SPEC §2.1 — career length is fixed at 20', () => {
  it('exports exactly 20', () => {
    expect(CAREER_SEASONS).toBe(20)
  })

  it('is defined once and imported everywhere else', () => {
    const definitions = scannableFiles().filter((file) =>
      /(?:const|let|var)\s+CAREER_SEASONS\s*=/.test(file.text),
    )
    expect(definitions.map((f) => f.path)).toEqual(['types/career.ts'])
  })
})

describe('SPEC §2.3 — league lengths are never hardcoded', () => {
  it('keeps every round count in the data file only', () => {
    // The distinct round counts that appear in leagues.json.
    const roundCounts = [...new Set(LEAGUE_LIST.map((l) => l.rounds))]
    expect(roundCounts.length).toBeGreaterThan(1)

    // An engine file that compared a league to a literal round count would look like
    // `rounds === 18` or `rounds > 26`. Test files legitimately assert against them.
    const engineFiles = scannableFiles().filter(
      (file) => file.path.startsWith('engine') && !file.path.includes('.test.'),
    )

    for (const file of engineFiles) {
      for (const count of roundCounts) {
        const pattern = new RegExp(`rounds\\s*(?:===|==|>=|<=|>|<|!==)\\s*${count}\\b`)
        expect(pattern.test(file.text), `${file.path} compares rounds to the literal ${count}`).toBe(
          false,
        )
      }
    }
  })

  it('agrees that perfectTarget is rounds + finalsRounds for all 8 leagues', () => {
    for (const league of LEAGUE_LIST) {
      expect(league.perfectTarget).toBe(league.rounds + league.finalsRounds)
    }
  })
})
