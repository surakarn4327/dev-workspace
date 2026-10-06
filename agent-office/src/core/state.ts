import { msg, t, tr } from './i18n.ts';
import type { Msg } from './i18n.ts';
import { ROSTER, nameOf } from './roster.ts';
import type { Activity, AgentId, ChatChoice, Doc, Infra, OfficeEvent, PlaceId, Stage, UsageView } from './types.ts';
import { AGENT_IDS, IDLE_INFRA } from './types.ts';

export interface AgentState {
  activity: Activity;
  note: Msg | null;
  place: PlaceId;
  /** Label of the document this agent is currently carrying (courier, secretary). */
  carrying: Msg | null;
  /** Documents waiting on this agent's desk. */
  inbox: number;
}

export interface LogLine {
  t: number;
  from: AgentId | 'user';
  to?: AgentId;
  text: Msg;
}

export interface ChatPrompt {
  id: string;
  from: AgentId;
  text: Msg;
  choices?: ChatChoice[];
  placeholder?: Msg;
  /** The agent is working out a reply: show `text` with no answer box (only the close button works). */
  thinking?: boolean;
}

export interface OfficeState {
  agents: Record<AgentId, AgentState>;
  job: { id: string; title: string } | null;
  stage: Stage;
  lastVerdict: { verdict: 'pass' | 'reject'; reason: Msg; round: number } | null;
  queue: Doc[];
  log: LogLine[];
  chat: ChatPrompt | null;
  /** Finished jobs filed on the archive shelves. */
  archived: number;
  /** The machinery behind the agents: drawn by the server room. */
  infra: Infra;
  /**
   * The lobby printer: how many pages (model calls) it has printed today, whether its paper has run out, and whether
   * the daily quota has reset so that the courier owes it fresh paper (until then the old pile and an empty tray stay).
   */
  paper: { printed: number; empty: boolean; due: boolean };
}

function freshAgents(): Record<AgentId, AgentState> {
  const out = {} as Record<AgentId, AgentState>;
  for (const id of AGENT_IDS) {
    out[id] = { activity: 'idle', note: null, place: `desk:${id}`, carrying: null, inbox: 0 };
  }
  return out;
}

export function freshState(): OfficeState {
  return {
    agents: freshAgents(),
    job: null,
    stage: 'idle',
    lastVerdict: null,
    queue: [],
    log: [],
    chat: null,
    archived: 0,
    infra: { ...IDLE_INFRA },
    paper: { printed: 0, empty: false, due: false },
  };
}

const LOG_LIMIT = 200;

export class OfficeStore {
  state: OfficeState = freshState();
  private listeners = new Set<() => void>();

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  apply(e: OfficeEvent, at: number = Date.now()): void {
    const s = this.state;
    switch (e.type) {
      case 'sim.reset':
        this.state = freshState();
        break;
      case 'job.created':
        s.job = { id: e.jobId, title: e.title };
        break;
      case 'job.stage':
        s.stage = e.stage;
        break;
      case 'job.done':
        s.stage = 'done';
        break;
      case 'agent.activity':
        s.agents[e.agent].activity = e.activity;
        s.agents[e.agent].note = e.note ?? null;
        break;
      case 'agent.walk':
        s.agents[e.agent].place = e.to;
        break;
      case 'agent.carry':
        s.agents[e.agent].carrying = e.label;
        break;
      case 'agent.say':
        this.pushLog({ t: at, from: e.agent, to: e.to, text: e.text });
        break;
      case 'user.say':
        this.pushLog({ t: at, from: 'user', to: e.to, text: e.text });
        break;
      case 'doc.queued':
        s.queue.push(e.doc);
        break;
      case 'doc.pickup':
        s.queue = s.queue.filter((d) => d.id !== e.doc.id);
        s.agents.courier.carrying = e.doc.label;
        break;
      case 'doc.delivered':
        s.agents.courier.carrying = null;
        s.agents[e.doc.to].inbox += 1;
        break;
      case 'doc.handed':
        s.agents[e.doc.to].inbox += 1;
        break;
      case 'doc.consumed':
        s.agents[e.agent].inbox = Math.max(0, s.agents[e.agent].inbox - 1);
        break;
      case 'archive.filed':
        s.archived += 1;
        break;
      case 'review.verdict':
        s.lastVerdict = { verdict: e.verdict, reason: e.reason, round: e.round };
        break;
      case 'chat.ask':
        s.chat = {
          id: e.id,
          from: e.from,
          text: e.text,
          choices: e.choices,
          placeholder: e.placeholder,
        };
        break;
      case 'chat.thinking': {
        const key = e.wait === 'quota' ? 'dlg.waitQuota' : e.from === 'secretary' ? 'dlg.writing' : 'dlg.thinking';
        s.chat = { id: e.id, from: e.from, text: msg(key, { name: ROSTER[e.from].name }), thinking: true };
        break;
      }
      case 'chat.closed':
        if (s.chat?.id === e.id) s.chat = null;
        break;
      case 'infra':
        s.infra = { ...IDLE_INFRA, ...e.infra }; // recordings made before the usage tally have no `usage`
        this.followPaper(e.infra.usage ?? IDLE_INFRA.usage);
        break;
      case 'paper.restocked':
        s.paper = { printed: s.infra.usage.calls, empty: s.infra.usage.exhausted, due: false };
        break;
    }
    for (const fn of this.listeners) fn();
  }

  /** The printer follows the day's tally; after a daily reset the pile and the empty tray wait for the courier. */
  private followPaper(u: UsageView): void {
    const p = this.state.paper;
    if (u.calls < p.printed) p.due = true; // the tally started over: the old pile stays until fresh paper arrives
    else p.printed = u.calls;
    if (u.exhausted) p.empty = true;
    else if (!p.due) p.empty = false; // an answer came back: there is paper again
  }

  private pushLog(line: LogLine): void {
    this.state.log.push(line);
    if (this.state.log.length > LOG_LIMIT) this.state.log.splice(0, this.state.log.length - LOG_LIMIT);
  }
}

/** One-line human description of an event for the feed (in the current language), or null to skip it. */
export function describeEvent(e: OfficeEvent): string | null {
  switch (e.type) {
    case 'sim.reset':
      return t('feed.reset');
    case 'job.created':
      return t('feed.job', { title: e.title });
    case 'job.stage':
      return t('feed.stage', { stage: t(`step.${e.stage}`) });
    case 'job.done':
      return t('feed.jobDone');
    case 'agent.say':
      return `${nameOf(e.agent)}${e.to ? ` > ${nameOf(e.to)}` : ''}: ${tr(e.text)}`;
    case 'user.say':
      return `${nameOf('user')} > ${nameOf(e.to)}: ${tr(e.text)}`;
    case 'doc.queued':
      return t('feed.queued', { label: e.doc.label, from: nameOf(e.doc.from), to: nameOf(e.doc.to) });
    case 'doc.delivered':
      return t('feed.delivered', { label: e.doc.label, to: nameOf(e.doc.to) });
    case 'doc.handed':
      return t('feed.handed', { label: e.doc.label, from: nameOf(e.doc.from), to: nameOf(e.doc.to) });
    case 'archive.filed':
      return t('feed.filed');
    case 'paper.restocked':
      return t('feed.restocked');
    case 'review.verdict':
      return e.verdict === 'pass'
        ? t('feed.pass', { round: e.round })
        : t('feed.reject', { round: e.round, reason: e.reason });
    case 'agent.activity':
      return e.activity === 'error' ? t('feed.error', { name: nameOf(e.agent) }) : null;
    default:
      return null;
  }
}