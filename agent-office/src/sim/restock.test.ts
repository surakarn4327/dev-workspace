// After the daily quota reset Zip carries a fresh ream of paper to the lobby printer.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { OfficeEvent } from '../core/types.ts';
import { MockOffice } from './simulator.ts';

const offices: MockOffice[] = [];
test.afterEach(() => {
  for (const o of offices.splice(0)) o.dispose();
});

function start(): { office: MockOffice; events: OfficeEvent[] } {
  const office = new MockOffice({ timeScale: 4000, ambient: false });
  offices.push(office);
  const events: OfficeEvent[] = [];
  office.subscribe((e) => events.push(e));
  return { office, events };
}

const until = async (cond: () => boolean, ms = 3000): Promise<void> => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};

test('Zip carries a ream to the printer, says so, restocks it, and goes back to the desk', async () => {
  const { office, events } = start();
  office.restock();
  await until(() => events.some((e) => e.type === 'paper.restocked'));
  await until(() => events.some((e) => e.type === 'agent.walk' && e.agent === 'courier' && e.to === 'desk:courier'));
  const seq = events.filter((e) => e.type === 'agent.carry' || e.type === 'agent.walk' || e.type === 'agent.say' || e.type === 'paper.restocked');
  const names = seq.map((e) => (e.type === 'agent.walk' ? `walk:${e.to}` : e.type === 'agent.carry' ? (e.label ? `carry:${e.label.key}` : 'carry:none') : e.type === 'agent.say' ? `say:${e.text.key}` : e.type));
  assert.deepEqual(names.slice(0, 6), ['carry:doc.ream', 'walk:printer:0', 'say:say.restock', 'paper.restocked', 'carry:none', 'walk:desk:courier']);
});

test('it happens once per reset, not on every wake-up', async () => {
  const { office, events } = start();
  office.restock();
  await until(() => events.some((e) => e.type === 'agent.walk' && e.agent === 'courier' && e.to === 'desk:courier'));
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(events.filter((e) => e.type === 'paper.restocked').length, 1);
});

test('a reset of the office cancels a delivery that has not started', async () => {
  const { office, events } = start();
  office.restock();
  office.reset();
  await new Promise((r) => setTimeout(r, 80));
  const after = events.slice(events.findIndex((e) => e.type === 'sim.reset'));
  assert.ok(!after.some((e) => e.type === 'agent.carry' && e.label?.key === 'doc.ream'));
});
