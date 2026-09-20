import mqtt, { type MqttClient } from 'mqtt';
import './style.css';
import { loadSettings, saveSettings, clearSettings, topics, type BrokerSettings } from './settings';
import { registerSW } from 'virtual:pwa-register';

registerSW({ immediate: true });

const HOLD_MS = 3000;

const app = document.querySelector<HTMLDivElement>('#app')!;

let client: MqttClient | null = null;

function render(): void {
  const settings = loadSettings();
  app.innerHTML = '';
  if (!settings) {
    app.appendChild(renderSetup());
  } else {
    app.appendChild(renderMain(settings));
  }
}

function renderSetup(existing?: BrokerSettings): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'screen setup';
  wrap.innerHTML = `
    <h1>+ เพิ่มอุปกรณ์</h1>
    <p class="hint">กรอกข้อมูล HiveMQ Cloud cluster เดียวกับที่ตั้งค่าไว้บน ESP32</p>
    <form id="setup-form">
      <label>Broker host <input name="host" required placeholder="xxxxxxxx.s1.eu.hivemq.cloud" value="${existing?.host ?? ''}"></label>
      <label>Port (WebSocket TLS) <input name="port" required type="number" placeholder="8884" value="${existing?.port ?? 8884}"></label>
      <label>Username <input name="username" required value="${existing?.username ?? ''}"></label>
      <label>Password <input name="password" required type="password" value="${existing?.password ?? ''}"></label>
      <label>Device ID <input name="deviceId" required placeholder="pc01" value="${existing?.deviceId ?? ''}"></label>
      <label>ชื่ออุปกรณ์ (แสดงบนหน้าจอ) <input name="deviceName" required placeholder="คอมห้องทำงาน" value="${existing?.deviceName ?? ''}"></label>
      <button type="submit">บันทึกและเชื่อมต่อ</button>
      ${existing ? '<button type="button" id="reset-btn" class="danger">ลบการตั้งค่าอุปกรณ์นี้</button>' : ''}
    </form>
  `;

  wrap.querySelector('#reset-btn')?.addEventListener('click', () => {
    clearSettings();
    render();
  });

  wrap.querySelector('form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget as HTMLFormElement;
    const data = new FormData(form);
    const settings: BrokerSettings = {
      host: String(data.get('host')).trim(),
      port: Number(data.get('port')),
      username: String(data.get('username')).trim(),
      password: String(data.get('password')),
      deviceId: String(data.get('deviceId')).trim(),
      deviceName: String(data.get('deviceName')).trim(),
    };
    saveSettings(settings);
    render();
  });

  return wrap;
}

type ConnState = 'connecting' | 'connected' | 'error';

function renderMain(settings: BrokerSettings): HTMLElement {
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
    </div>

    <p class="conn-line" id="conn-line"></p>
  `;

  wrap.querySelector('#settings-btn')!.addEventListener('click', () => {
    if (client) { client.end(true); client = null; }
    wrap.replaceWith(renderSetup(settings));
  });

  const espEl = wrap.querySelector<HTMLDivElement>('#esp-status')!;
  const pcEl = wrap.querySelector<HTMLDivElement>('#pc-status')!;
  const connLine = wrap.querySelector<HTMLParagraphElement>('#conn-line')!;
  const powerBtn = wrap.querySelector<HTMLButtonElement>('#power-btn')!;

  setConnState('connecting', connLine);
  const t = topics(settings.deviceId);

  client = mqtt.connect(`wss://${settings.host}:${settings.port}/mqtt`, {
    username: settings.username,
    password: settings.password,
    protocolVersion: 4,
    reconnectPeriod: 3000,
    clientId: `webapp-${Math.random().toString(16).slice(2)}`,
  });

  client.on('connect', () => {
    setConnState('connected', connLine);
    client!.subscribe([t.status, t.availability]);
  });
  client.on('reconnect', () => setConnState('connecting', connLine));
  client.on('error', () => setConnState('error', connLine));
  client.on('close', () => setConnState('error', connLine));

  client.on('message', (topic, payload) => {
    const value = payload.toString();
    if (topic === t.status) {
      setPill(pcEl, 'คอม', value === 'online');
    } else if (topic === t.availability) {
      setPill(espEl, 'ESP32', value === 'online');
    }
  });

  attachHoldToActivate(powerBtn, () => {
    client?.publish(t.cmd, 'toggle');
  });

  return wrap;
}

function setPill(el: HTMLElement, label: string, online: boolean): void {
  el.textContent = `${label}: ${online ? 'เปิดอยู่' : 'ปิดอยู่'}`;
  el.classList.toggle('online', online);
  el.classList.toggle('offline', !online);
}

function setConnState(state: ConnState, el: HTMLElement): void {
  const text: Record<ConnState, string> = {
    connecting: 'กำลังเชื่อมต่อ broker...',
    connected: 'เชื่อมต่อ broker แล้ว',
    error: 'เชื่อมต่อ broker ไม่ได้ กำลังลองใหม่...',
  };
  el.textContent = text[state];
  el.dataset.state = state;
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

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

render();
