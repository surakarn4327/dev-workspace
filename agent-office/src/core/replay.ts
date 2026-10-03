// Plays a recording back as if it were happening now: an OfficeSource that re-emits the recorded events with
// their original timing (faster if asked, with long waits shortened so nobody watches an empty office while the
// user was typing). The screen cannot tell it from the live office; answering questions does nothing, because
// the job is already over.

import type { Recording } from './recording.ts';
import type { ChatReply, OfficeEvent, OfficeListener, OfficeSource } from './types.ts';

export interface ReplayProgress {
  /** Events emitted so far. */
  index: number;
  total: number;
  /** Recorded time reached (ms) out of `durationMs`. */
  elapsedMs: number;
  durationMs: number;
  playing: boolean;
  finished: boolean;
}

export interface ReplayOptions {
  speed?: number;
  /** A wait longer than this (in recorded milliseconds) is shown as this long. */
  maxGapMs?: number;
  /** Swappable for tests. */
  schedule?: (fn: () => void, ms: number) => () => void;
}

export const REPLAY_SPEEDS: readonly number[] = [1, 4, 16];

const realSchedule = (fn: () => void, ms: number): (() => void) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

export class ReplaySource implements OfficeSource {
  private readonly recording: Recording;
  private readonly listeners = new Set<OfficeListener>();
  private readonly endListeners = new Set<() => void>();
  private readonly maxGapMs: number;
  private readonly schedule: (fn: () => void, ms: number) => () => void;
  private speed: number;
  private index = 0;
  private playing = false;
  private finished = false;
  private cancelTimer: (() => void) | null = null;
  private lastT = 0;

  constructor(recording: Recording, opts: ReplayOptions = {}) {
    this.recording = recording;
    this.speed = opts.speed ?? 1;
    this.maxGapMs = opts.maxGapMs ?? 2500;
    this.schedule = opts.schedule ?? realSchedule;
  }

  // ---------- OfficeSource ----------

  subscribe(listener: OfficeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get isRunning(): boolean {
    return this.playing;
  }

  /** Plays from the start. */
  start(): void {
    this.halt();
    this.index = 0;
    this.lastT = 0;
    this.finished = false;
    this.playing = true;
    this.emit({ type: 'sim.reset' });
    this.pump();
  }

  /** Stops playing and shows nothing more. */
  reset(): void {
    this.halt();
    this.playing = false;
  }

  answer(_chatId: string, _reply: ChatReply): void {
    /* the job is over: nobody is waiting for an answer */
  }

  /** The ✕ on a replayed question just hides the box. */
  cancel(chatId: string): void {
    this.emit({ type: 'chat.closed', id: chatId });
  }

  // ---------- controls ----------

  setSpeed(speed: number): void {
    this.speed = Math.max(0.25, speed);
    if (this.playing && this.cancelTimer) {
      this.halt(); // the wait already under way was timed at the old speed: time it again at the new one
      this.pump();
    }
  }

  get currentSpeed(): number {
    return this.speed;
  }

  pause(): void {
    if (!this.playing) return;
    this.halt();
    this.playing = false;
  }

  resume(): void {
    if (this.playing || this.finished) return;
    this.playing = true;
    this.pump();
  }

  get progress(): ReplayProgress {
    return {
      index: this.index,
      total: this.recording.events.length,
      elapsedMs: this.finished ? this.recording.durationMs : this.lastT,
      durationMs: this.recording.durationMs,
      playing: this.playing,
      finished: this.finished,
    };
  }

  get title(): string {
    return this.recording.title;
  }

  onEnd(fn: () => void): () => void {
    this.endListeners.add(fn);
    return () => this.endListeners.delete(fn);
  }

  // ---------- playback ----------

  private halt(): void {
    this.cancelTimer?.();
    this.cancelTimer = null;
  }

  private emit(e: OfficeEvent): void {
    for (const fn of [...this.listeners]) fn(e);
  }

  /** Emits every event that is due now, then waits for the next one. */
  private pump(): void {
    this.cancelTimer = null;
    const events = this.recording.events;
    while (this.playing && this.index < events.length) {
      const next = events[this.index];
      const wait = this.index === 0 ? 0 : Math.min(Math.max(0, next.t - this.lastT), this.maxGapMs) / this.speed;
      if (wait >= 1) {
        this.cancelTimer = this.schedule(() => {
          this.cancelTimer = null;
          if (!this.playing || this.index >= events.length) return; // a stale timer after a stop or the end does nothing
          this.deliver();
          this.pump();
        }, wait);
        return;
      }
      this.deliver();
    }
    if (this.playing && events.length === 0) this.finish();
  }

  private deliver(): void {
    const item = this.recording.events[this.index++];
    this.lastT = item.t;
    this.emit(item.e);
    if (this.index >= this.recording.events.length) this.finish();
  }
  private finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.playing = false;
    this.halt();
    for (const fn of [...this.endListeners]) fn();
  }
}
