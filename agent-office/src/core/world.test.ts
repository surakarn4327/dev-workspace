import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALL_PLACES, findPath, isBlockedCell, placePoint, seatPoint, standPoint, travelMs } from './world.ts';
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
