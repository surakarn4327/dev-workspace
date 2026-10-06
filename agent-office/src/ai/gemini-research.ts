// The real research department: Dr. Iris splits the approved brief in two, Leo and Mina each work their half with
// the web tools, and Dr. Iris merges the write-ups into a report. The honesty protocol is enforced in code, not
// just asked of the model: sources come from what the tools really returned, cited addresses are checked against
// them, and the report ends with a stamp that says whether anything was checked against real pages.

import type { BrainWait } from '../core/brain.ts';
import { getLang, msg, tr } from '../core/i18n.ts';
import type { Lang } from '../core/i18n.ts';
import type { Finding, ResearchBrain, ResearchProgress, ResearchResult, ResearchSource, ResearchTool } from '../core/research.ts';
import type { AgentId } from '../core/types.ts';
import { unverifiedUrls } from './agent-tools.ts';
import type { Source, ToolContext } from './agent-tools.ts';
import { clientLang, complete, plain } from './gemini-brain.ts';
import type { RateLimiter } from './limiter.ts';
import type { ModelClient } from './model-client.ts';
import { ModelError } from './model-client.ts';
import { headPlanPrompt, investigateRequest, planRequest, reportPrompt, reportRequest, researcherPrompt } from './research-prompts.ts';
import { runWithTools } from './tool-runner.ts';

export interface GeminiResearchDeps {
  head: ModelClient;
  /** One client per researcher (they may use different models). */
  researchers: Partial<Record<AgentId, ModelClient>>;
  toolbox: ToolContext['toolbox'];
  limiter?: RateLimiter;
  lang?: () => Lang;
  /** The files the client attached, read when a researcher starts (so files added before the job count). */
  attachments?: () => readonly { name: string; text: string }[];
}

const PLAN_TOKENS = 700;
const FINDING_TOKENS = 2000;
const REPORT_TOKENS = 2500;
const RESEARCHER_NAME: Partial<Record<AgentId, string>> = { 'research-1': 'Leo', 'research-2': 'Mina' };

const TOOL_OF: Record<string, ResearchTool> = { web_search: 'search', news_search: 'news', read_page: 'read' };

/** Sources in the order met, opened ones first marked as such; a page opened wins over the same page only seen. */
function mergeSources(...lists: readonly (readonly ResearchSource[])[]): ResearchSource[] {
  const out: ResearchSource[] = [];
  for (const s of lists.flat()) {
    const have = out.find((x) => x.url === s.url);
    if (!have) out.push({ ...s });
    else if (s.opened) have.opened = true;
  }
  return out;
}

