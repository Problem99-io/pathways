// Kinematic layout transitions: every node position is a damped spring that
// chases its layout target, so when steps are added (by you or the AI) the
// whole graph glides into its new shape instead of jumping.

import { useEffect, useRef, useState } from 'react'

interface Body {
  x: number
  y: number
  vx: number
  vy: number
}

const STIFFNESS = 210
const DAMPING = 25

export function useSpringPositions(
  targets: Map<string, { x: number; y: number }>,
  spawnFrom: (id: string) => { x: number; y: number } | undefined,
) {
  const bodies = useRef(new Map<string, Body>())
  const raf = useRef<number | null>(null)
  const [, setTick] = useState(0)
  const targetsRef = useRef(targets)
  targetsRef.current = targets

  // add/remove bodies synchronously so the first render has positions
  for (const [id, t] of targets) {
    if (!bodies.current.has(id)) {
      const from = bodies.current.size ? spawnFrom(id) : undefined
      bodies.current.set(id, { x: from?.x ?? t.x, y: from?.y ?? t.y, vx: 0, vy: 0 })
    }
  }
  for (const id of [...bodies.current.keys()]) if (!targets.has(id)) bodies.current.delete(id)

  useEffect(() => {
    let last = performance.now()
    const step = (now: number) => {
      const dt = Math.min(0.032, (now - last) / 1000)
      last = now
      let moving = false
      for (const [id, b] of bodies.current) {
        const t = targetsRef.current.get(id)
        if (!t) continue
        const ax = STIFFNESS * (t.x - b.x) - DAMPING * b.vx
        const ay = STIFFNESS * (t.y - b.y) - DAMPING * b.vy
        b.vx += ax * dt
        b.vy += ay * dt
        b.x += b.vx * dt
        b.y += b.vy * dt
        if (Math.abs(t.x - b.x) > 0.3 || Math.abs(t.y - b.y) > 0.3 || Math.abs(b.vx) > 1 || Math.abs(b.vy) > 1) moving = true
        else {
          b.x = t.x
          b.y = t.y
          b.vx = b.vy = 0
        }
      }
      setTick((v) => v + 1)
      raf.current = moving ? requestAnimationFrame(step) : null
    }
    if (raf.current === null) raf.current = requestAnimationFrame(step)
    return () => {
      if (raf.current !== null) cancelAnimationFrame(raf.current)
      raf.current = null
    }
  }, [targets])

  return bodies.current
}
