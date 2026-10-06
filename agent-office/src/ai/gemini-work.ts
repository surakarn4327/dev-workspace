// The real owner's team choice, production department and reviewer. As with research, the rules that matter are
// enforced in code and not only asked of the model: the team always has at least one department, the reviewer's
// verdict must parse (a reply that does not is an error the user can retry, never a silent pass), and web
// addresses in a result that nobody opened are rejected whatever the reviewer said.

import type { BrainWait } from '../core/brain.ts';
import { getLang, msg, tr } from '../core/i18n.ts';
import type { Lang } from '../core/i18n.ts';
import type { ResearchResult } from '../core/research.ts';
import type { AgentId } from '../core/types.ts';
import type { Team, Verdict, WorkBrain } from '../core/work.ts';
import { citedUrls, unverifiedUrls } from './agent-tools.ts';
import type { Source } from './agent-tools.ts';
import { clientLang, complete, plain } from './gemini-brain.ts';
import { parseAssignments } from './gemini-research.ts';
import type { RateLimiter } from './limiter.ts';
import { ModelError } from './model-client.ts';
import type { ModelClient } from './model-client.ts';
import {
  assembleRequest,
  assemblerPrompt,
  draftRequest,
  reviewRequest,
  reviewerPrompt,
  reviseRequest,
  reviserPrompt,
  teamPrompt,
  teamRequest,
  writerPrompt,
  writingPlanPrompt,
  writingPlanRequest,
} from './work-prompts.ts';

export interface GeminiWorkDeps {
  /** One client per position that speaks here: owner, prod-head, prod-1, prod-2, qa, and the research staff (they fix research-only results). */
  clients: Partial<Record<AgentId, ModelClient>>;
  limiter?: RateLimiter;
  lang?: () => Lang;
  /** The files the client attached (read when needed, so files added before the job count). */
  attachments?: () => readonly { name: string; text: string }[];
}

const TEAM_TOKENS = 200;
const PLAN_TOKENS = 700;
const PART_TOKENS = 1800;
const RESULT_TOKENS = 4000;
const VERDICT_TOKENS = 900;
const NAME: Partial<Record<AgentId, string>> = { 'prod-1': 'Kai', 'prod-2': 'Zoe', 'prod-head': 'Hana', 'research-1': 'Leo', 'research-2': 'Mina', 'research-head': 'Dr. Iris' };

