// Dragging without repainting the whole board: what the saved layers were painted from (`Snap`), the fingerprint of the board now
// (`Sigs`), and the two questions the renderer asks every frame while things move. Pure data, no canvas, so it is tested on its own.

/** A fingerprint of every part and wire: what it looks like (`look`, the same when it only moved) and where it is (`pos`). */
export interface Sigs {
  look: Map<string, string>
  pos: Map<string, [number, number]>
  /** The readings a part shows (current, voltage...), compared with a tolerance: a solve that comes out the same up to noise is no change. */
  vals: Map<string, number[]>
}

/** What the layers were painted from. */
export interface Snap {
  look: Map<string, string>
  pos: Map<string, [number, number]>
  vals: Map<string, number[]>
  /** Painted into the layers that are shifted while dragging. */
  moving: Set<string>
  /** Left out of every layer, painted live each frame. */
  live: Set<string>
  base: string
  zoom: number
}

/** The most things kept apart as "live" while they change shape (wires stretching between dragged and still parts): more is painted the long way. */
export const MAX_LIVE = 64

/** Two lists of readings that agree up to the noise of a solve (a micro-unit, or two thousandths of the size: no digit on screen can tell). */
export function closeVals(a: number[] | undefined, b: number[] | undefined): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-6 + 2e-3 * Math.max(Math.abs(a[i]), Math.abs(b[i]))) return false
  return true
}

export function sameSigs(a: Sigs, b: Sigs): boolean {
  if (a.look.size !== b.look.size) return false
  for (const [k, v] of a.look) if (b.look.get(k) !== v || !closeVals(a.vals.get(k), b.vals.get(k))) return false
  for (const [k, p] of a.pos) {
    const q = b.pos.get(k)
    if (!q || q[0] !== p[0] || q[1] !== p[1]) return false
  }
  return true
}

/**
 * How far the dragged things have gone since the layers were painted, if the layers can still show the board: only the dragged
 * things moved, all of them by the same distance and none of them changed, and nothing else changed except what is painted live.
 */
export function shiftOf(sigs: Sigs, snap: Snap): { dx: number; dy: number } | null {
  if (sigs.look.size !== snap.look.size) return null
  let dx = 0
  let dy = 0
  let first = true
  for (const [id, now] of sigs.look) {
    const old = snap.look.get(id)
    if (old === undefined) return null
    const p = sigs.pos.get(id)!
    const q = snap.pos.get(id)!
    const same = old === now && closeVals(sigs.vals.get(id), snap.vals.get(id))
    if (snap.moving.has(id)) {
      if (!same) return null
      const ddx = p[0] - q[0]
      const ddy = p[1] - q[1]
      if (first) {
        dx = ddx
        dy = ddy
        first = false
      } else if (ddx !== dx || ddy !== dy) return null
    } else if (!snap.live.has(id) && (!same || p[0] !== q[0] || p[1] !== q[1])) return null
  }
  return { dx, dy }
}

/**
 * Something new is moving: which things go into the shifted layers (the biggest group that moved by the same distance without
 * changing) and which are painted live (everything else that changed). Null when too many things are changing to keep apart.
 */
export function splitOf(sigs: Sigs, snap: Snap): { moving: Set<string>; live: Set<string> } | null {
  if (sigs.look.size !== snap.look.size) return null
  const shifted = new Map<string, string[]>()
  const live = new Set<string>()
  for (const [id, now] of sigs.look) {
    const old = snap.look.get(id)
    if (old === undefined) return null
    const p = sigs.pos.get(id)!
    const q = snap.pos.get(id)!
    const moved = p[0] !== q[0] || p[1] !== q[1]
    const same = old === now && closeVals(sigs.vals.get(id), snap.vals.get(id))
    if (same && !moved) continue
    if (!same) {
      live.add(id)
      continue
    }
    const key = `${p[0] - q[0]},${p[1] - q[1]}`
    const list = shifted.get(key)
    if (list) list.push(id)
    else shifted.set(key, [id])
  }
  let best: string[] = []
  for (const ids of shifted.values()) if (ids.length > best.length) best = ids
  for (const ids of shifted.values()) if (ids !== best) for (const id of ids) live.add(id)
  if (live.size > MAX_LIVE) return null
  return { moving: new Set(best), live }
}
