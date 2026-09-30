import { escapeHtml, q, setToggle, toggleHtml } from '../dom';
import { defaultSchedule, formatUptime, formatWhen, nextOccurrence } from '../schedule-util';
import { patchAgentLocal, pressPower, publishSchedule, sendAgentConfig, state, subscribe, type ConnState } from '../session';
import type { BrokerSettings } from '../settings';
import type { Nav } from '../nav';

const HOLD_MS = 3000;

const CONN_TEXT: Record<ConnState, string> = {
  connecting: 'กำลังเชื่อมต่อ broker...',
  connected: 'เชื่อมต่อ broker แล้ว',
  error: 'เชื่อมต่อ broker ไม่ได้ กำลังลองใหม่...',
};

const AGENT_CHIP: Record<string, string> = {
  unpaired: 'ยังไม่ได้เชื่อมต่อ agent',
  waiting: 'กำลังหา agent...',
  notfound: 'ไม่พบ agent',
  badcode: 'รหัสเชื่อมต่อไม่ตรง',
  online: 'agent เชื่อมต่อแล้ว',
  offline: 'agent ออฟไลน์',
};

export function renderHome(settings: BrokerSettings, nav: Nav): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'screen main';
  wrap.innerHTML = `
    <header>
      <h1>${escapeHtml(settings.deviceName)}</h1>
      <button class="settings-btn" id="settings-btn" aria-label="ตั้งค่า">⚙</button>
    </header>

    <div class="status-row">
      <div class="status-pill" id="esp-status">ESP32: -</div>
      <div class="status-pill" id="pc-status">คอม: -</div>
    </div>

    <div class="power-wrap">
      <button class="power-btn" id="power-btn">
        <svg viewBox="0 0 48 48" class="power-icon"><path d="M24 8v18" stroke="currentColor" stroke-width="4" stroke-linecap="round" fill="none"/><path d="M15 14a13 13 0 1 0 18 0" stroke="currentColor" stroke-width="4" fill="none" stroke-linecap="round"/></svg>
        <svg viewBox="0 0 48 48" class="power-progress"><circle cx="24" cy="24" r="21" pathLength="100" /></svg>
      </button>
      <p class="hold-hint">กดค้าง 3 วินาทีเพื่อเปิด/ปิดคอม</p>
      <p class="uptime-line" id="uptime"></p>
    </div>

    <section class="card">
      <h2>รอบถัดไป</h2>
      <div class="row"><span>ปิดคอม</span><strong id="next-off">-</strong></div>
      <div class="row"><span>เปิดคอม</span><strong id="next-on">-</strong></div>
      <div class="row"><span>หยุดชั่วคราว</span>${toggleHtml('pause-toggle', false)}</div>
    </section>

    <nav class="nav-list">
      <button class="nav-row" data-go="schedule"><span>ตั้งเวลา</span><span class="chev">›</span></button>
      <button class="nav-row" data-go="programs"><span>โปรแกรม</span><span class="chev">›</span></button>
      <button class="nav-row" data-go="agent"><span>เชื่อมต่อกับคอม</span><span class="agent-chip" id="agent-chip"></span><span class="chev">›</span></button>
    </nav>

    <p class="conn-line" id="conn-line"></p>
  `;

  const espEl = q<HTMLDivElement>(wrap, '#esp-status');
  const pcEl = q<HTMLDivElement>(wrap, '#pc-status');
  const connLine = q<HTMLParagraphElement>(wrap, '#conn-line');
  const uptimeEl = q<HTMLParagraphElement>(wrap, '#uptime');
  const nextOff = q<HTMLElement>(wrap, '#next-off');
  const nextOn = q<HTMLElement>(wrap, '#next-on');
  const pauseToggle = q<HTMLButtonElement>(wrap, '#pause-toggle');
  const agentChip = q<HTMLElement>(wrap, '#agent-chip');

  q(wrap, '#settings-btn').addEventListener('click', () => nav('setup'));
  wrap.querySelectorAll<HTMLElement>('[data-go]').forEach((b) =>
    b.addEventListener('click', () => nav(b.dataset.go as Parameters<Nav>[0])),
  );

  pauseToggle.addEventListener('click', () => {
    const paused = !(state.sched ?? defaultSchedule()).paused;
    publishSchedule({ ...(state.sched ?? defaultSchedule()), paused });
    if (state.agent) {
      patchAgentLocal({ paused });
      void sendAgentConfig({ paused });
    }
  });

  function update(): void {
    setPill(espEl, 'ESP32', state.esp);
    setPill(pcEl, 'คอม', state.pc);
    connLine.textContent = CONN_TEXT[state.conn];
    connLine.dataset.state = state.conn;

    const sched = state.sched ?? defaultSchedule();
    const agentCfg = state.agent?.config;
    const paused = sched.paused || (agentCfg?.paused ?? false);
    setToggle(pauseToggle, paused);

    const now = new Date();
    if (paused) {
      nextOff.textContent = nextOn.textContent = 'หยุดชั่วคราวอยู่';
    } else {
      const on = nextOccurrence(sched.days, sched.on, now);
      nextOn.textContent = on ? formatWhen(on, now) : '-';
      if (agentCfg && state.agent) {
        const a = state.agent;
        if (a.postponedUntil && a.postponedUntil > Date.now()) {
          nextOff.textContent = formatWhen(new Date(a.postponedUntil), now);
        } else {
          const off = nextOccurrence(agentCfg.days, agentCfg.off, now, a.skipToday);
          nextOff.textContent = off ? formatWhen(off, now) : '-';
        }
      } else {
        nextOff.textContent = state.agentLink === 'unpaired' ? 'ต้องเชื่อมต่อ agent' : '-';
      }
    }

    agentChip.textContent = AGENT_CHIP[state.agentLink];
    agentChip.className = `agent-chip ${state.agentLink}`;

    const boot = state.agent?.bootAt;
    uptimeEl.textContent = state.pc && boot && state.agentLink === 'online' ? `เปิดมาแล้ว ${formatUptime(boot, Date.now())}` : '';
  }

  const unsub = subscribe(() => {
    if (!wrap.isConnected) { unsub(); return; }
    update();
  });
  update();

  attachHoldToActivate(q<HTMLButtonElement>(wrap, '#power-btn'), pressPower);
  return wrap;
}

