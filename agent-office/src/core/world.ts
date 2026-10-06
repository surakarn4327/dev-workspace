// Pure geometry of the office: one building with half-height partitions, named
// places, a walkable grid and A* paths. No DOM here: the simulator uses it to time
// trips and the view uses it to move characters, so both agree on distances.
//
//   rows 0-5    back wall            rows 13-15  corridor (full width)
//   rows 6-11   top rooms            rows 17-27  bottom rooms
//   row 12/16   partitions with door gaps
//   cols 0-7    left wing   (restroom | archive)      cols 51-58  right wing (server | pantry)
//   top rooms:    exec · meeting room · mail room · QA lab
//   bottom rooms: research lab · lobby · production studio

import type { AgentId, HuddleSlot, MeetSlot, PlaceId, Pod } from './types.ts';

export const W = 472;
export const H = 224;
export const CELL = 8;
export const COLS = W / CELL;
export const ROWS = H / CELL;
/** Back wall occupies y < WALL_H; floors start below it. */
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

/** Rectangle covering whole grid cells (inclusive). */
export function cellsRect(c0: number, r0: number, c1: number, r1: number): Rect {
  return { x: c0 * CELL, y: r0 * CELL, w: (c1 - c0 + 1) * CELL, h: (r1 - r0 + 1) * CELL };
}

const DESK_W = 34;
const DESK_H = 20;

export const DESKS: Record<AgentId, Rect> = {
  owner: { x: 76, y: 52, w: 46, h: 22 },
  secretary: { x: 126, y: 54, w: DESK_W, h: DESK_H },
  courier: { x: 303, y: 54, w: DESK_W, h: DESK_H },
  qa: { x: 359, y: 54, w: DESK_W, h: DESK_H },
  'research-head': { x: 107, y: 146, w: DESK_W, h: DESK_H },
  'research-1': { x: 76, y: 186, w: DESK_W, h: DESK_H },
  'research-2': { x: 138, y: 186, w: DESK_W, h: DESK_H },
  'prod-head': { x: 331, y: 146, w: DESK_W, h: DESK_H },
  'prod-1': { x: 300, y: 186, w: DESK_W, h: DESK_H },
  'prod-2': { x: 362, y: 186, w: DESK_W, h: DESK_H },
};

export const TABLE: Rect = { x: 180, y: 62, w: 96, h: 26 };

export type PropKind =
  | 'plant'
  | 'cooler'
  | 'printer'
  | 'cabinet'
  | 'sofa'
  | 'coffee-table'
  | 'stall'
  | 'rack'
  | 'shelf'
  | 'counter'
  | 'fridge'
  | 'pantry-table';

export interface Prop {
  kind: PropKind;
  rect: Rect;
}

/** Floor furniture that blocks walking (besides desks and the meeting table). */
export const PROPS: Prop[] = [
  // lobby
  { kind: 'plant', rect: { x: 188, y: 140, w: 14, h: 18 } },
  { kind: 'plant', rect: { x: 270, y: 140, w: 14, h: 18 } },
  // copy corner against the wall on the lab side of the lobby
  { kind: 'printer', rect: { x: 186, y: 160, w: 22, h: 16 } },
  { kind: 'cabinet', rect: { x: 188, y: 180, w: 16, h: 22 } },
  { kind: 'sofa', rect: { x: 210, y: 186, w: 44, h: 18 } },
  { kind: 'coffee-table', rect: { x: 220, y: 208, w: 28, h: 10 } },
  { kind: 'cooler', rect: { x: 272, y: 196, w: 12, h: 20 } },
  // corridor ends
  { kind: 'plant', rect: { x: 2, y: 108, w: 14, h: 18 } },
  { kind: 'plant', rect: { x: 456, y: 108, w: 14, h: 18 } },
  // restroom
  { kind: 'stall', rect: { x: 4, y: 48, w: 24, h: 26 } },
  { kind: 'stall', rect: { x: 36, y: 48, w: 24, h: 26 } },
  // server room
  { kind: 'rack', rect: { x: 412, y: 48, w: 16, h: 30 } },
  { kind: 'rack', rect: { x: 432, y: 48, w: 16, h: 30 } },
  { kind: 'rack', rect: { x: 452, y: 48, w: 16, h: 30 } },
  // archive
  { kind: 'shelf', rect: { x: 2, y: 138, w: 20, h: 40 } },
  { kind: 'shelf', rect: { x: 42, y: 138, w: 20, h: 40 } },
  // pantry
  { kind: 'counter', rect: { x: 410, y: 138, w: 22, h: 18 } },
  { kind: 'fridge', rect: { x: 458, y: 138, w: 14, h: 26 } },
  { kind: 'pantry-table', rect: { x: 432, y: 184, w: 24, h: 16 } },
];

// ---------- rooms & doors (used for floors, signs and lights) ----------

export type RoomId =
  | 'restroom'
  | 'exec'
  | 'meeting'
  | 'mail'
  | 'qa'
  | 'server'
  | 'archive'
  | 'research'
  | 'production'
  | 'pantry'
  | 'lobby';

export interface Room {
  id: RoomId;
  rect: Rect;
}

