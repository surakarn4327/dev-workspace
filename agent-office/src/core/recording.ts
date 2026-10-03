// Records a job as the stream of events the office emitted, so it can be played back later (see replay.ts).
// Everything on screen is drawn from these events, so a recording is a complete, replayable copy of the job:
// the conversation, the walking, the documents, the verdicts and even the server room's lights.
// A recording starts when the owner opens his first question and ends when the job is done (or abandoned).

import type { Infra, OfficeEvent } from './types.ts';

export interface TimedEvent {
  /** Milliseconds since the recording started. */
  t: number;
  e: OfficeEvent;
}

export interface Recording {
  /** Format version, so old recordings can be recognised if the event vocabulary changes. */
  v: 1;
  id: string;
  /** The job's name (from the user's first answer); '' when the job never got one. */
  title: string;
  startedAt: number;
  durationMs: number;
  ended: 'done' | 'abandoned';
  events: TimedEvent[];
}

export type RecordingMeta = Omit<Recording, 'events'> & { eventCount: number };

export const metaOf = (r: Recording): RecordingMeta => {
  const { events, ...rest } = r;
  return { ...rest, eventCount: events.length };
};

export interface RecorderOptions {
  /** Called with each finished recording. */
  onSave: (recording: Recording) => void;
  now?: () => number;
  /** A job that somehow emits more events than this stops being recorded (but is still saved). */
  maxEvents?: number;
}

export class Recorder {
  private readonly onSave: (r: Recording) => void;
  private readonly now: () => number;
  private readonly maxEvents: number;
  private lastInfra: Infra | null = null;
  private seq = 0;

  private current: { id: string; startedAt: number; title: string; sawAnswer: boolean; events: TimedEvent[] } | null = null;

  constructor(opts: RecorderOptions) {
    this.onSave = opts.onSave;
    this.now = opts.now ?? Date.now;
    this.maxEvents = opts.maxEvents ?? 30_000;
  }

  get recording(): boolean {
    return this.current !== null;
  }

  /** Feed every event the live office emits. */
  feed(e: OfficeEvent): void {
    if (e.type === 'infra') this.lastInfra = e.infra;

    if (!this.current) {
      // Idle life (coffee breaks, wandering) is not a job: only the owner's first question opens a recording.
      if (e.type !== 'chat.ask') return;
      const startedAt = this.now();
      this.current = { id: `rec-${startedAt}-${++this.seq}`, startedAt, title: '', sawAnswer: false, events: [] };
      // The machinery's state at the start, so the replayed server room begins the way it really was.
      if (this.lastInfra) this.current.events.push({ t: 0, e: { type: 'infra', infra: this.lastInfra } });
    }
    const c = this.current;

    if (e.type === 'sim.reset') {
      this.finish(c.title ? 'abandoned' : null);
      return;
    }
    if (c.events.length < this.maxEvents) c.events.push({ t: Math.max(0, this.now() - c.startedAt), e });

    if (e.type === 'user.say') c.sawAnswer = true;
    if (e.type === 'job.created') c.title = e.title;
    if (e.type === 'chat.closed' && !c.sawAnswer && !c.title) this.finish(null); // the first question was closed unanswered
    if (e.type === 'job.done') this.finish('done');
  }

  private finish(ended: Recording['ended'] | null): void {
    const c = this.current;
    this.current = null;
    if (!c || !ended) return;
    const last = c.events.at(-1);
    this.onSave({ v: 1, id: c.id, title: c.title, startedAt: c.startedAt, durationMs: last?.t ?? 0, ended, events: c.events });
  }
}
