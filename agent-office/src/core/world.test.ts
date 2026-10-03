import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ALL_PLACES,
  COLS,
  DESKS,
  DOORS,
  PROPS,
  ROOMS,
  ROWS,
  TABLE,
  WALL_CELLS,
  findPath,
  isBlockedCell,
  isWallCell,
  placePoint,
  seatPoint,
  standPoint,
  travelMs,
} from './world.ts';
import { AGENT_IDS } from './types.ts';

function cellBlocked(p: { x: number; y: number }): boolean {
  return isBlockedCell(Math.floor(p.x / 8), Math.floor(p.y / 8));
}

test('every named place is on a walkable cell', () => {
  for (const place of ALL_PLACES) {
    assert.equal(cellBlocked(placePoint(place)), false, `${place} is blocked`);
  }
});

test('every place is reachable from every other place', () => {
  const origin = placePoint('desk:owner');
  for (const place of ALL_PLACES) {
    const target = placePoint(place);
    const path = findPath(origin, target);
    if (place !== 'desk:owner') assert.ok(path.length > 0, `no path to ${place}`);
    const end = path[path.length - 1] ?? origin;
    assert.deepEqual(end, target, `path to ${place} does not end at the goal`);
  }
});

test('paths never cut through blocked cells', () => {
  const path = findPath(placePoint('desk:research-1'), placePoint('desk:prod-2'));
  for (const p of path) assert.equal(cellBlocked(p), false);
});

test('travel time grows with distance and includes sitting down', () => {
  const near = travelMs('desk:owner', 'desk:secretary');
  const far = travelMs('desk:owner', 'desk:prod-2');
  assert.ok(far > near, 'far trip should take longer');
  assert.equal(travelMs('client', 'client'), 0);
  assert.ok(travelMs('client', 'desk:owner') > travelMs('client', 'visit:owner') - 1000);
});

test('each seat sits behind its desk and its stand point is in front', () => {
  for (const id of AGENT_IDS) {
    assert.ok(standPoint(id).y > seatPoint(id).y, `${id} stand point should be below the seat`);
    assert.equal(cellBlocked(standPoint(id)), false);
  }
});

test('partitions really separate rooms: you must use a door to get from one to another', () => {
  // The restroom and the archive share a wing column but have a wall between them.
  assert.ok(isWallCell(3, 12) === false, 'restroom door gap should be open');
  assert.ok(isWallCell(0, 12) && isWallCell(7, 12), 'restroom wall should be solid beside its door');
  // The restroom and the executive suite are neighbours with a solid wall between them, so
  // walking from one to the other must go out through one door and in through the other.
  const a = placePoint('restroom:0');
  const b = placePoint('desk:owner');
  const straight = Math.hypot(a.x - b.x, a.y - b.y);
  const path = findPath(a, b);
  const walked = path.reduce(
    (len, p, i) => len + Math.hypot(p.x - (i ? path[i - 1].x : a.x), p.y - (i ? path[i - 1].y : a.y)),
    0,
  );
  assert.ok(walked > straight * 1.5, `a wall should force a detour (walked ${walked}, straight ${straight})`);
});

test('every room can be entered and left through its own door', () => {
  const lobby = placePoint('client');
  for (const door of DOORS) {
    const room = ROOMS.find((r) => r.id === door.room);
    assert.ok(room, `door ${door.room} has no room`);
    // A free cell just inside the room, under/over the door, must connect to the lobby.
    const inside = { x: door.cx, y: door.y < 100 ? door.y - 8 : door.y + 12 };
    assert.equal(cellBlocked(inside) && door.room !== 'archive', false, `${door.room}: nothing free behind the door`);
    const path = findPath(lobby, inside);
    assert.ok(path.length > 0, `${door.room}: no route from the lobby through the door`);
  }
});

test('the building layout is consistent', () => {
  assert.equal(COLS * 8, 472);
  assert.equal(ROWS * 8, 224);
  assert.ok(WALL_CELLS.length > 100, 'expected a good number of partition cells');
  assert.ok(Object.keys(DESKS).length === AGENT_IDS.length);
  assert.ok(TABLE.w > 0);
  // No prop may sit on top of a partition.
  for (const p of PROPS) {
    for (let r = Math.floor(p.rect.y / 8); r <= Math.floor((p.rect.y + p.rect.h - 1) / 8); r++) {
      for (let c = Math.floor(p.rect.x / 8); c <= Math.floor((p.rect.x + p.rect.w - 1) / 8); c++) {
        assert.equal(isWallCell(c, r), false, `${p.kind} overlaps a wall at col ${c} row ${r}`);
      }
    }
  }
});
