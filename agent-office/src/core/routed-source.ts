// One OfficeSource for the screen to listen to, whichever source is actually driving it: the live office or a
// replay. Switching clears the screen first (sim.reset) so nothing of one leaks into the other, and answers and
// cancels always go to whoever is driving now.

import type { ChatReply, OfficeEvent, OfficeListener, OfficeSource } from './types.ts';

export type RouteMode = 'live' | 'replay';

export class RoutedSource implements OfficeSource {
  private readonly live: OfficeSource;
  private current: OfficeSource;
  private stop: (() => void) | null = null;
  private readonly listeners = new Set<OfficeListener>();
  private route: RouteMode = 'live';
  /** The latest picture of the machinery, so a listener that joins late still starts with it. */
  private lastInfra: OfficeEvent | null = null;

  constructor(live: OfficeSource) {
    this.live = live;
    this.current = live;
    this.attach();
  }

  get mode(): RouteMode {
    return this.route;
  }

  /** The source driving the screen now. */
  get active(): OfficeSource {
    return this.current;
  }

  private attach(): void {
    this.stop = this.current.subscribe((e) => this.emit(e));
  }

  private emit(e: OfficeEvent): void {
    if (e.type === 'infra') this.lastInfra = e;
    for (const fn of [...this.listeners]) fn(e);
  }

  /** Hand the screen to another source (a replay). The live office keeps running unseen only if it is idle. */
  useReplay(replay: OfficeSource): void {
    this.switchTo(replay, 'replay');
  }

  /** Give the screen back to the live office. */
  useLive(): void {
    this.switchTo(this.live, 'live');
  }

  private switchTo(next: OfficeSource, route: RouteMode): void {
    if (next === this.current) return;
    this.stop?.();
    if (this.route === 'replay') this.current.reset(); // a replay stops when it loses the screen; the live office is left alone
    this.current = next;
    this.route = route;
    this.emit({ type: 'sim.reset' });
    this.attach();
  }

  // ---------- OfficeSource: all delegated to whoever is driving ----------

  subscribe(listener: OfficeListener): () => void {
    this.listeners.add(listener);
    if (this.lastInfra) listener(this.lastInfra);
    return () => this.listeners.delete(listener);
  }

  get isRunning(): boolean {
    return this.current.isRunning;
  }

  start(): void {
    this.current.start();
  }

  reset(): void {
    this.current.reset();
  }

  answer(chatId: string, reply: ChatReply): void {
    this.current.answer(chatId, reply);
  }

  cancel(chatId: string): void {
    this.current.cancel(chatId);
  }
}