function setPill(el: HTMLElement, label: string, online: boolean | null): void {
  if (online === null) {
    el.textContent = `${label}: -`;
    el.classList.remove('online', 'offline');
    return;
  }
  el.textContent = `${label}: ${online ? 'เปิดอยู่' : 'ปิดอยู่'}`;
  el.classList.toggle('online', online);
  el.classList.toggle('offline', !online);
}

function attachHoldToActivate(btn: HTMLButtonElement, onComplete: () => void): void {
  let start = 0;
  let raf = 0;
  let holding = false;

  const progress = btn.querySelector<SVGCircleElement>('.power-progress circle')!;

  function frame() {
    const elapsed = performance.now() - start;
    const pct = Math.min(1, elapsed / HOLD_MS);
    progress.style.strokeDashoffset = String(100 - pct * 100);
    if (pct >= 1) {
      holding = false;
      btn.classList.remove('holding');
      progress.style.strokeDashoffset = '100';
      onComplete();
      return;
    }
    if (holding) raf = requestAnimationFrame(frame);
  }

  function begin(e: Event) {
    e.preventDefault();
    if (holding) return;
    holding = true;
    start = performance.now();
    btn.classList.add('holding');
    raf = requestAnimationFrame(frame);
  }

  function cancel() {
    if (!holding) return;
    holding = false;
    cancelAnimationFrame(raf);
    btn.classList.remove('holding');
    progress.style.strokeDashoffset = '100';
  }

  btn.addEventListener('pointerdown', begin);
  btn.addEventListener('pointerup', cancel);
  btn.addEventListener('pointerleave', cancel);
  btn.addEventListener('pointercancel', cancel);
}
