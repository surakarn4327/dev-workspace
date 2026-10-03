// The job's file collects the conversation and the brief as the job goes, for the departments to read later.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Exchange, IntakeBrain, OwnerTurn } from '../core/brain.ts';
import { raw, setLang, tr } from '../core/i18n.ts';
import type { JobFile } from '../core/job-file.ts';
import type { Msg } from '../core/i18n.ts';
import type { ChatReply, OfficeEvent } from '../core/types.ts';
import { MockOffice } from './simulator.ts';
import { ScriptedBrain } from './scripted-brain.ts';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

class TwoQuestionBrain implements IntakeBrain {
  async ownerTurn(history: readonly Exchange[]): Promise<OwnerTurn> {
    return history.length < 2 ? { kind: 'ask', question: { text: raw(`Question ${history.length + 1}?`) } } : { kind: 'ready' };
  }
  async writeBrief(history: readonly Exchange[], title: string): Promise<Msg> {
    return raw(`BRIEF ${title}: ${history.map((h) => h.text).join(' | ')}`);
  }
  async reviseBrief(_h: readonly Exchange[], _t: string, change: Msg): Promise<Msg> {
    return raw(`BRIEF v2 (${tr(change)})`);
  }
}

const offices: MockOffice[] = [];
test.afterEach(() => {
  for (const o of offices.splice(0)) o.dispose();
});

/** Answers each question in turn and resolves once the job reaches the meeting (the brief is approved). */
async function runToMeeting(answers: ChatReply[], brain: () => IntakeBrain): Promise<MockOffice> {
  const office = new MockOffice({ timeScale: 4000, ambient: false, brain });
  offices.push(office);
  const queue = [...answers];
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('never reached the meeting')), 10000);
    office.subscribe((e: OfficeEvent) => {
      if (e.type === 'chat.ask') {
        const reply = queue.shift();
        if (reply) setTimeout(() => office.answer(e.id, reply), 0);
      }
      if (e.type === 'job.stage' && e.stage === 'meeting') {
        clearTimeout(timer);
        resolve();
      }
    });
    office.start();
  });
  return office;
}

test('after approval the job file holds the title, the conversation, the changes and the approved brief', async () => {
  const office = await runToMeeting(
    [{ text: 'newsletter' }, { text: 'parents' }, { choice: 'revise' }, { text: 'shorter' }, { choice: 'approve' }],
    () => new TwoQuestionBrain(),
  );
  const file = office.jobFile;
  assert.ok(file);
  assert.equal(file.title, 'newsletter');
  assert.deepEqual(
    file.history.map((h) => h.text),
    ['newsletter', 'parents'],
  );
  assert.equal(tr(file.history[1].question), 'Question 2?', 'each answer keeps the question it answered');
  assert.deepEqual(file.changes, ['shorter']);
  assert.equal(file.approvedBrief, 'BRIEF v2 (shorter)', 'the approved brief is the revised one, as plain text');
  assert.equal(tr(file.brief ?? raw('')), 'BRIEF v2 (shorter)');
});

test('before approval there is a draft brief but nothing approved', async () => {
  const office = new MockOffice({ timeScale: 4000, ambient: false, brain: () => new TwoQuestionBrain() });
  offices.push(office);
  const asks: Extract<OfficeEvent, { type: 'chat.ask' }>[] = [];
  office.subscribe((e) => {
    if (e.type !== 'chat.ask') return;
    asks.push(e);
    const reply = [{ text: 'a' }, { text: 'b' }][asks.length - 1];
    if (reply) setTimeout(() => office.answer(e.id, reply), 0); // the third ask is the approval: leave it open
  });
  office.start();
  for (let i = 0; i < 100 && asks.length < 3; i++) await sleep(20);
  assert.equal(asks.length, 3);
  assert.equal(office.jobFile?.approvedBrief, null);
  assert.match(tr(office.jobFile?.brief ?? raw('')), /^BRIEF a: a \| b/);
});

test('the scripted demo fills the job file too', async () => {
  setLang('en', false);
  const office = await runToMeeting(
    [{ text: 'A weekly newsletter' }, { text: 'Beginners' }, { choice: 'one-page' }, { choice: 'approve' }],
    () => new ScriptedBrain(),
  );
  const approved = office.jobFile?.approvedBrief ?? '';
  assert.ok(approved.includes('A weekly newsletter') && approved.includes('Beginners') && approved.includes('One page'), approved);
  assert.equal(office.jobFile?.history.length, 3);
  assert.equal(office.jobFile?.history[2].choice, 'one-page', 'a pressed button is remembered as such');
});
test('a reset clears the file, and the next job starts with a fresh one', async () => {
  const office = await runToMeeting([{ text: 'one' }, { text: 'x' }, { choice: 'approve' }], () => new TwoQuestionBrain());
  const file = (): Readonly<JobFile> | null => office.jobFile;
  assert.equal(file()?.title, 'one');
  office.reset();
  assert.equal(file(), null);

  const queue: ChatReply[] = [{ text: 'two' }, { text: 'y' }];
  office.subscribe((e) => {
    if (e.type !== 'chat.ask') return;
    const reply = queue.shift();
    if (reply) setTimeout(() => office.answer(e.id, reply), 0);
  });
  office.start();
  for (let i = 0; i < 100 && file()?.title !== 'two'; i++) await sleep(20);
  assert.equal(file()?.title, 'two');
  assert.deepEqual(file()?.history.map((h) => h.text).slice(0, 1), ['two']);
  assert.equal(file()?.approvedBrief, null);
});
