import assert from 'node:assert/strict';
import { test } from 'node:test';
import { msg, raw, setLang } from '../core/i18n.ts';
import { OfficeStore } from '../core/state.ts';
import type { ChatReply, OfficeSource } from '../core/types.ts';
import { mountDialog } from './dialog.ts';
import { setupDom, sleep } from './test-dom.ts';

const t = setupDom();
const doc = t.window.document;

const answers: { id: string; reply: ChatReply }[] = [];
const cancelled: string[] = [];
const source: OfficeSource = {
  subscribe: () => () => {},
  isRunning: false,
  start: () => {},
  reset: () => {},
  answer: (id, reply) => {
    answers.push({ id, reply });
  },
  cancel: (id) => {
    cancelled.push(id);
  },
};
const store = new OfficeStore();
mountDialog(store, source);

const dialog = doc.getElementById('dialog') as HTMLElement;
const text = doc.getElementById('dlg-text') as HTMLElement;
const choices = doc.getElementById('dlg-choices') as HTMLElement;
const input = doc.getElementById('dlg-input') as HTMLInputElement;
const form = doc.getElementById('dlg-form') as HTMLFormElement;

const submit = (): void => {
  form.dispatchEvent(new t.window.Event('submit', { cancelable: true, bubbles: true }));
};

test('a question from the owner opens the dialog with his name, text and answer box', () => {
  store.apply({ type: 'chat.ask', id: 'c1', from: 'owner', text: raw('What should we make?'), placeholder: raw('e.g. A newsletter') });
  assert.equal(dialog.classList.contains('hidden'), false);
  assert.ok((doc.getElementById('dlg-name') as HTMLElement).textContent?.includes('Rex'));
  assert.equal(input.placeholder, 'e.g. A newsletter');
  assert.equal(dialog.classList.contains('top'), false, 'the owner talks at the bottom of the screen');
  assert.equal(text.textContent, 'What should we make?', 'the full text is in the layout (typed out gradually)');
});

test('clicking the text finishes the typing effect immediately', () => {
  text.click();
  assert.equal(text.querySelector('.ghost')?.textContent ?? '', '');
});

test('typing an answer and pressing send answers the question and ignores empty input', () => {
  input.value = '   ';
  submit();
  assert.equal(answers.length, 0, 'an empty answer must not be sent');
  input.value = '  A weekly newsletter  ';
  submit();
  assert.deepEqual(answers, [{ id: 'c1', reply: { text: 'A weekly newsletter' } }]);
});

test('the dialog closes when the question is closed', () => {
  store.apply({ type: 'chat.closed', id: 'c1' });
  assert.equal(dialog.classList.contains('hidden'), true);
});

test('the X cancels the question instead of answering it', () => {
  const before = answers.length;
  store.apply({ type: 'chat.ask', id: 'c9', from: 'owner', text: raw('Still there?') });
  (doc.getElementById('dlg-close') as HTMLButtonElement).click();
  assert.deepEqual(cancelled, ['c9'], 'the source is told to cancel');
  assert.equal(answers.length, before, 'closing is not an answer');
  store.apply({ type: 'chat.closed', id: 'c9' }); // what the source sends back
  assert.equal(dialog.classList.contains('hidden'), true);
  (doc.getElementById('dlg-close') as HTMLButtonElement).click();
  assert.deepEqual(cancelled, ['c9'], 'with no question open the X does nothing');
});

