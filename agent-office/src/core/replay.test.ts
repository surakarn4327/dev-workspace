// Playback runs on a fake scheduler: time only moves when a test says so.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { raw } from './i18n.ts';
import type { Recording } from './recording.ts';
import { ReplaySource } from './replay.ts';
import { RoutedSource } from './routed-source.ts';
import type { ChatReply, OfficeEvent, OfficeSource } from './types.ts';

const walk = (n: number): OfficeEvent => ({ type: 'agent.walk', agent: 'qa', to: 'pantry:0', speed: n });

function recording(times: number[]): Recording {
  return {
    v: 1,
    id: 'r1',
    title: 'Test job',
    startedAt: 0,
    durationMs: times.at(-1) ?? 0,
    ended: 'done',
    events: times.map((t, i) => ({ t, e: walk(i) })),
  };
}

function rig(times: number[], opts: ConstructorParameters<typeof ReplaySource>[1] = {}) {
  const timers: { fn: () => void; ms: number; live: boolean }[] = [];
  const replay = new ReplaySource(recording(times), {
    ...opts,
    schedule: (fn, ms) => {
      const t = { fn, ms, live: true };
      timers.push(t);
      return () => void (t.live = false);
    },
  });
  const seen: OfficeEvent[] = [];
  replay.subscribe((e) => seen.push(e));
  /** Fires the next pending timer, returns how long it was set for. */
  const tick = (): number | null => {
    const t = timers.find((x) => x.live);
    if (!t) return null;
    t.live = false;
    t.fn();
    return t.ms;
  };
  return { replay, seen, timers, tick };
}

const speeds = (seen: OfficeEvent[]): number[] => seen.filter((e): e is Extract<OfficeEvent, { type: 'agent.walk' }> => e.type === 'agent.walk').map((e) => e.speed);

test('starting clears the screen, then plays the events in order, waiting between them as they originally did', () => {
  const r = rig([0, 100, 100, 600]);
  r.replay.start();
  assert.equal(r.seen[0].type, 'sim.reset');
  assert.deepEqual(speeds(r.seen), [0], 'the first event is due at once; the next waits 100 ms');
  assert.equal(r.tick(), 100);
  assert.deepEqual(speeds(r.seen), [0, 1, 2], 'two events with no gap between them come out together');
  assert.equal(r.tick(), 500);
  assert.deepEqual(speeds(r.seen), [0, 1, 2, 3]);
  assert.equal(r.replay.progress.finished, true);
  assert.equal(r.tick(), null, 'nothing left to wait for');
});

test('speed shortens every wait, and a change of speed applies to the wait already under way', () => {
  const r = rig([0, 800, 1600, 2400], { speed: 4 });
  r.replay.start();
  r.replay.setSpeed(16); // the 200 ms wait for the second event is re-timed at once
  assert.equal(r.tick(), 50);
  r.replay.setSpeed(1);
  assert.equal(r.tick(), 800);
  assert.deepEqual(speeds(r.seen), [0, 1, 2], 'no event was lost or doubled by re-timing');
});

test('a long wait (the user typing) is shortened to a cap, so nobody watches an empty office', () => {
  const r = rig([0, 60_000, 60_100], { maxGapMs: 2500 });
  r.replay.start();
  assert.equal(r.tick(), 2500);
  assert.equal(r.tick(), 100);
});

test('the end is announced once, and the progress shows everything played', () => {
  const r = rig([0, 50, 100]);
  let ended = 0;
  r.replay.onEnd(() => ended++);
  r.replay.start();
  while (r.tick() !== null);
  assert.equal(ended, 1);
  assert.deepEqual([r.replay.progress.index, r.replay.progress.total, r.replay.progress.finished, r.replay.isRunning], [3, 3, true, false]);
  assert.equal(r.replay.progress.elapsedMs, 100);
});

test('pause stops the clock and resume carries on from the same place', () => {
  const r = rig([0, 100, 200, 300]);
  r.replay.start();
  r.replay.pause();
  assert.equal(r.replay.isRunning, false);
  assert.equal(r.tick(), null, 'the waiting timer was cancelled');
  r.replay.resume();
  assert.equal(r.replay.isRunning, true);
  r.tick();
  r.tick();
  r.tick();
  assert.deepEqual(speeds(r.seen), [0, 1, 2, 3], 'nothing was lost or repeated');
});

