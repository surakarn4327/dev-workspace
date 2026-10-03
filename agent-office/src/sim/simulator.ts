// Mock "brain" for stage 1. It plays the 7-step company workflow by emitting the
// same events a real orchestrator would, so the UI never knows the difference.
// The courier is a real FIFO queue (plain code); everything else is scripted.

import { travelMs } from '../core/world.ts';
import type {
  Activity,
  AgentId,
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
    { from: AgentId; resolve: (t: string) => void; reject: (e: unknown) => void }
  >();
  private queue: QueueItem[] = [];
  private wake: (() => void) | null = null;
  private loc = {} as Record<AgentId, PlaceId>;
  private desired = {} as Record<AgentId, { activity: Activity; note?: string }>;
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

  answer(chatId: string, text: string): void {
    const p = this.pending.get(chatId);
    if (!p) return;
    this.pending.delete(chatId);
    this.emit({ type: 'user.say', text, to: p.from });
    this.emit({ type: 'chat.closed', id: chatId });
    p.resolve(text);
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
      let to = people[Math.floor(Math.random() * people.length)];
      if (to === from) to = people[(people.indexOf(from) + 1) % people.length];
      this.handoff(from, to, 'Memo').catch(() => {});
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

  private setAct(agent: AgentId, activity: Activity, note?: string): void {
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
    text: string,
    opts: { choices?: string[]; placeholder?: string; auto?: string } = {},
  ): Promise<string> {
    const id = `chat-${++this.chatSeq}`;
    this.setAct(from, 'talking');
    const result = new Promise<string>((resolve, reject) => {
      this.pending.set(id, { from, resolve, reject });
    });
    this.emit({ type: 'chat.ask', id, from, text, choices: opts.choices, placeholder: opts.placeholder });
    if (this.autoAnswer) {
      const canned = opts.choices?.[0] ?? opts.auto ?? 'Sounds good';
      this.sleep(1400)
        .then(() => this.answer(id, canned))
        .catch(() => {});
    }
    return result.finally(() => this.setAct(from, 'idle'));
  }

  /** A short scripted conversation; the speaker animates while talking. */
  private async convo(lines: [AgentId, string, AgentId?][]): Promise<void> {
    for (const [agent, text, to] of lines) {
      this.setAct(agent, 'talking');
      this.emit({ type: 'agent.say', agent, text, to });
      await this.sleep(1100 + text.length * 22);
      this.setAct(agent, 'idle');
    }
  }

  /** Hand a document over via the courier queue; resolves when delivered. */
  handoff(from: AgentId, to: AgentId, label: string): Promise<void> {
    const doc: Doc = { id: `doc-${++this.docSeq}`, label, from, to };
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ doc, resolve, reject });
      this.emit({ type: 'doc.queued', doc });
      this.kick();
    });
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
  private async trip(agent: AgentId, place: PlaceId, ms: number, activity: Activity, note: string): Promise<void> {
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
            ? this.trip(agent, spot, 5000 + Math.random() * 3000, 'break', 'Coffee break')
            : this.trip(agent, spot, 3000 + Math.random() * 2000, 'idle', 'Restroom')
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
    this.emit({ type: 'agent.activity', agent: who, activity: 'error', note: 'Tool crashed' });
    this.emit({ type: 'agent.say', agent: who, text: 'My tool just crashed!', to: head });
    await this.sleep(1600);
    this.emit({ type: 'agent.activity', agent: head, activity: 'talking', note: 'Heading to the server room' });
    this.emit({ type: 'agent.say', agent: head, text: 'I will restart it from the server room.', to: who });
    await this.walk(head, 'server:0');
    this.emit({ type: 'agent.activity', agent: head, activity: 'typing', note: 'Restarting the tool server' });
    this.emit({ type: 'agent.say', agent: head, text: 'Restarting the tool server...' });
    await this.sleep(2800);
    if (run !== this.runId) return;
    this.emit({ type: 'agent.say', agent: head, text: 'Restarted. Please retry.', to: who });
    this.emit({ type: 'agent.say', agent: who, text: 'Working again, thanks!', to: head });
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
    const idea = await this.ask('owner', 'Welcome to the office! What would you like us to produce?', {
      placeholder: 'e.g. A weekly market newsletter',
      auto: 'A weekly market newsletter',
    });
    const title = shorten(idea);
    this.emit({ type: 'job.created', jobId, title });
    const audience = await this.ask(
      'owner',
      `"${title}" - sounds good. Who is it for, and what tone should it have?`,
      { placeholder: 'e.g. Beginners, friendly tone', auto: 'Beginners, friendly tone' },
    );
    const limits = await this.ask('owner', 'Any hard limits? Length, format, deadline...', {
      choices: ['No limits', 'One page', 'Detailed report'],
      placeholder: 'or type your own',
    });

    this.setAct('secretary', 'typing', 'Writing the brief');
    this.emit({ type: 'agent.say', agent: 'owner', text: 'Sam, please write this up as a brief.', to: 'secretary' });
    await this.sleep(2800);
    this.setAct('secretary', 'idle');
    await this.handoff('secretary', 'owner', 'Brief draft');
    this.emit({ type: 'doc.consumed', agent: 'owner' });

    // 2. Approval: the owner confirms the brief with the user.
    this.stage(jobId, 'approval');
    let details = `Goal: ${title}\nAudience & tone: ${audience}\nLimits: ${limits}`;
    let approved = false;
    while (!approved) {
      const reply = await this.ask('owner', `Here is the brief:\n${details}\n\nShall we start?`, {
        choices: ['Approve', 'Revise'],
        placeholder: 'or type a change',
      });
      if (/^(approve|ok|yes|y|go|start)/i.test(reply.trim())) {
        approved = true;
      } else {
        const change = /^revise/i.test(reply.trim())
          ? await this.ask('owner', 'What should I change?', { placeholder: 'tell me what to change' })
          : reply;
        details += `\nChange: ${change}`;
        this.setAct('secretary', 'typing', 'Updating the brief');
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
      ['owner', `New job: ${title}. We need Research and Production, then QA.`, 'research-head'],
      ['research-head', 'Research will gather the facts first.', 'owner'],
      ['prod-head', 'Production drafts in parallel and merges the facts when they arrive.', 'owner'],
      ['owner', 'Perfect. Keep me posted.'],
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
    this.emit({ type: 'agent.say', agent: 'owner', text: 'Great job, team! Another one delivered.' });
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
        [head, 'Leo, Mina: collect facts and sources for the brief.', staff[0]],
        [staff[0], 'On it. I will take the market data.', head],
        [staff[1], 'I will cover background and sources.', head],
      ]);
    } else {
      await this.convo([
        [head, 'Kai, Zoe: start the outline now, merge the research once it lands.', staff[0]],
        [staff[0], 'I will draft the structure.', head],
        [staff[1], 'And I will prepare the visuals.', head],
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
      for (const a of rStaff) this.setAct(a, 'typing', 'Gathering facts');
      await this.sleep(4600);
      await Promise.all(
        rStaff.map((a) => {
          this.setAct(a, 'idle');
          return this.handoff(a, rHead, 'Findings');
        }),
      );
      this.emit({ type: 'doc.consumed', agent: rHead });
      this.emit({ type: 'doc.consumed', agent: rHead });
      this.setAct(rHead, 'reviewing', 'Reading the findings');
      await this.sleep(2200);
      this.setAct(rHead, 'typing', 'Writing the research report');
      await this.sleep(2400);
      this.setAct(rHead, 'idle');
      await this.handoff(rHead, pHead, 'Research report');
      this.emit({ type: 'doc.consumed', agent: pHead });
    })();

    const production = (async () => {
      for (const a of pStaff) this.setAct(a, 'typing', 'Drafting the outline');
      await this.sleep(4200);
      // While Research finishes, the producers go and get a coffee.
      const coffee = Promise.all(
        pStaff.map(async (a, i) => {
          this.setAct(a, 'idle');
          await this.walk(a, `pantry:${i as 0 | 1}`);
          this.setAct(a, 'break', 'Coffee while waiting for the research');
        }),
      );
      await research;
      await coffee;
      const back = Promise.all(pStaff.map((a) => this.walk(a, `desk:${a}`)));
      this.setAct(pHead, 'thinking', 'Planning the merge');
      await this.sleep(1600);
      this.setAct(pHead, 'idle');
      await back;
      await Promise.all(pStaff.map((a) => this.handoff(pHead, a, 'Brief + research')));
      for (const a of pStaff) {
        this.emit({ type: 'doc.consumed', agent: a });
        this.setAct(a, 'typing', 'Merging into the draft');
      }
      await this.sleep(4600);
      await Promise.all(
        pStaff.map((a) => {
          this.setAct(a, 'idle');
          return this.handoff(a, pHead, 'Draft part');
        }),
      );
      this.emit({ type: 'doc.consumed', agent: pHead });
      this.emit({ type: 'doc.consumed', agent: pHead });
      this.setAct(pHead, 'typing', 'Assembling the deliverable');
      await this.sleep(2800);
      this.setAct(pHead, 'idle');
    })();

    await Promise.all([research, production]);
  }

  private async reviewPhase(): Promise<void> {
    const { head: pHead, staff: pStaff } = PODS.production;
    await this.handoff(pHead, 'qa', 'Deliverable v1');
    this.emit({ type: 'doc.consumed', agent: 'qa' });

    for (let round = 1; ; round++) {
      this.setAct('qa', 'reviewing', 'Checking against the brief');
      await this.sleep(3800);
      const reject = this.rejectNextReview && round < 3;
      this.rejectNextReview = false;
      if (!reject) {
        this.setAct('qa', 'idle');
        this.emit({ type: 'review.verdict', verdict: 'pass', reason: 'Matches the brief', round });
        this.emit({ type: 'agent.say', agent: 'qa', text: 'Looks good. Approved!', to: 'secretary' });
        await this.handoff('qa', 'secretary', 'Approved package');
        this.emit({ type: 'doc.consumed', agent: 'secretary' });
        return;
      }
      const reason = 'Section 2 has no sources';
      this.setAct('qa', 'idle');
      this.emit({ type: 'review.verdict', verdict: 'reject', reason, round });
      this.emit({ type: 'agent.say', agent: 'qa', text: `${reason}. Please fix and resubmit.`, to: pHead });
      await this.handoff('qa', pHead, 'Review notes');
      this.emit({ type: 'doc.consumed', agent: pHead });
      await this.rework(pHead, pStaff[0], round + 1);
    }
  }

  /** Head hands a fix list to one producer, who fixes it and returns it to QA via the head. */
  private async rework(head: AgentId, worker: AgentId, nextVersion: number): Promise<void> {
    this.setAct(head, 'thinking', 'Reading the review notes');
    await this.sleep(1500);
    this.setAct(head, 'idle');
    await this.handoff(head, worker, 'Fix list');
    this.emit({ type: 'doc.consumed', agent: worker });
    this.setAct(worker, 'typing', 'Fixing the issues');
    await this.sleep(4200);
    this.setAct(worker, 'idle');
    await this.handoff(worker, head, 'Fixed draft');
    this.emit({ type: 'doc.consumed', agent: head });
    this.setAct(head, 'typing', 'Re-assembling the deliverable');
    await this.sleep(2000);
    this.setAct(head, 'idle');
    await this.handoff(head, 'qa', `Deliverable v${nextVersion}`);
    this.emit({ type: 'doc.consumed', agent: 'qa' });
  }

  private async deliveryPhase(jobId: string, title: string): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      this.setAct('secretary', 'typing', 'Packaging the result');
      await this.sleep(2400);
      this.setAct('secretary', 'idle');
      this.emit({ type: 'agent.carry', agent: 'secretary', label: 'Deliverable' });
      await this.walk('secretary', 'client');
      const reply = await this.ask(
        'secretary',
        `Your deliverable is ready: "${title}".\n\n(Demo output - a real run would show the actual result here.)\n\nDo you accept it?`,
        { choices: ['Accept', 'Request changes'], placeholder: 'or describe what to change' },
      );
      if (/^(accept|ok|yes|y|good|great)/i.test(reply.trim())) {
        // Accepted: Sam files the deliverable in the archive room, then goes back to her desk.
        this.emit({ type: 'agent.say', agent: 'secretary', text: 'Wonderful. I will file it in the archive.', to: 'owner' });
        await this.walk('secretary', 'archive:0');
        this.setAct('secretary', 'typing', 'Filing the deliverable');
        await this.sleep(1600);
        this.setAct('secretary', 'idle');
        this.emit({ type: 'agent.carry', agent: 'secretary', label: null });
        this.emit({ type: 'archive.filed', jobId });
        await this.walk('secretary', 'desk:secretary');
        return;
      }
      const change = /^request/i.test(reply.trim())
        ? await this.ask('secretary', 'What should we change?', { placeholder: 'tell me what to change' })
        : reply;
      this.emit({ type: 'agent.say', agent: 'secretary', text: `Change request noted: ${shorten(change, 60)}`, to: 'prod-head' });
      this.emit({ type: 'agent.carry', agent: 'secretary', label: null });
      await this.walk('secretary', 'desk:secretary');
      await this.handoff('secretary', 'prod-head', 'Change request');
      this.emit({ type: 'doc.consumed', agent: 'prod-head' });
      await this.rework('prod-head', 'prod-2', attempt + 1);
      this.setAct('qa', 'reviewing', 'Re-checking the changes');
      await this.sleep(2600);
      this.setAct('qa', 'idle');
      this.emit({ type: 'review.verdict', verdict: 'pass', reason: 'Changes applied', round: attempt + 1 });
      await this.handoff('qa', 'secretary', 'Approved package');
      this.emit({ type: 'doc.consumed', agent: 'secretary' });
    }
  }
}
