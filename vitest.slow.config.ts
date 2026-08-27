/**
 * The slow half of the suite: `npm run test:balance`.
 *
 * Monte Carlo passes over whole 20-season careers, whole simulated worlds, and seed searches
 * that play dozens of seasons looking for a particular outcome. Minutes rather than seconds,
 * which is the right cost for a balance change and the wrong cost for every edit — so the
 * everyday `npm test` excludes them (see `vite.config.ts`) and this config runs only them.
 *
 * Run this when progression, balance or the world simulation changes.
 *
 * Deliberately standalone rather than `mergeConfig(base, ...)`: merging concatenates arrays,
 * so the base config's `exclude: ['src/**\/*.slow.test.ts']` survived the merge and this
 * command silently ran the fast suite instead. The duplication here is the price of the
 * include/exclude actually meaning what it says.
 */

import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: {
    environment: 'node',
    include: ['src/**/*.slow.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
})
