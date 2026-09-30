import { escapeHtml, q, screenHeader } from '../dom';
import { patchAgentLocal, sendAgentCommand, sendAgentConfig, state, subscribe } from '../session';
import type { Nav } from '../nav';

export function renderPrograms(nav: Nav): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'screen sub';
  wrap.innerHTML = `
    ${screenHeader('โปรแกรม')}
    <section class="card">
      <h2>โปรแกรมที่เลือกไว้</h2>
      <div id="selected"></div>
      <p class="note">เปิดตอนคอมบูต และปิดตอนถึงเวลาปิดคอม</p>
    </section>
    <section class="card">
      <div class="card-head"><h2>เพิ่มโปรแกรม</h2><button class="icon-btn" id="rescan" aria-label="สแกนใหม่">↻</button></div>
      <input type="search" id="search" placeholder="ค้นหาโปรแกรม" autocomplete="off">
      <div id="catalog"></div>
    </section>
  `;

  q(wrap, '[data-back]').addEventListener('click', () => nav('home'));
  q(wrap, '#rescan').addEventListener('click', () => void sendAgentCommand('scan'));

  const selectedEl = q<HTMLDivElement>(wrap, '#selected');
  const catalogEl = q<HTMLDivElement>(wrap, '#catalog');
  const search = q<HTMLInputElement>(wrap, '#search');

  function ids(): string[] {
    return (state.agent?.selected ?? []).map((a) => a.id);
  }

  function apply(apps: string[]): void {
    patchAgentLocal({ apps });
    void sendAgentConfig({ apps });
  }

  function render(): void {
    const agent = state.agent;
    if (!agent) {
      const msg = state.agentLink === 'unpaired'
        ? 'ยังไม่ได้เชื่อมต่อกับ agent — ไปที่ "เชื่อมต่อกับคอม" ก่อน'
        : 'ยังไม่ได้รับรายการจากคอม เปิดคอมและ agent ก่อน';
      selectedEl.innerHTML = `<p class="empty">${msg}</p>`;
      catalogEl.innerHTML = '';
      return;
    }

    selectedEl.innerHTML = agent.selected.length === 0
      ? '<p class="empty">ยังไม่มีโปรแกรม</p>'
      : agent.selected.map((a, i) => `
        <div class="row">
          <span>${escapeHtml(a.name)}</span>
          <span class="row-actions">
            <button class="icon-btn" data-up="${i}" aria-label="ขึ้น"${i === 0 ? ' disabled' : ''}>▲</button>
            <button class="icon-btn" data-down="${i}" aria-label="ลง"${i === agent.selected.length - 1 ? ' disabled' : ''}>▼</button>
            <button class="icon-btn" data-remove="${a.id}" aria-label="เอาออก">✕</button>
          </span>
        </div>`).join('');

    const chosen = new Set(ids());
    const needle = search.value.trim().toLowerCase();
    const items = agent.catalog.filter((a) => !chosen.has(a.id) && a.name.toLowerCase().includes(needle));
    catalogEl.innerHTML = items.length === 0
      ? '<p class="empty">ไม่พบโปรแกรม</p>'
      : items.map((a) => `
        <div class="row">
          <span>${escapeHtml(a.name)}${a.running ? ' <small class="muted">(เปิดอยู่)</small>' : ''}</span>
          <button class="add-btn" data-add="${a.id}">เพิ่ม</button>
        </div>`).join('');
  }

  wrap.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLElement>('[data-add],[data-remove],[data-up],[data-down]');
    if (!t) return;
    const cur = ids();
    if (t.dataset.add) apply([...cur, t.dataset.add]);
    else if (t.dataset.remove) apply(cur.filter((x) => x !== t.dataset.remove));
    else {
      const i = Number(t.dataset.up ?? t.dataset.down);
      const j = t.dataset.up !== undefined ? i - 1 : i + 1;
      if (j >= 0 && j < cur.length) {
        [cur[i], cur[j]] = [cur[j], cur[i]];
        apply(cur);
      }
    }
  });
  search.addEventListener('input', render);

  const unsub = subscribe(() => {
    if (!wrap.isConnected) { unsub(); return; }
    render();
  });
  render();
  return wrap;
}
