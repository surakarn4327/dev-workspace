// Draws the office onto a 384x224 canvas from the store's state and animates
// walking/sitting. It reacts to events only for movement and one-off effects;
// everything else (poses, bubbles) is derived from the store each frame.

import { DEPT_COLOR, ROSTER } from '../core/roster.ts';
import type { AgentState, OfficeStore } from '../core/state.ts';
import type { AgentId, OfficeEvent, PlaceId } from '../core/types.ts';
import { AGENT_IDS, WORK_STAGES } from '../core/types.ts';
import type { Point } from '../core/world.ts';
import {
  DESKS,
  H,
  PROPS,
  SIT_MS,
  TABLE,
  W,
  WALK_SPEED,
  findPath,
  placeFacing,
  placePoint,
  seatPoint,
  standPoint,
} from '../core/world.ts';
import { BOARD, CLOCK, HOLES, buildBackground } from './background.ts';
import type { Dir, Pose } from './characters.ts';
import { getSprite } from './characters.ts';
import { drawChair, drawCooler, drawDesk, drawPlant, drawPrinter, drawTable } from './furniture.ts';
import type { BubbleSpec, IconName } from './icons.ts';
import { drawBubble } from './icons.ts';
import { Particles } from './particles.ts';

const STEP = 1 / 60;

interface Anim {
  from: Point;
  to: Point;
  t: number;
  dur: number;
  onDone: () => void;
}

interface AgentView {
  id: AgentId;
  x: number;
  y: number;
  dir: Dir;
  seated: boolean;
  moving: boolean;
  path: Point[];
  speed: number;
  target: PlaceId | null;
  anim: Anim | null;
  queued: { place: PlaceId; speed: number } | null;
  phase: number;
  fx: number;
  flash: { icon: IconName; t: number } | null;
}

interface DrawItem {
  y: number;
  draw: () => void;
}

/** Draw an agent's face-forward sprite into a small canvas (CSS scales it up). */
export function drawPortrait(canvas: HTMLCanvasElement, id: AgentId, talking = false): void {
  canvas.width = 16;
  canvas.height = 26;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.clearRect(0, 0, 16, 26);
  const look = ROSTER[id].look;
  g.drawImage(getSprite(id, look, 'down', talking ? 'talk' : 'stand', 0), 0, 0);
}

export class OfficeView {
  selected: AgentId | null = null;
  hover: AgentId | null = null;

  private canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private store: OfficeStore;
  private bg: HTMLCanvasElement;
  private agents = {} as Record<AgentId, AgentView>;
  private particles = new Particles();
  private time = 0;
  private last = 0;
  private acc = 0;
  private confetti = 0;
  private raf = 0;

  constructor(canvas: HTMLCanvasElement, store: OfficeStore) {
    this.canvas = canvas;
    this.canvas.width = W;
    this.canvas.height = H;
    const g = canvas.getContext('2d');
    if (!g) throw new Error('2d canvas unavailable');
    this.g = g;
    g.imageSmoothingEnabled = false;
    this.store = store;
    this.bg = buildBackground();
    this.resetAgents();
  }

