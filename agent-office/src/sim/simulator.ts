// Mock "brain" for stage 1. It plays the 7-step company workflow by emitting the
// same events a real orchestrator would, so the UI never knows the difference.
// The courier is a real FIFO queue (plain code); everything else is scripted.

import { choice } from '../core/brain.ts';
import type { BrainWait, Exchange, IntakeBrain } from '../core/brain.ts';
import type { JobFile } from '../core/job-file.ts';
import type { Finding, ResearchBrain, ResearchTool } from '../core/research.ts';
import { MAX_REJECTIONS, withStamp } from '../core/work.ts';
import type { Team, WorkBrain } from '../core/work.ts';
import { clientLang } from '../ai/gemini-brain.ts';
import type { InfraFeed } from '../ai/infra.ts';
import { isAffirmative, isBareRevise } from '../core/intent.ts';
import { getLang, msg, raw, tr } from '../core/i18n.ts';
import type { Msg } from '../core/i18n.ts';
import { sameRoom, travelMs } from '../core/world.ts';
import type {
  Activity,
  AgentId,
  ChatChoice,
  ChatReply,
  DemoControls,
  Doc,
  OfficeEvent,
  OfficeListener,
  OfficeSource,
  PlaceId,
  Pod,
  Stage,
} from '../core/types.ts';
import { AGENT_IDS } from '../core/types.ts';
import { ModelError } from '../ai/model-client.ts';
import { ScriptedBrain } from './scripted-brain.ts';

class Cancelled extends Error {}

export interface MockOptions {
  timeScale?: number;
  autoAnswer?: boolean;
  /** Idle office life: people wander off for coffee or the restroom between jobs (default on). */
  ambient?: boolean;
  /** Makes the brain (the owner's questions and the secretary's brief) for each job. Default: the canned script. */
  brain?: () => IntakeBrain;
  /** Makes the research department's brain for each job (real researchers with web tools), or null for the canned script. */
  research?: () => ResearchBrain | null;
  /** Makes the brain for the owner's team choice, production and the reviewer for each job, or null for the canned script. */
  work?: () => WorkBrain | null;
  /** How long a brain call may take before the chat box shows "thinking" (default 250 ms; scripted brains never reach it). */
  thinkDelayMs?: number;
  /** The real machinery behind the agents (model and tool calls, quota, helper). Re-emitted as infra events. */
  infra?: InfraFeed;
}

/** Everyone who may wander off between jobs (the owner stays reachable, the courier works the queue). */
const AMBIENT: AgentId[] = [
  'secretary',
  'research-head',
  'research-1',
  'research-2',
  'prod-head',
  'prod-1',
  'prod-2',
  'qa',
];

interface QueueItem {
  doc: Doc;
  resolve: () => void;
  reject: (e: unknown) => void;
}

const TOOL_NOTE: Record<ResearchTool, string> = { search: 'note.searching', news: 'note.searchingNews', read: 'note.reading' };

const STAFF: AgentId[] = ['research-1', 'research-2', 'prod-1', 'prod-2'];
const PODS: Record<Pod, { head: AgentId; staff: [AgentId, AgentId] }> = {
  research: { head: 'research-head', staff: ['research-1', 'research-2'] },
  production: { head: 'prod-head', staff: ['prod-1', 'prod-2'] },
};

/** What the user answered: which button (if any), plus a displayable form of the reply. */
interface Answer {
  choice: string | null;
  msg: Msg;
  /** The reply as plain text in the current language (used for the job title). */
  text: string;
}

