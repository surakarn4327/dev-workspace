import assert from 'node:assert/strict';
import { test } from 'node:test';
import { OfficeStore } from '../core/state.ts';
import type { OfficeSource } from '../core/types.ts';
import { mountDialog } from './dialog.ts';
import { setupDom, sleep } from './test-dom.ts';

const t = setupDom();
const doc = t.window.document;

const answers: { id: string; text: string }[] = [];
const source: OfficeSource = {
  subscribe: () => () => {},
  answer: (id, text) => {
    answers.push({ id, text });
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
  store.apply({ type: 'chat.ask', id: 'c1', from: 'owner', text: 'What should we make?', placeholder: 'e.g. A newsletter' });
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
  assert.deepEqual(answers, [{ id: 'c1', text: 'A weekly newsletter' }]);
});

test('the dialog closes when the question is closed', () => {
  store.apply({ type: 'chat.closed', id: 'c1' });
  assert.equal(dialog.classList.contains('hidden'), true);
});

test('choice buttons are shown, locked while typing, and answer when clicked', async () => {
  store.apply({
    type: 'chat.ask',
    id: 'c2',
    from: 'owner',
    text: 'Shall we start?',
    choices: ['Approve', 'Revise'],
  });
  const buttons = [...choices.querySelectorAll('button')].map((b) => b.textContent);
  assert.deepEqual(buttons, ['Approve', 'Revise']);
  assert.ok(choices.classList.contains('pending'), 'choices are locked until the text has been typed');
  await sleep(600); // the typing effect finishes by itself
  assert.equal(choices.classList.contains('pending'), false);
  (choices.querySelectorAll('button')[1] as HTMLButtonElement).click();
  assert.deepEqual(answers.at(-1), { id: 'c2', text: 'Revise' });
  store.apply({ type: 'chat.closed', id: 'c2' });
});

test('the secretary talks at the top so the reception area stays visible', () => {
  store.apply({ type: 'chat.ask', id: 'c3', from: 'secretary', text: 'Your deliverable is ready.', choices: ['Accept'] });
  assert.equal(dialog.classList.contains('top'), true);
  store.apply({ type: 'chat.closed', id: 'c3' });
});

test.after(() => t.stop());
