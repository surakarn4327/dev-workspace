// The "words" side of the research department. The office (sim/simulator.ts) owns the choreography: who walks,
// who hands what to whom, what each person's desk shows. The research brain decides what the head assigns,
// what each researcher finds out (with web tools) and what the report says, so the same office runs on a real
// model or, with no brain, on the canned script. One brain is created per job.

import type { BrainWait } from './brain.ts';
import type { AgentId } from './types.ts';

/** A web page an agent opened (`opened`) or only saw listed in a search result. */
export interface ResearchSource {
  url: string;
  title: string;
  opened: boolean;
}

/** What one researcher brought back for one assignment. */
export interface Finding {
  agent: AgentId;
  assignment: string;
  /** The researcher's own write-up (plain text). */
  text: string;
  sources: ResearchSource[];
  /** Addresses the write-up cites that the researcher never opened or saw: made up or remembered, not checked. */
  unverified: string[];
  /** True when the researcher really opened at least one page with the web tools. */
  checked: boolean;
}

/** The head's report for the job: what production works from. */
export interface ResearchResult {
  /** The report as plain text, in the client's language, ending with the sources and the honesty stamp. */
  report: string;
  /** The report without the sources list and the stamp (what a result built on it adds again itself). */
  body: string;
  findings: Finding[];
  /** Every page opened or seen by anybody, without repeats. */
  sources: ResearchSource[];
  /** True only when every researcher opened real pages. False means "not checked against real sources". */
  checked: boolean;
}

/** What a researcher is doing with a tool right now, so the office can show the right pose. */
export type ResearchTool = 'search' | 'news' | 'read';
export type ResearchProgress = { type: 'tool'; tool: ResearchTool } | { type: 'tool-done'; tool: ResearchTool; ok: boolean };

/**
 * Every method may be slow (model and web calls) and may throw a ModelError; the office offers retry / cancel
 * on failure and aborts `signal` when the user cancels or resets.
 */
export interface ResearchBrain {
  /** The head splits the approved brief into one assignment for each of the two researchers. */
  plan(brief: string, signal?: AbortSignal): Promise<[string, string]>;
  /** A researcher works on an assignment with the web tools and reports honestly what was and was not confirmed. */
  investigate(
    agent: AgentId,
    assignment: string,
    brief: string,
    signal?: AbortSignal,
    onProgress?: (p: ResearchProgress) => void,
  ): Promise<Finding>;
  /** The head merges the findings into the report. */
  report(brief: string, findings: readonly Finding[], signal?: AbortSignal): Promise<ResearchResult>;
  /** Optional: reports while a call is stuck waiting for the free AI quota. Returns an unsubscribe. */
  watchWait?(listener: (wait: BrainWait) => void): () => void;
}
