// Test helper: builds the real index.html in jsdom and exposes the browser globals the UI code uses.
// Not part of the app (nothing imports it except tests).

import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

export interface TestDom {
  dom: JSDOM;
  window: JSDOM['window'];
  /** Stop animation-frame loops so the test process can exit. */
  stop(): void;
}

export function setupDom(): TestDom {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8').replace(
    /<script[^>]*src=[^>]*><\/script>/g,
    '',
  );
  const dom = new JSDOM(html, { pretendToBeVisual: true, url: 'http://localhost/' });
  const w = dom.window;
  const g = globalThis as unknown as Record<string, unknown>;
  g.window = w;
  g.document = w.document;
  for (const name of [
    'HTMLElement',
    'HTMLInputElement',
    'HTMLTextAreaElement',
    'HTMLSelectElement',
    'HTMLCanvasElement',
    'HTMLButtonElement',
    'Node',
    'Event',
    'KeyboardEvent',
    'MouseEvent',
    'WheelEvent',
  ] as const) {
    g[name] = (w as unknown as Record<string, unknown>)[name];
  }
  let running = true;
  g.requestAnimationFrame = (cb: FrameRequestCallback): number =>
    running ? (setTimeout(() => cb(performance.now()), 16) as unknown as number) : 0;
  // jsdom has no canvas: drawing helpers must cope with a missing 2d context.
  w.HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof w.HTMLCanvasElement.prototype.getContext;
  (w.HTMLElement.prototype as unknown as { setPointerCapture: () => void }).setPointerCapture = () => {};
  return {
    dom,
    window: w,
    stop() {
      running = false;
      w.close();
    },
  };
}

/** Give an element a size, since jsdom does no layout. */
export function sizeElement(node: HTMLElement, width: number, height: number): void {
  Object.defineProperty(node, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(node, 'clientHeight', { value: height, configurable: true });
  node.getBoundingClientRect = () =>
    ({ left: 0, top: 0, right: width, bottom: height, width, height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
