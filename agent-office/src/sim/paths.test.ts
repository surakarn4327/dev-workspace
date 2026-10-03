// The less common user paths: revising the brief, and asking for changes at delivery.
// A scripted "user" answers every question the office asks.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OfficeEvent } from '../core/types.ts';
import { MockOffice } from './simulator.ts';

type Ask = Extract<OfficeEvent, { type: 'chat.ask' }>;

/** Run a whole job with a scripted user; `decide` returns the answer to each question. */
function run(decide: (ask: Ask, n: number) => string): Promise<{ events: OfficeEvent[]; asks: Ask[] }> {
  const office = new MockOffice({ timeScale: 4000, ambient: false });
  const events: OfficeEvent[] = [];
  const asks: Ask[] = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('job did not finish in time')), 20000);
    office.subscribe((e) => {
      events.push(e);
      if (e.type === 'chat.ask') {
        asks.push(e);
        const answer = decide(e, asks.length);
        setTimeout(() => office.answer(e.id, answer), 0);
      }
      if (e.type === 'job.done') {
        clearTimeout(timer);
        setTimeout(() => {
          office.dispose();
          resolve({ events, asks });
        }, 50);
      }
    });
    office.start();
  });
}

const isBriefApproval = (a: Ask): boolean => a.text.includes('Here is the brief');
const isDelivery = (a: Ask): boolean => a.from === 'secretary' && a.text.includes('Your deliverable is ready');

test('pressing Revise on the brief asks what to change, updates the brief and asks again', async () => {
  let revised = false;
  const { events, asks } = await run((ask) => {
    if (isBriefApproval(ask)) {
      if (!revised) {
        revised = true;
        return 'Revise';
      }
      return 'Approve';
    }
    if (ask.text.includes('What should I change')) return 'Add a one-line summary at the top';
    if (ask.choices?.includes('Accept')) return 'Accept';
    return ask.choices?.[0] ?? 'Sounds good';
  });
  const approvals = asks.filter(isBriefApproval);
  assert.equal(approvals.length, 2, 'the brief should be put to the user twice');
  assert.ok(!approvals[0].text.includes('Change:'), 'the first brief has no change yet');
  assert.ok(approvals[1].text.includes('Change: Add a one-line summary at the top'), 'the second brief must include the change');
  assert.ok(events.some((e) => e.type === 'job.done'));
  // the secretary rewrote the brief before the second question
  const firstAsk = events.findIndex((e) => e.type === 'chat.ask' && isBriefApproval(e));
  const secondAsk = events.findIndex((e, i) => i > firstAsk && e.type === 'chat.ask' && isBriefApproval(e));
  const rewrote = events.slice(firstAsk, secondAsk).some((e) => e.type === 'agent.activity' && e.agent === 'secretary' && e.note === 'Updating the brief');
  assert.ok(rewrote, 'the secretary should update the brief between the two questions');
});

test('typing a change instead of pressing a button also counts as a revision', async () => {
  let n = 0;
  const { asks } = await run((ask) => {
    if (isBriefApproval(ask)) return n++ === 0 ? 'Make it shorter please' : 'ok';
    return ask.choices?.[0] ?? 'Sounds good';
  });
  const approvals = asks.filter(isBriefApproval);
  assert.equal(approvals.length, 2);
  assert.ok(approvals[1].text.includes('Change: Make it shorter please'));
});

test('Request changes at delivery sends the work back, QA re-checks, and it is delivered again before filing', async () => {
  let delivered = 0;
  const { events, asks } = await run((ask) => {
    if (isDelivery(ask)) return ++delivered === 1 ? 'Request changes' : 'Accept';
    if (ask.text.includes('What should we change')) return 'A shorter introduction';
    return ask.choices?.[0] ?? 'Sounds good';
  });
  assert.equal(asks.filter(isDelivery).length, 2, 'the result should be delivered twice');
  assert.equal(asks.filter((a) => a.text.includes('What should we change')).length, 1);
  const labels = events.filter((e) => e.type === 'doc.queued').map((e) => e.doc.label);
  assert.ok(labels.includes('Change request'), 'the change request must travel by courier');
  assert.ok(labels.includes('Fix list'), 'the producer must be given a fix list');
  const passes = events.filter((e) => e.type === 'review.verdict' && e.verdict === 'pass');
  assert.equal(passes.length, 2, 'QA should pass the original and the reworked version');
  const filed = events.filter((e) => e.type === 'archive.filed');
  assert.equal(filed.length, 1, 'only the accepted version is filed');
  const lastDelivery = events.map((e, i) => (e.type === 'chat.ask' && isDelivery(e) ? i : -1)).filter((i) => i >= 0).pop() as number;
  assert.ok(events.findIndex((e) => e.type === 'archive.filed') > lastDelivery, 'filing happens after the second delivery');
});

test('answering a delivery with free text counts as a change request', async () => {
  let delivered = 0;
  const { asks } = await run((ask) => {
    if (isDelivery(ask)) return ++delivered === 1 ? 'Please add a table' : 'Accept';
    return ask.choices?.[0] ?? 'Sounds good';
  });
  // free text skips the "what should we change" follow-up
  assert.equal(asks.filter(isDelivery).length, 2);
  assert.equal(asks.filter((a) => a.text.includes('What should we change')).length, 0);
});
