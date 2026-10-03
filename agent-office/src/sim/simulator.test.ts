import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OfficeStore } from '../core/state.ts';
import { sameRoom } from '../core/world.ts';
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
  assert.ok(queued.length >= 3, 'the courier carries the documents that cross rooms');
  assert.deepEqual([...picked].sort(), [...queued].sort());
  assert.deepEqual(delivered, picked, 'deliveries should follow pickup order');
  // FIFO: documents are picked up in the order they were queued.
  const queuedOrder = new Map(queued.map((id, i) => [id, i]));
  const pickOrder = picked.map((id) => queuedOrder.get(id) ?? -1);
  assert.deepEqual(pickOrder, [...pickOrder].sort((a, b) => a - b));
});

test('inside a room documents are handed over by hand, only room-crossing ones use the courier', async () => {
  const events = await runJob();
  const queued = events.filter((e) => e.type === 'doc.queued');
  const handed = events.filter((e) => e.type === 'doc.handed');
  assert.ok(queued.length > 0 && handed.length > 0);
  assert.ok(queued.every((e) => !sameRoom(e.doc.from, e.doc.to)), 'the courier never carries within one room');
  assert.ok(handed.every((e) => sameRoom(e.doc.from, e.doc.to)), 'hand-overs stay inside one room');
  assert.ok(queued.length + handed.length >= 10, 'expected a realistic number of handoffs');
  // the sender really walks to the recipient's desk, then back to their own
  const h = handed[0];
  const i = events.indexOf(h);
  const before = events.slice(0, i).filter((e) => e.type === 'agent.walk' && e.agent === h.doc.from).at(-1);
  assert.equal(before?.type === 'agent.walk' && before.to, `visit:${h.doc.to}`);
  const after = events.slice(i).find((e) => e.type === 'agent.walk' && e.agent === h.doc.from);
  assert.equal(after?.type === 'agent.walk' && after.to, `desk:${h.doc.from}`);
  assert.equal(events.some((e) => e.type === 'doc.pickup' && e.doc.id === h.doc.id), false, 'no courier pickup for a hand-over');
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

test('opening the owner\'s question does not start a job until the user sends an answer', async () => {
  const office = new MockOffice({ timeScale: 4000, ambient: false });
  const events: OfficeEvent[] = [];
  office.subscribe((e) => events.push(e));
  office.start();
  await new Promise((r) => setTimeout(r, 100));
  const ask = events.find((e) => e.type === 'chat.ask');
  assert.equal(ask?.type === 'chat.ask' && ask.from, 'owner');
  assert.equal(office.isRunning, false, 'still waiting for the user');
  assert.equal(events.some((e) => e.type === 'job.stage' || e.type === 'job.created'), false, 'no job yet');
  office.start(); // pressing Start again must not open a second question
  assert.equal(events.filter((e) => e.type === 'chat.ask').length, 1);

  office.answer(ask?.type === 'chat.ask' ? ask.id : '', { text: 'A weekly newsletter' });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(office.isRunning, true);
  const first = events.find((e) => e.type === 'job.stage');
  assert.equal(first?.type === 'job.stage' && first.stage, 'brief');
  assert.equal(events.some((e) => e.type === 'job.created'), true);
  office.reset();
  office.dispose();
});

test('cancelling the first question drops it without starting anything, and a new one can be opened', async () => {
  const office = new MockOffice({ timeScale: 4000, ambient: false });
  const events: OfficeEvent[] = [];
  office.subscribe((e) => events.push(e));
  office.start();
  await new Promise((r) => setTimeout(r, 50));
  const ask = events.find((e) => e.type === 'chat.ask');
  office.cancel(ask?.type === 'chat.ask' ? ask.id : '');
  assert.equal(events.some((e) => e.type === 'chat.closed'), true);
  assert.equal(events.some((e) => e.type === 'job.stage' || e.type === 'user.say'), false, 'nothing started, nothing answered');
  assert.equal(office.isRunning, false);
  office.start(); // opens straight away, no waiting for the old promise to settle
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(events.filter((e) => e.type === 'chat.ask').length, 2);
  office.start(); // the cancelled run settling later must not have cleared the new question's flag
  assert.equal(events.filter((e) => e.type === 'chat.ask').length, 2, 'no duplicate question');
  office.dispose();
});

test('cancelling a question in the middle of a job abandons the job', async () => {
  const office = new MockOffice({ timeScale: 4000, ambient: false });
  const events: OfficeEvent[] = [];
  office.subscribe((e) => events.push(e));
  office.start();
  await new Promise((r) => setTimeout(r, 50));
  const first = events.find((e) => e.type === 'chat.ask');
  office.answer(first?.type === 'chat.ask' ? first.id : '', { text: 'A newsletter' });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(office.isRunning, true);
  const second = events.filter((e) => e.type === 'chat.ask').at(-1);
  office.cancel(second?.type === 'chat.ask' ? second.id : '');
  assert.equal(office.isRunning, false);
  assert.equal(events.some((e) => e.type === 'sim.reset'), true);
  office.dispose();
});

test('resetting while the first question is open lets a new one be opened', async () => {
  const office = new MockOffice({ timeScale: 4000, ambient: false });
  const events: OfficeEvent[] = [];
  office.subscribe((e) => events.push(e));
  office.start();
  await new Promise((r) => setTimeout(r, 50));
  office.reset();
  office.start();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(events.filter((e) => e.type === 'chat.ask').length, 2, 'a fresh question after the reset');
  office.dispose();
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
