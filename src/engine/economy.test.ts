import { describe, it, expect } from 'vitest'
import {
  LIFESTYLE_ITEMS,
  assertReconciled,
  balance,
  canPurchase,
  createLedger,
  createLifestyleState,
  credit,
  debit,
  earningsBySeason,
  expectedSalary,
  formatMoney,
  grossEarnings,
  leagueWealthFactor,
  lifestyleEffects,
  noLifestyleEffects,
  owns,
  purchase,
  purchaseCount,
  reconcile,
  totalSpent,
  winBonus,
} from './economy'
import { LEAGUE_LIST, LIFESTYLE, getLeague } from '../data'
import { createRng } from './rng'
import type { Ledger, LifestyleState } from '../types/economy'

const CAREER_SEASONS = 20

describe('ledger basics', () => {
  it('starts empty and reconciled', () => {
    const l = createLedger()
    expect(grossEarnings(l)).toBe(0)
    expect(totalSpent(l)).toBe(0)
    expect(balance(l)).toBe(0)
    expect(reconcile(l).ok).toBe(true)
  })

  it('never mutates the ledger it is given', () => {
    const l = createLedger()
    const after = credit(l, 1, 'salary', 'Wages', 100_000)
    expect(l.entries).toHaveLength(0)
    expect(after.entries).toHaveLength(1)
  })

  it('rejects negative amounts on both sides', () => {
    const l = createLedger()
    expect(() => credit(l, 1, 'salary', 'Wages', -1)).toThrow('must be positive')
    expect(() => debit(l, 1, 'Thing', -1)).toThrow('must be positive')
  })

  it('tracks gross, spent and balance independently', () => {
    let l = createLedger()
    l = credit(l, 1, 'salary', 'Wages', 500_000)
    l = credit(l, 1, 'win_bonus', 'Win bonus', 20_000)
    l = debit(l, 1, 'Personal Trainer', 500_000)

    expect(grossEarnings(l)).toBe(520_000)
    expect(totalSpent(l)).toBe(500_000)
    expect(balance(l)).toBe(20_000)
  })

  it('groups earnings by season and excludes spending', () => {
    let l = createLedger()
    l = credit(l, 1, 'salary', 'Wages', 100_000)
    l = credit(l, 2, 'salary', 'Wages', 150_000)
    l = debit(l, 2, 'Off-Season Retreat', 250_000)

    const bySeason = earningsBySeason(l)
    expect(bySeason.get(1)).toBe(100_000)
    // The debit must not reduce what season 2 *earned*.
    expect(bySeason.get(2)).toBe(150_000)
  })
})

describe('SPEC §4 reconciliation — purchases + balance === gross', () => {
  it('holds at every season boundary across a full 20-season career', () => {
    const rng = createRng(31337)
    let ledger: Ledger = createLedger()
    let lifestyle: LifestyleState = createLifestyleState()

    for (let season = 1; season <= CAREER_SEASONS; season++) {
      // Earn.
      ledger = credit(ledger, season, 'salary', 'Wages', rng.int(40_000, 900_000))
      for (let w = 0; w < rng.int(0, 12); w++) {
        ledger = credit(ledger, season, 'win_bonus', 'Win bonus', rng.int(200, 5_000))
      }
      if (rng.bool(0.3)) {
        ledger = credit(ledger, season, 'sponsor', 'Boot deal', rng.int(10_000, 200_000))
      }

      // Spend whatever happens to be affordable this summer.
      for (const item of rng.shuffle(LIFESTYLE_ITEMS)) {
        if (canPurchase(ledger, lifestyle, item.id, season).ok && rng.bool(0.4)) {
          const result = purchase(ledger, lifestyle, item.id, season)
          ledger = result.ledger
          lifestyle = result.lifestyle
        }
      }

      // The season boundary assertion the spec asks for.
      const r = reconcile(ledger)
      expect(r.ok).toBe(true)
      expect(r.spent + r.balance).toBe(r.gross)
      expect(r.balance).toBeGreaterThanOrEqual(0)
      assertReconciled(ledger, `season ${season}`)
    }
  })

  it('holds for 200 randomised careers', () => {
    for (let seed = 0; seed < 200; seed++) {
      const rng = createRng(seed)
      let ledger: Ledger = createLedger()
      let lifestyle: LifestyleState = createLifestyleState()

      for (let season = 1; season <= CAREER_SEASONS; season++) {
        ledger = credit(ledger, season, 'salary', 'Wages', rng.int(5_000, 1_500_000))
        for (const item of rng.shuffle(LIFESTYLE_ITEMS)) {
          if (canPurchase(ledger, lifestyle, item.id, season).ok && rng.bool(0.5)) {
            const r = purchase(ledger, lifestyle, item.id, season)
            ledger = r.ledger
            lifestyle = r.lifestyle
          }
        }
        expect(reconcile(ledger).ok).toBe(true)
        expect(balance(ledger)).toBeGreaterThanOrEqual(0)
      }

      // Purchases recorded must exactly equal money debited.
      const spentOnItems = lifestyle.purchases.reduce((total, p) => {
        const item = LIFESTYLE_ITEMS.find((i) => i.id === p.itemId)!
        return total + item.cost
      }, 0)
      expect(spentOnItems).toBe(totalSpent(ledger))
    }
  })

  it('assertReconciled catches a ledger with a hand-written negative balance', () => {
    // Simulate a bug where something debited without checking affordability.
    const broken: Ledger = {
      entries: [
        { season: 1, type: 'salary', label: 'Wages', amount: 100 },
        { season: 1, type: 'lifestyle', label: 'Too expensive', amount: 5_000 },
      ],
    }
    expect(() => assertReconciled(broken)).toThrow('balance went negative')
  })
})

