import { q, screenHeader, setToggle, toggleHtml } from '../dom';
import {
  COUNTDOWN_OPTIONS, DAY_SHORT, DEFAULT_OFF, defaultSchedule, localTz,
} from '../schedule-util';
import { patchAgentLocal, publishSchedule, sendAgentConfig, state, subscribe } from '../session';
import type { Nav } from '../nav';

const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

export function renderSchedule(nav: Nav): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'screen sub';

  const sched = state.sched ?? defaultSchedule();
  const agentCfg = state.agent?.config;
  const days = new Set(sched.days);
  let paused = sched.paused || (agentCfg?.paused ?? false);
  const offValue = agentCfg?.off ?? DEFAULT_OFF;
  const countdownValue = agentCfg?.countdown ?? 60;

  wrap.innerHTML = `
    ${screenHeader('ตั้งเวลา')}
    <section class="card">
      <h2>วันที่ใช้งาน</h2>
      <div class="day-row">
        ${DISPLAY_ORDER.map((d) => `<button type="button" class="day${days.has(d) ? ' on' : ''}" data-day="${d}">${DAY_SHORT[d]}</button>`).join('')}
      </div>
    </section>

    <section class="card">
      <div class="row"><label for="on-time">เปิดคอม</label><input type="time" id="on-time" value="${sched.on}"></div>
      <div class="row"><label for="off-time">ปิดคอม</label><input type="time" id="off-time" value="${offValue}"></div>
      <div class="row"><label for="countdown">นับถอยหลังก่อนปิด</label>
        <select id="countdown">
          ${[...new Set([...COUNTDOWN_OPTIONS, countdownValue])].sort((a, b) => a - b)
            .map((s) => `<option value="${s}"${s === countdownValue ? ' selected' : ''}>${s} วินาที</option>`).join('')}
        </select>
      </div>
      <p class="note" id="agent-note"></p>
    </section>

    <section class="card">
      <div class="row"><span>หยุดชั่วคราว</span>${toggleHtml('pause-toggle', paused)}</div>
    </section>

    <button class="primary" id="save-btn">บันทึก</button>
    <p class="save-msg" id="save-msg"></p>
  `;

  q(wrap, '[data-back]').addEventListener('click', () => nav('home'));

  wrap.querySelectorAll<HTMLButtonElement>('.day').forEach((b) =>
    b.addEventListener('click', () => {
      const d = Number(b.dataset.day);
      if (days.has(d)) days.delete(d); else days.add(d);
      b.classList.toggle('on', days.has(d));
    }),
  );

  const pauseToggle = q<HTMLButtonElement>(wrap, '#pause-toggle');
  pauseToggle.addEventListener('click', () => {
    paused = !paused;
    setToggle(pauseToggle, paused);
  });

  const offInput = q<HTMLInputElement>(wrap, '#off-time');
  const countdownSel = q<HTMLSelectElement>(wrap, '#countdown');
  const note = q<HTMLElement>(wrap, '#agent-note');
  const saveMsg = q<HTMLElement>(wrap, '#save-msg');

  // The off time / countdown live on the PC agent, so they can only be edited
  // once its state has been received (see sendAgentConfig).
  function syncAgentControls(): void {
    const ready = !!state.agent;
    offInput.disabled = !ready;
    countdownSel.disabled = !ready;
    note.textContent = ready ? '' : 'เวลาปิดคอมและการนับถอยหลังตั้งได้หลังเชื่อมต่อกับ agent บนคอมแล้ว';
  }
  syncAgentControls();
  const unsub = subscribe(() => {
    if (!wrap.isConnected) { unsub(); return; }
    syncAgentControls();
  });

  q(wrap, '#save-btn').addEventListener('click', async () => {
    const dayList = [...days].sort((a, b) => a - b);
    const on = q<HTMLInputElement>(wrap, '#on-time').value || sched.on;
    publishSchedule({ days: dayList, on, paused, tz: localTz() });

    let msg = 'บันทึกแล้ว';
    if (state.agent) {
      const patch = {
        days: dayList,
        off: offInput.value || offValue,
        countdown: Number(countdownSel.value),
        paused,
      };
      patchAgentLocal(patch);
      const sent = await sendAgentConfig(patch);
      if (!sent) msg = 'บันทึกเวลาเปิดแล้ว แต่ส่งให้ agent ไม่สำเร็จ';
    }
    saveMsg.textContent = msg;
    window.setTimeout(() => nav('home'), 600);
  });

  return wrap;
}
