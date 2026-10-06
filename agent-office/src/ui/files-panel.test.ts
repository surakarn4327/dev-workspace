import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AttachmentStore } from '../core/attachments.ts';
import type { ExportFile } from '../core/export.ts';
import { setLang } from '../core/i18n.ts';
import type { JobFile } from '../core/job-file.ts';
import { applyStatic } from './i18n-dom.ts';
import { mountFilesPanel } from './files-panel.ts';
import { setupDom } from './test-dom.ts';

const t = setupDom();
const doc = t.window.document;

const store = new AttachmentStore();
let job: JobFile | null = null;
const saved: ExportFile[] = [];
mountFilesPanel({ store, job: () => job, save: (f) => saved.push(f) });

const input = doc.getElementById('files-input') as HTMLInputElement;
const status = (): string => doc.getElementById('files-status')?.textContent ?? '';
const listText = (): string => doc.getElementById('files-list')?.textContent ?? '';
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 5));
const fakeFile = (name: string, text: string) => ({ name, size: text.length, text: async () => text });

function pick(...files: ReturnType<typeof fakeFile>[]): void {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new t.window.Event('change'));
}

test('the panel starts empty, with nothing to download', () => {
  setLang('en', false);
  applyStatic();
  assert.match(listText(), /No files attached\./);
  assert.equal((doc.getElementById('files-downloads') as HTMLElement).hidden, true);
  assert.equal((doc.getElementById('files-download-none') as HTMLElement).hidden, false);
});

test('picking files lists the good ones and says why the others were refused', async () => {
  pick(fakeFile('notes.txt', 'hello world'), fakeFile('paper.pdf', 'x'), fakeFile('pic.png', 'x'));
  await settle();
  assert.match(listText(), /notes\.txt/);
  assert.doesNotMatch(listText(), /paper|pic/);
  assert.match(status(), /paper\.pdf: PDF files are not supported yet\./);
  assert.match(status(), /pic\.png: only text files can be attached\./);
  assert.ok(doc.getElementById('files-status')?.classList.contains('warn'));
});

test('the refusals are rewritten when the language changes', () => {
  setLang('th', false);
  applyStatic();
  assert.match(status(), /paper\.pdf: ยังไม่รองรับไฟล์ PDF/);
  setLang('en', false);
  applyStatic();
});

test('removing a file takes it off the list and clears the refusals', () => {
  (doc.querySelector('#files-list .replay-del') as HTMLButtonElement).click();
  assert.match(listText(), /No files attached\./);
  assert.equal(status(), '');
});

test('once a brief is approved the four download buttons appear and save the right files', () => {
  job = { id: 'j', title: 'Gold note', history: [], brief: null, approvedBrief: 'Goal: gold', changes: [], research: null };
  store.clear(); // any change makes the panel redraw
  void store.add(fakeFile('a.txt', 'abc'));
  return settle().then(() => {
    const buttons = [...doc.querySelectorAll<HTMLButtonElement>('#files-downloads button')];
    assert.deepEqual(buttons.map((b) => b.textContent), ['Markdown (.md)', 'Text (.txt)', 'Web page (.html)', 'Sources (.csv)']);
    buttons[0].click();
    buttons[3].click();
    assert.deepEqual(saved.map((f) => f.filename), ['Gold-note.md', 'Gold-note.csv']);
    assert.match(saved[0].content, /## Attached files\n\n- a\.txt/);
  });
});