function shorten(text: string, max = 44): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export class MockOffice implements OfficeSource, DemoControls {
  timeScale: number;
  autoAnswer: boolean;
  /** When set, the next QA review rejects the deliverable once. */
  rejectNextReview = false;

  private listeners = new Set<OfficeListener>();
  private runId = 0;
  private running = false;
  /** The owner's first question is open but the user has not answered yet (so no job has started). */
  private intake = false;
  private startSeq = 0;
  private jobSeq = 0;
  private file: JobFile | null = null;
  private chatSeq = 0;
  private docSeq = 0;
  private pending = new Map<
    string,
    { from: AgentId; choices: ChatChoice[]; resolve: (a: Answer) => void; reject: (e: unknown) => void }
  >();
  private queue: QueueItem[] = [];
  /** Per-person lanes: hand-overs by or to the same person run one after another (nobody walks two ways at once). */
  private lanes = new Map<AgentId, Promise<void>>();
  private wake: (() => void) | null = null;
  private loc = {} as Record<AgentId, PlaceId>;
  private desired = {} as Record<AgentId, { activity: Activity; note?: Msg }>;
  private blocked = new Set<AgentId>();
  private ambient: boolean;
  private makeBrain: () => IntakeBrain;
  private makeResearch: () => ResearchBrain | null;
  /** The research brain of the job in progress (null when research is the canned script). */
  private researchBrain: ResearchBrain | null = null;
  private makeWork: () => WorkBrain | null;
  /** The work brain of the job in progress (null when production and review are the canned script). */
  private workBrain: WorkBrain | null = null;
  /** The departments picked for the job in progress. */
  private team: Team = { research: true, production: true };
  /** Failure questions from parallel researchers are asked one at a time. */
  private failLock: Promise<void> = Promise.resolve();
  private thinkDelayMs: number;
  private infraFeed?: InfraFeed;
  private stopInfra: (() => void) | null = null;
  /** Aborted on reset/cancel so a model call in flight stops instead of finishing for nobody. */
  private abort = new AbortController();
  /** Ids of chat boxes currently showing 'thinking' (the close button cancels through these). */
  private thinking = new Set<string>();
  private away = new Set<AgentId>();
  private trips = new Set<Promise<void>>();
  private occupied = new Set<PlaceId>();
  private recallWaiters = new Set<() => void>();

  constructor(opts: MockOptions = {}) {
    this.timeScale = opts.timeScale ?? 1;
    this.autoAnswer = opts.autoAnswer ?? false;
    this.ambient = opts.ambient ?? true;
    this.makeBrain = opts.brain ?? (() => new ScriptedBrain());
    this.makeResearch = opts.research ?? (() => null);
    this.makeWork = opts.work ?? (() => null);
    this.thinkDelayMs = opts.thinkDelayMs ?? 250;
    this.infraFeed = opts.infra;
    this.stopInfra = opts.infra?.subscribe((infra) => this.emit({ type: 'infra', infra })) ?? null;
    this.initAgents();
    void this.courierLoop(this.runId);
    if (this.ambient) void this.ambientLoop(this.runId);
  }

  // ---------- OfficeSource ----------

  subscribe(listener: OfficeListener): () => void {
    this.listeners.add(listener);
    // A newcomer starts with the machinery's state as it is now (a job's events only ever change it).
    if (this.infraFeed) listener({ type: 'infra', infra: this.infraFeed.snapshot() });
    return () => this.listeners.delete(listener);
  }

  answer(chatId: string, reply: ChatReply): void {
    const p = this.pending.get(chatId);
    if (!p) return;
    let answer: Answer;
    if ('choice' in reply) {
      const picked = p.choices.find((c) => c.id === reply.choice);
      if (!picked) return; // not one of the offered buttons: ignore, the question stays open
      answer = { choice: picked.id, msg: picked.label, text: tr(picked.label) };
    } else {
      answer = { choice: null, msg: raw(reply.text), text: reply.text };
    }
    this.resolveAnswer(chatId, answer);
  }

  cancel(chatId: string): void {
    if (this.thinking.has(chatId)) {
      this.reset(); // closed while an agent was still working out a reply: abandon the job
      return;
    }
    const p = this.pending.get(chatId);
    if (!p) return;
    if (this.running) {
      this.reset(); // a job is under way: abandon it, the office goes back to idle
      return;
    }
    // The owner's first question, before any job started: just drop it so a new one can be opened.
    this.pending.delete(chatId);
    this.intake = false;
    this.emit({ type: 'chat.closed', id: chatId });
    p.reject(new Cancelled());
  }

  private resolveAnswer(chatId: string, answer: Answer): void {
    const p = this.pending.get(chatId);
    if (!p) return;
    this.pending.delete(chatId);
    this.emit({ type: 'user.say', text: answer.msg, to: p.from });
    this.emit({ type: 'chat.closed', id: chatId });
    p.resolve(answer);
  }

  // ---------- controls used by the demo panel ----------

  get isRunning(): boolean {
    return this.running;
  }

  /**
   * What the company knows about the current job: the conversation, the brief and its changes. The departments
   * work from this. It lives only in memory; it is cleared by a reset and replaced when the next job starts.
   */
  get jobFile(): Readonly<JobFile> | null {
    return this.file;
  }

  setSpeed(scale: number): void {
    this.timeScale = Math.max(0.1, scale);
  }

  /**
   * Opens the owner's first question. The job only counts as started (running, steps, coffee-break
   * recall) once the user sends their first answer; until then this can be called again harmlessly.
   */
  start(): void {
    if (this.running || this.intake) return;
    this.intake = true;
    const run = this.runId;
    const mine = ++this.startSeq; // a cancelled first question must not clear the flags of the next start
    this.runJob(run)
      .catch((err: unknown) => {
        if (!(err instanceof Cancelled)) console.error('[MockOffice] job failed', err);
      })
      .finally(() => {
        if (run === this.runId && mine === this.startSeq) {
          this.running = false;
          this.intake = false;
        }
      });
  }

  reset(): void {
    this.runId++;
    this.running = false;
    this.intake = false;
    this.abortCalls();
    this.file = null;
    this.researchBrain = null;
    this.workBrain = null;
    this.team = { research: true, production: true };
    this.failLock = Promise.resolve();
    this.rejectNextReview = false;
    for (const p of this.pending.values()) p.reject(new Cancelled());
    this.pending.clear();
    for (const q of this.queue) q.reject(new Cancelled());
    this.queue = [];
    this.kick();
    this.wakeRecall();
    this.lanes.clear();
    this.blocked.clear();
    this.away.clear();
    this.trips.clear();
    this.occupied.clear();
    this.initAgents();
    this.emit({ type: 'sim.reset' });
    if (this.infraFeed) this.emit({ type: 'infra', infra: this.infraFeed.snapshot() }); // a reset clears the picture, not the machinery
    void this.courierLoop(this.runId);
    if (this.ambient) void this.ambientLoop(this.runId);
  }

  /** Stop everything for good (no loops restart). Used by tests so the process can exit. */
  dispose(): void {
    this.runId++;
    this.running = false;
    this.intake = false;
    this.abortCalls();
    this.file = null;
    for (const p of this.pending.values()) p.reject(new Cancelled());
    this.pending.clear();
    for (const q of this.queue) q.reject(new Cancelled());
    this.queue = [];
    this.kick();
    this.wakeRecall();
    this.lanes.clear();
    this.stopInfra?.();
    this.listeners.clear();
  }

  private abortCalls(): void {
    this.abort.abort();
    this.abort = new AbortController();
    this.thinking.clear();
  }

  /** Crash a working staff member; their head walks to the server room, restarts it and comes back. */
  injectError(): boolean {
    const run = this.runId;
    const atDesk = STAFF.filter((a) => this.loc[a] === `desk:${a}` && !this.blocked.has(a) && !this.away.has(a));
    const typing = atDesk.filter((a) => this.desired[a].activity === 'typing');
    const pool = typing.length ? typing : atDesk;
    if (!pool.length) return false;
    const who = pool[Math.floor(Math.random() * pool.length)];
    const head = (who.startsWith('research') ? PODS.research : PODS.production).head;
    if (this.blocked.has(head) || this.away.has(head)) return false;
    this.errorFlow(run, who, head).catch((err: unknown) => {
      if (!(err instanceof Cancelled)) console.error('[MockOffice] error flow failed', err);
    });
    return true;
  }

  /** Dump a pile of memos on the courier to show the queue working. */
  jam(count = 4): void {
    const people: AgentId[] = ['owner', 'secretary', 'research-head', 'prod-head', 'qa'];
    for (let i = 0; i < count; i++) {
      const from = people[Math.floor(Math.random() * people.length)];
      // the courier only works across rooms, so pick someone from another room
      const others = people.filter((p) => !sameRoom(p, from));
      const to = others[Math.floor(Math.random() * others.length)];
      this.handoff(from, to, msg('doc.memo')).catch(() => {});
    }
  }

  // ---------- plumbing ----------

  private initAgents(): void {
    for (const id of AGENT_IDS) {
      this.loc[id] = `desk:${id}`;
      this.desired[id] = { activity: 'idle' };
    }
  }

  private kick(): void {
    const w = this.wake;
    this.wake = null;
    w?.();
  }

  private emit(e: OfficeEvent): void {
    for (const l of this.listeners) l(e);
  }

  private sleep(ms: number): Promise<void> {
    const run = this.runId;
    return new Promise((resolve, reject) => {
      setTimeout(() => (run === this.runId ? resolve() : reject(new Cancelled())), Math.max(0, ms / this.timeScale));
    });
  }

  private setAct(agent: AgentId, activity: Activity, note?: Msg): void {
    this.desired[agent] = { activity, note };
    if (this.blocked.has(agent)) return;
    this.emit({ type: 'agent.activity', agent, activity, note });
  }

  private async walk(agent: AgentId, to: PlaceId): Promise<void> {
    const ms = travelMs(this.loc[agent], to);
    this.loc[agent] = to;
    this.emit({ type: 'agent.walk', agent, to, speed: this.timeScale });
    await this.sleep(ms);
  }

  private stage(jobId: string, stage: Stage): void {
    this.emit({ type: 'job.stage', jobId, stage });
  }

  private ask(
    from: AgentId,
    text: Msg,
    opts: { choices?: ChatChoice[]; placeholder?: Msg; auto?: Msg } = {},
  ): Promise<Answer> {
    const id = `chat-${++this.chatSeq}`;
    this.setAct(from, 'talking');
    const result = new Promise<Answer>((resolve, reject) => {
      this.pending.set(id, { from, choices: opts.choices ?? [], resolve, reject });
    });
    this.emit({ type: 'chat.ask', id, from, text, choices: opts.choices, placeholder: opts.placeholder });
    if (this.autoAnswer) {
      const first = opts.choices?.[0];
      const autoMsg = opts.auto ?? msg('auto.idea');
      const canned: Answer = first
        ? { choice: first.id, msg: first.label, text: tr(first.label) }
        : { choice: null, msg: autoMsg, text: tr(autoMsg) };
      this.sleep(1400)
        .then(() => this.resolveAnswer(id, canned))
        .catch(() => {});
    }
    return result.finally(() => this.setAct(from, 'idle'));
  }

  /** A short scripted conversation; the speaker animates while talking. */
  private async convo(lines: [AgentId, Msg, AgentId?][]): Promise<void> {
    for (const [agent, text, to] of lines) {
      this.setAct(agent, 'talking');
      this.emit({ type: 'agent.say', agent, text, to });
      await this.sleep(1100 + tr(text, 'en').length * 22); // pacing never depends on the UI language
      this.setAct(agent, 'idle');
    }
  }

  /**
   * Pass a document on; resolves when the recipient has it. Inside one room the sender walks it over
   * to the recipient's desk and back; across rooms it goes through the courier queue.
   */
  handoff(from: AgentId, to: AgentId, label: Msg): Promise<void> {
    const doc: Doc = { id: `doc-${++this.docSeq}`, label, from, to };
    if (sameRoom(from, to)) return this.handByHand(doc);
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ doc, resolve, reject });
      this.emit({ type: 'doc.queued', doc });
      this.kick();
    });
  }

  /** Same room: the sender carries the document to the recipient's desk, hands it over and walks back. */
  private handByHand(doc: Doc): Promise<void> {
    const { from, to } = doc;
    const prev = Promise.all([this.lanes.get(from), this.lanes.get(to)].map((p) => p?.catch(() => {})));
    const next = prev.then(async () => {
      this.emit({ type: 'agent.carry', agent: from, label: doc.label });
      await this.walk(from, `visit:${to}`);
      this.emit({ type: 'doc.handed', doc });
      this.emit({ type: 'agent.carry', agent: from, label: null });
      await this.sleep(300);
      await this.walk(from, `desk:${from}`);
    });
    this.lanes.set(from, next);
    this.lanes.set(to, next);
    return next;
  }

  private async courierLoop(run: number): Promise<void> {
    try {
      while (run === this.runId) {
        const item = this.queue[0];
        if (!item) {
          if (this.loc.courier !== 'desk:courier') {
            this.setAct('courier', 'idle');
            await this.walk('courier', 'desk:courier');
            continue;
          }
          await new Promise<void>((r) => {
            this.wake = r;
          });
          continue;
        }
        const { doc } = item;
        this.setAct('courier', 'idle');
        await this.walk('courier', `visit:${doc.from}`);
        this.queue.shift();
        this.emit({ type: 'doc.pickup', doc });
        await this.sleep(350);
        await this.walk('courier', `visit:${doc.to}`);
        this.emit({ type: 'doc.delivered', doc });
        item.resolve();
        await this.sleep(300);
      }
    } catch (err) {
      if (!(err instanceof Cancelled)) throw err;
    }
  }

  // ---------- ambient office life ----------

  private wakeRecall(): void {
    const waiters = [...this.recallWaiters];
    this.recallWaiters.clear();
    for (const w of waiters) w();
  }

  /** Sleep that ends early when a job starts (so people head back to their desks). */
  private sleepUntilJob(ms: number): Promise<void> {
    const run = this.runId;
    return new Promise((resolve, reject) => {
      const finish = (): void => {
        clearTimeout(timer);
        this.recallWaiters.delete(finish);
        if (run === this.runId) resolve();
        else reject(new Cancelled());
      };
      const timer = setTimeout(finish, Math.max(0, ms / this.timeScale));
      this.recallWaiters.add(finish);
    });
  }

  /** Walk somewhere, stay a while, walk back to the desk. */
  private async trip(agent: AgentId, place: PlaceId, ms: number, activity: Activity, note: Msg): Promise<void> {
    const run = this.runId;
    this.away.add(agent);
    this.occupied.add(place);
    try {
      await this.walk(agent, place);
      if (!this.running) {
        this.setAct(agent, activity, note);
        await this.sleepUntilJob(ms);
      }
      this.setAct(agent, 'idle');
      this.occupied.delete(place);
      await this.walk(agent, `desk:${agent}`);
    } catch (err) {
      if (!(err instanceof Cancelled)) throw err;
    } finally {
      if (run === this.runId) {
        this.occupied.delete(place);
        this.away.delete(agent);
      }
    }
  }

  /** Between jobs, now and then somebody goes for coffee or to the restroom. */
  private async ambientLoop(run: number): Promise<void> {
    try {
      while (run === this.runId) {
        await this.sleep(5000 + Math.random() * 7000);
        if (this.running || this.away.size >= 2) continue;
        const free = AMBIENT.filter(
          (a) => !this.away.has(a) && this.loc[a] === `desk:${a}` && !this.blocked.has(a),
        );
        if (!free.length) continue;
        const agent = free[Math.floor(Math.random() * free.length)];
        const coffee = Math.random() < 0.65;
        const spots: PlaceId[] = coffee ? ['pantry:0', 'pantry:1', 'pantry:2'] : ['restroom:0', 'restroom:1'];
        const open = spots.filter((p) => !this.occupied.has(p));
        if (!open.length) continue;
        const spot = open[Math.floor(Math.random() * open.length)];
        const t: Promise<void> = (
          coffee
            ? this.trip(agent, spot, 5000 + Math.random() * 3000, 'break', msg('note.coffee'))
            : this.trip(agent, spot, 3000 + Math.random() * 2000, 'idle', msg('note.restroom'))
        ).finally(() => {
          this.trips.delete(t);
        });
        this.trips.add(t);
      }
    } catch (err) {
      if (!(err instanceof Cancelled)) throw err;
    }
  }

  /** Wait until everyone who wandered off is back at their desk. */
  private async settleAway(): Promise<void> {
    await Promise.all([...this.trips]);
  }

  /**
   * A tool crashes: the staff member shows the error, their head walks to the server room,
   * restarts the tool server (the racks flash), the staff member recovers and the head goes back.
   */
  private async errorFlow(run: number, who: AgentId, head: AgentId): Promise<void> {
    this.blocked.add(who);
    this.blocked.add(head);
    this.emit({ type: 'agent.activity', agent: who, activity: 'error', note: msg('note.crashed') });
    this.emit({ type: 'agent.say', agent: who, text: msg('say.crash'), to: head });
    await this.sleep(1600);
    this.emit({ type: 'agent.activity', agent: head, activity: 'talking', note: msg('note.toServer') });
    this.emit({ type: 'agent.say', agent: head, text: msg('say.restartPlan'), to: who });
    await this.walk(head, 'server:0');
    this.emit({ type: 'agent.activity', agent: head, activity: 'typing', note: msg('note.restarting') });
    this.emit({ type: 'agent.say', agent: head, text: msg('say.restarting') });
    await this.sleep(2800);
    if (run !== this.runId) return;
    this.emit({ type: 'agent.say', agent: head, text: msg('say.restarted'), to: who });
    this.emit({ type: 'agent.say', agent: who, text: msg('say.recovered'), to: head });
    this.blocked.delete(who);
    this.blocked.delete(head);
    this.emit({ type: 'agent.activity', agent: who, ...this.desired[who] });
    this.emit({ type: 'agent.activity', agent: head, ...this.desired[head] });
    await this.walk(head, `desk:${head}`);
  }
  // ---------- brain calls: thinking, failures, cancel ----------

  /**
   * Runs one brain call. If it takes a moment the chat box shows gent thinking (and the character does the
   * thinking pose, or waits for quota). If the model fails the user is asked to try again or cancel the job.
   */
  private async think<T>(agent: AgentId, brain: IntakeBrain, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    for (;;) {
      try {
        return await this.thinkOnce(agent, brain, work);
      } catch (err) {
        if (err instanceof Cancelled || !(err instanceof ModelError)) throw err;
        if (err.kind === 'cancelled') throw new Cancelled();
        const reply = await this.ask(agent, msg(`ask.modelError.${err.kind}`), {
          choices: [choice('retry', 'choice.retry'), choice('cancel', 'choice.cancelJob')],
        });
        if (reply.choice === 'cancel') {
          this.reset();
          throw new Cancelled();
        }
      }
    }
  }

  private async thinkOnce<T>(agent: AgentId, brain: IntakeBrain, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const run = this.runId;
    const id = `think-${++this.chatSeq}`;
    const before = this.desired[agent];
    let shown = false;
    let wait: BrainWait = null;

    const render = (): void => {
      if (!shown || run !== this.runId) return;
      this.emit({ type: 'chat.thinking', id, from: agent, wait: wait ?? undefined });
      if (wait === 'quota') this.setAct(agent, 'waiting', msg('note.quotaWait'));
      else if (agent === 'owner') this.setAct(agent, 'thinking', msg('note.thinking'));
      else this.setAct(agent, before.activity, before.note);
    };
    const timer = setTimeout(() => {
      if (run !== this.runId) return;
      shown = true;
      this.thinking.add(id);
      render();
    }, this.thinkDelayMs);
    const unwatch = brain.watchWait?.((w) => {
      wait = w;
      render();
    });

    try {
      return await work(this.abort.signal);
    } finally {
      clearTimeout(timer);
      unwatch?.();
      if (shown && run === this.runId) {
        this.thinking.delete(id);
        this.emit({ type: 'chat.closed', id });
        this.setAct(agent, before.activity, before.note);
      }
    }
  }

  // ---------- the scripted workflow ----------

  private async runJob(run: number): Promise<void> {
    const jobId = `job-${++this.jobSeq}`;
    this.file = null;

    // 1. Brief: the owner questions the user until the brain says there is enough. Nothing has started
    // until the user sends the first answer.
    const brain = this.makeBrain();
    this.researchBrain = this.makeResearch();
    this.workBrain = this.makeWork();
    this.team = { research: true, production: true };
    const history: Exchange[] = [];
    let title = '';
    for (;;) {
      const turn = await this.think('owner', brain, (signal) => brain.ownerTurn(history, title, signal));
      if (turn.kind === 'ready') break;
      const q = turn.question;
      const answer = await this.ask('owner', q.text, { choices: q.choices, placeholder: q.placeholder, auto: q.auto });
      history.push({ question: q.text, answer: answer.msg, text: answer.text, choice: answer.choice });
      if (history.length === 1) {
        this.intake = false;
        this.running = true;
        this.wakeRecall(); // anyone on a coffee break heads back to their desk
        this.stage(jobId, 'brief');
        title = shorten(answer.text);
        this.file = { id: jobId, title, history, brief: null, approvedBrief: null, changes: [] };
        this.emit({ type: 'job.created', jobId, title });
      }
    }

    this.setAct('secretary', 'typing', msg('note.writeBrief'));
    this.emit({ type: 'agent.say', agent: 'owner', text: msg('say.writeBrief'), to: 'secretary' });
    let [, brief] = await Promise.all([
      this.sleep(2800),
      this.think('secretary', brain, (signal) => brain.writeBrief(history, title, signal)),
    ]);
    this.setAct('secretary', 'idle');
    if (this.file) this.file.brief = brief;
    await this.handoff('secretary', 'owner', msg('doc.briefDraft'));
    this.emit({ type: 'doc.consumed', agent: 'owner' });

    // 2. Approval: the owner confirms the brief with the user.
    this.stage(jobId, 'approval');
    let approved = false;
    while (!approved) {
      const reply = await this.ask('owner', msg('ask.approve', { details: brief }), {
        choices: [choice('approve', 'choice.approve'), choice('revise', 'choice.revise')],
        placeholder: msg('ask.approve.ph'),
      });
      if (reply.choice === 'approve' || (reply.choice === null && isAffirmative(reply.text))) {
        approved = true;
        if (this.file) this.file.approvedBrief = tr(brief);
      } else {
        const asksWhat = reply.choice === 'revise' || (reply.choice === null && isBareRevise(reply.text));
        const change = asksWhat
          ? (await this.ask('owner', msg('ask.reviseWhat'), { placeholder: msg('ask.reviseWhat.ph') })).msg
          : reply.msg;
        this.setAct('secretary', 'typing', msg('note.updateBrief'));
        [, brief] = await Promise.all([
          this.sleep(1800),
          this.think('secretary', brain, (signal) => brain.reviseBrief(history, title, change, signal)),
        ]);
        this.setAct('secretary', 'idle');
        if (this.file) {
          this.file.changes.push(tr(change));
          this.file.brief = brief;
        }
      }
    }

    // 3. Owner meets the department heads (everyone is back from any break by now). With a real work brain the
    // owner first decides which departments this job needs, and only those heads come to the meeting.
    await this.settleAway();
    const work = this.workBrain;
    if (work) {
      this.setAct('owner', 'thinking', msg('note.pickTeam'));
      this.team = await this.modelCall('owner', work, (signal) => work.chooseTeam(this.file?.approvedBrief ?? '', signal));
      this.setAct('owner', 'idle');
      if (this.file) this.file.team = this.team;
    }
    const { team } = this;
    this.stage(jobId, 'meeting');
    const heads: AgentId[] = [...(team.research ? (['research-head'] as const) : []), ...(team.production ? (['prod-head'] as const) : [])];
    const slot: Partial<Record<AgentId, PlaceId>> = { 'research-head': 'meet:3', 'prod-head': 'meet:5' };
    await Promise.all([this.walk('owner', 'meet:1'), ...heads.map((h) => this.walk(h, slot[h] as PlaceId))]);
    if (!work) {
      await this.convo([
        ['owner', msg('say.meetOwner', { title }), 'research-head'],
        ['research-head', msg('say.meetResearch'), 'owner'],
        ['prod-head', msg('say.meetProd'), 'owner'],
        ['owner', msg('say.meetOwner2')],
      ]);
    } else {
      const picked = team.research && team.production ? 'say.teamBoth' : team.research ? 'say.teamResearch' : 'say.teamProduction';
      await this.convo([
        ['owner', msg('say.meetOwnerNew', { title }), heads[0]],
        ['owner', msg(picked), heads[0]],
        ...(team.research ? ([['research-head', msg('say.meetResearch'), 'owner']] as [AgentId, Msg, AgentId?][]) : []),
        ...(team.production ? ([['prod-head', msg(team.research ? 'say.meetProd' : 'say.meetProdSolo'), 'owner']] as [AgentId, Msg, AgentId?][]) : []),
        ['owner', msg('say.meetOwner2')],
      ]);
    }
    await Promise.all([this.walk('owner', 'desk:owner'), ...heads.map((h) => this.walk(h, `desk:${h}`))]);

    // 4. Each chosen head briefs their team.
    this.stage(jobId, 'team');
    await Promise.all([...(team.research ? [this.huddle('research')] : []), ...(team.production ? [this.huddle('production')] : [])]);

    // 5. The team works; Production waits for Research's report.
    this.stage(jobId, 'work');
    await this.workPhase();

    // 6. QA reviews, possibly sending it back.
    this.stage(jobId, 'review');
    await this.reviewPhase();

    // 7. Secretary delivers the result to the client.
    this.stage(jobId, 'delivery');
    await this.deliveryPhase(jobId, title);

    // Done: celebrate.
    this.stage(jobId, 'done');
    for (const id of AGENT_IDS) if (id !== 'courier') this.setAct(id, 'celebrate');
    this.emit({ type: 'agent.say', agent: 'owner', text: msg('say.celebrate') });
    this.emit({ type: 'job.done', jobId });
    await this.sleep(3600);
    if (run !== this.runId) return;
    for (const id of AGENT_IDS) this.setAct(id, 'idle');
  }

  private async huddle(pod: Pod): Promise<void> {
    const { head, staff } = PODS[pod];
    await Promise.all([
      this.walk(head, `huddle:${pod}:1`),
      this.walk(staff[0], `huddle:${pod}:0`),
      this.walk(staff[1], `huddle:${pod}:2`),
    ]);
    if (pod === 'research') {
      await this.convo([
        [head, msg('say.huddleResearch'), staff[0]],
        [staff[0], msg('say.huddleLeo'), head],
        [staff[1], msg('say.huddleMina'), head],
      ]);
    } else {
      await this.convo([
        [head, msg('say.huddleProd'), staff[0]],
        [staff[0], msg('say.huddleKai'), head],
        [staff[1], msg('say.huddleZoe'), head],
      ]);
    }
    await Promise.all([
      this.walk(head, `desk:${head}`),
      this.walk(staff[0], `desk:${staff[0]}`),
      this.walk(staff[1], `desk:${staff[1]}`),
    ]);
  }

  private async workPhase(): Promise<void> {
    const { team } = this;
    const { head: rHead, staff: rStaff } = PODS.research;
    const { head: pHead, staff: pStaff } = PODS.production;
    /** Where the research report goes: to Production, or straight to the reviewer when Production is not on the job. */
    const reportTo: AgentId = team.production ? pHead : 'qa';

    const research: Promise<void> = !team.research
      ? Promise.resolve()
      : this.researchBrain
        ? this.realResearch(this.researchBrain, reportTo)
        : (async () => {
            for (const a of rStaff) this.setAct(a, 'typing', msg('note.gathering'));
            await this.sleep(4600);
            await Promise.all(
              rStaff.map((a) => {
                this.setAct(a, 'idle');
                return this.handoff(a, rHead, msg('doc.findings'));
              }),
            );
            this.emit({ type: 'doc.consumed', agent: rHead });
            this.emit({ type: 'doc.consumed', agent: rHead });
            this.setAct(rHead, 'reviewing', msg('note.readFindings'));
            await this.sleep(2200);
            this.setAct(rHead, 'typing', msg('note.writeReport'));
            await this.sleep(2400);
            this.setAct(rHead, 'idle');
            await this.handoff(rHead, reportTo, msg('doc.researchReport'));
            if (reportTo === pHead) this.emit({ type: 'doc.consumed', agent: pHead });
          })();

    const production: Promise<void> = !team.production
      ? Promise.resolve()
      : (async () => {
          if (team.research) {
            for (const a of pStaff) this.setAct(a, 'typing', msg('note.outline'));
            await this.sleep(4200);
            // While Research finishes, the producers go and get a coffee.
            const coffee = Promise.all(
              pStaff.map(async (a, i) => {
                this.setAct(a, 'idle');
                await this.walk(a, `pantry:${i as 0 | 1}`);
                this.setAct(a, 'break', msg('note.coffeeWait'));
              }),
            );
            await research;
            await coffee;
            const back = Promise.all(pStaff.map((a) => this.walk(a, `desk:${a}`)));
            this.setAct(pHead, 'thinking', msg('note.planMerge'));
            await this.sleep(1600);
            this.setAct(pHead, 'idle');
            await back;
          }
          if (this.workBrain) return this.realWriting(this.workBrain);
          await Promise.all(pStaff.map((a) => this.handoff(pHead, a, msg('doc.briefResearch'))));
          for (const a of pStaff) {
            this.emit({ type: 'doc.consumed', agent: a });
            this.setAct(a, 'typing', msg('note.merging'));
          }
          await this.sleep(4600);
          await Promise.all(
            pStaff.map((a) => {
              this.setAct(a, 'idle');
              return this.handoff(a, pHead, msg('doc.draftPart'));
            }),
          );
          this.emit({ type: 'doc.consumed', agent: pHead });
          this.emit({ type: 'doc.consumed', agent: pHead });
          this.setAct(pHead, 'typing', msg('note.assembling'));
          await this.sleep(2800);
          this.setAct(pHead, 'idle');
        })();

    await Promise.all([research, production]);
  }

  /**
   * Production on real models: the head splits the writing, both writers write their part from the brief and
   * the research, the head joins the parts into version 1 of the result kept in the job file.
   */
  private async realWriting(work: WorkBrain): Promise<void> {
    const { head, staff } = PODS.production;
    const brief = this.file?.approvedBrief ?? '';
    const research = this.file?.research ?? null;

    this.setAct(head, 'thinking', msg('note.planWriting'));
    const assignments = await this.modelCall(head, work, (signal) => work.planWriting(brief, research, signal));
    this.setAct(head, 'idle');
    await Promise.all(staff.map((a) => this.handoff(head, a, msg('doc.assignment'))));
    for (const a of staff) this.emit({ type: 'doc.consumed', agent: a });

    const parts = await Promise.all(
      staff.map(async (a, i) => {
        this.setAct(a, 'typing', msg('note.drafting'));
        const text = await this.modelCall(a, work, (signal) => work.draft(a, assignments[i], brief, research, signal));
        this.setAct(a, 'idle');
        await this.handoff(a, head, msg('doc.draftPart'));
        this.emit({ type: 'doc.consumed', agent: head });
        return text;
      }),
    );

    this.setAct(head, 'typing', msg('note.assembling'));
    const body = await this.modelCall(head, work, (signal) => work.assemble(brief, parts, research, signal));
    this.setAct(head, 'idle');
    if (this.file) this.file.deliverable = { body, version: 1, unresolved: null };
  }

  /**
   * The research department on real models: the head plans, both researchers work their half with web tools
   * (showing what they are doing), the head merges the write-ups into the report kept in the job file.
   * Cancelling or resetting abandons it; a model failure asks the user to retry or cancel.
   */
  private async realResearch(brain: ResearchBrain, reportTo: AgentId): Promise<void> {
    const { head, staff } = PODS.research;
    const brief = this.file?.approvedBrief ?? '';

    this.setAct(head, 'thinking', msg('note.planResearch'));
    const assignments = await this.modelCall(head, brain, (signal) => brain.plan(brief, signal));
    this.setAct(head, 'idle');
    await Promise.all(staff.map((a) => this.handoff(head, a, msg('doc.assignment'))));
    for (const a of staff) this.emit({ type: 'doc.consumed', agent: a });

    const findings: Finding[] = await Promise.all(
      staff.map(async (a, i) => {
        this.setAct(a, 'typing', msg('note.gathering'));
        const finding = await this.modelCall(a, brain, (signal) =>
          brain.investigate(a, assignments[i], brief, signal, (p) => {
            if (p.type === 'tool') this.setAct(a, p.tool === 'read' ? 'reviewing' : 'typing', msg(TOOL_NOTE[p.tool]));
            else this.setAct(a, 'typing', msg('note.writingUp'));
          }),
        );
        this.setAct(a, 'idle');
        await this.handoff(a, head, msg('doc.findings'));
        this.emit({ type: 'doc.consumed', agent: head });
        return finding;
      }),
    );

    this.setAct(head, 'typing', msg('note.mergingFindings'));
    const result = await this.modelCall(head, brain, (signal) => brain.report(brief, findings, signal));
    if (this.file) {
      this.file.research = result;
      // With no Production on the job the research is the result itself.
      if (reportTo === 'qa') this.file.deliverable = { body: result.body, version: 1, unresolved: null };
    }
    this.setAct(head, 'idle');
    await this.handoff(head, reportTo, msg('doc.researchReport'));
    if (reportTo !== 'qa') this.emit({ type: 'doc.consumed', agent: reportTo });
  }

  /**
   * One research model call. While it waits for the free quota the person shows it; if the model fails the
   * user is asked (one question at a time, even with two researchers failing together) to retry or cancel.
   */
  private async modelCall<T>(agent: AgentId, brain: { watchWait?(listener: (wait: BrainWait) => void): () => void }, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const run = this.runId;
    for (;;) {
      const before = this.desired[agent];
      const unwatch = brain.watchWait?.((wait) => {
        if (run !== this.runId) return;
        if (wait === 'quota') this.setAct(agent, 'waiting', msg('note.quotaWait'));
        else this.setAct(agent, before.activity, before.note);
      });
      try {
        return await work(this.abort.signal);
      } catch (err) {
        if (err instanceof Cancelled || !(err instanceof ModelError)) throw err;
        if (err.kind === 'cancelled') throw new Cancelled();
        const turn = this.failLock;
        let release!: () => void;
        this.failLock = new Promise<void>((r) => (release = r));
        await turn;
        try {
          if (run !== this.runId) throw new Cancelled();
          const reply = await this.ask(agent, msg(`ask.modelError.${err.kind}`), {
            choices: [choice('retry', 'choice.retry'), choice('cancel', 'choice.cancelJob')],
          });
          if (reply.choice === 'cancel') {
            this.reset();
            throw new Cancelled();
          }
        } finally {
          release();
        }
      } finally {
        unwatch?.();
      }
    }
  }

  /** The pod that wrote the result: Production, or Research when Production was not on the job. */
  private leadPod(): { head: AgentId; staff: [AgentId, AgentId] } {
    return this.team.production ? PODS.production : PODS.research;
  }

  private async reviewPhase(): Promise<void> {
    const { head: lead, staff: leadStaff } = this.leadPod();
    // With Production on the job its head hands QA the result; otherwise the research report already went to QA.
    if (this.team.production) await this.handoff(lead, 'qa', msg('doc.deliverable', { version: 1 }));
    this.emit({ type: 'doc.consumed', agent: 'qa' });
    const work = this.workBrain;

    for (let round = 1; ; round++) {
      this.setAct('qa', 'reviewing', msg('note.checking'));
      let reject: boolean;
      let reason: Msg = msg('reason.noSources');
      let notes = '';
      if (work && this.file?.deliverable) {
        this.rejectNextReview = false; // the demo knob is for the script; a real reviewer decides for itself
        const d = this.file.deliverable;
        const verdict = await this.modelCall('qa', work, (signal) => work.review(this.file?.approvedBrief ?? '', d.body, this.file?.research ?? null, signal));
        reject = !verdict.pass;
        reason = raw(verdict.reason || verdict.issues[0] || '');
        notes = [verdict.reason, ...verdict.issues].filter(Boolean).join('\n');
      } else {
        await this.sleep(3800);
        reject = this.rejectNextReview && round < 3;
        this.rejectNextReview = false;
      }
      if (!reject) {
        this.setAct('qa', 'idle');
        this.emit({ type: 'review.verdict', verdict: 'pass', reason: work ? raw(tr(msg('reason.matches'))) : msg('reason.matches'), round });
        this.emit({ type: 'agent.say', agent: 'qa', text: msg('say.qaPass'), to: 'secretary' });
        await this.handoff('qa', 'secretary', msg('doc.approved'));
        this.emit({ type: 'doc.consumed', agent: 'secretary' });
        return;
      }
      this.setAct('qa', 'idle');
      this.emit({ type: 'review.verdict', verdict: 'reject', reason, round });
      if (work && this.file?.deliverable && round > MAX_REJECTIONS) {
        // Sent back as often as allowed: the result goes to the client with the objection stated, never hidden.
        this.file.deliverable.unresolved = tr(reason);
        this.emit({ type: 'agent.say', agent: 'qa', text: msg('say.qaGaveUp'), to: 'secretary' });
        await this.handoff('qa', 'secretary', msg('doc.deliverable', { version: this.file.deliverable.version }));
        this.emit({ type: 'doc.consumed', agent: 'secretary' });
        return;
      }
      this.emit({ type: 'agent.say', agent: 'qa', text: msg('say.qaReject', { reason }), to: lead });
      await this.handoff('qa', lead, msg('doc.reviewNotes'));
      this.emit({ type: 'doc.consumed', agent: lead });
      if (work) await this.realRework(work, lead, leadStaff[0], round + 1, notes);
      else await this.rework(lead, leadStaff[0], round + 1);
    }
  }

  /** The same loop with a real model: the head reads the notes, a team member fixes the whole result, QA gets it back. */
  private async realRework(work: WorkBrain, head: AgentId, worker: AgentId, nextVersion: number, notes: string): Promise<void> {
    this.setAct(head, 'thinking', msg('note.readNotes'));
    await this.sleep(600);
    this.setAct(head, 'idle');
    await this.handoff(head, worker, msg('doc.fixList'));
    this.emit({ type: 'doc.consumed', agent: worker });
    this.setAct(worker, 'typing', msg('note.fixing'));
    const file = this.file;
    const body = await this.modelCall(worker, work, (signal) =>
      work.revise(worker, file?.approvedBrief ?? '', file?.deliverable?.body ?? '', notes, file?.research ?? null, signal),
    );
    this.setAct(worker, 'idle');
    if (file) file.deliverable = { body, version: nextVersion, unresolved: null };
    await this.handoff(worker, head, msg('doc.fixedDraft'));
    this.emit({ type: 'doc.consumed', agent: head });
    await this.handoff(head, 'qa', msg('doc.deliverable', { version: nextVersion }));
    this.emit({ type: 'doc.consumed', agent: 'qa' });
  }

  /** Head hands a fix list to one producer, who fixes it and returns it to QA via the head. */
  private async rework(head: AgentId, worker: AgentId, nextVersion: number): Promise<void> {
    this.setAct(head, 'thinking', msg('note.readNotes'));
    await this.sleep(1500);
    this.setAct(head, 'idle');
    await this.handoff(head, worker, msg('doc.fixList'));
    this.emit({ type: 'doc.consumed', agent: worker });
    this.setAct(worker, 'typing', msg('note.fixing'));
    await this.sleep(4200);
    this.setAct(worker, 'idle');
    await this.handoff(worker, head, msg('doc.fixedDraft'));
    this.emit({ type: 'doc.consumed', agent: head });
    this.setAct(head, 'typing', msg('note.reassembling'));
    await this.sleep(2000);
    this.setAct(head, 'idle');
    await this.handoff(head, 'qa', msg('doc.deliverable', { version: nextVersion }));
    this.emit({ type: 'doc.consumed', agent: 'qa' });
  }

  /** The result as the client sees it: the body plus what the code knows about how far to trust it. */
  private deliveredText(): string {
    const d = this.file?.deliverable;
    if (!d) return '';
    return withStamp(d, this.file?.research, clientLang([this.file?.approvedBrief ?? ''], getLang()));
  }

  private async deliveryPhase(jobId: string, title: string): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      this.setAct('secretary', 'typing', msg('note.packaging'));
      await this.sleep(2400);
      this.setAct('secretary', 'idle');
      this.emit({ type: 'agent.carry', agent: 'secretary', label: msg('doc.deliverableShort') });
      await this.walk('secretary', 'client');
      const d = this.file?.deliverable;
      const delivered = this.workBrain && d ? msg('ask.deliver.text', { title, text: raw(this.deliveredText()) }) : msg('ask.deliver', { title });
      const reply = await this.ask('secretary', delivered, {
        choices: [choice('accept', 'choice.accept'), choice('request-changes', 'choice.requestChanges')],
        placeholder: msg('ask.deliver.ph'),
      });
      if (reply.choice === 'accept' || (reply.choice === null && isAffirmative(reply.text))) {
        // Accepted: Sam files the deliverable in the archive room, then goes back to her desk.
        this.emit({ type: 'agent.say', agent: 'secretary', text: msg('say.filing'), to: 'owner' });
        await this.walk('secretary', 'archive:0');
        this.setAct('secretary', 'typing', msg('note.filing'));
        await this.sleep(1600);
        this.setAct('secretary', 'idle');
        this.emit({ type: 'agent.carry', agent: 'secretary', label: null });
        this.emit({ type: 'archive.filed', jobId });
        await this.walk('secretary', 'desk:secretary');
        return;
      }
      const asksWhat = reply.choice === 'request-changes' || (reply.choice === null && isBareRevise(reply.text));
      const change = asksWhat
        ? (await this.ask('secretary', msg('ask.changeWhat'), { placeholder: msg('ask.changeWhat.ph') })).msg
        : reply.msg;
      const shown = change.key === 'text' ? raw(shorten(String(change.params?.text ?? ''), 60)) : change;
      const { head: lead, staff: leadStaff } = this.leadPod();
      this.emit({ type: 'agent.say', agent: 'secretary', text: msg('say.changeNoted', { change: shown }), to: lead });
      this.emit({ type: 'agent.carry', agent: 'secretary', label: null });
      await this.walk('secretary', 'desk:secretary');
      await this.handoff('secretary', lead, msg('doc.changeRequest'));
      this.emit({ type: 'doc.consumed', agent: lead });
      const work = this.workBrain;
      if (work && this.file?.deliverable) {
        // A real fix, then a real second look: the reviewer's honest verdict is shown, and any objection stays on the result.
        const version = this.file.deliverable.version + 1;
        await this.realRework(work, lead, leadStaff[leadStaff.length - 1], version, tr(change));
        const body = this.file.deliverable.body;
        this.setAct('qa', 'reviewing', msg('note.rechecking'));
        const verdict = await this.modelCall('qa', work, (signal) => work.review(this.file?.approvedBrief ?? '', body, this.file?.research ?? null, signal));
        this.setAct('qa', 'idle');
        const reason = raw(verdict.reason || verdict.issues[0] || '');
        this.emit({ type: 'review.verdict', verdict: verdict.pass ? 'pass' : 'reject', reason, round: version });
        if (this.file.deliverable) this.file.deliverable.unresolved = verdict.pass ? null : tr(reason);
        await this.handoff('qa', 'secretary', msg('doc.approved'));
        this.emit({ type: 'doc.consumed', agent: 'secretary' });
        continue;
      }
      await this.rework(lead, leadStaff[leadStaff.length - 1], attempt + 1);
      this.setAct('qa', 'reviewing', msg('note.rechecking'));
      await this.sleep(2600);
      this.setAct('qa', 'idle');
      this.emit({ type: 'review.verdict', verdict: 'pass', reason: msg('reason.applied'), round: attempt + 1 });
      await this.handoff('qa', 'secretary', msg('doc.approved'));
      this.emit({ type: 'doc.consumed', agent: 'secretary' });
    }
  }
}
