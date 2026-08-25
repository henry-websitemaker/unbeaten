import { describe, it, expect } from 'vitest'
import { createRng, rngFor, hashString } from './rng'

describe('createRng', () => {
  it('is deterministic for a given seed', () => {
    const a = createRng(12345)
    const b = createRng(12345)
    const seqA = Array.from({ length: 50 }, () => a.next())
    const seqB = Array.from({ length: 50 }, () => b.next())
    expect(seqA).toEqual(seqB)
  })

  it('produces different streams for adjacent seeds', () => {
    const a = Array.from({ length: 20 }, (_, i) => createRng(i).next())
    // Adjacent seeds must not produce adjacent values — this is what mix32 is for.
    expect(new Set(a).size).toBe(20)
  })

  it('stays in [0, 1)', () => {
    const rng = createRng(7)
    for (let i = 0; i < 10_000; i++) {
      const v = rng.next()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('int is inclusive at both ends', () => {
    const rng = createRng(99)
    const seen = new Set<number>()
    for (let i = 0; i < 5_000; i++) seen.add(rng.int(1, 6))
    expect([...seen].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('int(n, n) returns n', () => {
    expect(createRng(1).int(4, 4)).toBe(4)
  })

  it('int throws when max < min', () => {
    expect(() => createRng(1).int(5, 2)).toThrow()
  })

  it('bool respects its probability', () => {
    const rng = createRng(2024)
    let hits = 0
    const n = 20_000
    for (let i = 0; i < n; i++) if (rng.bool(0.25)) hits++
    expect(hits / n).toBeGreaterThan(0.23)
    expect(hits / n).toBeLessThan(0.27)
  })

  it('pick throws on an empty array', () => {
    expect(() => createRng(1).pick([])).toThrow('empty array')
  })

  it('shuffle permutes without mutating the input', () => {
    const source = [1, 2, 3, 4, 5, 6, 7, 8]
    const frozen = source.slice()
    const out = createRng(5).shuffle(source)
    expect(source).toEqual(frozen)
    expect(out).not.toBe(source)
    expect(out.slice().sort((a, b) => a - b)).toEqual(frozen)
  })

  it('weighted respects the weights', () => {
    const rng = createRng(31)
    const items = [
      { id: 'a', w: 50 },
      { id: 'b', w: 35 },
      { id: 'c', w: 15 },
    ]
    const counts: Record<string, number> = { a: 0, b: 0, c: 0 }
    const n = 40_000
    for (let i = 0; i < n; i++) counts[rng.weighted(items, (x) => x.w).id]!++
    expect(counts.a! / n).toBeCloseTo(0.5, 1)
    expect(counts.b! / n).toBeCloseTo(0.35, 1)
    expect(counts.c! / n).toBeCloseTo(0.15, 1)
  })

  it('weighted skips zero-weight items entirely', () => {
    const rng = createRng(8)
    const items = [
      { id: 'never', w: 0 },
      { id: 'always', w: 1 },
    ]
    for (let i = 0; i < 500; i++) expect(rng.weighted(items, (x) => x.w).id).toBe('always')
  })

  it('weighted throws when nothing can be picked', () => {
    expect(() => createRng(1).weighted([{ w: 0 }], (x) => x.w)).toThrow()
  })

  it('gaussian centres on the mean and stays bounded', () => {
    const rng = createRng(404)
    const n = 20_000
    let sum = 0
    for (let i = 0; i < n; i++) {
      const v = rng.gaussian(50, 10)
      expect(v).toBeGreaterThanOrEqual(50 - 4 * 10)
      expect(v).toBeLessThanOrEqual(50 + 4 * 10)
      sum += v
    }
    expect(sum / n).toBeCloseTo(50, 0)
  })
})

describe('rngFor', () => {
  it('is order-independent — the whole point of deriving rather than streaming', () => {
    const seed = 777

    // Simulate round 3 first, then round 1.
    const outOfOrder = [
      rngFor(seed, 'match', 1, 3, 'a', 'b').next(),
      rngFor(seed, 'match', 1, 1, 'c', 'd').next(),
    ]
    // Now the other way round.
    const inOrder = [
      rngFor(seed, 'match', 1, 1, 'c', 'd').next(),
      rngFor(seed, 'match', 1, 3, 'a', 'b').next(),
    ]

    expect(outOfOrder[0]).toBe(inOrder[1])
    expect(outOfOrder[1]).toBe(inOrder[0])
  })

  it('separates purposes that share coordinates', () => {
    const seed = 4242
    const match = rngFor(seed, 'match', 1, 1).next()
    const injury = rngFor(seed, 'injury', 1, 1).next()
    expect(match).not.toBe(injury)
  })

  it('separates coordinates that share a purpose', () => {
    const seed = 4242
    expect(rngFor(seed, 'match', 1, 1).next()).not.toBe(rngFor(seed, 'match', 1, 2).next())
  })
})

describe('hashString', () => {
  it('is stable across calls', () => {
    expect(hashString('crusaders')).toBe(hashString('crusaders'))
  })

  it('returns an unsigned 32-bit integer', () => {
    for (const s of ['', 'a', 'Leinster Rugby', 'x'.repeat(500)]) {
      const h = hashString(s)
      expect(Number.isInteger(h)).toBe(true)
      expect(h).toBeGreaterThanOrEqual(0)
      expect(h).toBeLessThanOrEqual(0xffffffff)
    }
  })

  it('separates similar strings', () => {
    expect(hashString('LK1')).not.toBe(hashString('LK2'))
  })
})
