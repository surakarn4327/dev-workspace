// Camera maths: zoom steps and keeping the view inside the real building.
// The camera can only pan across the rooms that are actually used (the building),
// never into the decorative rooms beyond it.

/** Centre of the view along one axis, kept so the view never leaves [0, world]. */
export function clampAxis(center: number, visible: number, world: number): number {
  if (visible >= world) return world / 2; // the whole building fits: stay centred
  const half = visible / 2;
  return Math.min(world - half, Math.max(half, center));
}

/**
 * Pixel scales the user can zoom through. The first is the "fit the whole building" scale;
 * the rest are the next whole numbers up, so pixels stay crisp.
 */
export function zoomLevels(fitScale: number, steps = 4): number[] {
  const levels = [fitScale];
  const first = Math.floor(fitScale) + 1;
  for (let i = 0; i < steps; i++) levels.push(first + i);
  return levels;
}

/**
 * New camera centre after a zoom that keeps the point under the pointer still.
 * `anchor` is the office coordinate under the pointer, `fromCentre` how far the pointer is from
 * the middle of the window (screen pixels), `scale` the new scale.
 */
export function anchoredCentre(anchor: number, fromCentre: number, scale: number): number {
  return anchor - fromCentre / scale;
}
