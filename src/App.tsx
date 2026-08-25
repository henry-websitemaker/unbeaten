/**
 * Root shell. Screens are lazy so the entry chunk stays small (SPEC §6) — the main menu is
 * the only thing that has to be immediately interactive.
 */

export default function App() {
  return (
    <div className="min-h-dvh bg-pitch-950">
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
        <header className="mb-10">
          <p className="text-xs font-semibold uppercase tracking-[0.25em] text-turf-500">
            Rugby Career
          </p>
          <h1 className="mt-1 text-5xl font-black tracking-tight text-white">Unbeaten</h1>
          <p className="mt-3 text-sm text-pitch-500">Twenty seasons. One perfect record.</p>
        </header>
      </main>
    </div>
  )
}
