import assert from 'node:assert/strict';
import { test } from 'node:test';
import { indexedDbRecordingStore, memoryRecordingStore } from './recording-store.ts';
import type { Recording } from './recording.ts';

const rec = (n: number): Recording => ({ v: 1, id: `r${n}`, title: `Job ${n}`, startedAt: n * 1000, durationMs: 100, ended: 'done', events: [{ t: 0, e: { type: 'sim.reset' } }] });

test('recordings come back newest first, as light summaries; a single one comes back whole', async () => {
  const s = memoryRecordingStore();
  await s.put(rec(1));
  await s.put(rec(3));
  await s.put(rec(2));
  const list = await s.list();
  assert.deepEqual(list.map((m) => m.id), ['r3', 'r2', 'r1']);
  assert.equal('events' in list[0], false);
  assert.equal(list[0].eventCount, 1);
  assert.equal((await s.get('r2'))?.events.length, 1);
  assert.equal(await s.get('nope'), null);
});

test('only the newest few are kept', async () => {
  const s = memoryRecordingStore(3);
  for (let i = 1; i <= 6; i++) await s.put(rec(i));
  assert.deepEqual((await s.list()).map((m) => m.id), ['r6', 'r5', 'r4']);
  assert.equal(await s.get('r1'), null);
});

test('saving the same recording again replaces it, and a recording can be removed', async () => {
  const s = memoryRecordingStore();
  await s.put(rec(1));
  await s.put({ ...rec(1), title: 'Renamed' });
  assert.equal((await s.list()).length, 1);
  assert.equal((await s.list())[0].title, 'Renamed');
  await s.remove('r1');
  await s.remove('r1'); // removing what is gone is fine
  assert.deepEqual(await s.list(), []);
});

test('with no IndexedDB at all (or one that fails) the store keeps working in memory for the session', async () => {
  const none = indexedDbRecordingStore(5, undefined);
  await none.put(rec(1));
  assert.deepEqual((await none.list()).map((m) => m.id), ['r1']);

  const failing = {
    open() {
      const req: Record<string, unknown> = {};
      setTimeout(() => (req.onerror as () => void)?.(), 0);
      return req;
    },
  } as unknown as IDBFactory;
  const broken = indexedDbRecordingStore(5, failing);
  await broken.put(rec(2));
  await broken.put(rec(3));
  assert.deepEqual((await broken.list()).map((m) => m.id), ['r3', 'r2']);
  assert.equal((await broken.get('r2'))?.title, 'Job 2');
  await broken.remove('r2');
  assert.deepEqual((await broken.list()).map((m) => m.id), ['r3']);
});
