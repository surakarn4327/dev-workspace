// The "Files" panel in the Menu: attach text files for the team to read, and save the finished job's result
// as Markdown, text, a web page or a CSV of its sources. Attached text stays in this tab (nothing is stored).

import { clientLang } from '../ai/gemini-brain.ts';
import { ACCEPT, MAX_FILES } from '../core/attachments.ts';
import type { AttachResult, AttachmentStore } from '../core/attachments.ts';
import { EXPORT_FORMATS, buildExport, canExport } from '../core/export.ts';
import type { ExportFile, ExportFormat } from '../core/export.ts';
import { getLang, onLangChange, t } from '../core/i18n.ts';
import type { JobFile } from '../core/job-file.ts';
import { el, h } from './dom.ts';

export interface FilesPanelDeps {
  store: AttachmentStore;
  /** The current job's file (the finished result lives there). */
  job: () => Readonly<JobFile> | null;
  /** Hands a built file to the user. The default makes the browser download it; tests pass their own. */
  save?: (file: ExportFile) => void;
}

/** Make the browser save `file` (a temporary link to an in-memory copy). */
export function downloadFile(file: ExportFile): void {
  const url = URL.createObjectURL(new Blob([file.content], { type: file.mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function mountFilesPanel(deps: FilesPanelDeps): { refresh(): void } {
  const list = el<HTMLUListElement>('#files-list');
  const attachBtn = el<HTMLButtonElement>('#files-attach');
  const input = el<HTMLInputElement>('#files-input');
  const status = el<HTMLElement>('#files-status');
  const downloads = el<HTMLElement>('#files-downloads');
  const none = el<HTMLElement>('#files-download-none');
  const save = deps.save ?? downloadFile;
  input.accept = ACCEPT;

  /** Why the last picked files were refused; kept as data so a language switch rewrites the sentences. */
  let problems: Extract<AttachResult, { ok: false }>[] = [];

  function renderList(): void {
    list.replaceChildren();
    for (const f of deps.store.list()) {
      const li = h('li', 'replay-item');
      const name = h('span', 'file-name', f.truncated ? `${f.name} · ${t('files.cut')}` : f.name);
      name.title = f.name;
      const meta = h('span', 'replay-meta', t('files.chars', { n: f.text.length.toLocaleString(getLang() === 'th' ? 'th-TH' : 'en-GB') }));
      const del = h('button', 'btn replay-del', '✕');
      del.type = 'button';
      del.title = t('files.remove', { name: f.name });
      del.setAttribute('aria-label', t('files.remove', { name: f.name }));
      del.addEventListener('click', () => {
        problems = [];
        deps.store.remove(f.name);
      });
      li.append(name, del, meta);
      list.append(li);
    }
    if (!list.children.length) list.append(h('li', 'hint', t('files.none')));
  }

  function renderDownloads(): void {
    const job = deps.job();
    const ready = canExport(job);
    none.hidden = ready;
    downloads.hidden = !ready;
    downloads.replaceChildren();
    if (!ready) return;
    for (const format of EXPORT_FORMATS) {
      const b = h('button', 'btn', t(`files.fmt.${format}`));
      b.type = 'button';
      b.addEventListener('click', () => download(format));
      downloads.append(b);
    }
  }

  function download(format: ExportFormat): void {
    const job = deps.job();
    if (!canExport(job)) return;
    const lang = clientLang([job.approvedBrief ?? '', ...job.history.map((x) => x.text)], getLang());
    save(buildExport(job, format, lang, deps.store.names()));
  }

  function refresh(): void {
    renderList();
    renderDownloads();
    status.textContent = problems.map((r) => t(`files.err.${r.kind}`, { name: r.name, n: MAX_FILES })).join(' ');
    status.classList.toggle('warn', problems.length > 0);
  }

  async function addFiles(files: FileList | File[]): Promise<void> {
    problems = [];
    for (const file of Array.from(files)) {
      const r = await deps.store.add(file);
      if (!r.ok) problems.push(r);
    }
    refresh();
  }

  attachBtn.addEventListener('click', () => input.click());
  input.addEventListener('change', () => {
    const picked = input.files ? Array.from(input.files) : [];
    input.value = ''; // picking the same file again must still fire a change
    if (picked.length) void addFiles(picked);
  });
  deps.store.onChange(refresh);
  onLangChange(() => refresh());

  refresh();
  return { refresh };
}
