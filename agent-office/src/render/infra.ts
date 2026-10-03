// The server room wall: the parts of the office that show the real machinery behind the agents.
// - the cooling fan spins faster while model calls run and screams when the free quota is used up
// - a warning beacon flashes while calls are waiting for quota
// - a gateway strip (the search helper's link) scans while tools run, and shows the helper's health
// Everything is drawn from numbers the view keeps (glow, fan angle), so a blink always means a real call.

import type { HelperKind } from '../core/types.ts';
import { rect } from './furniture.ts';

type Ctx = CanvasRenderingContext2D;

export interface WallLook {
  /** Seconds, for blinking. */
  t: number;
  /** Fan blade angle in radians (the view integrates the speed, so changes of speed are smooth). */
  fanAngle: number;
  /** 0..1: how recently a model call was running (fades after the call ends so a short call is still seen). */
  modelGlow: number;
  /** 0..1: same for tool calls. */
  toolGlow: number;
  /** The free AI quota is used up: everything overheats. */
  hot: boolean;
  helper: HelperKind;
}

// Positions in building coordinates. The vent, the sign and the racks are drawn elsewhere; these sit with them.
export const VENT = { x: 424, y: 10, w: 36, h: 20 };
export const FAN = { x: 442, y: 20, radius: 8 };
export const BEACON = { x: 439, y: 33, w: 6, h: 4 };
export const GATEWAY = { x: 414, y: 37, w: 52, h: 8 };
const LEDS = 8;

const GREEN = '#2fb36a';
const GREEN_DIM = '#17402a';
const AMBER = '#f2c14e';
const AMBER_DIM = '#5a4410';
const RED = '#e5484d';
const RED_DIM = '#4a1a1c';

/** Revolutions per second of the cooling fan for the current load. */
export function fanSpeed(modelGlow: number, hot: boolean): number {
  if (hot) return 3.4;
  return modelGlow > 0 ? 1.6 : 0.5;
}

/** A line of single pixels through (cx, cy) at `angle`, `reach` pixels each way. */
function bar(g: Ctx, cx: number, cy: number, angle: number, reach: number, color: string): void {
  g.fillStyle = color;
  for (let k = -reach; k <= reach; k++) g.fillRect(Math.round(cx + Math.cos(angle) * k), Math.round(cy + Math.sin(angle) * k), 1, 1);
}

export function drawFan(g: Ctx, look: WallLook): void {
  rect(g, FAN.x - 9, FAN.y - 9, 18, 18, '#11151d'); // the fan's opening, a bit darker than the vent
  const blade = look.hot ? '#d97b7f' : '#69738a';
  for (let i = 0; i < 4; i++) bar(g, FAN.x, FAN.y, look.fanAngle + (i * Math.PI) / 4, FAN.radius, blade);
  rect(g, FAN.x - 1, FAN.y - 1, 3, 3, '#2d3340');
  rect(g, FAN.x, FAN.y, 1, 1, look.hot ? RED : '#9aa3b5');
  if (look.hot) {
    // the heat shows as a red glow that breathes over the vent
    g.fillStyle = `rgba(229,72,77,${(0.12 + 0.12 * (0.5 + 0.5 * Math.sin(look.t * 6))).toFixed(3)})`;
    g.fillRect(VENT.x, VENT.y, VENT.w, VENT.h);
  }
}

export function drawBeacon(g: Ctx, look: WallLook): void {
  const { x, y, w, h } = BEACON;
  rect(g, x - 1, y - 1, w + 2, h + 2, '#1d1b2e');
  if (!look.hot) {
    rect(g, x, y, w, h, '#3a2124'); // a dark lamp: all is well
    return;
  }
  const on = Math.floor(look.t * 3) % 2 === 0;
  rect(g, x, y, w, h, on ? '#ff6b6b' : '#7a2226');
  if (on) {
    rect(g, x - 3, y + 1, 2, 2, RED); // light spilling to both sides
    rect(g, x + w + 1, y + 1, 2, 2, RED);
  }
}

/** The strip of lights that links the office to the search helper. */
export function drawGateway(g: Ctx, look: WallLook): void {
  const { x, y, w, h } = GATEWAY;
  rect(g, x, y, w, h, '#1f2430');
  rect(g, x, y, w, 1, '#3b4256');
  rect(g, x, y + h - 1, w, 1, '#11151d');

  // antenna at the left end; its signal arcs show while a tool is running
  rect(g, x + 4, y + 2, 1, 5, '#6f7889');
  rect(g, x + 3, y + 1, 3, 1, '#9aa3b5');
  if (look.toolGlow > 0 && look.helper !== 'down') {
    rect(g, x + 1, y + 2, 1, 2, AMBER);
    rect(g, x + 7, y + 2, 1, 2, AMBER);
    if (Math.floor(look.t * 6) % 2 === 0) {
      rect(g, x, y + 3, 1, 1, AMBER);
      rect(g, x + 8, y + 3, 1, 1, AMBER);
    }
  }

  const leds = (i: number): string => {
    switch (look.helper) {
      case 'down':
        return i === 0 ? (Math.floor(look.t * 2) % 2 ? RED : RED_DIM) : '#1a1e28';
      case 'unknown':
        return i === 0 ? (Math.floor(look.t * 4) % 2 ? AMBER : AMBER_DIM) : '#1a1e28';
      default: {
        if (i === 0) return GREEN;
        if (i === 1 && look.helper === 'degraded') return AMBER;
        if (look.toolGlow > 0) {
          const scan = Math.floor(look.t * 12) % LEDS; // a light runs along the strip while a tool is working
          if (i === scan) return AMBER;
          if (i === (scan + LEDS - 1) % LEDS) return AMBER_DIM;
        }
        return i === LEDS - 1 && Math.floor(look.t / 1.2) % 2 === 0 ? GREEN : GREEN_DIM; // idle heartbeat
      }
    }
  };
  for (let i = 0; i < LEDS; i++) {
    const lx = x + 14 + i * 5;
    rect(g, lx, y + 3, 4, 2, '#0c0f16');
    rect(g, lx + 1, y + 3, 2, 2, leds(i));
  }
}

/** Everything on the server room wall that reacts to the real machinery. */
export function drawServerWall(g: Ctx, look: WallLook): void {
  drawFan(g, look);
  drawBeacon(g, look);
  drawGateway(g, look);
}
