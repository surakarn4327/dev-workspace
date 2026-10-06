// Turns the finished job's file into something the user can save: Markdown, plain text, a web page, or the
// sources as a CSV table. Pure text-building (no DOM), in the language the client wrote in.

import { msg, tr } from './i18n.ts';
import type { Lang } from './i18n.ts';
import { htmlPage } from './export-template.ts';
import { withStamp } from './work.ts';
import type { JobFile } from './job-file.ts';

export type ExportFormat = 'md' | 'txt' | 'html' | 'csv';
export const EXPORT_FORMATS: readonly ExportFormat[] = ['md', 'txt', 'html', 'csv'];

export interface ExportFile {
  filename: string;
  mime: string;
  content: string;
}

const MIME: Record<ExportFormat, string> = {
  md: 'text/markdown;charset=utf-8',
  txt: 'text/plain;charset=utf-8',
  html: 'text/html;charset=utf-8',
  csv: 'text/csv;charset=utf-8',
};

/** True when there is anything worth saving yet (an approved brief at least). */
export function canExport(job: Readonly<JobFile> | null | undefined): job is Readonly<JobFile> {
  return !!job && (job.approvedBrief !== null || !!job.research || !!job.deliverable);
}

/** A file name from the job's title: letters (with their marks, e.g. Thai vowels) and digits of any script kept, everything else becomes "-". */
export function fileBase(title: string): string {
  const slug = title.normalize('NFC').replace(/[^\p{L}\p{M}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return slug || 'job';
}

const escapeHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A spreadsheet would run a cell that starts with = + - or @ as a formula: defuse it. */
const DEFUSE = "'";
const QUOTE = '"';
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? DEFUSE + value : value;
  return /[,\n\r]/.test(safe) || safe.includes(QUOTE) ? QUOTE + safe.split(QUOTE).join(QUOTE + QUOTE) + QUOTE : safe;
}

interface Section {
  heading: string;
  body: string;
}

function sections(job: Readonly<JobFile>, lang: Lang, attached: readonly string[]): Section[] {
  const out: Section[] = [];
  // The finished result comes first, with what the code knows about how far it can be trusted.
  if (job.deliverable) out.push({ heading: tr(msg('export.deliverable'), lang), body: withStamp(job.deliverable, job.research, lang) });
  if (job.approvedBrief) out.push({ heading: tr(msg('export.brief'), lang), body: job.approvedBrief });
  // A result that is the research report itself (no Production on the job) is not repeated.
  const sameAsResult = !!job.research && job.deliverable?.body === job.research.body;
  if (!sameAsResult) out.push({ heading: tr(msg('export.research'), lang), body: job.research ? job.research.report : tr(msg('export.noResearch'), lang) });
  if (attached.length) out.push({ heading: tr(msg('export.attached'), lang), body: attached.map((n) => `- ${n}`).join('\n') });
  return out;
}

function sourcesCsv(job: Readonly<JobFile>, lang: Lang): string {
  const head = ['export.col.address', 'export.col.title', 'export.col.opened'].map((k) => csvCell(tr(msg(k), lang))).join(',');
  const rows = (job.research?.sources ?? []).map((s) => [s.url, s.title, tr(msg(s.opened ? 'export.yes' : 'export.no'), lang)].map(csvCell).join(','));
  return [head, ...rows].join('\r\n') + '\r\n';
}

export function buildExport(job: Readonly<JobFile>, format: ExportFormat, lang: Lang, attached: readonly string[] = []): ExportFile {
  const filename = `${fileBase(job.title)}.${format}`;
  const parts = sections(job, lang, attached);
  const mime = MIME[format];
  switch (format) {
    case 'md':
      return { filename, mime, content: `# ${job.title}\n\n${parts.map((p) => `## ${p.heading}\n\n${p.body}`).join('\n\n')}\n` };
    case 'txt':
      return { filename, mime, content: `${job.title}\n\n${parts.map((p) => `${p.heading.toUpperCase()}\n\n${p.body}`).join('\n\n')}\n` };
    case 'html': {
      const body = parts.map((p) => `<h2>${escapeHtml(p.heading)}</h2>\n<pre>${escapeHtml(p.body)}</pre>`).join('\n');
      return { filename, mime, content: htmlPage(lang, job.title, escapeHtml(job.title), body) };
    }
    case 'csv':
      return { filename, mime, content: sourcesCsv(job, lang) };
  }
}