export const ROOMS: Room[] = [
  { id: 'restroom', rect: cellsRect(0, 6, 7, 11) },
  { id: 'exec', rect: cellsRect(9, 6, 19, 11) },
  { id: 'meeting', rect: cellsRect(21, 6, 35, 11) },
  { id: 'mail', rect: cellsRect(37, 6, 42, 11) },
  { id: 'qa', rect: cellsRect(44, 6, 49, 11) },
  { id: 'server', rect: cellsRect(51, 6, 58, 11) },
  { id: 'archive', rect: cellsRect(0, 17, 7, 27) },
  { id: 'research', rect: cellsRect(9, 17, 21, 27) },
  { id: 'lobby', rect: cellsRect(23, 17, 35, 27) },
  { id: 'production', rect: cellsRect(37, 17, 49, 27) },
  { id: 'pantry', rect: cellsRect(51, 17, 58, 27) },
];

/** The room each agent's desk is in. Documents inside one room are handed over by hand; across rooms the courier carries them. */
export const ROOM_OF: Record<AgentId, RoomId> = {
  owner: 'exec',
  secretary: 'exec',
  courier: 'mail',
  qa: 'qa',
  'research-head': 'research',
  'research-1': 'research',
  'research-2': 'research',
  'prod-head': 'production',
  'prod-1': 'production',
  'prod-2': 'production',
};

export const sameRoom = (a: AgentId, b: AgentId): boolean => ROOM_OF[a] === ROOM_OF[b];

/** Door gaps in the two horizontal partition rows (columns, 3 cells wide each). */
const GAPS_TOP: Record<string, number> = {
  restroom: 3,
  exec: 13,
  meeting: 27,
  mail: 39,
  qa: 46,
  server: 54,
};
const GAPS_BOTTOM: Record<string, number> = {
  archive: 3,
  research: 13,
  production: 41,
  pantry: 54,
};

export interface Door {
  room: RoomId;
  /** Centre x and top y of the doorway (3 cells wide, 1 cell tall). */
  cx: number;
  y: number;
}

export const DOORS: Door[] = [
  ...Object.entries(GAPS_TOP).map(([room, col]) => ({ room: room as RoomId, cx: (col + 1.5) * CELL, y: 12 * CELL })),
  ...Object.entries(GAPS_BOTTOM).map(([room, col]) => ({ room: room as RoomId, cx: (col + 1.5) * CELL, y: 16 * CELL })),
];

// ---------- partition walls ----------

export interface WallCell {
  col: number;
  row: number;
}

const wallSet = new Set<number>();
export const WALL_CELLS: WallCell[] = [];

function addWall(col: number, row: number): void {
  const key = row * COLS + col;
  if (wallSet.has(key)) return;
  wallSet.add(key);
  WALL_CELLS.push({ col, row });
}

export function isWallCell(col: number, row: number): boolean {
  return wallSet.has(row * COLS + col);
}

(() => {
  const gapsTop = Object.values(GAPS_TOP).flatMap((c) => [c, c + 1, c + 2]);
  const gapsBottom = Object.values(GAPS_BOTTOM).flatMap((c) => [c, c + 1, c + 2]);
  for (let col = 0; col < COLS; col++) {
    if (!gapsTop.includes(col)) addWall(col, 12);
    const inLobby = col >= 23 && col <= 35; // the lobby is open to the corridor
    if (!inLobby && !gapsBottom.includes(col)) addWall(col, 16);
  }
  for (const col of [8, 20, 36, 43, 50]) for (let row = 6; row <= 11; row++) addWall(col, row);
  for (const col of [8, 22, 36, 50]) for (let row = 17; row <= 27; row++) addWall(col, row);
})();

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

blockRect({ x: 0, y: 0, w: W, h: WALL_H + 4 }); // back wall + the strip hidden behind desks
for (const w of WALL_CELLS) blocked[w.row * COLS + w.col] = 1;
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

export const POD_X: Record<Pod, number> = { research: 124, production: 348 };
const HUDDLE_Y = 180;

const PANTRY_SPOTS: Point[] = [
  { x: 420, y: 164 }, // in front of the coffee machine
  { x: 464, y: 172 }, // by the fridge
  { x: 444, y: 176 }, // at the table
];
const RESTROOM_SPOTS: Point[] = [
  { x: 16, y: 84 },
  { x: 48, y: 84 },
];

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
      return snap({ x: POD_X[pod] + (slot - 1) * 16, y: HUDDLE_Y });
    }
    case 'pantry':
      return snap(PANTRY_SPOTS[Number(a)]);
    case 'restroom':
      return snap(RESTROOM_SPOTS[Number(a)]);
    case 'server':
      return snap({ x: 440, y: 84 });
    case 'archive':
      return snap({ x: 32, y: 188 });
    case 'printer':
      return snap({ x: 224, y: 168 });
    default:
      return snap({ x: 256, y: 176 }); // client, in the lobby
  }
}

export type Facing = 'down' | 'up' | 'left' | 'right';

export function placeFacing(place: PlaceId): Facing {
  const kind = place.split(':')[0];
  if (kind === 'meet') return Number(place.split(':')[1]) < 3 ? 'down' : 'up';
  if (kind === 'visit' || kind === 'printer') return 'left';
  if (kind === 'pantry' || kind === 'restroom' || kind === 'server' || kind === 'archive') return 'up';
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
  'pantry:0',
  'pantry:1',
  'pantry:2',
  'restroom:0',
  'restroom:1',
  'server:0',
  'archive:0',
  'printer:0',
  'client',
];
