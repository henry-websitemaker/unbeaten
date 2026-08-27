/**
 * A wheel you can actually watch land (SPEC §3).
 *
 * Used by the mid-season gamble, the transfer window and the origin draft. The important
 * property: **the wheel never decides anything.** The outcome is chosen by the seeded engine
 * before the animation starts, and `targetIndex` says where to stop. The spin is a reveal, so
 * a save reloaded mid-spin still lands on the same result.
 *
 * Honours the `prefers-reduced-motion` block in `index.css` — reduced motion gets the answer
 * immediately rather than a shorter spin, because the point of that setting is no motion.
 */

import { useEffect, useMemo, useRef, useState } from 'react'

export interface WheelSegment {
  label: string
  /** Ring colour. Falls back to alternating greens. */
  tone?: 'good' | 'bad' | 'neutral' | 'gold'
}

const TONE_FILL: Record<string, string> = {
  good: '#16a34a',
  bad: '#b91c1c',
  neutral: '#2a3a34',
  gold: '#b45309',
}

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function WheelSpinner({
  segments,
  targetIndex,
  spinning,
  onLanded,
  size = 260,
}: {
  segments: WheelSegment[]
  /** Where the engine already decided it lands. */
  targetIndex: number
  /** Flips to true to start the spin. */
  spinning: boolean
  onLanded: () => void
  size?: number
}) {
  const [rotation, setRotation] = useState(0)
  const landed = useRef(false)

  const count = Math.max(1, segments.length)
  const sweep = 360 / count

  // Land the target's midpoint under the pointer at the top, after several whole turns.
  const target = useMemo(() => {
    const centre = targetIndex * sweep + sweep / 2
    return 360 * 5 - centre
  }, [targetIndex, sweep])

  useEffect(() => {
    if (!spinning || landed.current) return
    landed.current = true

    if (prefersReducedMotion()) {
      setRotation(target)
      onLanded()
      return
    }

    // A frame's delay so the transition has a start value to animate from.
    const start = requestAnimationFrame(() => setRotation(target))
    const done = setTimeout(onLanded, 3400)
    return () => {
      cancelAnimationFrame(start)
      clearTimeout(done)
    }
  }, [spinning, target, onLanded])

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      {/* The pointer, fixed at the top. */}
      <div
        aria-hidden="true"
        className="absolute left-1/2 top-0 z-10 -ml-2 h-0 w-0"
        style={{
          borderLeft: '8px solid transparent',
          borderRight: '8px solid transparent',
          borderTop: '14px solid #fbbf24',
        }}
      />

      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        role="img"
        aria-label={`Wheel of ${count} outcomes`}
        style={{
          transform: `rotate(${rotation}deg)`,
          transition: prefersReducedMotion()
            ? undefined
            : 'transform 3.2s cubic-bezier(0.15, 0.9, 0.2, 1)',
        }}
      >
        {segments.map((segment, index) => (
          <path
            key={`${segment.label}:${index}`}
            d={arcPath(50, 50, 48, index * sweep, (index + 1) * sweep)}
            fill={
              segment.tone
                ? TONE_FILL[segment.tone]
                : index % 2 === 0
                  ? '#131b18'
                  : '#1c2723'
            }
            stroke="#070b09"
            strokeWidth="0.6"
          />
        ))}
        <circle cx="50" cy="50" r="9" fill="#0a0f0d" stroke="#3d5249" strokeWidth="1" />
      </svg>

      {/* Labels sit outside the rotating svg so they never end up upside down. */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="rounded-full bg-pitch-950/80 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-pitch-500">
          {count} outcomes
        </span>
      </div>
    </div>
  )
}

/** One pie slice, in the 0-100 viewBox. Angles are degrees clockwise from twelve o'clock. */
function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const point = (angle: number) => {
    const rad = ((angle - 90) * Math.PI) / 180
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)]
  }
  const [x1, y1] = point(from)
  const [x2, y2] = point(to)
  const large = to - from > 180 ? 1 : 0
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`
}
