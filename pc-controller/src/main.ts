import './style.css';
import { loadPairing, loadSettings, saveSettings, clearSettings, type BrokerSettings } from './settings';
import { registerSW } from 'virtual:pwa-register';
import { escapeHtml } from './dom';
import { startSession, stopSession } from './session';
import type { Nav, Screen } from './nav';
import { renderHome } from './screens/home';
import { renderSchedule } from './screens/schedule';
import { renderPrograms } from './screens/programs';
import { renderAgent } from './screens/agent';

registerSW({ immediate: true });

const app = document.querySelector<HTMLDivElement>('#app')!;

function getDeviceIdFromUrl(): string | null {
  const device = new URLSearchParams(window.location.search).get('device');
  return device ? device.trim() : null;
}

const nav: Nav = (to) => show(to);

function show(screen: Screen): void {
  const settings = loadSettings();
  app.innerHTML = '';
  if (!settings) {
    const prefillDeviceId = getDeviceIdFromUrl();
    if (prefillDeviceId) {
      // Drop ?device= from the address bar once read so it doesn't linger
      // in history/bookmarks or get re-read after the form is filled in.
      window.history.replaceState(null, '', window.location.pathname);
    }
    app.appendChild(renderSetup(undefined, prefillDeviceId ?? undefined));
    return;
  }
  switch (screen) {
    case 'setup': app.appendChild(renderSetup(settings)); break;
    case 'schedule': app.appendChild(renderSchedule(nav)); break;
    case 'programs': app.appendChild(renderPrograms(nav)); break;
    case 'agent': app.appendChild(renderAgent(nav)); break;
    default: app.appendChild(renderHome(settings, nav));
  }
}

function renderSetup(existing?: BrokerSettings, prefillDeviceId?: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'screen setup';
  const deviceIdValue = existing?.deviceId ?? prefillDeviceId ?? '';
  const hint = prefillDeviceId && !existing
    ? 'Device ID กรอกให้จาก ESP32 อัตโนมัติแล้ว — แค่ตั้งชื่ออุปกรณ์แล้วกดบันทึก'
    : 'ใส่ Device ID เดียวกับที่ตั้งค่าไว้บน ESP32 (broker เป็นแบบสาธารณะ ไม่ต้องกรอก host/รหัสผ่านเอง)';
  wrap.innerHTML = `
    <h1>${existing ? 'ตั้งค่าอุปกรณ์' : '+ เพิ่มอุปกรณ์'}</h1>
    <p class="hint">${hint}</p>
    <form id="setup-form">
      <label>Device ID <input name="deviceId" required placeholder="pc-x9f3k2m8q1" value="${escapeHtml(deviceIdValue)}"></label>
      <label>ชื่ออุปกรณ์ (แสดงบนหน้าจอ) <input name="deviceName" required placeholder="คอมห้องทำงาน" value="${escapeHtml(existing?.deviceName ?? '')}"></label>
      <button type="submit">บันทึกและเชื่อมต่อ</button>
      ${existing ? '<button type="button" id="back-btn" class="secondary">กลับ</button>' : ''}
      ${existing ? '<button type="button" id="reset-btn" class="danger">ลบการตั้งค่าอุปกรณ์นี้</button>' : ''}
    </form>
  `;

  wrap.querySelector('#back-btn')?.addEventListener('click', () => show('home'));

  wrap.querySelector('#reset-btn')?.addEventListener('click', () => {
    stopSession();
    clearSettings();
    show('home');
  });

  wrap.querySelector('form')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(e.currentTarget as HTMLFormElement);
    const settings: BrokerSettings = {
      deviceId: String(data.get('deviceId')).trim(),
      deviceName: String(data.get('deviceName')).trim(),
    };
    saveSettings(settings);
    startSession(settings, loadPairing());
    show('home');
  });

  return wrap;
}

const initial = loadSettings();
if (initial) startSession(initial, loadPairing());
show('home');
