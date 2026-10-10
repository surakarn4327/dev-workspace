// Per-frame drawing context shared with part draw functions.

/** A halo that was asked for while the board was being painted into a saved layer: replayed on the board, see `radialGlow`. */
export interface GlowCall {
  /** Part-local frame -> world. */
  m: DOMMatrix
  x: number
  y: number
  r: number
  color: string
  alpha: number
}

export const scene = {
  /** Point keys (see pointKey) that currently have something plugged in. */
  used: new Set<string>(),
  time: 0,
  /** Parts whose value labels are shown: the selected one, and one held under the pointer for a while. */
  labeled: new Set<string>(),
  /**
   * Label pass: value labels are not part of a part's picture (so showing or hiding one never changes the saved board layers). They
   * are drawn on top, by running the part's draw function with a context that ignores everything; the label functions then draw
   * on `labelCtx`, the real context in the part's frame.
   */
  labelPass: false,
  labelCtx: null as CanvasRenderingContext2D | null,
  /**
   * While set, `radialGlow` records the halo instead of painting it (with `glowBase`, the inverse of the transform the painting
   * started from). Halos are additive and must land on the finished board, never inside a saved layer: an additive halo on a
   * transparent layer comes out dimmer than on the board, so the same LED looked different live and from a saved layer.
   */
  glowSink: null as GlowCall[] | null,
  glowBase: null as DOMMatrix | null,
  /** Pixel look on: parts that have hand-made sprites draw those instead of vector shapes. */
  pixel: true,
}
