// Pure geometry of the office: layout, named places, walkable grid and A* paths.
// No DOM here: the simulator uses it to time courier trips and the view uses it
// to move characters, so both agree on distances.

import type { AgentId, HuddleSlot, MeetSlot, PlaceId, Pod } from './types.ts';

export const W = 384;
export const H = 224;
export const CELL = 8;
export const COLS = W / CELL;
export const ROWS = H / CELL;
/** Wall occupies y < WALL_H; the floor starts below it. */
export const WALL_H = 44;
/** Walking speed in logical pixels per second at 1x. */
export const WALK_SPEED = 46;
/** Time to stand up from / sit down at a desk (ms). */
export const SIT_MS = 280;
/** Sprite-anchor offset from desk top to the seated character's feet line. */
export const SEAT_DY = 7;

export interface Point {
  x: number;
  y: number;
}
export interface Rect extends Point {
  w: number;
  h: number;
}

const DESK_W = 34;
const DESK_H = 20;

export const DESKS: Record<AgentId, Rect> = {
  owner: { x: 12, y: 52, w: 46, h: 22 },
  secretary: { x: 70, y: 54, w: DESK_W, h: DESK_H },
  courier: { x: 250, y: 54, w: DESK_W, h: DESK_H },
  qa: { x: 330, y: 54, w: DESK_W, h: DESK_H },
  'research-head': { x: 32, y: 112, w: DESK_W, h: DESK_H },
  'research-1': { x: 8, y: 160, w: DESK_W, h: DESK_H },
  'research-2': { x: 56, y: 160, w: DESK_W, h: DESK_H },
  'prod-head': { x: 318, y: 112, w: DESK_W, h: DESK_H },
  'prod-1': { x: 294, y: 160, w: DESK_W, h: DESK_H },
  'prod-2': { x: 342, y: 160, w: DESK_W, h: DESK_H },
};

export const TABLE: Rect = { x: 128, y: 62, w: 96, h: 26 };

/** Static floor furniture that blocks walking (besides desks and the table). */
export const PROPS: { kind: 'plant' | 'cooler' | 'printer'; rect: Rect }[] = [
  { kind: 'plant', rect: { x: 108, y: 58, w: 12, h: 16 } },
  { kind: 'plant', rect: { x: 4, y: 196, w: 14, h: 18 } },
  { kind: 'plant', rect: { x: 366, y: 196, w: 14, h: 18 } },
  { kind: 'cooler', rect: { x: 140, y: 172, w: 12, h: 20 } },
  { kind: 'printer', rect: { x: 236, y: 170, w: 22, h: 16 } },
];

// ---------- walkable grid ----------

const blocked = new Uint8Array(COLS * ROWS);

function blockRect(r: Rect): void {
  const c0 = Math.max(0, Math.floor(r.x / CELL));
  const c1 = Math.min(COLS - 1, Math.floor((r.x + r.w - 1) / CELL));
  const r0 = Math.max(0, Math.floor(r.y / CELL));
  const r1 = Math.min(ROWS - 1, Math.floor((r.y + r.h - 1) / CELL));
  for (let row = r0; row <= r1; row++) {
    for (let col = c0; col <= c1; col++) blocked[row * COLS + col] = 1;
  }
}

blockRect({ x: 0, y: 0, w: W, h: WALL_H + 4 }); // wall + the strip hidden behind desks
for (const d of Object.values(DESKS)) blockRect(d);
blockRect(TABLE);
for (const p of PROPS) blockRect(p.rect);

export function isBlockedCell(col: number, row: number): boolean {
  if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return true;
  return blocked[row * COLS + col] === 1;
}

function cellOf(p: Point): { col: number; row: number } {
  return {
    col: Math.min(COLS - 1, Math.max(0, Math.floor(p.x / CELL))),
    row: Math.min(ROWS - 1, Math.max(0, Math.floor(p.y / CELL))),
  };
}

function centerOf(col: number, row: number): Point {
  return { x: col * CELL + CELL / 2, y: row * CELL + CELL / 2 };
}

/** Centre of the cell containing p. */
export function snap(p: Point): Point {
  const { col, row } = cellOf(p);
  return centerOf(col, row);
}

// ---------- places ----------

function deskCx(id: AgentId): number {
  const d = DESKS[id];
  return d.x + d.w / 2;
}

/** Where the character's feet are while sitting at their desk. */
export function seatPoint(id: AgentId): Point {
  return { x: deskCx(id), y: DESKS[id].y + SEAT_DY };
}

/** The floor cell in front of a desk (where agents stand up / arrive). */
export function standPoint(id: AgentId): Point {
  const d = DESKS[id];
  return snap({ x: deskCx(id), y: d.y + d.h + 6 });
}

const POD_X: Record<Pod, number> = { research: 49, production: 335 };

