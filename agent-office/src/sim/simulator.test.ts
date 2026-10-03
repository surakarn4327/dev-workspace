import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OfficeStore } from '../core/state.ts';
import type { OfficeEvent, Stage } from '../core/types.ts';
import { MockOffice } from './simulator.ts';

/** Run a whole job at warp speed and return every event it emitted. */
function runJob(configure?: (office: MockOffice) => void): Promise<OfficeEvent[]> {
  const office = new MockOffice({ timeScale: 4000, autoAnswer: true, ambient: false });
  configure?.(office);
  const events: OfficeEvent[] = [];
  const store = new OfficeStore();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('job did not finish in time')), 20000);
    office.subscribe((e) => {
      events.push(e);
      store.apply(e);
      if (e.type === 'job.done') {
        clearTimeout(timer);
        // Let trailing events (idle resets) flush before returning.
        setTimeout(() => resolve(events), 50);
      }
    });
    office.start();
  });
}

test('a full job walks through all seven stages in order', async () => {
  const events = await runJob();
  const stages = events.filter((e) => e.type === 'job.stage').map((e) => e.stage);
  const expected: Stage[] = ['brief', 'approval', 'meeting', 'team', 'work', 'review', 'delivery', 'done'];
  assert.deepEqual(stages, expected);
});

test('every queued document is picked up and delivered exactly once, in FIFO order', async () => {
  const events = await runJob();
  const queued = events.filter((e) => e.type === 'doc.queued').map((e) => e.doc.id);
  const picked = events.filter((e) => e.type === 'doc.pickup').map((e) => e.doc.id);
  const delivered = events.filter((e) => e.type === 'doc.delivered').map((e) => e.doc.id);
  assert.ok(queued.length >= 10, 'expected a realistic number of handoffs');
  assert.deepEqual([...picked].sort(), [...queued].sort());
  assert.deepEqual(delivered, picked, 'deliveries should follow pickup order');
  // FIFO: documents are picked up in the order they were queued.
  const queuedOrder = new Map(queued.map((id, i) => [id, i]));
  const pickOrder = picked.map((id) => queuedOrder.get(id) ?? -1);
  assert.deepEqual(pickOrder, [...pickOrder].sort((a, b) => a - b));
});

test('the user is asked for the brief, approval and acceptance', async () => {
  const events = await runJob();
  const asks = events.filter((e) => e.type === 'chat.ask');
  assert.ok(asks.length >= 5);
  assert.equal(asks[0].from, 'owner');
  assert.ok(asks.some((a) => a.from === 'secretary'), 'secretary should deliver the result');
  const answered = events.filter((e) => e.type === 'user.say').length;
  assert.equal(answered, asks.length);
});

test('forcing a QA reject sends the work back once, then it passes', async () => {
  const events = await runJob((o) => {
    o.rejectNextReview = true;
  });
  const verdicts = events.filter((e) => e.type === 'review.verdict').map((e) => e.verdict);
  assert.deepEqual(verdicts, ['reject', 'pass']);
});

test('the store ends the job with an empty courier queue and no open chat', async () => {
  const office = new MockOffice({ timeScale: 4000, autoAnswer: true, ambient: false });
  const store = new OfficeStore();
  await new Promise<void>((resolve) => {
    office.subscribe((e) => {
      store.apply(e);
      if (e.type === 'job.done') setTimeout(resolve, 50);
    });
    office.start();
  });
  assert.equal(store.state.queue.length, 0);
  assert.equal(store.state.chat, null);
  assert.equal(store.state.stage, 'done');
});

test('jam queues several memos that the courier clears one by one', async () => {
  const office = new MockOffice({ timeScale: 4000, ambient: false });
  const events: OfficeEvent[] = [];
  office.subscribe((e) => events.push(e));
  office.jam(4);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(events.filter((e) => e.type === 'doc.queued').length, 4);
  assert.equal(events.filter((e) => e.type === 'doc.delivered').length, 4);
});

test('reset cancels a running job without leaking events afterwards', async () => {
  const office = new MockOffice({ timeScale: 4000, ambient: false });
  const events: OfficeEvent[] = [];
  office.subscribe((e) => events.push(e));
  office.start();
  await new Promise((r) => setTimeout(r, 30));
  office.reset();
  const count = events.length;
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(events.some((e) => e.type === 'sim.reset'), true);
  // Only idle bookkeeping from the cancelled chat may follow the reset.
  const after = events.slice(count).filter((e) => e.type !== 'agent.activity');
  assert.equal(after.length, 0);
  assert.equal(office.isRunning, false);
});
