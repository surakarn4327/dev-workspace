// Tests for the office "life": real use of the new rooms (coffee, archive, restroom).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OfficeEvent } from '../core/types.ts';
import { MockOffice } from './simulator.ts';

function runJob(): Promise<OfficeEvent[]> {
  const office = new MockOffice({ timeScale: 4000, autoAnswer: true, ambient: false });
  const events: OfficeEvent[] = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('job did not finish in time')), 20000);
    office.subscribe((e) => {
      events.push(e);
      if (e.type === 'job.done') {
        clearTimeout(timer);
        setTimeout(() => resolve(events), 50);
      }
    });
    office.start();
  });
}

const walksOf = (events: OfficeEvent[], agent: string): string[] =>
  events.filter((e) => e.type === 'agent.walk' && e.agent === agent).map((e) => (e as { to: string }).to);

test('while waiting for research, the producers go for coffee and come back', async () => {
  const events = await runJob();
  for (const a of ['prod-1', 'prod-2']) {
    const walks = walksOf(events, a);
    const pantry = walks.findIndex((p) => p.startsWith('pantry:'));
    assert.ok(pantry >= 0, `${a} never went to the pantry`);
    assert.equal(walks[pantry + 1], `desk:${a}`, `${a} should go back to their desk after the coffee`);
  }
  const breaks = events.filter((e) => e.type === 'agent.activity' && e.activity === 'break');
  assert.ok(breaks.length >= 2, 'expected a coffee-break activity');
});

test('after acceptance the secretary files the deliverable in the archive, then celebrates', async () => {
  const events = await runJob();
  const filed = events.findIndex((e) => e.type === 'archive.filed');
  const done = events.findIndex((e) => e.type === 'job.done');
  assert.ok(filed >= 0, 'nothing was filed');
  assert.ok(filed < done, 'filing must happen before the job is done');
  assert.equal(events.filter((e) => e.type === 'archive.filed').length, 1);
  const walks = walksOf(events, 'secretary');
  const archive = walks.lastIndexOf('archive:0');
  assert.ok(archive >= 0, 'the secretary never walked to the archive');
  assert.equal(walks[archive + 1], 'desk:secretary');
});

test('between jobs people wander off for a break and always return to their own desk', async () => {
  const office = new MockOffice({ timeScale: 6000, ambient: true });
  const events: OfficeEvent[] = [];
  office.subscribe((e) => events.push(e));
  await new Promise((r) => setTimeout(r, 1500));
  const trips = events.filter((e) => e.type === 'agent.walk' && /^(pantry|restroom):/.test(e.to));
  assert.ok(trips.length > 0, 'nobody ever left their desk');
  // Let in-flight trips finish by starting nothing new: the last walk of anyone who left must be back to their desk.
  for (const t of trips) {
    const who = (t as { agent: string }).agent;
    const idx = events.indexOf(t);
    const next = events.slice(idx + 1).find((e) => e.type === 'agent.walk' && e.agent === who);
    if (next) assert.equal((next as { to: string }).to, `desk:${who}`, `${who} did not walk back`);
  }
  office.dispose();
});

test('the owner never wanders off, so a click on Rex always finds him at his desk', async () => {
  const office = new MockOffice({ timeScale: 6000, ambient: true });
  const walks: string[] = [];
  office.subscribe((e) => {
    if (e.type === 'agent.walk' && (e.agent === 'owner' || e.agent === 'courier')) walks.push(`${e.agent}:${e.to}`);
  });
  await new Promise((r) => setTimeout(r, 1200));
  assert.deepEqual(
    walks.filter((w) => w.startsWith('owner:')),
    [],
  );
  office.dispose();
});

test('starting a job while people are on a break still completes the job', async () => {
  const office = new MockOffice({ timeScale: 6000, autoAnswer: true, ambient: true });
  let done = false;
  office.subscribe((e) => {
    if (e.type === 'job.done') done = true;
  });
  await new Promise((r) => setTimeout(r, 600)); // some trips are surely under way
  office.start();
  for (let i = 0; i < 400 && !done; i++) await new Promise((r) => setTimeout(r, 50));
  assert.equal(done, true, 'the job never finished');
  office.dispose();
});

test('when an agent crashes, the head goes to the server room, restarts it and comes back; the agent recovers', async () => {
  const office = new MockOffice({ timeScale: 6000, ambient: false });
  const events: OfficeEvent[] = [];
  office.subscribe((e) => events.push(e));
  assert.equal(office.injectError(), true);
  await new Promise((r) => setTimeout(r, 400));
  const crashed = events.find((e) => e.type === 'agent.activity' && e.activity === 'error');
  assert.ok(crashed && crashed.type === 'agent.activity', 'nobody crashed');
  const who = crashed.agent;
  const head = who.startsWith('research') ? 'research-head' : 'prod-head';
  const headWalks = walksOf(events, head);
  assert.deepEqual(headWalks, ['server:0', `desk:${head}`], 'the head should go to the server room, then back to the desk');
  const staffActs = events
    .filter((e) => e.type === 'agent.activity' && e.agent === who)
    .map((e) => (e as { activity: string }).activity);
  assert.equal(staffActs[0], 'error');
  assert.notEqual(staffActs[staffActs.length - 1], 'error', 'the agent never recovered');
  assert.ok(
    events.some((e) => e.type === 'agent.activity' && e.agent === head && e.activity === 'typing' && e.note === 'Restarting the tool server'),
    'the head never restarted the server',
  );
  office.dispose();
});
