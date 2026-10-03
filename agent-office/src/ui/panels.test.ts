import assert from 'node:assert/strict';
import { test } from 'node:test';
import { msg, raw, setLang } from '../core/i18n.ts';
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
  const doc1 = { id: 'd1', label: msg('doc.findings'), from: 'research-1', to: 'research-head' } as const;
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
  await send({ type: 'agent.activity', agent: 'qa', activity: 'reviewing', note: raw('Checking the brief') });
  await send({ type: 'agent.say', agent: 'qa', text: msg('reason.noSources'), to: 'prod-head' });
  const inspector = text('#inspector');
  assert.ok(inspector.includes('Quinn') && inspector.includes('QA Reviewer'));
  assert.ok(inspector.includes('Reviewing'), 'the activity label');
  assert.ok(inspector.includes('Checking the brief'), 'what they are doing');
  assert.ok(inspector.includes('Section 2 has no sources'), 'their conversation');
});

test('the event feed lists what happened, newest first, and skips noise like walking', async () => {
  await send({ type: 'agent.walk', agent: 'qa', to: 'pantry:0', speed: 1 });
  const before = doc.querySelectorAll('#feed li').length;
  await send({ type: 'agent.say', agent: 'owner', text: raw('Welcome!') });
  const items = [...doc.querySelectorAll('#feed li')];
  assert.equal(items.length, before + 1, 'walking is not logged, speech is');
  assert.ok((items[0].textContent ?? '').includes('Rex: Welcome!'));
});

test('a reset clears the feed', async () => {
  await send({ type: 'sim.reset' });
  assert.equal(doc.querySelectorAll('#feed li').length, 1, 'only the "Office reset" line remains');
});

test('switching language re-labels steps, the queue, the inspector and the already-written feed', async () => {
  await send({ type: 'sim.reset' });
  await send({ type: 'job.stage', jobId: 'j', stage: 'review' });
  await send({ type: 'review.verdict', verdict: 'reject', reason: msg('reason.noSources'), round: 1 });
  view.selected = 'qa';
  await send({ type: 'agent.activity', agent: 'qa', activity: 'reviewing', note: msg('note.checking') });
  assert.ok(text('#feed').includes('QA rejected (round 1): Section 2 has no sources'));
  assert.ok(text('#inspector').includes('Checking against the brief') && text('#inspector').includes('Reviewing'));

  setLang('th', false); // no await: the switch must show up immediately
  assert.ok(text('#feed').includes('QA ตีกลับ (รอบที่ 1): หัวข้อที่ 2 ไม่มีแหล่งอ้างอิง'), 'old feed lines are translated too');
  assert.ok(text('#feed').includes('ขั้นตอน: ตรวจ'));
  assert.equal((doc.querySelectorAll('#steps .step')[6] as HTMLElement).title, 'ส่งมอบ');
  assert.ok(text('#queue').includes('คิวว่าง'));
  const insp = text('#inspector');
  assert.ok(insp.includes('ผู้ตรวจ QA') && insp.includes('กำลังตรวจ') && insp.includes('กำลังตรวจเทียบกับบรีฟ') && insp.includes('Quinn'));
  assert.equal(text('#job-title'), 'ยังไม่มีงาน — กด "เริ่มงาน" หรือคลิกที่ Rex');
  assert.ok(doc.querySelector('#steps .step.current'), 'step highlighting survives the re-render');

  setLang('en', false);
  assert.ok(text('#feed').includes('QA rejected (round 1)'));
});
test.after(() => t.stop());