describe('lifestyle shop', () => {
  const rich = (): Ledger => credit(createLedger(), 1, 'salary', 'Wages', 10_000_000)

  it('exposes all five items from the data file', () => {
    expect(LIFESTYLE_ITEMS).toHaveLength(5)
    expect(LIFESTYLE_ITEMS.map((i) => i.id).sort()).toEqual([
      'elite_agent',
      'offseason_retreat',
      'personal_trainer',
      'private_physio',
      'sports_psychologist',
    ])
  })

  it('matches the SPEC §4 price list exactly', () => {
    const prices = Object.fromEntries(LIFESTYLE_ITEMS.map((i) => [i.id, i.cost]))
    expect(prices).toEqual({
      personal_trainer: 500_000,
      private_physio: 750_000,
      sports_psychologist: 400_000,
      elite_agent: 1_000_000,
      offseason_retreat: 250_000,
    })
  })

  it('actually deducts from career earnings', () => {
    const ledger = rich()
    const before = balance(ledger)
    const result = purchase(ledger, createLifestyleState(), 'personal_trainer', 1)

    expect(balance(result.ledger)).toBe(before - 500_000)
    // Gross is untouched — you earned it, you just spent it.
    expect(grossEarnings(result.ledger)).toBe(grossEarnings(ledger))
    expect(totalSpent(result.ledger)).toBe(500_000)
  })

  it('refuses a purchase you cannot afford, with the shortfall', () => {
    const poor = credit(createLedger(), 1, 'salary', 'Wages', 100_000)
    const check = canPurchase(poor, createLifestyleState(), 'personal_trainer', 1)
    expect(check.ok).toBe(false)
    if (!check.ok && check.reason === 'insufficient_funds') {
      expect(check.shortfall).toBe(400_000)
    } else {
      throw new Error('expected insufficient_funds')
    }
  })

  it('throws rather than silently succeeding when unaffordable', () => {
    const poor = credit(createLedger(), 1, 'salary', 'Wages', 100_000)
    expect(() => purchase(poor, createLifestyleState(), 'elite_agent', 1)).toThrow(
      'purchase refused',
    )
  })

  it('greys out one-time items once owned', () => {
    const result = purchase(rich(), createLifestyleState(), 'private_physio', 1)
    expect(owns(result.lifestyle, 'private_physio')).toBe(true)
    const again = canPurchase(result.ledger, result.lifestyle, 'private_physio', 2)
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.reason).toBe('already_owned')
  })

  it('allows the Off-Season Retreat again in a later season', () => {
    const first = purchase(rich(), createLifestyleState(), 'offseason_retreat', 1)
    // Not twice in the same summer...
    expect(canPurchase(first.ledger, first.lifestyle, 'offseason_retreat', 1).ok).toBe(false)
    // ...but yes the next one.
    expect(canPurchase(first.ledger, first.lifestyle, 'offseason_retreat', 2).ok).toBe(true)

    const second = purchase(first.ledger, first.lifestyle, 'offseason_retreat', 2)
    expect(purchaseCount(second.lifestyle, 'offseason_retreat')).toBe(2)
    expect(totalSpent(second.ledger)).toBe(500_000)
  })

  it('rejects an unknown item id', () => {
    const check = canPurchase(rich(), createLifestyleState(), 'private_jet', 1)
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.reason).toBe('unknown_item')
  })
})

