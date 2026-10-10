// The fingerprint of the board that decides whether the saved layers still show it (`Sigs`), and how two fingerprints are compared.
// Pure data, no canvas, so it is tested on its own.

/** A fingerprint of every part and wire: what it looks like (`look`, the same when it only moved) and where it is (`pos`). */
export interface Sigs {
  look: Map<string, string>
  pos: Map<string, [number, number]>
  /** The readings a part shows (current, voltage...), compared with a tolerance: a solve that comes out the same up to noise is no change. */
  vals: Map<string, number[]>
}

/** Two lists of readings that agree up to the noise of a solve (a micro-unit, or two thousandths of the size: no digit on screen can tell). */
export function closeVals(a: number[] | undefined, b: number[] | undefined): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 1e-6 + 2e-3 * Math.max(Math.abs(a[i]), Math.abs(b[i]))) return false
  return true
}

/** Does the board look the same, with everything where it was? */
export function sameSigs(a: Sigs, b: Sigs): boolean {
  if (a.look.size !== b.look.size) return false
  for (const [k, v] of a.look) if (b.look.get(k) !== v || !closeVals(a.vals.get(k), b.vals.get(k))) return false
  for (const [k, p] of a.pos) {
    const q = b.pos.get(k)
    if (!q || q[0] !== p[0] || q[1] !== p[1]) return false
  }
  return true
}
