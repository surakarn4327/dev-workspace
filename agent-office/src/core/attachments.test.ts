import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AttachmentStore, MAX_FILES, MAX_FILE_CHARS, MAX_TOTAL_CHARS, kindOfFile } from './attachments.ts';

const file = (name: string, text: string, size = text.length) => ({ name, size, text: async () => text });

test('only text file types are accepted, PDF gets its own answer', () => {
  assert.equal(kindOfFile('notes.TXT'), 'text');
  assert.equal(kindOfFile('data.csv'), 'text');
  assert.equal(kindOfFile('report.pdf'), 'pdf');
  assert.equal(kindOfFile('photo.png'), 'other');
  assert.equal(kindOfFile('README'), 'other');
});

test('a text file is kept (line endings tidied) and listed by name', async () => {
  const s = new AttachmentStore();
  const r = await s.add(file('a.md', 'one\r\ntwo\r\n'));
  assert.ok(r.ok);
  assert.deepEqual(s.list().map((f) => [f.name, f.text, f.truncated]), [['a.md', 'one\ntwo', false]]);
  assert.deepEqual(s.names(), ['a.md']);
});

test('refused files say why and are not kept', async () => {
  const s = new AttachmentStore();
  assert.deepEqual(await s.add(file('x.pdf', 'p')), { ok: false, kind: 'pdf', name: 'x.pdf' });
  assert.deepEqual(await s.add(file('x.png', 'p')), { ok: false, kind: 'type', name: 'x.png' });
  assert.deepEqual(await s.add(file('e.txt', '  \n ')), { ok: false, kind: 'empty', name: 'e.txt' });
  assert.deepEqual(await s.add(file('big.txt', 'x', 5_000_000)), { ok: false, kind: 'unreadable', name: 'big.txt' });
  assert.deepEqual(await s.add({ name: 'bad.txt', size: 1, text: async () => { throw new Error('nope'); } }), { ok: false, kind: 'unreadable', name: 'bad.txt' });
  assert.equal(s.list().length, 0);
});

test('a long file is cut to the per-file limit and flagged', async () => {
  const s = new AttachmentStore();
  const r = await s.add(file('long.txt', 'a'.repeat(MAX_FILE_CHARS + 500)));
  assert.ok(r.ok && r.attachment.truncated);
  assert.equal(s.list()[0].text.length, MAX_FILE_CHARS);
});

test('the files together stay inside the total limit, and no more than the file count', async () => {
  const s = new AttachmentStore();
  await s.add(file('1.txt', 'a'.repeat(MAX_FILE_CHARS)));
  await s.add(file('2.txt', 'b'.repeat(MAX_FILE_CHARS)));
  const third = await s.add(file('3.txt', 'c'.repeat(MAX_FILE_CHARS)));
  assert.deepEqual(third, { ok: false, kind: 'budget', name: '3.txt' });
  assert.ok(s.totalChars <= MAX_TOTAL_CHARS);

  const many = new AttachmentStore();
  for (let i = 0; i < MAX_FILES; i++) assert.ok((await many.add(file(`f${i}.txt`, 'x'))).ok);
  assert.deepEqual(await many.add(file('extra.txt', 'x')), { ok: false, kind: 'too-many', name: 'extra.txt' });
});

test('attaching the same name again replaces it, and remove / clear tell listeners', async () => {
  const s = new AttachmentStore();
  let changes = 0;
  s.onChange(() => changes++);
  await s.add(file('a.txt', 'old'));
  await s.add(file('a.txt', 'new'));
  assert.deepEqual(s.list().map((f) => f.text), ['new']);
  s.remove('nope');
  s.remove('a.txt');
  s.clear();
  assert.equal(s.list().length, 0);
  assert.equal(changes, 3, 'two adds and one real remove; the no-ops stay silent');
});
