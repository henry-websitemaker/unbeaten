import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // SPEC §6: bundle under 300KB or route-level lazy loading. Screens are lazy;
    // the recovered data (teams.json alone is 190KB raw) is dynamically imported
    // so it never lands in the entry chunk.
    chunkSizeWarningLimit: 350,
  },
  test: {
    // The engine is pure and the screens are smoke-tested with react-dom/server, so no DOM
    // implementation is needed and the suite stays fast.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    /**
     * `*.slow.test.ts` is excluded from `npm test` and run by `npm run test:balance`.
     *
     * These are the Monte Carlo passes: whole 20-season careers, whole simulated worlds, and
     * seed searches that play dozens of seasons looking for a particular outcome. They take
     * minutes, not seconds, which is fine for a balance change and intolerable as the cost of
     * every edit. Run them when progression, balance or the world simulation changes.
     */
    exclude: [...configDefaults.exclude, 'src/**/*.slow.test.ts'],
  },
})
