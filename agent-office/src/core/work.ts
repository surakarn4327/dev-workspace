// The "words" side of the rest of the company: the owner choosing which departments a job needs, the production
// department writing the result from the research, and the reviewer checking it against the brief. As with
// research, the office owns the choreography (who walks, who hands what to whom); this brain decides what is
// written and judged. One brain is created per job.

import type { BrainWait } from './brain.ts';
import { msg, tr } from './i18n.ts';
import type { Lang } from './i18n.ts';
import type { ResearchResult } from './research.ts';
import type { AgentId } from './types.ts';

/** Which departments the owner picked for this job. At least one is true. */
export interface Team {
  research: boolean;
  production: boolean;
}

/** The reviewer's judgement. `issues` are specific, short, and in the client's language. */
export interface Verdict {
  pass: boolean;
  reason: string;
  issues: string[];
}

/** The result being worked on. `body` is the text itself; the honesty stamp is added by `withStamp`, never by a model. */
export interface Deliverable {
  body: string;
  version: number;
  /** Set when the reviewer still objected after the last allowed round: what was left unresolved. */
  unresolved: string | null;
}

/** Most times the reviewer may send the work back before it goes to the client with the objection stated. */
export const MAX_REJECTIONS = 2;

export interface WorkBrain {
  /** The owner decides which departments the approved brief needs. */
  chooseTeam(brief: string, signal?: AbortSignal): Promise<Team>;
  /** The production head splits the writing in two parts, one per writer. `research` is null when research was not used. */
  planWriting(brief: string, research: ResearchResult | null, signal?: AbortSignal): Promise<[string, string]>;
  /** A writer writes their part, using only what the brief, the research and the attached files say. */
  draft(agent: AgentId, assignment: string, brief: string, research: ResearchResult | null, signal?: AbortSignal): Promise<string>;
  /** The head merges the parts into one result. */
  assemble(brief: string, parts: readonly string[], research: ResearchResult | null, signal?: AbortSignal): Promise<string>;
  /** The reviewer checks the result against the brief and against the evidence. */
  review(brief: string, body: string, research: ResearchResult | null, signal?: AbortSignal): Promise<Verdict>;
  /** Somebody fixes the result: the reviewer's notes, or a change the client asked for. Returns the whole new result. */
  revise(agent: AgentId, brief: string, body: string, notes: string, research: ResearchResult | null, signal?: AbortSignal): Promise<string>;
  /** Optional: reports while a call is stuck waiting for the free AI quota. Returns an unsubscribe. */
  watchWait?(listener: (wait: BrainWait) => void): () => void;
}

/**
 * The result as the client gets it: the body, then what the code (not a model) knows about how far it can be
 * trusted. Research's own stamp is repeated so a result that was not checked against real sources says so,
 * and an objection the reviewer never saw resolved is stated.
 */
export function withStamp(d: Deliverable, research: ResearchResult | null | undefined, lang: Lang): string {
  const tail: string[] = [];
  if (d.unresolved) tail.push(tr(msg('work.unresolved', { reason: d.unresolved }), lang));
  if (research) {
    const opened = research.sources.filter((s) => s.opened);
    if (opened.length) tail.push(tr(msg('research.sources'), lang), ...opened.map((s) => `- ${s.title ? `${s.title}: ` : ''}${s.url}`));
    tail.push(tr(research.checked ? msg('research.checked', { n: opened.length }) : msg('research.unchecked'), lang));
  }
  return tail.length ? `${d.body}\n\n${tail.join('\n')}` : d.body;
}
