// The office with a work brain: the owner picks the departments, Production writes, the reviewer judges for real
// (sending work back at most twice), a change asked for at delivery is really applied, and the result carries the
// code-made stamp. Fake models only.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Finding, ResearchBrain, ResearchResult } from '../core/research.ts';
import type { AgentId, OfficeEvent } from '../core/types.ts';
import type { Team, Verdict, WorkBrain } from '../core/work.ts';
import { MAX_REJECTIONS } from '../core/work.ts';
import { tr } from '../core/i18n.ts';
import { MockOffice } from './simulator.ts';

const offices: MockOffice[] = [];
test.afterEach(() => {
  for (const o of offices.splice(0)) o.dispose();
});

const REPORT: ResearchResult = {
  report: 'REPORT + TAIL',
  body: 'RESEARCH BODY',
  findings: [],
  sources: [{ url: 'https://x.example', title: 'X', opened: true }],
  checked: true,
};

class FakeResearch implements ResearchBrain {
  planned = 0;
  async plan(): Promise<[string, string]> {
    this.planned++;
    return ['a', 'b'];
  }
  async investigate(agent: AgentId): Promise<Finding> {
    return { agent, assignment: 'a', text: 't', sources: [], unverified: [], checked: true };
  }
  async report(): Promise<ResearchResult> {
    return REPORT;
  }
}

class FakeWork implements WorkBrain {
  team: Team = { research: true, production: true };
  /** Verdicts handed out one per review; the last one repeats. */
  verdicts: Verdict[] = [{ pass: true, reason: 'fine', issues: [] }];
  calls: string[] = [];
  revisions: { agent: AgentId; notes: string }[] = [];
  reviewed: string[] = [];
  async chooseTeam(): Promise<Team> {
    this.calls.push('team');
    return this.team;
  }
  async planWriting(): Promise<[string, string]> {
    this.calls.push('plan');
    return ['first', 'second'];
  }
  async draft(agent: AgentId): Promise<string> {
    this.calls.push(`draft:${agent}`);
    return `part by ${agent}`;
  }
  async assemble(_b: string, parts: readonly string[]): Promise<string> {
    this.calls.push('assemble');
    return `JOINED(${parts.join('+')})`;
  }
  async review(_b: string, body: string): Promise<Verdict> {
    this.calls.push('review');
    this.reviewed.push(body);
    return this.verdicts.length > 1 ? (this.verdicts.shift() as Verdict) : this.verdicts[0];
  }
  async revise(agent: AgentId, _b: string, body: string, notes: string): Promise<string> {
    this.calls.push(`revise:${agent}`);
    this.revisions.push({ agent, notes });
    return `${body}|fixed${this.revisions.length}`;
  }
}

