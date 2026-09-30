import { q, screenHeader } from '../dom';
import { setPairing, state, subscribe } from '../session';
import { clearPairing, loadPairing, parsePairingCode, savePairing } from '../settings';
import type { Nav } from '../nav';

const STATUS_TEXT: Record<string, string> = {
  unpaired: 'ยังไม่ได้เชื่อมต่อ',
  waiting: 'กำลังหา agent...',
  notfound: 'ไม่พบ agent ตรวจรหัสเชื่อมต่อ และเปิดโปรแกรมบนคอมไว้หรือยัง',
  badcode: 'เชื่อมต่อไม่ได้ ตรวจรหัสเชื่อมต่ออีกครั้ง',
  online: 'เชื่อมต่อ agent แล้ว',
  offline: 'agent ออฟไลน์ (คอมปิดอยู่) — แสดงข้อมูลล่าสุดที่จำไว้',
};

export function renderAgent(nav: Nav): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'screen sub';
  const existing = loadPairing();

  wrap.innerHTML = `
    ${screenHeader('เชื่อมต่อกับคอม')}
    <section class="card">
      <label class="field">รหัสเชื่อมต่อ (คัดลอกจากโปรแกรมบนคอม)
        <div class="input-row">
          <input id="code" placeholder="วางรหัสที่นี่" autocomplete="off" value="${existing ? formatCode(existing.agentId + existing.token) : ''}">
          <button type="button" class="icon-btn" id="paste" aria-label="วาง">📋</button>
        </div>
      </label>
      <p class="link-status" id="status"></p>
      <p class="error" id="error"></p>
    </section>
    <button class="primary" id="save-btn">เชื่อมต่อ</button>
    ${existing ? '<button class="danger" id="unpair-btn">ยกเลิกการเชื่อมต่อ</button>' : ''}
  `;

  q(wrap, '[data-back]').addEventListener('click', () => nav('home'));

  const codeInput = q<HTMLInputElement>(wrap, '#code');
  const error = q<HTMLElement>(wrap, '#error');
  const status = q<HTMLElement>(wrap, '#status');

  q(wrap, '#paste').addEventListener('click', async () => {
    try {
      codeInput.value = await navigator.clipboard.readText();
      error.textContent = '';
    } catch {
      error.textContent = 'วางอัตโนมัติไม่ได้ กดค้างที่ช่องแล้วเลือกวางเอง';
    }
  });

  q(wrap, '#save-btn').addEventListener('click', () => {
    const p = parsePairingCode(codeInput.value);
    if (!p) {
      error.textContent = 'รหัสไม่ถูกต้อง ลองคัดลอกใหม่จากโปรแกรมบนคอม';
      return;
    }
    error.textContent = '';
    savePairing(p);
    setPairing(p);
    codeInput.value = formatCode(p.agentId + p.token);
  });

  wrap.querySelector('#unpair-btn')?.addEventListener('click', () => {
    clearPairing();
    setPairing(null);
    nav('agent');
  });

  function update(): void {
    status.textContent = STATUS_TEXT[state.agentLink];
    status.dataset.state = state.agentLink;
  }
  const unsub = subscribe(() => {
    if (!wrap.isConnected) { unsub(); return; }
    update();
  });
  update();
  return wrap;
}

function formatCode(hex: string): string {
  return hex.replace(/(.{4})/g, '$1-').replace(/-$/, '');
}