test('start plays again from the beginning, and reset stops for good', () => {
  const r = rig([0, 100, 200]);
  r.replay.start();
  r.tick();
  r.replay.start();
  assert.deepEqual(r.seen.filter((e) => e.type === 'sim.reset').length, 2);
  assert.equal(r.seen.at(-1) && (r.seen.at(-1) as { speed: number }).speed, 0, 'back at the first event');
  r.replay.reset();
  assert.equal(r.replay.isRunning, false);
  assert.equal(r.tick(), null);
});

test('answers do nothing during a replay; the ✕ on a question only hides that question', () => {
  const r = rig([0]);
  r.replay.start();
  const before = r.seen.length;
  r.replay.answer('c1', { text: 'hello' } as ChatReply);
  assert.equal(r.seen.length, before);
  r.replay.cancel('c1');
  assert.deepEqual(r.seen.at(-1), { type: 'chat.closed', id: 'c1' });
});

test('a timer that fires after the replay was stopped or finished does nothing', () => {
  const r = rig([0, 100, 200]);
  r.replay.start();
  const stale = r.timers[0];
  r.replay.reset();
  const before = r.seen.length;
  assert.doesNotThrow(() => stale.fn());
  assert.equal(r.seen.length, before);
  r.replay.start();
  while (r.tick() !== null);
  assert.doesNotThrow(() => stale.fn());
});

test('an empty recording finishes at once instead of hanging', () => {
  const r = rig([]);
  let ended = 0;
  r.replay.onEnd(() => ended++);
  r.replay.start();
  assert.equal(ended, 1);
});

// ---------- the switch between the live office and a replay ----------

function fakeLive() {
  const listeners = new Set<(e: OfficeEvent) => void>();
  const calls: string[] = [];
  const live: OfficeSource & { emit(e: OfficeEvent): void } = {
    subscribe: (fn) => {
      listeners.add(fn);
      fn({ type: 'infra', infra: { model: 0, tools: 0, quota: false, helper: 'up' } });
      return () => listeners.delete(fn);
    },
    isRunning: false,
    start: () => void calls.push('start'),
    reset: () => void calls.push('reset'),
    answer: (id) => void calls.push(`answer ${id}`),
    cancel: (id) => void calls.push(`cancel ${id}`),
    emit: (e) => listeners.forEach((fn) => fn(e)),
  };
  return { live, calls, listeners: () => listeners.size };
}

test('the screen hears the live office until a replay takes over, with a clean slate at every switch', () => {
  const { live, calls, listeners } = fakeLive();
  const routed = new RoutedSource(live);
  const heard: string[] = [];
  routed.subscribe((e) => heard.push(e.type));
  live.emit({ type: 'chat.ask', id: 'c', from: 'owner', text: raw('hi') });
  assert.deepEqual(heard, ['infra', 'chat.ask']);

  const r = rig([0, 10]);
  routed.useReplay(r.replay);
  assert.equal(routed.mode, 'replay');
  assert.equal(heard.at(-1), 'sim.reset');
  assert.equal(listeners(), 0, 'the live office is no longer listened to');
  live.emit({ type: 'chat.ask', id: 'ignored', from: 'owner', text: raw('x') });
  assert.equal(heard.filter((t) => t === 'chat.ask').length, 1);

  r.replay.start();
  assert.ok(heard.includes('agent.walk'));

  routed.useLive();
  assert.equal(routed.mode, 'live');
  assert.equal(r.replay.isRunning, false, 'giving the screen back stops the replay');
  assert.equal(listeners(), 1);
  assert.deepEqual(heard.slice(-2), ['sim.reset', 'infra'], 'the live office\'s machinery state is shown again');
  assert.deepEqual(calls, [], 'the live office was never reset or started by the switching');
});

test('start, reset, answer, cancel and isRunning always go to whoever drives the screen', () => {
  const { live, calls } = fakeLive();
  const routed = new RoutedSource(live);
  routed.start();
  routed.answer('a1', { text: 'x' });
  routed.cancel('c1');
  routed.reset();
  assert.deepEqual(calls, ['start', 'answer a1', 'cancel c1', 'reset']);

  const r = rig([0, 10]);
  routed.useReplay(r.replay);
  assert.equal(routed.isRunning, false);
  routed.start();
  assert.equal(routed.isRunning, true, 'start now plays the replay');
  assert.equal(calls.length, 4, 'and did not touch the live office');
  routed.useLive();
});