/** The assignments from the head's JSON reply; `null` when it did not come out as two usable ones. */
export function parseAssignments(text: string): [string, string] | null {
  const body = text.replace(/```(?:json)?/gi, '').trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const data = JSON.parse(body.slice(start, end + 1)) as { assignments?: unknown };
    const list = Array.isArray(data.assignments) ? data.assignments.filter((a): a is string => typeof a === 'string' && a.trim().length > 0) : [];
    return list.length >= 2 ? [list[0].trim(), list[1].trim()] : null;
  } catch {
    return null;
  }
}

export class GeminiResearch implements ResearchBrain {
  private readonly head: ModelClient;
  private readonly researchers: Partial<Record<AgentId, ModelClient>>;
  private readonly toolbox: ToolContext['toolbox'];
  private readonly limiter?: RateLimiter;
  private readonly lang: () => Lang;
  private readonly attachments: () => readonly { name: string; text: string }[];

  constructor(deps: GeminiResearchDeps) {
    this.head = deps.head;
    this.researchers = deps.researchers;
    this.toolbox = deps.toolbox;
    this.limiter = deps.limiter;
    this.lang = deps.lang ?? getLang;
    this.attachments = deps.attachments ?? (() => []);
  }

  watchWait(listener: (wait: BrainWait) => void): () => void {
    if (!this.limiter) return () => {};
    return this.limiter.onStatus((s) => listener(s.phase === 'quota-wait' ? 'quota' : null));
  }

  async plan(brief: string, signal?: AbortSignal): Promise<[string, string]> {
    const lang = clientLang([brief], this.lang());
    const result = await complete(this.head, {
      system: headPlanPrompt({ lang }),
      history: [{ role: 'user', text: planRequest(brief) }],
      maxOutputTokens: PLAN_TOKENS,
      signal,
    });
    // A reply that is not two clean assignments must not fail the job: both researchers get the brief, each told to take one angle.
    return parseAssignments(result.text) ?? [`${brief}\n(Angle 1: the main facts and figures.)`, `${brief}\n(Angle 2: context, recent changes and anything people disagree about.)`];
  }

  async investigate(
    agent: AgentId,
    assignment: string,
    brief: string,
    signal?: AbortSignal,
    onProgress?: (p: ResearchProgress) => void,
  ): Promise<Finding> {
    const client = this.researchers[agent];
    if (!client) throw new Error(`${agent} is not a researcher`);
    const lang = clientLang([brief], this.lang());
    const run = await runWithTools(
      client,
      {
        system: researcherPrompt({ name: RESEARCHER_NAME[agent] ?? 'a researcher', lang, toolsOffered: true }),
        history: [{ role: 'user', text: investigateRequest(assignment, brief, this.attachments()) }],
        maxOutputTokens: FINDING_TOKENS,
        signal,
      },
      this.toolbox,
      {
        onProgress: (e) => {
          const tool = TOOL_OF[e.name];
          if (!tool) return;
          onProgress?.(e.type === 'call' ? { type: 'tool', tool } : { type: 'tool-done', tool, ok: e.ok });
        },
      },
    );
    const text = plain(run.text);
    if (!text) throw new ModelError('empty', 'The researcher wrote nothing.');
    const toSource = (opened: boolean) => (s: Source): ResearchSource => ({ url: s.url, title: s.title, opened });
    const sources = mergeSources(run.read.map(toSource(true)), run.seen.map(toSource(false)));
    return {
      agent,
      assignment,
      text,
      sources,
      unverified: unverifiedUrls(text, run),
      checked: run.toolsWorked && run.read.length > 0,
    };
  }

  async report(brief: string, findings: readonly Finding[], signal?: AbortSignal): Promise<ResearchResult> {
    const lang = clientLang([brief], this.lang());
    const result = await complete(this.head, {
      system: reportPrompt({ lang }),
      history: [{ role: 'user', text: reportRequest(brief, findings.map((f) => f.text)) }],
      maxOutputTokens: REPORT_TOKENS,
      signal,
    });
    const body = plain(result.text);
    if (!body) throw new ModelError('empty', 'The research head wrote nothing.');

    const sources = mergeSources(...findings.map((f) => f.sources));
    const checked = findings.length > 0 && findings.every((f) => f.checked);
    // Addresses in the final report that nobody ever opened or saw (the head may have copied one wrongly or invented it).
    const asSource = (via: Source['via']) => (s: ResearchSource): Source => ({ url: s.url, title: s.title, via });
    const known = { read: sources.filter((s) => s.opened).map(asSource('read_page')), seen: sources.filter((s) => !s.opened).map(asSource('web_search')) };
    const loose = [...new Set([...unverifiedUrls(body, known), ...findings.flatMap((f) => f.unverified)])];

    const opened = sources.filter((s) => s.opened);
    const tail: string[] = [];
    if (opened.length) {
      tail.push(tr(msg('research.sources'), lang), ...opened.map((s) => `- ${s.title ? `${s.title}: ` : ''}${s.url}`));
    }
    if (loose.length) tail.push(tr(msg('research.unverified', { urls: loose.join(' ') }), lang));
    tail.push(tr(checked ? msg('research.checked', { n: opened.length }) : msg('research.unchecked'), lang));
    return { report: `${body}\n\n${tail.join('\n')}`, body, findings: [...findings], sources, checked };
  }
}
