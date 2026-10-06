// Files the user attaches for the team to read. Only text is supported (no PDF reader yet), the content is kept
// in memory for this browser tab only, and it is limited in size so a big file cannot eat the free AI quota.
// The text is data for the researchers, never instructions (the prompts say so).

export interface Attachment {
  name: string;
  text: string;
  /** The file was longer than the room left, so only its start is kept. */
  truncated: boolean;
}

export type AttachErrorKind = 'type' | 'pdf' | 'too-many' | 'empty' | 'unreadable' | 'budget';
export type AttachResult = { ok: true; attachment: Attachment } | { ok: false; kind: AttachErrorKind; name: string };

export const MAX_FILES = 5;
/** Characters kept from one file. */
export const MAX_FILE_CHARS = 30_000;
/** Characters kept from all files together. */
export const MAX_TOTAL_CHARS = 60_000;
/** Below this much room left, a further file is refused rather than kept as a stub. */
const MIN_ROOM = 500;
/** A file larger than this is not even read into memory. */
const MAX_BYTES = 2_000_000;

export const TEXT_EXTENSIONS = ['txt', 'md', 'csv', 'json', 'html', 'htm', 'xml', 'log'] as const;

const extensionOf = (name: string): string => (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '');

export function kindOfFile(name: string): 'text' | 'pdf' | 'other' {
  const ext = extensionOf(name);
  if (ext === 'pdf') return 'pdf';
  return (TEXT_EXTENSIONS as readonly string[]).includes(ext) ? 'text' : 'other';
}

/** What the browser's file input is told to offer. */
export const ACCEPT = TEXT_EXTENSIONS.map((e) => `.${e}`).join(',');

export class AttachmentStore {
  private files: Attachment[] = [];
  private listeners = new Set<() => void>();

  list(): readonly Attachment[] {
    return this.files;
  }

  names(): string[] {
    return this.files.map((f) => f.name);
  }

  get totalChars(): number {
    return this.files.reduce((n, f) => n + f.text.length, 0);
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Reads one picked file and keeps it, or says why not. A file with the same name replaces the old one. */
  async add(file: { name: string; size: number; text(): Promise<string> }): Promise<AttachResult> {
    const { name } = file;
    const kind = kindOfFile(name);
    if (kind === 'pdf') return { ok: false, kind: 'pdf', name };
    if (kind === 'other') return { ok: false, kind: 'type', name };
    const others = this.files.filter((f) => f.name !== name);
    if (others.length >= MAX_FILES) return { ok: false, kind: 'too-many', name };
    if (file.size > MAX_BYTES) return { ok: false, kind: 'unreadable', name };

    let text: string;
    try {
      text = (await file.text()).replace(/\r\n?/g, '\n').replace(/\u0000/g, '').trim();
    } catch {
      return { ok: false, kind: 'unreadable', name };
    }
    if (!text) return { ok: false, kind: 'empty', name };

    const room = Math.min(MAX_FILE_CHARS, MAX_TOTAL_CHARS - others.reduce((n, f) => n + f.text.length, 0));
    if (room < MIN_ROOM) return { ok: false, kind: 'budget', name };
    const truncated = text.length > room;
    const attachment: Attachment = { name, text: truncated ? text.slice(0, room) : text, truncated };
    this.files = [...others, attachment];
    this.emit();
    return { ok: true, attachment };
  }

  remove(name: string): void {
    const next = this.files.filter((f) => f.name !== name);
    if (next.length === this.files.length) return;
    this.files = next;
    this.emit();
  }

  clear(): void {
    if (!this.files.length) return;
    this.files = [];
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
