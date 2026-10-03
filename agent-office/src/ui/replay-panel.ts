// Replay in the Menu: a list of recorded jobs to play back, and a bar over the office while one is playing.
// Playing hands the screen to a ReplaySource through the RoutedSource; stopping hands it back to the live office.

import type { RecordingStore } from '../core/recording-store.ts';
import type { RecordingMeta } from '../core/recording.ts';
import { ReplaySource, REPLAY_SPEEDS } from '../core/replay.ts';
import type { Recording } from '../core/recording.ts';
import type { RoutedSource } from '../core/routed-source.ts';
import { getLang, t } from '../core/i18n.ts';
import { el, h } from './dom.ts';

export interface ReplayPanelDeps {
  routed: RoutedSource;
  store: RecordingStore;
  /** Tests build replays with a fake clock. */
  makeReplay?: (recording: Recording) => ReplaySource;
  /** Where "now is replaying" is shown as a class (the chat box hides its answer controls). */
  stage?: HTMLElement;
}

const clock = (ms: number): string => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function when(ms: number): string {
  try {
    return new Intl.DateTimeFormat(getLang() === 'th' ? 'th-TH' : 'en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(ms);
  } catch {
    return new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
  }
}

export function mountReplayPanel(deps: ReplayPanelDeps): { refresh(): Promise<void>; stop(): void } {
  const list = el<HTMLUListElement>('#replay-list');
  const empty = el<HTMLElement>('#replay-empty');
  const bar = el<HTMLElement>('#replay-bar');
  const barTitle = el<HTMLElement>('#replay-title');
  const fill = el<HTMLElement>('#replay-fill');
  const stopBtn = el<HTMLButtonElement>('#replay-stop');
  const speedBtns = [...bar.querySelectorAll<HTMLButtonElement>('.replay-speed')];
  const stage = deps.stage ?? document.body;

  let metas: RecordingMeta[] = [];
  let replay: ReplaySource | null = null;
  let ticker = 0;

  const busy = (): boolean => deps.routed.mode === 'live' && deps.routed.isRunning;
  const playing = (): boolean => replay !== null;

  function renderList(): void {
    list.replaceChildren();
    empty.hidden = metas.length > 0;
    const blocked = busy() || playing();
    for (const m of metas) {
      const li = h('li', 'replay-item');
      const play = h('button', 'btn replay-play', `▶ ${m.title || t('replay.untitled')}`);
      play.type = 'button';
      play.disabled = blocked;
      play.title = busy() ? t('replay.busy') : t('replay.play');
      play.addEventListener('click', () => void start(m.id));
      const meta = h('span', 'replay-meta', `${when(m.startedAt)} · ${clock(m.durationMs)} · ${t(`replay.${m.ended}`)}`);
      const del = h('button', 'btn replay-del', '✕');
      del.type = 'button';
      del.title = t('replay.delete');
      del.setAttribute('aria-label', t('replay.delete'));
      del.addEventListener('click', () => void remove(m.id));
      li.append(play, meta, del);
      list.append(li);
    }
  }

  function renderBar(): void {
    bar.hidden = !playing();
    stage.classList.toggle('replaying', playing());
    if (!replay) return;
    const p = replay.progress;
    barTitle.textContent = replay.title || t('replay.untitled');
    fill.style.width = `${p.total ? Math.round((p.index / p.total) * 100) : 100}%`;
    stopBtn.textContent = t(p.finished ? 'replay.close' : 'replay.stop');
    for (const b of speedBtns) b.classList.toggle('active', Number(b.dataset.speed) === replay.currentSpeed);
  }

  async function refresh(): Promise<void> {
    try {
      metas = await deps.store.list();
    } catch {
      metas = [];
    }
    renderList();
    renderBar();
  }

  async function start(id: string): Promise<void> {
    if (busy() || playing()) return;
    let recording: Recording | null = null;
    try {
      recording = await deps.store.get(id);
    } catch {
      /* unreadable: nothing to play */
    }
    if (!recording || busy()) return;
    const next = deps.makeReplay ? deps.makeReplay(recording) : new ReplaySource(recording);
    replay = next;
    next.onEnd(renderBar);
    deps.routed.useReplay(next);
    next.start();
    renderList();
    renderBar();
    window.clearInterval(ticker);
    ticker = window.setInterval(renderBar, 250);
  }

  function stop(): void {
    if (!replay) return;
    window.clearInterval(ticker);
    replay = null;
    deps.routed.useLive();
    renderList();
    renderBar();
  }

  async function remove(id: string): Promise<void> {
    try {
      await deps.store.remove(id);
    } catch {
      /* already gone */
    }
    await refresh();
  }

  stopBtn.addEventListener('click', stop);
  for (const b of speedBtns) {
    b.addEventListener('click', () => {
      const speed = Number(b.dataset.speed);
      if (replay && REPLAY_SPEEDS.includes(speed)) replay.setSpeed(speed);
      renderBar();
    });
  }

  void refresh();
  return { refresh, stop };
}