describe('lifestyle effects', () => {
  const rich = (): Ledger => credit(createLedger(), 1, 'salary', 'Wages', 10_000_000)

  it('is neutral when nothing is owned', () => {
    expect(lifestyleEffects(createLifestyleState(), 5)).toEqual(noLifestyleEffects())
  })

  it('applies a one-time item from its season onward, never before', () => {
    const { lifestyle } = purchase(rich(), createLifestyleState(), 'personal_trainer', 5)

    expect(lifestyleEffects(lifestyle, 4).matchGrowthMultiplier).toBe(1)
    expect(lifestyleEffects(lifestyle, 5).matchGrowthMultiplier).toBe(1.25)
    expect(lifestyleEffects(lifestyle, 20).matchGrowthMultiplier).toBe(1.25)
  })

  it('applies the retreat only to the season it was bought for', () => {
    const { lifestyle } = purchase(rich(), createLifestyleState(), 'offseason_retreat', 7)

    expect(lifestyleEffects(lifestyle, 6).startSeasonInPeakForm).toBe(false)
    expect(lifestyleEffects(lifestyle, 7).startSeasonInPeakForm).toBe(true)
    expect(lifestyleEffects(lifestyle, 8).startSeasonInPeakForm).toBe(false)
  })

  it('stacks distinct items', () => {
    let ledger = rich()
    let lifestyle = createLifestyleState()
    for (const id of ['personal_trainer', 'private_physio', 'elite_agent']) {
      const r = purchase(ledger, lifestyle, id, 3)
      ledger = r.ledger
      lifestyle = r.lifestyle
    }

    const e = lifestyleEffects(lifestyle, 10)
    expect(e.matchGrowthMultiplier).toBe(1.25)
    expect(e.injuryRiskMultiplier).toBe(0.5)
    expect(e.recoveryWeeksReduction).toBe(1)
    expect(e.extraOffersPerWindow).toBe(1)
    expect(e.futureSalaryMultiplier).toBeCloseTo(1.1, 10)
  })

  it('mirrors the effect values in lifestyle.json rather than hardcoding them', () => {
    const dataItems = LIFESTYLE.items as unknown as { id: string; effect: Record<string, number> }[]
    const physio = dataItems.find((i) => i.id === 'private_physio')!
    const { lifestyle } = purchase(rich(), createLifestyleState(), 'private_physio', 1)
    expect(lifestyleEffects(lifestyle, 1).injuryRiskMultiplier).toBe(
      physio.effect.injuryRiskMultiplier,
    )
  })
})

describe('salary curve', () => {
  it('pays tier 1 far better than tier 2 at the same OVR', () => {
    expect(expectedSalary('premiership', 75)).toBeGreaterThan(
      expectedSalary('rfu_championship', 75) * 4,
    )
  })

  it('rises monotonically with OVR in every league', () => {
    for (const league of LEAGUE_LIST) {
      let previous = 0
      for (let ovr = 50; ovr <= 95; ovr += 5) {
        const salary = expectedSalary(league.id, ovr)
        expect(salary).toBeGreaterThanOrEqual(previous)
        previous = salary
      }
    }
  })

  it('makes Top 14 the best-paying tier 1 league, matching its prize pool', () => {
    const byPay = LEAGUE_LIST.filter((l) => l.tier === 1)
      .map((l) => ({ id: l.id, pay: expectedSalary(l.id, 80) }))
      .sort((a, b) => b.pay - a.pay)
    expect(byPay[0]!.id).toBe('top_14')
  })

  it('keeps a tier-2 rookie on a believable wage', () => {
    const rookie = expectedSalary('shute_shield', 58)
    expect(rookie).toBeGreaterThan(4_000)
    expect(rookie).toBeLessThan(40_000)
  })

  it('keeps a tier-1 superstar under a believable ceiling', () => {
    const star = expectedSalary('top_14', 92)
    expect(star).toBeGreaterThan(800_000)
    expect(star).toBeLessThan(4_000_000)
  })

  it('makes a £10M career reachable but demanding', () => {
    // Three tier-2 seasons, then seventeen good tier-1 ones.
    let total = 0
    for (let s = 1; s <= 3; s++) total += expectedSalary('rfu_championship', 60 + s)
    for (let s = 4; s <= CAREER_SEASONS; s++) {
      total += expectedSalary('premiership', Math.min(90, 66 + s))
    }
    expect(total).toBeGreaterThan(8_000_000)
    expect(total).toBeLessThan(40_000_000)
  })

  it('scales a fringe role below a starter', () => {
    expect(expectedSalary('urc', 70, 0.6)).toBeLessThan(expectedSalary('urc', 70, 1))
  })

  it('derives league wealth from the data, so Shute Shield trails its tier', () => {
    expect(leagueWealthFactor(getLeague('shute_shield'))).toBeLessThan(1)
    expect(leagueWealthFactor(getLeague('top_14'))).toBeGreaterThan(1)
  })

  it('pays a bigger win bonus in richer leagues', () => {
    expect(winBonus('top_14')).toBeGreaterThan(winBonus('shute_shield'))
  })
})

describe('formatMoney', () => {
  it('formats across the magnitudes the game actually uses', () => {
    expect(formatMoney(1_000_000)).toBe('£1M')
    expect(formatMoney(750_000)).toBe('£750k')
    expect(formatMoney(250_000)).toBe('£250k')
    expect(formatMoney(8_500)).toBe('£8,500')
    expect(formatMoney(0)).toBe('£0')
  })

  it('handles negatives', () => {
    expect(formatMoney(-400_000)).toBe('-£400k')
  })
})
