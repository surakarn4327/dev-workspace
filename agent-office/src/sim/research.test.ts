// The office with a research brain: the researchers show what they are doing, the report lands in the job file,
// a model failure asks retry / cancel (one question at a time), and without a brain the demo script still plays.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Finding, ResearchBrain, ResearchProgress, ResearchResult } from '../core/research.ts';
import type { AgentId, OfficeEvent } from '../core/types.ts';
import { ModelError } from '../ai/model-client.ts';
import { MockOffice } from './simulator.ts';

const offices: MockOffice[] = [];
test.afterEach(() => {
  for (const o of offices.splice(0)) o.dispose();
});

const finding = (agent: AgentId): Finding => ({ agent, assignment: 'a', text: `write-up by ${agent}`, sources: [{ url: 'https://x.example', title: 'X', opened: true }], unverified: [], checked: true });

class FakeResearch implements ResearchBrain {
  calls: string[] = [];
  failFirstInvestigate: ModelError | null = null;
  async plan(): Promise<[string, string]> {
    this.calls.push('plan');
    return ['first', 'second'];
  }
  async investigate(agent: AgentId, _a: string, _b: string, _s?: AbortSignal, onProgress?: (p: ResearchProgress) => void): Promise<Finding> {
    this.calls.push(`investigate:${agent}`);
    if (this.failFirstInvestigate && agent === 'research-1') {
      const e = this.failFirstInvestigate;
      this.failFirstInvestigate = null;
      throw e;
    }
    onProgress?.({ type: 'tool', tool: 'search' });
    onProgress?.({ type: 'tool-done', tool: 'search', ok: true });
    onProgress?.({ type: 'tool', tool: 'read' });
    onProgress?.({ type: 'tool-done', tool: 'read', ok: true });
    return finding(agent);
  }
  async report(_b: string, findings: readonly Finding[]): Promise<ResearchResult> {
    this.calls.push('report');
    return { report: 'THE REPORT', body: 'THE REPORT', findings: [...findings], sources: [{ url: 'https://x.example', title: 'X', opened: true }], checked: true };
  }
}

function run(research: (() => ResearchBrain | null) | undefined, onEvent: (e: OfficeEvent, office: MockOffice) => void = () => {}): { office: MockOffice; events: OfficeEvent[]; done: Promise<void> } {
  const office = new MockOffice({ timeScale: 4000, ambient: false, autoAnswer: true, research });
  offices.push(office);
  const events: OfficeEvent[] = [];
  const done = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`the job never finished: ${events.slice(-5).map((e) => e.type).join(', ')}`)), 15000);
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
  return { office, events, done };
}

const notesOf = (events: OfficeEvent[], agent: AgentId): string[] =>
  events.flatMap((e) => (e.type === 'agent.activity' && e.agent === agent && e.note ? [e.note.key] : []));

test('with a research brain the head plans, both researchers work with tools, the head reports into the job file', async () => {
  const brain = new FakeResearch();
  const { office, events, done } = run(() => brain);
  await done;
  assert.deepEqual(brain.calls.filter((c) => c === 'plan' || c === 'report'), ['plan', 'report']);
  assert.deepEqual(brain.calls.filter((c) => c.startsWith('investigate')).sort(), ['investigate:research-1', 'investigate:research-2']);
  assert.equal(office.jobFile?.research?.report, 'THE REPORT');
  for (const who of ['research-1', 'research-2'] as const) {
    const notes = notesOf(events, who);
    assert.ok(notes.includes('note.searching'), `${who} searches`);
    assert.ok(notes.includes('note.reading'), `${who} reads`);
  }
  assert.ok(notesOf(events, 'research-head').includes('note.planResearch'));
  assert.ok(notesOf(events, 'research-head').includes('note.mergingFindings'));
  assert.ok(!notesOf(events, 'research-1').includes('note.coffeeWait'), 'the demo script text is not used');
  // the report still travels on to production, as in the demo
  assert.ok(events.some((e) => e.type === 'doc.queued' && e.doc.from === 'research-head' && e.doc.to === 'prod-head'));
});

test('without a research brain the demo script plays and the job file has no research report', async () => {
  const { office, events, done } = run(undefined);
  await done;
  assert.ok(!office.jobFile?.research);
  assert.ok(notesOf(events, 'research-1').includes('note.gathering'));
  assert.ok(!notesOf(events, 'research-1').includes('note.searching'));
});

test('a failing researcher call asks retry or cancel, and retrying carries on to a report', async () => {
  const brain = new FakeResearch();
  brain.failFirstInvestigate = new ModelError('server', 'down');
  const asked: string[] = [];
  const { office, done } = run(() => brain, (e, o) => {
    if (e.type === 'chat.ask' && e.from === 'research-1') {
      asked.push(e.text.key);
      queueMicrotask(() => o.answer(e.id, { choice: 'retry' }));
    }
  });
  await done;
  assert.deepEqual(asked, ['ask.modelError.server']);
  assert.equal(office.jobFile?.research?.report, 'THE REPORT');
  assert.equal(brain.calls.filter((c) => c === 'investigate:research-1').length, 2, 'the failed call was made again');
});

test('choosing cancel on a research failure abandons the job and the report is never written', async () => {
  const brain = new FakeResearch();
  brain.failFirstInvestigate = new ModelError('network', 'offline');
  let office!: MockOffice;
  const events: OfficeEvent[] = [];
  const o = new MockOffice({ timeScale: 4000, ambient: false, autoAnswer: true, research: () => brain });
  offices.push(o);
  office = o;
  const reset = new Promise<void>((resolve) => {
    o.subscribe((e) => {
      events.push(e);
      if (e.type === 'chat.ask' && e.from === 'research-1') queueMicrotask(() => office.answer(e.id, { choice: 'cancel' }));
      if (e.type === 'sim.reset') resolve();
    });
  });
  o.start();
  await reset;
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(!brain.calls.includes('report'));
  assert.ok(!events.some((e) => e.type === 'job.done'));
  assert.equal(office.isRunning, false);
});

test('two researchers failing together are asked about one at a time', async () => {
  const brain = new FakeResearch();
  const orig = brain.investigate.bind(brain);
  const failed = new Set<AgentId>();
  brain.investigate = async (agent, a, b, s, p) => {
    if (!failed.has(agent)) {
      failed.add(agent);
      throw new ModelError('timeout', 'slow');
    }
    return orig(agent, a, b, s, p);
  };
  const openIds = new Set<string>();
  let mostAtOnce = 0;
  const { office, done } = run(() => brain, (e) => {
    if (e.type === 'chat.ask' && e.from.startsWith('research-') && e.from !== 'research-head') {
      openIds.add(e.id);
      mostAtOnce = Math.max(mostAtOnce, openIds.size);
    }
    if (e.type === 'chat.closed') openIds.delete(e.id);
  });
  await done;
  assert.equal(mostAtOnce, 1);
  assert.equal(office.jobFile?.research?.report, 'THE REPORT');
});
