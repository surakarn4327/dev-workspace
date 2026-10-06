import assert from 'node:assert/strict';
import { test } from 'node:test';
import { raw } from './i18n.ts';
import { Recorder, metaOf } from './recording.ts';
import type { Recording } from './recording.ts';
import { IDLE_USAGE } from './types.ts';
import type { Infra, OfficeEvent } from './types.ts';

function rig(maxEvents?: number) {
  let time = 1_000_000;
  const saved: Recording[] = [];
  const recorder = new Recorder({ now: () => time, onSave: (r) => saved.push(r), maxEvents });
  return {
    recorder,
    saved,
    at(ms: number, e: OfficeEvent) {
      time += ms;
      recorder.feed(e);
    },
  };
}

const ask: OfficeEvent = { type: 'chat.ask', id: 'c1', from: 'owner', text: raw('What?') };
const walk: OfficeEvent = { type: 'agent.walk', agent: 'qa', to: 'pantry:0', speed: 40 };
const infra = (model: number): Infra => ({ model, tools: 0, quota: false, helper: 'up', usage: IDLE_USAGE });

test('idle life is not recorded: only the owner\'s first question opens a recording', () => {
  const r = rig();
  r.at(10, walk);
  r.at(10, { type: 'agent.activity', agent: 'qa', activity: 'break' });
  r.at(10, { type: 'infra', infra: infra(1) });
  assert.equal(r.recorder.recording, false);
  r.at(10, ask);
  assert.equal(r.recorder.recording, true);
});

test('a finished job is saved with its title, timing, ending and every event in order', () => {
  const r = rig();
  r.at(0, ask);
  r.at(500, { type: 'user.say', text: raw('A newsletter'), to: 'owner' });
  r.at(5, { type: 'chat.closed', id: 'c1' });
  r.at(5, { type: 'job.created', jobId: 'j1', title: 'A newsletter' });
  r.at(2000, walk);
  r.at(3000, { type: 'job.done', jobId: 'j1' });
  assert.equal(r.saved.length, 1);
  const rec = r.saved[0];
  assert.equal(rec.v, 1);
  assert.equal(rec.title, 'A newsletter');
  assert.equal(rec.ended, 'done');
  assert.equal(rec.durationMs, 5510);
  assert.deepEqual(rec.events.map((x) => x.e.type), ['chat.ask', 'user.say', 'chat.closed', 'job.created', 'agent.walk', 'job.done']);
  assert.deepEqual(rec.events.map((x) => x.t), [0, 500, 505, 510, 2510, 5510]);
  assert.equal(r.recorder.recording, false);
});

test('events after the job is done (coffee again) belong to no recording', () => {
  const r = rig();
  r.at(0, ask);
  r.at(1, { type: 'user.say', text: raw('x'), to: 'owner' });
  r.at(1, { type: 'job.created', jobId: 'j', title: 'X' });
  r.at(1, { type: 'job.done', jobId: 'j' });
  r.at(1, walk);
  r.at(1, { type: 'chat.closed', id: 'c9' });
  assert.equal(r.saved.length, 1);
  assert.equal(r.saved[0].events.length, 4);
});

test('the machinery\'s state is copied in at the start, and its later changes are recorded', () => {
  const r = rig();
  r.at(0, { type: 'infra', infra: infra(0) }); // seen while idle
  r.at(10, ask);
  r.at(10, { type: 'infra', infra: infra(1) });
  r.at(10, { type: 'user.say', text: raw('x'), to: 'owner' });
  r.at(10, { type: 'job.created', jobId: 'j', title: 'X' });
  r.at(10, { type: 'job.done', jobId: 'j' });
  const events = r.saved[0].events;
  assert.deepEqual(events[0], { t: 0, e: { type: 'infra', infra: infra(0) } });
  assert.deepEqual(events.filter((x) => x.e.type === 'infra').map((x) => (x.e as { infra: Infra }).infra.model), [0, 1]);
});

test('a job abandoned by a reset is saved as abandoned; one that never got a name is dropped', () => {
  const named = rig();
  named.at(0, ask);
  named.at(1, { type: 'user.say', text: raw('x'), to: 'owner' });
  named.at(1, { type: 'job.created', jobId: 'j', title: 'Half done' });
  named.at(100, { type: 'sim.reset' });
  assert.equal(named.saved.length, 1);
  assert.equal(named.saved[0].ended, 'abandoned');
  assert.equal(named.saved[0].title, 'Half done');

  const unnamed = rig();
  unnamed.at(0, ask);
  unnamed.at(100, { type: 'sim.reset' });
  assert.equal(unnamed.saved.length, 0);
  assert.equal(unnamed.recorder.recording, false);
});

test('closing the first question without answering leaves nothing recorded, and the next question starts fresh', () => {
  const r = rig();
  r.at(0, ask);
  r.at(5, { type: 'chat.closed', id: 'c1' });
  assert.equal(r.recorder.recording, false);
  assert.equal(r.saved.length, 0);
  r.at(5, ask);
  assert.equal(r.recorder.recording, true);
});

test('each recording gets its own id', () => {
  const r = rig();
  for (let i = 0; i < 3; i++) {
    r.at(1, ask);
    r.at(1, { type: 'user.say', text: raw('x'), to: 'owner' });
    r.at(1, { type: 'job.created', jobId: `j${i}`, title: `Job ${i}` });
    r.at(1, { type: 'job.done', jobId: `j${i}` });
  }
  assert.equal(new Set(r.saved.map((s) => s.id)).size, 3);
});

test('a runaway job stops being recorded at the cap but is still saved', () => {
  const r = rig(10);
  r.at(0, ask);
  r.at(1, { type: 'user.say', text: raw('x'), to: 'owner' });
  r.at(1, { type: 'job.created', jobId: 'j', title: 'Big' });
  for (let i = 0; i < 50; i++) r.at(1, walk);
  r.at(1, { type: 'job.done', jobId: 'j' });
  assert.equal(r.saved.length, 1);
  assert.equal(r.saved[0].events.length, 10);
  assert.equal(r.saved[0].title, 'Big');
});

test('metaOf keeps everything but the events, and counts them', () => {
  const r = rig();
  r.at(0, ask);
  r.at(1, { type: 'user.say', text: raw('x'), to: 'owner' });
  r.at(1, { type: 'job.created', jobId: 'j', title: 'T' });
  r.at(1, { type: 'job.done', jobId: 'j' });
  const meta = metaOf(r.saved[0]);
  assert.equal(meta.eventCount, 4);
  assert.equal('events' in meta, false);
  assert.equal(meta.title, 'T');
});
