// Per-frame drawing context shared with part draw functions.
export const scene = {
  /** Point keys (see pointKey) that currently have something plugged in. */
  used: new Set<string>(),
  time: 0,
  /** Parts whose value labels are shown: the selected one, and one held under the pointer for a while. */
  labeled: new Set<string>(),
  /** Pixel look on: parts that have hand-made sprites draw those instead of vector shapes. */
  pixel: true,
}
