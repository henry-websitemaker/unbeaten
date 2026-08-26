/**
 * Shared UI pieces.
 *
 * Everything is built to survive a 380px viewport (SPEC §6): no fixed widths, wide content
 * scrolls inside its own container rather than pushing the page sideways.
 */

import type { ReactNode } from 'react'
import type { SquadRole } from '../types/career'

/**
 * How a squad role reads to the player (SPEC §3).
 *
 * Three labels over four internal roles: `star` and `starter` both mean you are in the side,
 * and the difference between them is already visible everywhere else — in the salary, the
 * coach's expectation and whether you wear the armband. Splitting them here would be a
 * distinction without a difference on a card that has to be read at a glance.
 */
export const SQUAD_ROLE_LABEL: Record<SquadRole, string> = {
  star: 'First Team',
  starter: 'First Team',
  squad: 'Impact Sub',
  fringe: 'Bench Cover',
}

export function Screen({
  title,
  subtitle,
  onBack,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  onBack?: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-pitch-950">
      <header className="sticky top-0 z-10 border-b border-pitch-800 bg-pitch-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center gap-3 px-4 py-3">
          {onBack && (
            <button
              onClick={onBack}
              className="-ml-2 rounded-lg px-2 py-1 text-pitch-500 transition hover:bg-pitch-800 hover:text-white"
              aria-label="Back"
            >
              ←
            </button>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-bold text-white">{title}</h1>
            {subtitle && <p className="truncate text-xs text-pitch-500">{subtitle}</p>}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-4">{children}</main>

      {footer && (
        <footer className="sticky bottom-0 border-t border-pitch-800 bg-pitch-950/95 px-4 pt-3 pb-safe backdrop-blur">
          <div className="mx-auto max-w-2xl">{footer}</div>
        </footer>
      )}
    </div>
  )
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled,
  full,
}: {
  children: ReactNode
  onClick?: () => void
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  disabled?: boolean
  full?: boolean
}) {
  const base =
    'rounded-xl px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40'
  const styles = {
    primary: 'bg-turf-500 text-pitch-950 hover:bg-turf-400',
    secondary: 'bg-pitch-700 text-white hover:bg-pitch-600',
    ghost: 'text-pitch-500 hover:bg-pitch-800 hover:text-white',
    danger: 'bg-loss/15 text-loss hover:bg-loss/25',
  }[variant]

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${base} ${styles} ${full ? 'w-full' : ''}`}
    >
      {children}
    </button>
  )
}

export function Card({
  children,
  onClick,
  selected,
  className = '',
}: {
  children: ReactNode
  onClick?: () => void
  selected?: boolean
  className?: string
}) {
  const interactive = onClick
    ? 'cursor-pointer transition hover:border-pitch-500 text-left w-full'
    : ''
  const border = selected ? 'border-turf-500 bg-turf-500/5' : 'border-pitch-700'
  const Tag = onClick ? 'button' : 'div'

  return (
    <Tag
      onClick={onClick}
      className={`rounded-2xl border ${border} bg-pitch-900 p-4 ${interactive} ${className}`}
    >
      {children}
    </Tag>
  )
}

/** The green club pill from the 38-0-0 layout. */
export function ClubPill({ club, league }: { club: string; league?: string }) {
  return (
    <div className="inline-flex max-w-full items-center gap-2 rounded-full bg-turf-500/15 px-3 py-1.5">
      <span className="size-2 shrink-0 rounded-full bg-turf-400" />
      <span className="truncate text-sm font-semibold text-turf-400">{club}</span>
      {league && <span className="truncate text-xs text-turf-400/60">{league}</span>}
    </div>
  )
}

/** One of the four stat cards on the dashboard. */
export function StatCard({
  label,
  value,
  sub,
  tone = 'default',
}: {
  label: string
  value: string | number
  sub?: string
  tone?: 'default' | 'good' | 'bad'
}) {
  const colour =
    tone === 'good' ? 'text-turf-400' : tone === 'bad' ? 'text-loss' : 'text-white'
  return (
    <div className="rounded-2xl border border-pitch-700 bg-pitch-900 p-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-pitch-500">{label}</p>
      <p className={`nums mt-1 text-2xl font-bold ${colour}`}>{value}</p>
      {sub && <p className="nums mt-0.5 truncate text-[11px] text-pitch-500">{sub}</p>}
    </div>
  )
}

/** Coloured W / D / L chip. */
export function ResultChip({ result }: { result: 'W' | 'D' | 'L' }) {
  const styles = {
    W: 'bg-win/20 text-win',
    D: 'bg-draw/20 text-draw',
    L: 'bg-loss/20 text-loss',
  }[result]
  return (
    <span
      className={`inline-flex size-6 shrink-0 items-center justify-center rounded-md text-xs font-bold ${styles}`}
    >
      {result}
    </span>
  )
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <span className="text-sm text-pitch-500">{label}</span>
      <span className="nums text-sm font-semibold text-white">{value}</span>
    </div>
  )
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex items-center justify-between gap-3 first:mt-0">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-pitch-500">{children}</h2>
      {action}
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-2xl border border-dashed border-pitch-700 px-4 py-8 text-center text-sm text-pitch-500">
      {children}
    </p>
  )
}

const TIER_STYLES: Record<string, string> = {
  bronze: 'bg-bronze/15 text-bronze',
  silver: 'bg-silver/15 text-silver',
  gold: 'bg-gold/15 text-gold',
  legend: 'bg-legend/15 text-legend',
}

export function TierBadge({ tier }: { tier: string }) {
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
        TIER_STYLES[tier] ?? 'bg-pitch-700 text-pitch-500'
      }`}
    >
      {tier}
    </span>
  )
}

/** Wide content — tables, especially — scrolls here rather than breaking the page. */
export function ScrollX({ children }: { children: ReactNode }) {
  return <div className="-mx-4 overflow-x-auto px-4">{children}</div>
}

export function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max === 0 ? 0 : Math.min(100, (value / max) * 100)
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-pitch-800">
      <div className="h-full rounded-full bg-turf-500 transition-all" style={{ width: `${pct}%` }} />
    </div>
  )
}

export function OvrDelta({ delta }: { delta: number }) {
  if (delta === 0) return <span className="nums text-sm text-pitch-500">±0</span>
  const good = delta > 0
  return (
    <span className={`nums text-sm font-semibold ${good ? 'text-turf-400' : 'text-loss'}`}>
      {good ? '+' : ''}
      {delta}
    </span>
  )
}
