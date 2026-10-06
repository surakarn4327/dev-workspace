import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildExport, canExport, fileBase } from './export.ts';
import type { JobFile } from './job-file.ts';

const job: JobFile = {
  id: 'job-1',
  title: 'Gold <price> note',
  history: [],
  brief: null,
  approvedBrief: 'Goal: price & trend',
  changes: [],
  research: {
    report: 'Confirmed:\n- 65,900 baht',
    body: 'Confirmed:\n- 65,900 baht',
    findings: [],
    sources: [
      { url: 'https://gold.example/p?a=1&b=2', title: 'Gold, "today"', opened: true },
      { url: 'https://x.example', title: '=HYPERLINK("http://evil")', opened: false },
    ],
    checked: true,
  },
};

test('there is something to save once a brief is approved, not before', () => {
  assert.equal(canExport(null), false);
  assert.equal(canExport({ ...job, approvedBrief: null, research: null }), false);
  assert.equal(canExport({ ...job, research: null }), true);
});

test('file names keep letters and digits of any script and never end up empty', () => {
  assert.equal(fileBase('Gold <price> note!'), 'Gold-price-note');
  assert.equal(fileBase('ราคาทองวันนี้'), 'ราคาทองวันนี้');
  assert.equal(fileBase('???'), 'job');
  assert.ok(fileBase('x'.repeat(200)).length <= 40);
});

test('markdown and text carry the title, the brief, the report and the attached file names', () => {
  const md = buildExport(job, 'md', 'en', ['notes.txt']);
  assert.equal(md.filename, 'Gold-price-note.md');
  assert.match(md.content, /^# Gold <price> note\n\n## Approved brief\n\nGoal: price & trend\n\n## Research report\n\nConfirmed:/);
  assert.match(md.content, /## Attached files\n\n- notes\.txt/);
  const txt = buildExport(job, 'txt', 'en');
  assert.match(txt.content, /APPROVED BRIEF\n\nGoal/);
  assert.doesNotMatch(txt.content, /Attached files/i);
});

test('the web page escapes everything it was given and declares the language', () => {
  const html = buildExport(job, 'html', 'th').content;
  assert.match(html, /<html lang="th">/);
  assert.ok(html.includes('Gold &lt;price&gt; note'));
  assert.ok(html.includes('price &amp; trend'));
  assert.ok(!html.includes('<price>'));
});

test('the CSV quotes cells, and a cell that would run as a spreadsheet formula is defused', () => {
  const csv = buildExport(job, 'csv', 'en').content;
  const lines = csv.trimEnd().split('\r\n');
  assert.equal(lines[0], 'Address,Title,Opened');
  assert.equal(lines[1], 'https://gold.example/p?a=1&b=2,"Gold, ""today""",yes');
  assert.equal(lines[2], `https://x.example,"'=HYPERLINK(""http://evil"")",no`);
});

test('a job whose research ran as the demo says so instead of leaving a gap', () => {
  const md = buildExport({ ...job, research: null }, 'md', 'en').content;
  assert.match(md, /No research report: the research ran as the demo script\./);
  assert.equal(buildExport({ ...job, research: null }, 'csv', 'en').content, 'Address,Title,Opened\r\n');
});

test('the same export in Thai uses Thai labels', () => {
  const md = buildExport(job, 'md', 'th').content;
  assert.match(md, /## บรีฟที่อนุมัติแล้ว/);
  assert.match(md, /## รายงานวิจัย/);
});

test('a finished result comes first, with the stamp, and a research-only result is not repeated', () => {
  const withResult: JobFile = { ...job, deliverable: { body: 'THE RESULT', version: 2, unresolved: null } };
  const md = buildExport(withResult, 'md', 'en').content;
  assert.ok(md.indexOf('## Result') < md.indexOf('## Approved brief'));
  assert.match(md, /THE RESULT\n\nSources opened:\n- Gold, "today": https:\/\/gold\.example/);
  assert.match(md, /## Research report/);

  const researchOnly: JobFile = { ...job, deliverable: { body: job.research?.body ?? '', version: 1, unresolved: null } };
  assert.doesNotMatch(buildExport(researchOnly, 'md', 'en').content, /## Research report/);
  assert.equal(canExport({ ...job, approvedBrief: null, research: null, deliverable: { body: 'x', version: 1, unresolved: null } }), true);
});
