/**
 * A whole career through the real store — the slow half of the store tests.
 *
 * Twenty seasons, each closing by simulating the entire world, so this runs in tens of
 * seconds. It is the only test that proves retirement, the Hall of Fame entry and the
 * refusal to resume a finished career all work through the buttons a player actually presses,
 * which is why it is kept rather than trimmed — it just lives behind `npm run test:balance`.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest'
import { useGame } from './gameStore'
import { isRegularSeasonComplete } from '../engine/season'
import { CAREER_SEASONS } from '../types/career'

beforeAll(async () => {
  const data = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  })
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => {
    cb()
    return 0
  })
  await useGame.getState().init()
})

describe('retirement', () => {
  it('retires after season 20 and records a ranked Hall of Fame entry', async () => {
    useGame.getState().startCareer({
      name: 'Marathon Man',
      position: 'OC',
      archetypeId: 'wonderkid',
      nationId: 'eng',
    })
    await vi.waitFor(() => {
      if (!useGame.getState().run) throw new Error('career not started')
    })

    for (let season = 1; season <= CAREER_SEASONS; season++) {
      const game = useGame.getState()
      for (let i = 0; i < 60; i++) {
        const run = useGame.getState().run!
        if (isRegularSeasonComplete(run.season)) break
        if (run.wheelPending) game.skipWheel()
        else game.nextRound()
      }
      useGame.getState().finishSeason()
      useGame.getState().beginNextSeason()
    }

    const state = useGame.getState()
    expect(state.run!.career.retired).toBe(true)
    expect(state.run!.career.history).toHaveLength(CAREER_SEASONS)
    expect(state.screen).toBe('career-end')

    const entry = state.save.hallOfFame.find((e) => e.name === 'Marathon Man')
    expect(entry).toBeDefined()
    expect(entry!.ranked).toBe(true)
    expect(entry!.seasonsPlayed).toBe(CAREER_SEASONS)

    // A retired career must not be resumed on the next boot.
    await useGame.getState().init()
    expect(useGame.getState().run).toBeNull()
  }, 300_000)
})
