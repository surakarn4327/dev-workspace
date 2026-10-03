// The "words" side of gathering a brief. The office (sim/simulator.ts) owns the choreography: who walks,
// who sits, which documents travel, when the stages change. The brain only decides what the owner asks
// and what the secretary writes, so the same office can run on a script or on a real model.
// One brain is created per job and may keep state for that job.

import { msg } from './i18n.ts';
import type { Msg } from './i18n.ts';
import type { ChatChoice } from './types.ts';

/** A button for a chat question. `id` is language-independent. */
export const choice = (id: string, key: string): ChatChoice => ({ id, label: msg(key) });

export interface Question {
  text: Msg;
  placeholder?: Msg;
  /** Buttons under the question (the scripted brain uses them; a model brain does not). */
  choices?: ChatChoice[];
  /** What "auto-answer" types for this question in the demo. */
  auto?: Msg;
}

/** One question the owner asked and how the user answered it. */
export interface Exchange {
  question: Msg;
  answer: Msg;
  /** The answer as plain text in the current language. */
  text: string;
  /** Which button was pressed, or null when the user typed. */
  choice: string | null;
}

export type OwnerTurn = { kind: 'ask'; question: Question } | { kind: 'ready' };

export interface IntakeBrain {
  /**
   * The owner's next turn, given the answers so far (`title` is '' before the first answer):
   * ask another question, or say there is enough to write the brief.
   */
  ownerTurn(history: readonly Exchange[], title: string): Promise<OwnerTurn>;
  /** The secretary's brief, written from the whole conversation. */
  writeBrief(history: readonly Exchange[], title: string): Promise<Msg>;
  /** The brief again with the user's requested change applied. */
  reviseBrief(history: readonly Exchange[], title: string, change: Msg): Promise<Msg>;
}