test('a thinking box shows the words with no answer box, its X cancels, and the next question replaces it', () => {
  setLang('en', false);
  const before = cancelled.length;
  store.apply({ type: 'chat.thinking', id: 't1', from: 'owner' });
  assert.equal(dialog.classList.contains('hidden'), false);
  assert.equal(dialog.classList.contains('thinking'), true, 'the answer box and buttons are hidden by this class');
  assert.equal(text.textContent, 'Rex is thinking...');

  store.apply({ type: 'chat.thinking', id: 't1', from: 'owner', wait: 'quota' });
  assert.equal(text.textContent, 'Rex is waiting for the free AI quota...', 'same box, new words');

  (doc.getElementById('dlg-close') as HTMLButtonElement).click();
  assert.deepEqual(cancelled.slice(before), ['t1']);

  store.apply({ type: 'chat.ask', id: 'c10', from: 'owner', text: raw('Next question?') });
  assert.equal(dialog.classList.contains('thinking'), false, 'a real question brings the answer box back');
  assert.equal(text.textContent, 'Next question?');
  store.apply({ type: 'chat.closed', id: 'c10' });
});

test('the secretary thinking box says she is writing the brief', () => {
  setLang('en', false);
  store.apply({ type: 'chat.thinking', id: 't2', from: 'secretary' });
  assert.equal(text.textContent, 'Sam is writing the brief...');
  store.apply({ type: 'chat.closed', id: 't2' });
  assert.equal(dialog.classList.contains('hidden'), true);
});

test('choice buttons are shown, locked while typing, and answer when clicked', async () => {
  store.apply({
    type: 'chat.ask',
    id: 'c2',
    from: 'owner',
    text: raw('Shall we start?'),
    choices: [
      { id: 'approve', label: msg('choice.approve') },
      { id: 'revise', label: msg('choice.revise') },
    ],
  });
  const buttons = [...choices.querySelectorAll('button')].map((b) => b.textContent);
  assert.deepEqual(buttons, ['Approve', 'Revise']);
  assert.ok(choices.classList.contains('pending'), 'choices are locked until the text has been typed');
  await sleep(600); // the typing effect finishes by itself
  assert.equal(choices.classList.contains('pending'), false);
  (choices.querySelectorAll('button')[1] as HTMLButtonElement).click();
  assert.deepEqual(answers.at(-1), { id: 'c2', reply: { choice: 'revise' } });
  store.apply({ type: 'chat.closed', id: 'c2' });
});

test('the secretary talks at the top so the reception area stays visible', () => {
  store.apply({ type: 'chat.ask', id: 'c3', from: 'secretary', text: raw('Your deliverable is ready.'), choices: [{ id: 'accept', label: msg('choice.accept') }] });
  assert.equal(dialog.classList.contains('top'), true);
  store.apply({ type: 'chat.closed', id: 'c3' });
});

test('switching language mid-question swaps the words at once and keeps the typed answer', async () => {
  setLang('en', false);
  store.apply({
    type: 'chat.ask',
    id: 'c4',
    from: 'owner',
    text: msg('ask.approve', { details: raw('X') }),
    placeholder: msg('ask.approve.ph'),
    choices: [
      { id: 'approve', label: msg('choice.approve') },
      { id: 'revise', label: msg('choice.revise') },
    ],
  });
  await sleep(1500); // typing effect done
  input.value = 'half-typed answer';
  assert.ok(text.textContent?.includes('Here is the brief'));
  setLang('th', false);
  assert.ok(text.textContent?.includes('นี่คือบรีฟ'), 'the question text is Thai now');
  assert.deepEqual([...choices.querySelectorAll('button')].map((b) => b.textContent), ['อนุมัติ', 'ขอแก้ไข']);
  assert.equal(input.placeholder, 'หรือพิมพ์สิ่งที่อยากแก้');
  assert.ok((doc.getElementById('dlg-name') as HTMLElement).textContent?.includes('เจ้าของบริษัท'));
  assert.equal(input.value, 'half-typed answer', 'what the user was typing is kept');
  (choices.querySelectorAll('button')[0] as HTMLButtonElement).click();
  assert.deepEqual(answers.at(-1), { id: 'c4', reply: { choice: 'approve' } }, 'the answer is the same id in any language');
  store.apply({ type: 'chat.closed', id: 'c4' });
  setLang('en', false);
});
test.after(() => t.stop());
