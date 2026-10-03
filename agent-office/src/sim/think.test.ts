// What the office does while a brain call is slow, fails or is cancelled. Brains here are fakes built on the
// scripted one; the slow step is the second owner turn (right after the user's first answer).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ModelError } from '../ai/model-client.ts';
import type { BrainWait, Exchange, OwnerTurn } from '../core/brain.ts';
import { raw, tr } from '../core/i18n.ts';
import type { Msg } from '../core/i18n.ts';
import { OfficeStore } from '../core/state.ts';
import type { OfficeEvent } from '../core/types.ts';
import { MockOffice } from './simulator.ts';
import { ScriptedBrain } from './scripted-brain.ts';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** The second owner turn waits until released; it can fail first; it reports quota waits when told to. */
class GatedBrain extends ScriptedBrain {
  signals: (AbortSignal | undefined)[] = [];
  failures: Error[] = [];
  slowBrief = false;
  gateOwner = true;
  private release: (() => void) | null = null;
  private waitListeners = new Set<(w: BrainWait) => void>();

  releaseNow(): void {
    this.release?.();
  }

  setWait(w: BrainWait): void {
    for (const fn of this.waitListeners) fn(w);
  }

  watchWait(fn: (w: BrainWait) => void): () => void {
    this.waitListeners.add(fn);
    return () => this.waitListeners.delete(fn);
  }

  private gate(signal?: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.release = resolve;
      signal?.addEventListener('abort', () => reject(new ModelError('cancelled', 'aborted')), { once: true });
    });
  }

  override async ownerTurn(history: readonly Exchange[], title: string, signal?: AbortSignal): Promise<OwnerTurn> {
    if (history.length === 1 && this.gateOwner) {
      this.signals.push(signal);
      const failure = this.failures.shift();
      if (failure) throw failure;
      await this.gate(signal);
    }
    return super.ownerTurn(history, title);
  }

  override async writeBrief(history: readonly Exchange[], title: string, signal?: AbortSignal): Promise<Msg> {
    if (this.slowBrief) await this.gate(signal);
    return super.writeBrief(history, title);
  }
}

// A failing assertion must not leave an office running (its timers would keep the test process alive).
const offices: MockOffice[] = [];
test.afterEach(() => {
  for (const o of offices.splice(0)) o.dispose();
});

function setup(brain: GatedBrain, autoAnswer = false) {
  const office = new MockOffice({ timeScale: 4000, ambient: false, autoAnswer, thinkDelayMs: 10, brain: () => brain });
  offices.push(office);
  const store = new OfficeStore();
  const events: OfficeEvent[] = [];
  office.subscribe((e) => {
    events.push(e);
    store.apply(e);
  });
  const lastAsk = (): Extract<OfficeEvent, { type: 'chat.ask' }> | undefined =>
    events.filter((e): e is Extract<OfficeEvent, { type: 'chat.ask' }> => e.type === 'chat.ask').at(-1);
  const thinkings = (): Extract<OfficeEvent, { type: 'chat.thinking' }>[] =>
    events.filter((e): e is Extract<OfficeEvent, { type: 'chat.thinking' }> => e.type === 'chat.thinking');
  /** Start, answer the greeting, and let the (gated) next owner turn begin. */
  async function reachSlowTurn(): Promise<void> {
    office.start();
    await sleep(30);
    office.answer(lastAsk()?.id ?? '', { text: 'A newsletter' });
    await sleep(80);
  }
  return { office, store, events, lastAsk, thinkings, reachSlowTurn };
}

test('a slow owner turn shows the chat box thinking, then replaces it with the next question', async () => {
  const brain = new GatedBrain();
  const { office, store, events, thinkings, reachSlowTurn } = setup(brain);
  await reachSlowTurn();

  assert.equal(thinkings().length >= 1, true);
  assert.equal(thinkings()[0].from, 'owner');
  assert.equal(store.state.chat?.thinking, true);
  assert.equal(tr(store.state.chat?.text ?? raw('')), 'Rex is thinking...');
  assert.equal(store.state.agents.owner.activity, 'thinking', 'the character does the thinking pose');

  const thinkId = thinkings()[0].id;
  brain.releaseNow();
  await sleep(60);
  const closedAt = events.findIndex((e) => e.type === 'chat.closed' && e.id === thinkId);
  const nextAsk = events.findIndex((e, i) => i > closedAt && e.type === 'chat.ask');
  assert.ok(closedAt >= 0 && nextAsk > closedAt, 'the thinking box closes, then the next question arrives');
  assert.equal(store.state.chat?.thinking, undefined);
  office.dispose();
});

test('a quick brain never shows the thinking box (the scripted demo does not flicker)', async () => {
  const office = new MockOffice({ timeScale: 4000, autoAnswer: true, ambient: false });
  const events: OfficeEvent[] = [];
  await new Promise<void>((resolve) => {
    office.subscribe((e) => {
      events.push(e);
      if (e.type === 'job.done') setTimeout(resolve, 20);
    });
    office.start();
  });
  assert.equal(events.some((e) => e.type === 'chat.thinking'), false);
  office.dispose();
});