function jsonObject(text: string): Record<string, unknown> | null {
  const body = text.replace(/```(?:json)?/gi, '').trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const data: unknown = JSON.parse(body.slice(start, end + 1));
    return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The owner's choice. Anything unusable means "both": the safe, complete team. */
export function parseTeam(text: string): Team {
  const d = jsonObject(text);
  if (!d || typeof d.research !== 'boolean' || typeof d.production !== 'boolean') return { research: true, production: true };
  return d.research || d.production ? { research: d.research, production: d.production } : { research: true, production: true };
}

/** The reviewer's verdict, or null when the reply does not say pass or reject. */
export function parseVerdict(text: string): Verdict | null {
  const d = jsonObject(text);
  if (!d || (d.verdict !== 'pass' && d.verdict !== 'reject')) return null;
  const issues = Array.isArray(d.issues) ? d.issues.filter((i): i is string => typeof i === 'string' && i.trim().length > 0).map((i) => i.trim()) : [];
  const reason = typeof d.reason === 'string' ? d.reason.trim() : '';
  return { pass: d.verdict === 'pass', reason: reason || issues[0] || '', issues };
}

export class GeminiWork implements WorkBrain {
  private readonly clients: Partial<Record<AgentId, ModelClient>>;
  private readonly limiter?: RateLimiter;
  private readonly lang: () => Lang;
  private readonly attachments: () => readonly { name: string; text: string }[];

  constructor(deps: GeminiWorkDeps) {
    this.clients = deps.clients;
    this.limiter = deps.limiter;
    this.lang = deps.lang ?? getLang;
    this.attachments = deps.attachments ?? (() => []);
  }

  watchWait(listener: (wait: BrainWait) => void): () => void {
    if (!this.limiter) return () => {};
    return this.limiter.onStatus((s) => listener(s.phase === 'quota-wait' ? 'quota' : null));
  }

  private client(agent: AgentId): ModelClient {
    const c = this.clients[agent];
    if (!c) throw new Error(`${agent} has no model here`);
    return c;
  }

  async chooseTeam(brief: string, signal?: AbortSignal): Promise<Team> {
    const result = await complete(this.client('owner'), {
      system: teamPrompt(),
      history: [{ role: 'user', text: teamRequest(brief, this.attachments().map((f) => f.name)) }],
      maxOutputTokens: TEAM_TOKENS,
      signal,
    });
    return parseTeam(result.text);
  }

  async planWriting(brief: string, research: ResearchResult | null, signal?: AbortSignal): Promise<[string, string]> {
    const lang = clientLang([brief], this.lang());
    const result = await complete(this.client('prod-head'), {
      system: writingPlanPrompt({ lang }),
      history: [{ role: 'user', text: writingPlanRequest(brief, research) }],
      maxOutputTokens: PLAN_TOKENS,
      signal,
    });
    return parseAssignments(result.text) ?? [`${brief}\n(Part 1: the first half of the result.)`, `${brief}\n(Part 2: the second half of the result.)`];
  }

  async draft(agent: AgentId, assignment: string, brief: string, research: ResearchResult | null, signal?: AbortSignal): Promise<string> {
    const lang = clientLang([brief], this.lang());
    const result = await complete(this.client(agent), {
      system: writerPrompt({ name: NAME[agent] ?? 'a writer', lang }),
      history: [{ role: 'user', text: draftRequest(assignment, brief, research, this.attachments()) }],
      maxOutputTokens: PART_TOKENS,
      signal,
    });
    const text = plain(result.text);
    if (!text) throw new ModelError('empty', 'The writer wrote nothing.');
    return text;
  }

  async assemble(brief: string, parts: readonly string[], research: ResearchResult | null, signal?: AbortSignal): Promise<string> {
    const lang = clientLang([brief], this.lang());
    const result = await complete(this.client('prod-head'), {
      system: assemblerPrompt({ lang }),
      history: [{ role: 'user', text: assembleRequest(brief, parts, research) }],
      maxOutputTokens: RESULT_TOKENS,
      signal,
    });
    const text = plain(result.text);
    if (!text) throw new ModelError('empty', 'The head wrote nothing.');
    return text;
  }

  async review(brief: string, body: string, research: ResearchResult | null, signal?: AbortSignal): Promise<Verdict> {
    const lang = clientLang([brief], this.lang());
    const files = this.attachments();
    const result = await complete(this.client('qa'), {
      system: reviewerPrompt({ lang }),
      history: [{ role: 'user', text: reviewRequest(brief, body, research, files) }],
      maxOutputTokens: VERDICT_TOKENS,
      signal,
    });
    const verdict = parseVerdict(result.text);
    if (!verdict) throw new ModelError('empty', 'The reviewer gave no usable verdict.');

    // Addresses the result cites that nobody opened or saw (research pages) or that the client did not write themselves.
    const asSource = (url: string): Source => ({ url, title: '', via: 'read_page' });
    const known = [
      ...(research?.sources ?? []).map((s) => asSource(s.url)),
      ...citedUrls([brief, ...files.map((f) => f.text)].join('\n')).map(asSource),
    ];
    const loose = unverifiedUrls(body, { read: known, seen: [] });
    if (loose.length) {
      const note = tr(msg('work.fakeLinks', { urls: loose.join(' ') }), lang);
      return { pass: false, reason: verdict.pass ? note : verdict.reason || note, issues: [...verdict.issues, note] };
    }
    return verdict;
  }

  async revise(agent: AgentId, brief: string, body: string, notes: string, research: ResearchResult | null, signal?: AbortSignal): Promise<string> {
    const lang = clientLang([brief, notes], this.lang());
    const result = await complete(this.client(agent), {
      system: reviserPrompt({ name: NAME[agent] ?? 'a team member', lang }),
      history: [{ role: 'user', text: reviseRequest(brief, body, notes, research, this.attachments()) }],
      maxOutputTokens: RESULT_TOKENS,
      signal,
    });
    const text = plain(result.text);
    if (!text) throw new ModelError('empty', 'The fix came back empty.');
    return text;
  }
}
