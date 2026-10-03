// The office asks its brain for the owner's questions and the secretary's brief. These tests plug in a
// fake brain to prove the seam works; the scripted brain's behaviour is covered by simulator/paths tests.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Exchange, IntakeBrain, OwnerTurn } from '../core/brain.ts';
import { raw, tr } from '../core/i18n.ts';
import type { Msg } from '../core/i18n.ts';
import type { ChatReply, OfficeEvent } from '../core/types.ts';
import { MockOffice } from './simulator.ts';
import { ScriptedBrain } from './scripted-brain.ts';

class FakeBrain implements IntakeBrain {
  calls: string[] = [];

  async ownerTurn(history: readonly Exchange[], title: string): Promise<OwnerTurn> {
    this.calls.push(`turn:${history.length}:${title}`);
    return history.length < 2 ? { kind: 'ask', question: { text: raw(`Question ${history.length + 1}?`) } } : { kind: 'ready' };
  }

  async writeBrief(history: readonly Exchange[], title: string): Promise<Msg> {
    this.calls.push('write');
    return raw(`BRIEF ${title}: ${history.map((h) => h.text).join(' | ')}`);
  }

  async reviseBrief(_history: readonly Exchange[], _title: string, change: Msg): Promise<Msg> {
    this.calls.push('revise');
    return raw(`BRIEF v2 (${tr(change)})`);
  }
}

type Ask = Extract<OfficeEvent, { type: 'chat.ask' }>;

test('the office asks exactly what the brain asks, shows the brain\'s brief, and sends revisions back to it', async () => {
  const brain = new FakeBrain();
  const office = new MockOffice({ timeScale: 4000, ambient: false, brain: () => brain });
  const events: OfficeEvent[] = [];
  const answers: ChatReply[] = [
    { text: 'newsletter' },
    { text: 'parents' },
    { choice: 'revise' },
    { text: 'shorter' },
    { choice: 'approve' },
  ];
  const asks: Ask[] = [];
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('did not reach the meeting')), 10000);
    office.subscribe((e) => {
      events.push(e);
      if (e.type === 'chat.ask') {
        asks.push(e);
        const reply = answers.shift();
        if (reply) setTimeout(() => office.answer(e.id, reply), 0);
      }
      if (e.type === 'job.stage' && e.stage === 'meeting') {
        clearTimeout(timer);
        resolve();
      }
    });
    office.start();
  });
  office.reset();
  office.dispose();

  assert.deepEqual(brain.calls, ['turn:0:', 'turn:1:newsletter', 'turn:2:newsletter', 'write', 'revise']);
  assert.equal(tr(asks[0].text), 'Question 1?');
  assert.equal(tr(asks[1].text), 'Question 2?');

  const approvals = asks.filter((a) => a.text.key === 'ask.approve');
  assert.equal(approvals.length, 2);
  assert.match(tr(approvals[0].text), /BRIEF newsletter: newsletter \| parents/);
  assert.match(tr(approvals[1].text), /BRIEF v2 \(shorter\)/);

  const created = events.findIndex((e) => e.type === 'job.created');
  const secondQuestion = events.findIndex((e) => e.type === 'chat.ask' && tr(e.text) === 'Question 2?');
  assert.ok(created >= 0 && created < secondQuestion, 'the job (and its title) exists as soon as the first answer is in');
  const createdEvent = events[created];
  assert.equal(createdEvent.type === 'job.created' && createdEvent.title, 'newsletter');
});

test('the scripted brain asks idea, audience, limits, then is ready, and builds the brief from the answers', async () => {
  const brain = new ScriptedBrain();
  const history: Exchange[] = [];
  const answer = (text: string): Exchange => ({ question: raw('q'), answer: raw(text), text, choice: null });

  const first = await brain.ownerTurn(history, '');
  assert.ok(first.kind === 'ask' && first.question.text.key === 'ask.idea');
  history.push(answer('A weekly newsletter'));
  const second = await brain.ownerTurn(history, 'A weekly newsletter');
  assert.ok(second.kind === 'ask' && second.question.text.key === 'ask.audience');
  history.push(answer('Beginners'));
  const third = await brain.ownerTurn(history, 'A weekly newsletter');
  assert.ok(third.kind === 'ask' && third.question.text.key === 'ask.limits' && third.question.choices?.length === 3);
  history.push(answer('One page'));
  assert.deepEqual(await brain.ownerTurn(history, 'A weekly newsletter'), { kind: 'ready' });

  const brief = tr(await brain.writeBrief(history, 'A weekly newsletter'));
  assert.ok(brief.includes('A weekly newsletter') && brief.includes('Beginners') && brief.includes('One page'));
  const revised = tr(await brain.reviseBrief(history, 'A weekly newsletter', raw('Make it shorter')));
  assert.ok(revised.includes('Make it shorter'), 'the change is added to the brief');
  const again = tr(await brain.reviseBrief(history, 'A weekly newsletter', raw('Add a joke')));
  assert.ok(again.includes('Make it shorter') && again.includes('Add a joke'), 'changes accumulate');
});

test('each job gets its own brain, so one job\'s changes never leak into the next', async () => {
  let made = 0;
  const office = new MockOffice({ timeScale: 4000, ambient: false, brain: () => (made++, new ScriptedBrain()) });
  office.start();
  await new Promise((r) => setTimeout(r, 30));
  office.reset();
  office.start();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(made, 2);
  office.dispose();
});
