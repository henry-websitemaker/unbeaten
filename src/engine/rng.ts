/**
 * Seeded RNG.
 *
 * Deliberately *derived*, not streamed. A single mutable global stream would desync the
 * moment a save is loaded mid-season — replaying from a different point in the sequence
 * yields different results. Instead every stochastic decision derives its own sub-stream by
 * hashing a purpose tuple, so any result is reproducible from `(careerSeed, coordinates)`
 * alone, in any order, after any number of reloads.
 */

/** FNV-1a over a string, returned as an unsigned 32-bit int. */
export function hashString(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    // h *= 16777619, kept in 32-bit range without overflowing the float mantissa
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Mix a numeric seed so that adjacent seeds produce unrelated streams. */
function mix32(seed: number): number {
  let h = seed >>> 0
  h ^= h >>> 16
  h = Math.imul(h, 0x21f0aaad)
  h ^= h >>> 15
  h = Math.imul(h, 0x735a2d97)
  h ^= h >>> 15
  return h >>> 0
}

export interface Rng {
  /** Uniform in [0, 1). */
  next(): number
  /** Uniform integer in [min, max] — inclusive both ends. */
  int(min: number, max: number): number
  /** Uniform float in [min, max). */
  float(min: number, max: number): number
  /** True with probability `p`. */
  bool(p: number): boolean
  /** Uniform pick. Throws on an empty array rather than returning undefined. */
  pick<T>(items: readonly T[]): T
  /** Fisher-Yates, returning a new array — never mutates the input. */
  shuffle<T>(items: readonly T[]): T[]
  /** Weighted pick. Weights need not sum to anything in particular. */
  weighted<T>(items: readonly T[], weightOf: (item: T) => number): T
  /** Normal deviate via Box-Muller, clamped to +/- 4 sd to avoid absurd tails. */
  gaussian(mean: number, sd: number): number
}

/**
 * mulberry32 — small, fast, and good enough for a sports sim. Not cryptographic.
 */
export function createRng(seed: number): Rng {
  let state = mix32(seed)

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  const rng: Rng = {
    next,

    int(min, max) {
      if (max < min) throw new Error(`rng.int: max ${max} < min ${min}`)
      return min + Math.floor(next() * (max - min + 1))
    },

    float(min, max) {
      return min + next() * (max - min)
    },

    bool(p) {
      return next() < p
    },

    pick(items) {
      if (items.length === 0) throw new Error('rng.pick: empty array')
      const item = items[Math.floor(next() * items.length)]
      // Index is always in range, but the compiler cannot know that.
      return item as (typeof items)[number]
    },

    shuffle(items) {
      const out = items.slice()
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1))
        const a = out[i] as (typeof out)[number]
        const b = out[j] as (typeof out)[number]
        out[i] = b
        out[j] = a
      }
      return out
    },

    weighted(items, weightOf) {
      if (items.length === 0) throw new Error('rng.weighted: empty array')
      let total = 0
      for (const item of items) {
        const w = weightOf(item)
        if (w > 0) total += w
      }
      if (total <= 0) throw new Error('rng.weighted: all weights are zero or negative')
      let roll = next() * total
      for (const item of items) {
        const w = weightOf(item)
        if (w <= 0) continue
        roll -= w
        if (roll < 0) return item
      }
      // Floating-point drift on the final item only.
      return items[items.length - 1] as (typeof items)[number]
    },

    gaussian(mean, sd) {
      // u must be non-zero for the log.
      let u = next()
      while (u === 0) u = next()
      const v = next()
      const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
      return mean + sd * Math.max(-4, Math.min(4, z))
    },
  }

  return rng
}

/**
 * Derive a purpose-specific stream from the career seed.
 *
 * `rngFor(seed, 'match', season, round, homeId, awayId)` always returns the same stream
 * for the same coordinates, no matter what else has been simulated first.
 */
export function rngFor(seed: number, purpose: string, ...coords: (string | number)[]): Rng {
  return createRng(seed ^ hashString(`${purpose}:${coords.join(':')}`))
}

/** A fresh career seed. Callers pass entropy in — the engine never reads the clock itself. */
export function seedFromString(input: string): number {
  return hashString(input)
}