export function placePoint(place: PlaceId): Point {
  const [kind, a, b] = place.split(':');
  switch (kind) {
    case 'desk':
      return standPoint(a as AgentId);
    case 'visit': {
      const s = standPoint(a as AgentId);
      return snap({ x: s.x + 14, y: s.y });
    }
    case 'meet': {
      const slot = Number(a) as MeetSlot;
      const col = slot % 3;
      const x = TABLE.x + 18 + col * 30;
      const y = slot < 3 ? TABLE.y - 8 : TABLE.y + TABLE.h + 6;
      return snap({ x, y });
    }
    case 'huddle': {
      const pod = a as Pod;
      const slot = Number(b) as HuddleSlot;
      return snap({ x: POD_X[pod] + (slot - 1) * 16, y: 148 });
    }
    default:
      return snap({ x: 176, y: 208 }); // client
  }
}

export type Facing = 'down' | 'up' | 'left' | 'right';

export function placeFacing(place: PlaceId): Facing {
  const kind = place.split(':')[0];
  if (kind === 'meet') return Number(place.split(':')[1]) < 3 ? 'down' : 'up';
  if (kind === 'visit') return 'left';
  return 'down';
}

// ---------- A* ----------

const SQRT2 = Math.SQRT2;

function nearestFree(col: number, row: number): { col: number; row: number } {
  if (!isBlockedCell(col, row)) return { col, row };
  for (let r = 1; r < 8; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (!isBlockedCell(col + dx, row + dy)) return { col: col + dx, row: row + dy };
      }
    }
  }
  return { col, row };
}

/**
 * Shortest walkable route between two points, as cell-centre waypoints
 * (the start itself is not included; the last waypoint is the goal cell).
 */
export function findPath(from: Point, to: Point): Point[] {
  const s = nearestFree(cellOf(from).col, cellOf(from).row);
  const g = nearestFree(cellOf(to).col, cellOf(to).row);
  const startIdx = s.row * COLS + s.col;
  const goalIdx = g.row * COLS + g.col;
  if (startIdx === goalIdx) return [];

  const gScore = new Float32Array(COLS * ROWS).fill(Infinity);
  const prev = new Int32Array(COLS * ROWS).fill(-1);
  const closed = new Uint8Array(COLS * ROWS);
  const open: number[] = [startIdx];
  const fScore = new Float32Array(COLS * ROWS).fill(Infinity);
  gScore[startIdx] = 0;

  const h = (idx: number): number => {
    const dx = Math.abs((idx % COLS) - g.col);
    const dy = Math.abs(Math.floor(idx / COLS) - g.row);
    return Math.max(dx, dy) + (SQRT2 - 1) * Math.min(dx, dy);
  };
  fScore[startIdx] = h(startIdx);

  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) {
      if (fScore[open[i]] < fScore[open[bi]]) bi = i;
    }
    const cur = open.splice(bi, 1)[0];
    if (cur === goalIdx) break;
    closed[cur] = 1;
    const cc = cur % COLS;
    const cr = Math.floor(cur / COLS);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nc = cc + dx;
        const nr = cr + dy;
        if (isBlockedCell(nc, nr)) continue;
        if (dx && dy && (isBlockedCell(cc + dx, cr) || isBlockedCell(cc, cr + dy))) continue;
        const ni = nr * COLS + nc;
        if (closed[ni]) continue;
        const cost = gScore[cur] + (dx && dy ? SQRT2 : 1);
        if (cost < gScore[ni]) {
          gScore[ni] = cost;
          prev[ni] = cur;
          fScore[ni] = cost + h(ni);
          if (!open.includes(ni)) open.push(ni);
        }
      }
    }
  }

  if (prev[goalIdx] === -1) return [];
  const rev: Point[] = [];
  for (let i = goalIdx; i !== startIdx; i = prev[i]) {
    rev.push(centerOf(i % COLS, Math.floor(i / COLS)));
  }
  return rev.reverse();
}

export function pathLength(from: Point, path: Point[]): number {
  let len = 0;
  let cur = from;
  for (const p of path) {
    len += Math.hypot(p.x - cur.x, p.y - cur.y);
    cur = p;
  }
  return len;
}

/** Estimated walking time (ms, at 1x) between two places, including sit/stand. */
export function travelMs(a: PlaceId, b: PlaceId): number {
  if (a === b) return 0;
  const from = placePoint(a);
  const path = findPath(from, placePoint(b));
  let ms = (pathLength(from, path) / WALK_SPEED) * 1000;
  if (a.startsWith('desk:')) ms += SIT_MS;
  if (b.startsWith('desk:')) ms += SIT_MS;
  return ms;
}

export const ALL_PLACES: PlaceId[] = [
  ...(Object.keys(DESKS) as AgentId[]).flatMap((id): PlaceId[] => [`desk:${id}`, `visit:${id}`]),
  'meet:0',
  'meet:1',
  'meet:2',
  'meet:3',
  'meet:4',
  'meet:5',
  'huddle:research:0',
  'huddle:research:1',
  'huddle:research:2',
  'huddle:production:0',
  'huddle:production:1',
  'huddle:production:2',
  'client',
];