  start(): void {
    const loop = (now: number): void => {
      // Fixed timestep so a slow frame can't make characters lag far behind the script.
      this.acc += this.last ? Math.min(0.25, (now - this.last) / 1000) : 0;
      this.last = now;
      while (this.acc >= STEP) {
        this.update(STEP);
        this.acc -= STEP;
      }
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  onEvent(e: OfficeEvent): void {
    switch (e.type) {
      case 'sim.reset':
        this.particles.clear();
        this.resetAgents();
        break;
      case 'agent.walk':
        this.startWalk(this.agents[e.agent], e.to, e.speed);
        break;
      case 'doc.delivered': {
        const d = DESKS[e.doc.to];
        this.particles.burst(d.x + 8, d.y + 2, '#f4f1e8', 6);
        break;
      }
      case 'review.verdict': {
        const qa = this.agents.qa;
        qa.flash = { icon: e.verdict === 'pass' ? 'check' : 'cross', t: 2.4 };
        const d = DESKS.qa;
        this.particles.burst(d.x + d.w / 2, d.y - 6, e.verdict === 'pass' ? '#2fb36a' : '#e5484d', 12);
        break;
      }
      case 'job.done':
        this.confetti = 3;
        break;
      default:
        break;
    }
  }

  /** The front-most agent under a point given in canvas (logical) pixels. */
  pick(x: number, y: number): AgentId | null {
    let best: AgentId | null = null;
    let bestY = -Infinity;
    for (const id of AGENT_IDS) {
      const a = this.agents[id];
      let left = a.x - 8;
      let right = a.x + 8;
      let bottom = a.y;
      if (a.seated) {
        const d = DESKS[id];
        left = Math.min(left, d.x);
        right = Math.max(right, d.x + d.w);
        bottom = d.y + d.h;
      }
      if (x >= left && x <= right && y >= a.y - 25 && y <= bottom) {
        const sy = this.sortY(a);
        if (sy > bestY) {
          bestY = sy;
          best = id;
        }
      }
    }
    return best;
  }

  // ---------- agents & movement ----------

  private resetAgents(): void {
    for (const id of AGENT_IDS) {
      const seat = seatPoint(id);
      this.agents[id] = {
        id,
        x: seat.x,
        y: seat.y,
        dir: 'down',
        seated: true,
        moving: false,
        path: [],
        speed: WALK_SPEED,
        target: null,
        anim: null,
        queued: null,
        phase: Math.random() * 3,
        fx: 0,
        flash: null,
      };
    }
  }

  private startWalk(a: AgentView, place: PlaceId, speedMul: number): void {
    if (a.anim) {
      a.queued = { place, speed: speedMul };
      return;
    }
    a.target = place;
    a.speed = WALK_SPEED * speedMul;
    const begin = (): void => {
      a.path = findPath({ x: a.x, y: a.y }, placePoint(place));
      a.moving = a.path.length > 0;
      if (!a.moving) this.arrive(a);
    };
    if (a.seated && place === `desk:${a.id}`) return;
    if (a.seated) {
      a.seated = false;
      this.animate(a, standPoint(a.id), speedMul, begin);
    } else {
      begin();
    }
  }

  private arrive(a: AgentView): void {
    a.moving = false;
    a.path = [];
    if (a.target === `desk:${a.id}`) {
      this.animate(a, seatPoint(a.id), 1, () => {
        a.seated = true;
        a.dir = 'down';
      });
    } else if (a.target) {
      a.dir = placeFacing(a.target);
    }
  }

  private animate(a: AgentView, to: Point, speedMul: number, then: () => void): void {
    a.anim = {
      from: { x: a.x, y: a.y },
      to,
      t: 0,
      dur: SIT_MS / 1000 / Math.max(1, speedMul),
      onDone: () => {
        a.anim = null;
        then();
        const q = a.queued;
        if (q && !a.anim) {
          a.queued = null;
          this.startWalk(a, q.place, q.speed);
        }
      },
    };
  }

  private update(dt: number): void {
    this.time += dt;
    for (const id of AGENT_IDS) this.updateAgent(this.agents[id], dt);
    if (this.confetti > 0) {
      this.confetti -= dt;
      this.particles.confetti(rand(40, W - 40), 30, 2);
    }
    this.particles.update(dt);
  }

  private updateAgent(a: AgentView, dt: number): void {
    if (a.flash) {
      a.flash.t -= dt;
      if (a.flash.t <= 0) a.flash = null;
    }
    if (a.anim) {
      const an = a.anim;
      an.t += dt;
      const k = Math.min(1, an.t / an.dur);
      a.x = an.from.x + (an.to.x - an.from.x) * k;
      a.y = an.from.y + (an.to.y - an.from.y) * k;
      if (k >= 1) an.onDone();
    } else if (a.moving) {
      let remaining = a.speed * dt;
      while (remaining > 0 && a.path.length) {
        const tgt = a.path[0];
        const dx = tgt.x - a.x;
        const dy = tgt.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d > 0.01) a.dir = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : dy < 0 ? 'up' : 'down';
        if (d <= remaining) {
          a.x = tgt.x;
          a.y = tgt.y;
          a.path.shift();
          remaining -= d;
        } else {
          a.x += (dx / d) * remaining;
          a.y += (dy / d) * remaining;
          remaining = 0;
        }
      }
      if (!a.path.length) this.arrive(a);
    }
    this.spawnEffects(a, dt);
  }

  private spawnEffects(a: AgentView, dt: number): void {
    const st = this.store.state.agents[a.id];
    a.fx -= dt;
    if (a.fx > 0) return;
    const d = DESKS[a.id];
    if (st.activity === 'typing' && a.seated) {
      a.fx = 0.22;
      this.particles.code(d.x + d.w - 9, d.y - 6);
    } else if (st.activity === 'error') {
      a.fx = 0.16;
      this.particles.smoke(a.x, a.y - 22);
    } else if (st.activity === 'celebrate') {
      a.fx = 0.35;
      this.particles.confetti(a.x, a.y - 24, 2);
    } else {
      a.fx = 0.3;
    }
  }

  // ---------- poses ----------

  private poseOf(a: AgentView, st: AgentState): Pose {
    if (a.moving) return st.carrying ? 'carry' : 'walk';
    if (a.anim) return 'stand';
    switch (st.activity) {
      case 'error':
        return 'alert';
      case 'celebrate':
        return 'cheer';
      case 'waiting':
        return 'wait';
      case 'talking':
        return 'talk';
      default:
        break;
    }
    if (a.seated) {
      if (st.activity === 'typing') return 'type';
      if (st.activity === 'thinking') return 'think';
      if (st.activity === 'reviewing') return 'review';
      return 'sit';
    }
    return st.carrying ? 'carry' : 'stand';
  }

  private frameOf(pose: Pose, a: AgentView): number {
    const t = this.time + a.phase;
    switch (pose) {
      case 'walk':
      case 'carry':
        return a.moving ? Math.floor(t * 8) % 4 : 0;
      case 'type':
        return Math.floor(t * 7) % 2;
      case 'talk':
        return Math.floor(t * 4) % 2;
      case 'cheer':
        return Math.floor(t * 5) % 2;
      case 'alert':
        return Math.floor(t * 6) % 2;
      default:
        return t % 3.4 < 0.14 ? 1 : 0;
    }
  }

  private sortY(a: AgentView): number {
    return a.seated ? DESKS[a.id].y + 10 : a.y;
  }

  private bubbleFor(a: AgentView, st: AgentState): BubbleSpec | null {
    if (a.flash) return { icon: a.flash.icon };
    if (this.store.state.chat?.from === a.id) return { icon: 'ques' };
    switch (st.activity) {
      case 'error':
        return { icon: 'excl', tone: 'alert' };
      case 'thinking':
        return { dots: Math.floor(this.time * 3) % 3 };
      case 'talking':
        return { icon: 'lines' };
      case 'waiting':
        return { icon: 'zzz' };
      case 'reviewing':
        return { icon: 'mag' };
      case 'celebrate':
        return { icon: 'star' };
      default:
        return null;
    }
  }

  // ---------- drawing ----------

  private draw(): void {
    const g = this.g;
    g.drawImage(this.bg, 0, 0);
    this.drawWall();

    const items: DrawItem[] = [];
    for (const id of AGENT_IDS) {
      const d = DESKS[id];
      items.push({ y: d.y + 5, draw: () => drawChair(g, d) });
      items.push({ y: d.y + d.h, draw: () => this.drawDeskOf(id) });
      items.push({ y: this.sortY(this.agents[id]), draw: () => this.drawAgent(this.agents[id]) });
    }
    items.push({ y: TABLE.y + TABLE.h, draw: () => drawTable(g, TABLE) });
    const busy = this.store.state.queue.length > 0;
    for (const p of PROPS) {
      items.push({
        y: p.rect.y + p.rect.h,
        draw: () => {
          if (p.kind === 'plant') drawPlant(g, p.rect);
          else if (p.kind === 'cooler') drawCooler(g, p.rect);
          else drawPrinter(g, p.rect, busy);
        },
      });
    }
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();

    this.particles.draw(g);
    for (const id of AGENT_IDS) this.drawOverhead(this.agents[id]);
  }

  private drawDeskOf(id: AgentId): void {
    const a = this.agents[id];
    const st = this.store.state.agents[id];
    const active = a.seated && (st.activity === 'typing' || st.activity === 'reviewing' || st.activity === 'thinking');
    drawDesk(this.g, DESKS[id], {
      accent: DEPT_COLOR[ROSTER[id].dept],
      typing: a.seated && st.activity === 'typing',
      frame: Math.floor((this.time + a.phase) * 7) % 2,
      inbox: st.inbox,
      skin: ROSTER[id].look.skin,
      active,
    });
  }

  private drawAgent(a: AgentView): void {
    const g = this.g;
    const st = this.store.state.agents[a.id];
    const pose = this.poseOf(a, st);
    const sprite = getSprite(a.id, ROSTER[a.id].look, a.dir, pose, this.frameOf(pose, a));
    const x = Math.round(a.x);
    const y = Math.round(a.y);
    if (!a.seated) {
      g.globalAlpha = 0.28;
      g.fillStyle = '#0c0a18';
      g.fillRect(x - 5, y - 1, 10, 2);
      g.fillRect(x - 4, y - 2, 8, 1);
      g.globalAlpha = 1;
    }
    g.drawImage(sprite, x - 8, y - 25);
  }

  private drawOverhead(a: AgentView): void {
    const g = this.g;
    const st = this.store.state.agents[a.id];
    const headTop = Math.round(a.y) - 22;
    const bubble = this.bubbleFor(a, st);
    const bob = Math.round(Math.sin((this.time + a.phase) * 4));
    if (bubble) drawBubble(g, a.x, headTop - 16 + bob, bubble);
    if (this.selected === a.id) {
      const my = bubble ? headTop - 22 : headTop - 8;
      const mx = Math.round(a.x);
      g.fillStyle = '#ffcc4d';
      g.fillRect(mx - 2, my + bob, 5, 1);
      g.fillRect(mx - 1, my + 1 + bob, 3, 1);
      g.fillRect(mx, my + 2 + bob, 1, 1);
    }
  }

  private drawWall(): void {
    const g = this.g;
    const s = this.store.state;

    // whiteboard progress
    const idx = WORK_STAGES.indexOf(s.stage);
    const doneAll = s.stage === 'done';
    let doneCount = 0;
    for (let i = 0; i < WORK_STAGES.length; i++) {
      const x = BOARD.x + 6 + i * 13;
      const y = BOARD.y + 5;
      const done = doneAll || (idx >= 0 && i < idx);
      const current = !doneAll && i === idx;
      if (done) doneCount++;
      g.fillStyle = '#1d1b2e';
      g.fillRect(x, y, 9, 9);
      g.fillStyle = done ? '#2fb36a' : current ? (Math.floor(this.time * 3) % 2 ? '#f2c14e' : '#e0a92f') : '#d3d8e4';
      g.fillRect(x + 1, y + 1, 7, 7);
      if (done) {
        g.fillStyle = '#ffffff';
        g.fillRect(x + 2, y + 4, 1, 1);
        g.fillRect(x + 3, y + 5, 1, 1);
        g.fillRect(x + 4, y + 4, 1, 1);
        g.fillRect(x + 5, y + 3, 1, 1);
        g.fillRect(x + 6, y + 2, 1, 1);
      }
    }
    const frac = (doneAll ? WORK_STAGES.length : doneCount + (idx >= 0 ? 0.5 : 0)) / WORK_STAGES.length;
    g.fillStyle = '#d3d8e4';
    g.fillRect(BOARD.x + 6, BOARD.y + 19, 84, 4);
    g.fillStyle = '#4a8fd9';
    g.fillRect(BOARD.x + 6, BOARD.y + 19, Math.round(84 * frac), 4);
    if (s.lastVerdict) {
      g.fillStyle = s.lastVerdict.verdict === 'pass' ? '#2fb36a' : '#e5484d';
      g.fillRect(BOARD.x + 6, BOARD.y + 25, 5, 3);
    }

    // pigeonholes show the courier queue
    const n = Math.min(HOLES.cols * HOLES.rows, s.queue.length);
    for (let i = 0; i < n; i++) {
      const col = i % HOLES.cols;
      const row = Math.floor(i / HOLES.cols);
      const x = HOLES.x + col * HOLES.cw;
      const y = HOLES.y + row * HOLES.ch;
      g.fillStyle = '#f4f1e8';
      g.fillRect(x + 1, y + 2, HOLES.cw - 3, HOLES.ch - 4);
      g.fillStyle = '#4a8fd9';
      g.fillRect(x + 2, y + 3, HOLES.cw - 6, 1);
    }

    // clock
    const rows = [3, 5, 7, 9, 9, 9, 7, 5, 3];
    for (let r = 0; r < rows.length; r++) {
      g.fillStyle = '#1d1b2e';
      g.fillRect(CLOCK.x - Math.floor((rows[r] + 2) / 2), CLOCK.y - 5 + r, rows[r] + 2, 1);
    }
    for (let r = 0; r < rows.length; r++) {
      g.fillStyle = '#f4f6fa';
      g.fillRect(CLOCK.x - Math.floor(rows[r] / 2), CLOCK.y - 5 + r, rows[r], 1);
    }
    const now = new Date();
    const hand = (angle: number, len: number, color: string): void => {
      g.fillStyle = color;
      for (let k = 0; k <= len; k++) {
        g.fillRect(Math.round(CLOCK.x + Math.sin(angle) * k), Math.round(CLOCK.y - Math.cos(angle) * k), 1, 1);
      }
    };
    hand(((now.getHours() % 12) + now.getMinutes() / 60) * (Math.PI / 6), 2, '#1d1b2e');
    hand(now.getMinutes() * (Math.PI / 30), 3, '#1d1b2e');
    hand(now.getSeconds() * (Math.PI / 30), 3, '#e5484d');
  }
}

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}
