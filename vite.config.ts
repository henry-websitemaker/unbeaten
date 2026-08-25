import { defineConfig } from 'vitest/config'
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
  },
})
