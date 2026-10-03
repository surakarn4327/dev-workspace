// The job's file: what the company knows about the current job, kept in memory for the departments to work
// from (research reads the approved brief; later steps add their own work to it). Not part of the event stream
// the screen draws: it is orchestration data, read through the office.

import type { Exchange } from './brain.ts';
import type { Msg } from './i18n.ts';

export interface JobFile {
  id: string;
  /** Short name of the job, taken from the user's first answer. */
  title: string;
  /** Everything the owner asked and the user answered, oldest first. */
  history: readonly Exchange[];
  /** The brief as the secretary last wrote it (a draft until the user approves it). */
  brief: Msg | null;
  /** The brief the user approved, as plain text in the language it was shown in. Null until approval. */
  approvedBrief: string | null;
  /** What the user asked to change, in order. */
  changes: string[];
}
