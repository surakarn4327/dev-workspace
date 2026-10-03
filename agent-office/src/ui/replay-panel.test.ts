import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setLang } from '../core/i18n.ts';
import { memoryRecordingStore } from '../core/recording-store.ts';
import type { Recording } from '../core/recording.ts';
import { ReplaySource } from '../core/replay.ts';
import { RoutedSource } from '../core/routed-source.ts';
import type { OfficeEvent, OfficeSource } from '../core/types.ts';
import { applyStatic } from './i18n-dom.ts';
import { mountReplayPanel } from './replay-panel.ts';
import { setupDom } from './test-dom.ts';

const t = setupDom();
const doc = t.window.document;
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 10));

const rec = (n: number, over: Partial<Recording> = {}): Recording => ({
  v: 1,
  id: `r${n}`,
  title: `Job ${n}`,
  startedAt: Date.UTC(2026, 9, n, 7, 30),
  durationMs: 92_000,
  ended: 'done',
  events: [0, 100, 200].map((time, i) => ({ t: time, e: { type: 'agent.walk', agent: 'qa', to: 'pantry:0', speed: i } as OfficeEvent })),
  ...over,
});

function setup() {
  const live = { running: false, resets: 0 };
  const liveSource: OfficeSource = {
    subscribe: () => () => {},
    get isRunning() {
      return live.running;
    },
    start: () => {},
    reset: () => void live.resets++,
    answer: () => {},
    cancel: () => {},
  };
  const routed = new RoutedSource(liveSource);
  const store = memoryRecordingStore();
  const timers: { fn: () => void; live: boolean }[] = [];
  const stage = doc.getElementById('stage-area') as HTMLElement;
  const replays: ReplaySource[] = [];
  const panel = mountReplayPanel({
    routed,
    store,
    stage,
    makeReplay: (r) => {
      const replay = new ReplaySource(r, {
        schedule: (fn) => {
          const timer = { fn, live: true };
          timers.push(timer);
          return () => void (timer.live = false);
        },
      });
      replays.push(replay);
      return replay;
    },
  });
  const fire = (): void => {
    const next = timers.find((x) => x.live);
    if (next) {
      next.live = false;
      next.fn();
    }
  };
  return { live, routed, store, stage, panel, fire, replays };
}

const items = (): HTMLElement[] => [...doc.querySelectorAll<HTMLElement>('#replay-list .replay-item')];
const bar = doc.getElementById('replay-bar') as HTMLElement;
const playButtons = (): HTMLButtonElement[] => [...doc.querySelectorAll<HTMLButtonElement>('#replay-list .replay-play')];

test('with nothing recorded the panel says so; recordings then appear newest first with when, how long and how it ended', async () => {
  setLang('en', false);
  applyStatic();
  const s = setup();
  await s.panel.refresh();
  assert.equal(items().length, 0);
  assert.equal((doc.getElementById('replay-empty') as HTMLElement).hidden, false);

  await s.store.put(rec(1));
  await s.store.put(rec(3, { title: '', ended: 'abandoned' }));
  await s.panel.refresh();
  assert.equal((doc.getElementById('replay-empty') as HTMLElement).hidden, true);
  assert.deepEqual(playButtons().map((b) => b.textContent), ['▶ Untitled job', '▶ Job 1']);
  const meta = items()[0].querySelector('.replay-meta')?.textContent ?? '';
  assert.match(meta, /1:32/);
  assert.match(meta, /cancelled/);
  assert.match(items()[1].querySelector('.replay-meta')?.textContent ?? '', /finished/);
});

test('playing hands the screen to the replay, shows the bar with the job\'s name, and locks the play buttons', async () => {
  const s = setup();
  await s.store.put(rec(1));
  await s.store.put(rec(2));
  await s.panel.refresh();
  playButtons()[0].click();
  await settle();
  assert.equal(s.routed.mode, 'replay');
  assert.equal(bar.hidden, false);
  assert.equal(doc.getElementById('replay-title')?.textContent, 'Job 2');
  assert.equal(s.stage.classList.contains('replaying'), true);
  assert.ok(playButtons().every((b) => b.disabled), 'one replay at a time');
  s.panel.stop();
});

test('the speed buttons change the speed and show which one is on', async () => {
  const s = setup();
  await s.store.put(rec(1));
  await s.panel.refresh();
  playButtons()[0].click();
  await settle();
  const speed = (n: number): HTMLButtonElement => bar.querySelector(`.replay-speed[data-speed="${n}"]`) as HTMLButtonElement;
  assert.equal(speed(1).classList.contains('active'), true);
  speed(16).click();
  assert.equal(s.replays[0].currentSpeed, 16);
  assert.equal(speed(16).classList.contains('active'), true);
  assert.equal(speed(1).classList.contains('active'), false);
  s.panel.stop();
});

test('when the replay ends the button becomes Close, and closing gives the live office its screen back', async () => {
  const s = setup();
  await s.store.put(rec(1));
  await s.panel.refresh();
  playButtons()[0].click();
  await settle();
  const stopBtn = doc.getElementById('replay-stop') as HTMLButtonElement;
  assert.equal(stopBtn.textContent, 'Stop');
  s.fire();
  s.fire();
  assert.equal(s.replays[0].progress.finished, true);
  assert.equal(stopBtn.textContent, 'Close');
  stopBtn.click();
  assert.equal(s.routed.mode, 'live');
  assert.equal(bar.hidden, true);
  assert.equal(s.stage.classList.contains('replaying'), false);
  assert.ok(playButtons().every((b) => !b.disabled));
  assert.equal(s.live.resets, 0, 'the live office was never reset by watching a replay');
});

test('while a live job is running nothing can be played, and the buttons say why', async () => {
  const s = setup();
  await s.store.put(rec(1));
  s.live.running = true;
  await s.panel.refresh();
  assert.ok(playButtons().every((b) => b.disabled && b.title === 'Finish or cancel the current job first.'));
  playButtons()[0].click();
  await settle();
  assert.equal(s.routed.mode, 'live');
  s.live.running = false;
  await s.panel.refresh();
  assert.ok(playButtons().every((b) => !b.disabled));
});

test('a recording can be deleted from the list', async () => {
  const s = setup();
  await s.store.put(rec(1));
  await s.store.put(rec(2));
  await s.panel.refresh();
  (items()[0].querySelector('.replay-del') as HTMLButtonElement).click();
  await settle();
  assert.deepEqual(playButtons().map((b) => b.textContent), ['▶ Job 1']);
});

test('the words follow the language', async () => {
  const s = setup();
  await s.store.put(rec(1));
  setLang('th', false);
  applyStatic();
  await s.panel.refresh();
  assert.match(items()[0].querySelector('.replay-meta')?.textContent ?? '', /เสร็จแล้ว/);
  assert.equal(doc.getElementById('replay-stop')?.textContent, 'หยุด');
  playButtons()[0].click();
  await settle();
  assert.equal(doc.querySelector('.replay-tag')?.textContent, 'ย้อนดู');
  s.panel.stop();
  setLang('en', false);
  applyStatic();
});

test.after(() => t.stop());
