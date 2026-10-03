import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OfficeStore } from '../core/state.ts';
import type { AgentId, OfficeEvent } from '../core/types.ts';
import type { OfficeView } from '../render/view.ts';
import { mountPanels } from './panels.ts';
import { setupDom, sleep } from './test-dom.ts';

const t = setupDom();
const doc = t.window.document;
const store = new OfficeStore();
const view = { selected: null as AgentId | null };
const panels = mountPanels(store, view as unknown as OfficeView);

/** Apply an event the way main.ts does: store first, then the panels' own listener. */
const send = async (e: OfficeEvent): Promise<void> => {
  store.apply(e);
  panels.onEvent(e);
  await sleep(40); // panels re-render on the next animation frame
};
const text = (sel: string): string => doc.querySelector(sel)?.textContent ?? '';

test('the seven workflow steps are listed with their names as tooltips', () => {
  const steps = [...doc.querySelectorAll('#steps .step')];
  assert.equal(steps.length, 7);
  assert.equal((steps[0] as HTMLElement).title, 'Brief');
  assert.equal((steps[6] as HTMLElement).title, 'Deliver');
});

test('the step tracker follows the stage: earlier steps done, the current one highlighted', async () => {
  await send({ type: 'job.stage', jobId: 'j', stage: 'work' });
  const steps = [...doc.querySelectorAll('#steps .step')];
  assert.deepEqual(
    steps.map((s) => s.classList.contains('done')),
    [true, true, true, true, false, false, false],
  );
  assert.equal(steps[4].classList.contains('current'), true);
  await send({ type: 'job.stage', jobId: 'j', stage: 'done' });
  assert.ok([...doc.querySelectorAll('#steps .step')].every((s) => s.classList.contains('done')), 'all steps done at the end');
});

test('the job title shows the job once it exists', async () => {
  await send({ type: 'job.created', jobId: 'j', title: 'A weekly newsletter' });
  assert.equal(text('#job-title'), 'A weekly newsletter');
});

test('the courier queue lists waiting documents and what the courier is carrying', async () => {
  const doc1 = { id: 'd1', label: 'Findings', from: 'research-1', to: 'research-head' } as const;
  await send({ type: 'doc.queued', doc: doc1 });
  assert.ok(text('#queue').includes('Findings'));
  assert.ok(text('#queue').includes('Leo') && text('#queue').includes('Dr. Iris'));
  await send({ type: 'doc.pickup', doc: doc1 });
  assert.ok(text('#queue').includes('Carrying: Findings'));
  await send({ type: 'doc.delivered', doc: doc1 });
  assert.ok(text('#queue').includes('Queue is empty'));
});

test('the inspector shows a hint until somebody is selected, then their details and conversations', async () => {
  assert.ok(text('#inspector').includes('Click a character'));
  view.selected = 'qa';
  await send({ type: 'agent.activity', agent: 'qa', activity: 'reviewing', note: 'Checking the brief' });
  await send({ type: 'agent.say', agent: 'qa', text: 'Section 2 has no sources', to: 'prod-head' });
  const inspector = text('#inspector');
  assert.ok(inspector.includes('Quinn') && inspector.includes('QA Reviewer'));
  assert.ok(inspector.includes('Reviewing'), 'the activity label');
  assert.ok(inspector.includes('Checking the brief'), 'what they are doing');
  assert.ok(inspector.includes('Section 2 has no sources'), 'their conversation');
});

test('the event feed lists what happened, newest first, and skips noise like walking', async () => {
  await send({ type: 'agent.walk', agent: 'qa', to: 'pantry:0', speed: 1 });
  const before = doc.querySelectorAll('#feed li').length;
  await send({ type: 'agent.say', agent: 'owner', text: 'Welcome!' });
  const items = [...doc.querySelectorAll('#feed li')];
  assert.equal(items.length, before + 1, 'walking is not logged, speech is');
  assert.ok((items[0].textContent ?? '').includes('Rex: Welcome!'));
});

test('a reset clears the feed', async () => {
  await send({ type: 'sim.reset' });
  assert.equal(doc.querySelectorAll('#feed li').length, 1, 'only the "Office reset" line remains');
});

test.after(() => t.stop());
