// Mock "brain" for stage 1. It plays the 7-step company workflow by emitting the
// same events a real orchestrator would, so the UI never knows the difference.
// The courier is a real FIFO queue (plain code); everything else is scripted.

import { isAffirmative, isBareRevise } from '../core/intent.ts';
import { msg, raw, tr } from '../core/i18n.ts';
import type { Msg } from '../core/i18n.ts';
import { sameRoom, travelMs } from '../core/world.ts';
import type {
  Activity,
  AgentId,
  ChatChoice,
  ChatReply,
  Doc,
  OfficeEvent,
  OfficeListener,
  OfficeSource,
  PlaceId,
  Pod,
  Stage,
} from '../core/types.ts';
import { AGENT_IDS } from '../core/types.ts';

class Cancelled extends Error {}

export interface MockOptions {
  timeScale?: number;
  autoAnswer?: boolean;
  /** Idle office life: people wander off for coffee or the restroom between jobs (default on). */
  ambient?: boolean;
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

const choice = (id: string, key: string): ChatChoice => ({ id, label: msg(key) });

function shorten(text: string, max = 44): string {
  const t = text.trim().replace(/\s+/g, ' ');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

export class MockOffice implements OfficeSource {
  timeScale: number;
  autoAnswer: boolean;
  /** When set, the next QA review rejects the deliverable once. */
  rejectNextReview = false;

  private listeners = new Set<OfficeListener>();
  private runId = 0;
  private running = false;
  private jobSeq = 0;
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
  private away = new Set<AgentId>();
  private trips = new Set<Promise<void>>();
  private occupied = new Set<PlaceId>();
  private recallWaiters = new Set<() => void>();

  constructor(opts: MockOptions = {}) {
    this.timeScale = opts.timeScale ?? 1;
    this.autoAnswer = opts.autoAnswer ?? false;
    this.ambient = opts.ambient ?? true;
    this.initAgents();
    void this.courierLoop(this.runId);
    if (this.ambient) void this.ambientLoop(this.runId);
  }

  // ---------- OfficeSource ----------

  subscribe(listener: OfficeListener): () => void {
    this.listeners.add(listener);
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

  setSpeed(scale: number): void {
    this.timeScale = Math.max(0.1, scale);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.wakeRecall(); // anyone on a coffee break heads back to their desk
    const run = this.runId;
    this.runJob(run)
      .catch((err: unknown) => {
        if (!(err instanceof Cancelled)) console.error('[MockOffice] job failed', err);
      })
      .finally(() => {
        if (run === this.runId) this.running = false;
      });
  }

  reset(): void {
    this.runId++;
    this.running = false;
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
    void this.courierLoop(this.runId);
    if (this.ambient) void this.ambientLoop(this.runId);
  }

  /** Stop everything for good (no loops restart). Used by tests so the process can exit. */
  dispose(): void {
    this.runId++;
    this.running = false;
    for (const p of this.pending.values()) p.reject(new Cancelled());
    this.pending.clear();
    for (const q of this.queue) q.reject(new Cancelled());
    this.queue = [];
    this.kick();
    this.wakeRecall();
    this.lanes.clear();
    this.listeners.clear();
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
  // ---------- the scripted workflow ----------

  private async runJob(run: number): Promise<void> {
    const jobId = `job-${++this.jobSeq}`;

    // 1. Brief: the user tells the owner what to produce.
    this.stage(jobId, 'brief');
    const idea = await this.ask('owner', msg('ask.idea'), {
      placeholder: msg('ask.idea.ph'),
      auto: msg('auto.idea'),
    });
    const title = shorten(idea.text);
    this.emit({ type: 'job.created', jobId, title });
    const audience = await this.ask('owner', msg('ask.audience', { title }), {
      placeholder: msg('ask.audience.ph'),
      auto: msg('auto.audience'),
    });
    const limits = await this.ask('owner', msg('ask.limits'), {
      choices: [choice('none', 'choice.none'), choice('one-page', 'choice.onePage'), choice('detailed', 'choice.detailed')],
      placeholder: msg('ask.limits.ph'),
    });

    this.setAct('secretary', 'typing', msg('note.writeBrief'));
    this.emit({ type: 'agent.say', agent: 'owner', text: msg('say.writeBrief'), to: 'secretary' });
    await this.sleep(2800);
    this.setAct('secretary', 'idle');
    await this.handoff('secretary', 'owner', msg('doc.briefDraft'));
    this.emit({ type: 'doc.consumed', agent: 'owner' });

    // 2. Approval: the owner confirms the brief with the user.
    this.stage(jobId, 'approval');
    let changes: Msg = raw('');
    let approved = false;
    while (!approved) {
      const details = msg('brief.body', { goal: title, audience: audience.msg, limits: limits.msg, changes });
      const reply = await this.ask('owner', msg('ask.approve', { details }), {
        choices: [choice('approve', 'choice.approve'), choice('revise', 'choice.revise')],
        placeholder: msg('ask.approve.ph'),
      });
      if (reply.choice === 'approve' || (reply.choice === null && isAffirmative(reply.text))) {
        approved = true;
      } else {
        const asksWhat = reply.choice === 'revise' || (reply.choice === null && isBareRevise(reply.text));
        const change = asksWhat
          ? (await this.ask('owner', msg('ask.reviseWhat'), { placeholder: msg('ask.reviseWhat.ph') })).msg
          : reply.msg;
        changes = msg('brief.change', { prev: changes, text: change });
        this.setAct('secretary', 'typing', msg('note.updateBrief'));
        await this.sleep(1800);
        this.setAct('secretary', 'idle');
      }
    }

    // 3. Owner meets the department heads (everyone is back from any break by now).
    await this.settleAway();
    this.stage(jobId, 'meeting');
    await Promise.all([
      this.walk('owner', 'meet:1'),
      this.walk('research-head', 'meet:3'),
      this.walk('prod-head', 'meet:5'),
    ]);
    await this.convo([
      ['owner', msg('say.meetOwner', { title }), 'research-head'],
      ['research-head', msg('say.meetResearch'), 'owner'],
      ['prod-head', msg('say.meetProd'), 'owner'],
      ['owner', msg('say.meetOwner2')],
    ]);
    await Promise.all([
      this.walk('owner', 'desk:owner'),
      this.walk('research-head', 'desk:research-head'),
      this.walk('prod-head', 'desk:prod-head'),
    ]);

    // 4. Each head briefs their team.
    this.stage(jobId, 'team');
    await Promise.all([this.huddle('research'), this.huddle('production')]);

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
    const { head: rHead, staff: rStaff } = PODS.research;
    const { head: pHead, staff: pStaff } = PODS.production;

    const research = (async () => {
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
      await this.handoff(rHead, pHead, msg('doc.researchReport'));
      this.emit({ type: 'doc.consumed', agent: pHead });
    })();

    const production = (async () => {
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

  private async reviewPhase(): Promise<void> {
    const { head: pHead, staff: pStaff } = PODS.production;
    await this.handoff(pHead, 'qa', msg('doc.deliverable', { version: 1 }));
    this.emit({ type: 'doc.consumed', agent: 'qa' });

    for (let round = 1; ; round++) {
      this.setAct('qa', 'reviewing', msg('note.checking'));
      await this.sleep(3800);
      const reject = this.rejectNextReview && round < 3;
      this.rejectNextReview = false;
      if (!reject) {
        this.setAct('qa', 'idle');
        this.emit({ type: 'review.verdict', verdict: 'pass', reason: msg('reason.matches'), round });
        this.emit({ type: 'agent.say', agent: 'qa', text: msg('say.qaPass'), to: 'secretary' });
        await this.handoff('qa', 'secretary', msg('doc.approved'));
        this.emit({ type: 'doc.consumed', agent: 'secretary' });
        return;
      }
      const reason = msg('reason.noSources');
      this.setAct('qa', 'idle');
      this.emit({ type: 'review.verdict', verdict: 'reject', reason, round });
      this.emit({ type: 'agent.say', agent: 'qa', text: msg('say.qaReject', { reason }), to: pHead });
      await this.handoff('qa', pHead, msg('doc.reviewNotes'));
      this.emit({ type: 'doc.consumed', agent: pHead });
      await this.rework(pHead, pStaff[0], round + 1);
    }
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

  private async deliveryPhase(jobId: string, title: string): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      this.setAct('secretary', 'typing', msg('note.packaging'));
      await this.sleep(2400);
      this.setAct('secretary', 'idle');
      this.emit({ type: 'agent.carry', agent: 'secretary', label: msg('doc.deliverableShort') });
      await this.walk('secretary', 'client');
      const reply = await this.ask('secretary', msg('ask.deliver', { title }), {
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
      this.emit({ type: 'agent.say', agent: 'secretary', text: msg('say.changeNoted', { change: shown }), to: 'prod-head' });
      this.emit({ type: 'agent.carry', agent: 'secretary', label: null });
      await this.walk('secretary', 'desk:secretary');
      await this.handoff('secretary', 'prod-head', msg('doc.changeRequest'));
      this.emit({ type: 'doc.consumed', agent: 'prod-head' });
      await this.rework('prod-head', 'prod-2', attempt + 1);
      this.setAct('qa', 'reviewing', msg('note.rechecking'));
      await this.sleep(2600);
      this.setAct('qa', 'idle');
      this.emit({ type: 'review.verdict', verdict: 'pass', reason: msg('reason.applied'), round: attempt + 1 });
      await this.handoff('qa', 'secretary', msg('doc.approved'));
      this.emit({ type: 'doc.consumed', agent: 'secretary' });
    }
  }
}