test('closing the box while it is thinking cancels the job and aborts the model call', async () => {
  const brain = new GatedBrain();
  const { office, events, thinkings, reachSlowTurn } = setup(brain);
  await reachSlowTurn();
  const signal = brain.signals[0];
  assert.equal(signal?.aborted, false);

  office.cancel(thinkings()[0].id); // what the box's close button does
  assert.equal(signal?.aborted, true, 'the in-flight call is aborted');
  assert.equal(office.isRunning, false);
  assert.equal(events.some((e) => e.type === 'sim.reset'), true);

  const count = events.length;
  await sleep(100);
  const after = events.slice(count).filter((e) => e.type !== 'agent.activity');
  assert.deepEqual(after, [], 'nothing happens after the cancel');
  office.dispose();
});

test('waiting for quota is shown in the box and on the character, and clears when the wait ends', async () => {
  const brain = new GatedBrain();
  const { office, store, thinkings, reachSlowTurn } = setup(brain);
  await reachSlowTurn();

  brain.setWait('quota');
  assert.equal(thinkings().at(-1)?.wait, 'quota');
  assert.equal(tr(store.state.chat?.text ?? raw('')), 'Rex is waiting for the free AI quota...');
  assert.equal(store.state.agents.owner.activity, 'waiting');
  assert.equal(tr(store.state.agents.owner.note ?? raw('')), 'Waiting for the AI quota');

  brain.setWait(null);
  assert.equal(tr(store.state.chat?.text ?? raw('')), 'Rex is thinking...');
  assert.equal(store.state.agents.owner.activity, 'thinking');
  office.dispose();
});

test('a model failure asks the user to try again or cancel, and trying again carries on', async () => {
  const brain = new GatedBrain();
  brain.failures.push(new ModelError('network', 'offline'));
  const { office, lastAsk, reachSlowTurn } = setup(brain);
  await reachSlowTurn();

  const ask = lastAsk();
  assert.equal(ask?.text.key, 'ask.modelError.network');
  assert.deepEqual(ask?.choices?.map((c) => c.id), ['retry', 'cancel']);
  assert.equal(ask?.from, 'owner');

  office.answer(ask?.id ?? '', { choice: 'retry' });
  await sleep(60);
  brain.releaseNow();
  await sleep(60);
  assert.equal(lastAsk()?.text.key, 'ask.audience', 'the conversation went on after the retry');
  assert.equal(office.isRunning, true);
  office.dispose();
});

test('choosing cancel after a failure abandons the job', async () => {
  const brain = new GatedBrain();
  brain.failures.push(new ModelError('rate-limit', 'used up'));
  const { office, events, lastAsk, reachSlowTurn } = setup(brain);
  await reachSlowTurn();
  assert.equal(lastAsk()?.text.key, 'ask.modelError.rate-limit');

  office.answer(lastAsk()?.id ?? '', { choice: 'cancel' });
  await sleep(60);
  assert.equal(office.isRunning, false);
  assert.equal(events.some((e) => e.type === 'sim.reset'), true);
  office.dispose();
});

test('every kind of model failure has a message in the dictionary', async () => {
  const { STRINGS } = await import('../core/strings.ts');
  for (const kind of ['no-key', 'bad-key', 'rate-limit', 'network', 'timeout', 'server', 'empty', 'blocked', 'bad-request']) {
    assert.ok(STRINGS.en[`ask.modelError.${kind}`], `en.${kind}`);
    assert.ok(STRINGS.th[`ask.modelError.${kind}`], `th.${kind}`);
  }
});

test('a cancelled model call is not treated as a failure and asks nothing', async () => {
  const brain = new GatedBrain();
  brain.failures.push(new ModelError('cancelled', 'aborted'));
  const { office, events, reachSlowTurn } = setup(brain);
  await reachSlowTurn();
  assert.equal(events.filter((e) => e.type === 'chat.ask').length, 1, 'only the greeting was asked');
  office.dispose();
});

test('a slow brief shows the secretary writing, and the job goes on when it arrives', async () => {
  const brain = new GatedBrain();
  brain.gateOwner = false;
  brain.slowBrief = true;
  const { office, store, thinkings, events } = setup(brain, true);
  try {
    office.start();
    for (let i = 0; i < 100 && !thinkings().some((t) => t.from === 'secretary'); i++) await sleep(20);
    assert.ok(thinkings().some((t) => t.from === 'secretary'), 'the secretary box appeared while the brief was slow');
    assert.equal(tr(store.state.chat?.text ?? raw('')), 'Sam is writing the brief...');

    brain.releaseNow();
    for (let i = 0; i < 100 && !events.some((e) => e.type === 'job.stage' && e.stage === 'approval'); i++) await sleep(20);
    assert.equal(events.some((e) => e.type === 'job.stage' && e.stage === 'approval'), true, 'the job reached approval');
  } finally {
    office.dispose();
  }
});