function run(work: FakeWork, onEvent: (e: OfficeEvent, o: MockOffice) => void = () => {}) {
  const research = new FakeResearch();
  const office = new MockOffice({ timeScale: 4000, ambient: false, autoAnswer: true, research: () => research, work: () => work });
  offices.push(office);
  const events: OfficeEvent[] = [];
  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the job never finished: ${events.slice(-6).map((e) => e.type).join(', ')}`)), 20000);
    office.subscribe((e) => {
      events.push(e);
      onEvent(e, office);
      if (e.type === 'job.done') {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  office.start();
  return { office, events, done, research };
}

const verdicts = (events: OfficeEvent[]): string[] => events.flatMap((e) => (e.type === 'review.verdict' ? [`${e.verdict}:${e.round}`] : []));
const notesOf = (events: OfficeEvent[], agent: AgentId): string[] => events.flatMap((e) => (e.type === 'agent.activity' && e.agent === agent && e.note ? [e.note.key] : []));
const delivered = (events: OfficeEvent[]): string => events.flatMap((e) => (e.type === 'chat.ask' && e.text.key === 'ask.deliver.text' ? [tr(e.text, 'en')] : []))[0] ?? '';

test('the whole team: the owner picks both, Production writes from the research, the reviewer passes, the stamp is on the result', async () => {
  const work = new FakeWork();
  const { office, events, done } = run(work);
  await done;
  assert.deepEqual(work.calls.filter((c) => !c.startsWith('draft')), ['team', 'plan', 'assemble', 'review']);
  assert.deepEqual(work.calls.filter((c) => c.startsWith('draft')).sort(), ['draft:prod-1', 'draft:prod-2']);
  assert.deepEqual(office.jobFile?.team, { research: true, production: true });
  assert.equal(office.jobFile?.deliverable?.body, 'JOINED(part by prod-1+part by prod-2)');
  assert.deepEqual(verdicts(events), ['pass:1']);
  const shown = delivered(events);
  assert.ok(shown.includes('JOINED(part by prod-1+part by prod-2)'));
  assert.ok(shown.includes('Sources opened:') && shown.includes('https://x.example'));
  assert.ok(notesOf(events, 'prod-1').includes('note.drafting'));
  assert.ok(notesOf(events, 'prod-head').includes('note.planWriting'));
  assert.ok(notesOf(events, 'owner').includes('note.pickTeam'));
});

test('Production only: Research never works and its head does not come to the meeting', async () => {
  const work = new FakeWork();
  work.team = { research: false, production: true };
  const { events, done, research } = run(work);
  await done;
  assert.equal(research.planned, 0);
  assert.ok(!events.some((e) => e.type === 'agent.walk' && e.agent === 'research-head' && e.to === 'meet:3'));
  assert.ok(events.some((e) => e.type === 'agent.walk' && e.agent === 'prod-head' && e.to === 'meet:5'));
  assert.ok(!notesOf(events, 'research-1').includes('note.gathering'));
  assert.ok(!delivered(events).includes('Sources opened:'), 'no research, no research stamp');
});

test('Research only: the research is the result, goes straight to the reviewer, and Production never works', async () => {
  const work = new FakeWork();
  work.team = { research: true, production: false };
  const { office, events, done } = run(work);
  await done;
  assert.ok(!work.calls.some((c) => c.startsWith('draft') || c === 'plan' || c === 'assemble'));
  assert.equal(office.jobFile?.deliverable?.body, 'RESEARCH BODY');
  assert.deepEqual(work.reviewed, ['RESEARCH BODY']);
  assert.ok(events.some((e) => e.type === 'doc.queued' && e.doc.from === 'research-head' && e.doc.to === 'qa'));
  assert.ok(!events.some((e) => e.type === 'agent.walk' && e.agent === 'prod-head' && e.to === 'meet:5'));
});

test('a rejection sends the result back with the reviewer\'s notes, a real fix follows, and the second look passes', async () => {
  const work = new FakeWork();
  work.verdicts = [{ pass: false, reason: 'price not in sources', issues: ['the 70,000 figure'] }, { pass: true, reason: 'fixed', issues: [] }];
  const { office, events, done } = run(work);
  await done;
  assert.deepEqual(verdicts(events), ['reject:1', 'pass:2']);
  assert.equal(work.revisions.length, 1);
  assert.match(work.revisions[0].notes, /price not in sources\nthe 70,000 figure/);
  assert.equal(work.revisions[0].agent, 'prod-1');
  assert.equal(office.jobFile?.deliverable?.version, 2);
  assert.match(work.reviewed[1], /\|fixed1$/, 'the reviewer sees the fixed version');
  assert.equal(office.jobFile?.deliverable?.unresolved, null);
});

test('after the allowed rejections the result goes out with the objection stated, not hidden', async () => {
  const work = new FakeWork();
  work.verdicts = [{ pass: false, reason: 'still no source for the price', issues: [] }];
  const { office, events, done } = run(work);
  await done;
  assert.equal(work.revisions.length, MAX_REJECTIONS);
  assert.equal(verdicts(events).length, MAX_REJECTIONS + 1);
  assert.ok(events.some((e) => e.type === 'agent.say' && e.agent === 'qa' && e.text.key === 'say.qaGaveUp'));
  assert.equal(office.jobFile?.deliverable?.unresolved, 'still no source for the price');
  assert.match(delivered(events), /Reviewer note: this is still not fully resolved: still no source for the price/);
});

test('a change asked for at delivery is really applied, re-reviewed honestly, and then the client can accept', async () => {
  const work = new FakeWork();
  work.verdicts = [{ pass: true, reason: 'ok', issues: [] }, { pass: false, reason: 'the date is missing', issues: [] }, { pass: true, reason: 'ok', issues: [] }];
  let asked = 0;
  const { office, events, done } = run(work, (e, o) => {
    if (e.type === 'chat.ask' && e.text.key === 'ask.deliver.text') {
      asked++;
      if (asked === 1) setTimeout(() => o.answer(e.id, { text: 'make it shorter please' }), 0);
      else setTimeout(() => o.answer(e.id, { choice: 'accept' }), 0);
    }
  });
  await done;
  assert.equal(asked, 2);
  assert.equal(work.revisions.length, 1);
  assert.equal(work.revisions[0].notes, 'make it shorter please');
  assert.deepEqual(verdicts(events), ['pass:1', 'reject:2']);
  assert.equal(office.jobFile?.deliverable?.version, 2);
  assert.equal(office.jobFile?.deliverable?.unresolved, 'the date is missing', 'the second look\'s objection stays on the result');
});
