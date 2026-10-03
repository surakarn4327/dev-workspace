// How the fixed-size office is placed inside whatever window the user has.
// The pixel scale is a whole number whenever the window is big enough (crisp pixels);
// the canvas then grows to cover the window and the office sits in the middle,
// with the scenery extended around it.

export interface Layout {
  /** Screen pixels per office pixel. */
  scale: number;
  /** Logical canvas size (office pixels) that covers the whole window. */
  cw: number;
  ch: number;
  /** Where the fixed office rectangle sits inside the canvas. */
  ox: number;
  oy: number;
}

export function computeLayout(availW: number, availH: number, officeW: number, officeH: number): Layout {
  const aw = Math.max(1, availW);
  const ah = Math.max(1, availH);
  const ratio = Math.min(aw / officeW, ah / officeH);
  const scale = ratio >= 1 ? Math.floor(ratio) : Math.max(0.1, ratio);
  const cw = Math.max(officeW, Math.ceil(aw / scale));
  const ch = Math.max(officeH, Math.ceil(ah / scale));
  return { scale, cw, ch, ox: Math.floor((cw - officeW) / 2), oy: Math.floor((ch - officeH) / 2) };
}
