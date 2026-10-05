import { checkMenu, nearby, parseInput, suggest } from '../engine/check';
import type { Check, Data, Menu, RowResult, Verdict } from '../engine/types';

let d: Data;
const DIET_CHIP = 'กลืนแร่';

const ACCENTS: { id: string; name: string; color: string }[] = [
  { id: 'sage', name: 'เขียว', color: '#5e8c61' },
  { id: 'blue', name: 'ฟ้า', color: '#5b7f9a' },
  { id: 'rose', name: 'ชมพู', color: '#a8697a' },
  { id: 'clay', name: 'ส้ม', color: '#b4795a' },
];

interface Theme {
  mode: 'light' | 'dark';
  accent: string;
}

function loadTheme(): Theme {
  let saved: Partial<Theme> = {};
  try {
    saved = JSON.parse(localStorage.getItem('theme') ?? '{}');
  } catch {
    /* storage may be blocked */
  }
  return {
    mode: saved.mode ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
    accent: ACCENTS.some((a) => a.id === saved.accent) ? saved.accent! : 'sage',
  };
}

const theme = loadTheme();

function applyTheme(): void {
  document.documentElement.dataset.mode = theme.mode;
  document.documentElement.dataset.accent = theme.accent;
  try {
    localStorage.setItem('theme', JSON.stringify(theme));
  } catch {
    /* storage may be blocked */
  }
}

applyTheme();

interface State {
  query: string;
  chipOn: boolean;
  infoOpen: boolean;
  themeOpen: boolean;
  notFound: string | null;
}

const state: State = { query: '', chipOn: true, infoOpen: false, themeOpen: false, notFound: null };
const root = document.getElementById('app')!;
let slideTimer: number | undefined;

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const cssUrl = (u: string): string => `url('${encodeURI(u).replace(/'/g, '%27')}')`;

const VERDICT_TEXT: Record<Verdict, string> = { ok: 'ทานได้', no: 'ไม่ควรทาน', unsure: 'ไม่แน่ใจ ควรเลี่ยง' };

function route(): { menu: Menu; protein: string | null } | null {
  const m = location.hash.match(/^#\/r\/([^/]+)(?:\/(.+))?$/);
  if (!m) return null;
  const menu = d.menus.find((x) => x.name === decodeURIComponent(m[1]));
  if (!menu) return null;
  return { menu, protein: m[2] ? decodeURIComponent(m[2]) : null };
}

function go(menu: Menu, protein: string | null): void {
  location.hash = `#/r/${encodeURIComponent(menu.name)}${protein ? '/' + encodeURIComponent(protein) : ''}`;
}

function infoSheet(menu: Menu | null): string {
  const img = menu?.image;
  return `<div class="sheet-bg" data-act="close-info"><div class="sheet" data-stop>
    <h3>ข้อมูลนี้ไม่ใช่คำแนะนำทางการแพทย์</h3>
    <p>กรุณายึดคำสั่งของแพทย์เป็นหลัก และตรวจฉลากสินค้าปัจจุบันก่อนซื้อทุกครั้ง</p>
    <h3>แหล่งข้อมูล</h3>
    <p>คู่มืออาหารไอโอดีนต่ำ ภาควิชารังสีวิทยา คณะแพทยศาสตร์โรงพยาบาลรามาธิบดี และแนวทางของ Memorial Sloan Kettering Cancer Center</p>
    ${img ? `<h3>ที่มาของภาพ</h3><p>${esc(img.creator || 'ไม่ระบุผู้เผยแพร่')} · ${esc(img.license)} · <a href="${esc(img.page)}" target="_blank" rel="noopener">ดูต้นฉบับ</a></p>` : ''}
    <button class="close" data-act="close-info">ปิด</button>
  </div></div>`;
}

const tools = (): string =>
  `<div class="tools"><button class="info theme" data-act="open-theme" aria-label="เลือกธีม">◐</button><button class="info" data-act="open-info" aria-label="ข้อมูลและที่มา">i</button></div>`;

function themeSheet(): string {
  return `<div class="sheet-bg" data-act="close-theme"><div class="sheet" data-stop>
    <h3>โหมดหน้าจอ</h3>
    <div class="group"><button class="mode ${theme.mode === 'light' ? 'on' : ''}" data-set-mode="light">สว่าง</button><button class="mode ${theme.mode === 'dark' ? 'on' : ''}" data-set-mode="dark">มืด</button></div>
    <h3 style="margin-top:18px">สี</h3>
    <div class="group">${ACCENTS.map((a) => `<button class="swatch ${a.id === theme.accent ? 'on' : ''}" data-set-accent="${a.id}" style="background:${a.color}" aria-label="${a.name}"></button>`).join('')}</div>
    <button class="close" data-act="close-theme">ปิด</button>
  </div></div>`;
}

function nav(active: 'home' | 'library'): string {
  return `<div class="nav"><button class="${active === 'home' ? 'on' : ''}" data-act="home">หน้าแรก</button><button class="${active === 'library' ? 'on' : ''}" data-act="library">คลังข้อมูล</button></div>`;
}

function homeView(): string {
  const sugg = suggest(d, state.query);
  const withImg = d.menus.filter((m) => m.image);
  return `<div class="page">
    <div class="top"><h1>กินอะไร"ดี"</h1>${tools()}</div>
    <div class="search">
      <input id="q" value="${esc(state.query)}" placeholder="ชื่อเมนู" autocomplete="off" enterkeyhint="search" />
      ${state.query ? '<button class="clear" data-act="clear" aria-label="ล้าง">✕</button>' : ''}
    </div>
    ${sugg.length ? `<div class="suggest">${sugg.map((s) => `<button data-pick="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
    ${state.notFound ? `<p class="reasons" style="text-align:center">ไม่พบเมนู "${esc(state.notFound)}" ในฐานข้อมูล</p>` : ''}
    <h2>โรคหรือการรักษาที่ต้องควบคุมอาหาร</h2>
    <div class="chips"><button class="chip ${state.chipOn ? 'on' : ''}" data-act="chip">${DIET_CHIP}</button></div>
    <button class="dice" data-act="random">
      <div class="plate"><div class="track" id="track">${[...withImg, withImg[0]].filter(Boolean).map((m) => `<div style="background-image:${cssUrl(m.image!.url)}"></div>`).join('')}</div></div>
      <b>สุ่มเมนูอาหาร</b>
    </button>
  </div>
  <button class="cta" data-act="check">ตรวจเมนู</button>
  ${nav('home')}`;
}

function libraryView(): string {
  return `<div class="page"><div class="top"><h1>คลังข้อมูล</h1></div><p class="empty">อยู่ระหว่างจัดทำ</p></div>${nav('library')}`;
}

function rowHtml(r: RowResult, diet: boolean): string {
  if (!diet) return `<div class="row"><div class="n">${esc(r.ingredient)}</div></div>`;
  if (r.kind === 'brand') {
    const list = r.brands?.length
      ? `<ul>${r.brands.map((b) => `<li>${esc(b.brand)}${[...b.variants, ...b.notes].length ? ` (${esc([...b.variants, ...b.notes].join(' / '))})` : ''}</li>`).join('')}</ul>`
      : `<p class="none">${esc(r.reason ?? 'ต้องเลือกชนิดที่ไม่เสริมไอโอดีน')}</p>`;
    return `<div class="brand"><div class="head"><div class="n" style="font-size:17px;font-weight:600">${esc(r.ingredient)}</div><span class="tag warn">เลือกยี่ห้อ</span></div>${list}</div>`;
  }
  const tag: Record<string, [string, string]> = {
    ok: ['ทานได้', ''],
    limit: ['ไม่ควรทานมาก', 'warn'],
    swap: ['เปลี่ยนวัตถุดิบ', 'warn'],
    omit: ['ไม่ใส่', 'warn'],
    unknown: ['ไม่แน่ใจ', 'warn'],
    banned: ['ห้ามทาน', 'bad'],
  };
  const [label, cls] = tag[r.kind];
  return `<div class="row"><div><div class="n">${esc(r.ingredient)}</div>${r.kind === 'ok' || r.kind === 'limit' ? '' : `<div class="use">${esc(r.use)}</div>`}</div><span class="tag ${cls}">${label}</span></div>`;
}

// Anything that is not plainly edible comes first, then "eat sparingly", then edible.
const ROW_ORDER: Record<RowResult['kind'], number> = { banned: 0, unknown: 1, swap: 2, omit: 3, brand: 4, limit: 5, ok: 6 };
const sortRows = (rows: RowResult[]): RowResult[] => [...rows].sort((a, b) => ROW_ORDER[a.kind] - ROW_ORDER[b.kind]);

function resultView(menu: Menu, protein: string | null): string {
  const diet = state.chipOn;
  const check: Check = checkMenu(d, menu, protein);
  const hasOptions = check.byProtein.length > 0;
  const showNear = diet && check.verdict !== 'ok';
  const variants = showNear ? check.byProtein.filter((b) => b.verdict === 'ok' && b.option !== protein).slice(0, 3) : [];
  const near = showNear && !variants.length ? nearby(d, menu) : [];
  const pill = diet ? `<div class="verdict"><span class="pill ${check.verdict === 'ok' ? '' : check.verdict}">${DIET_CHIP} : ${VERDICT_TEXT[check.verdict]}</span>${check.verdict !== 'ok' && check.reasons.length ? `<p class="reasons">${check.reasons.map(esc).join('<br>')}</p>` : ''}</div>` : '';
  const options = hasOptions
    ? `<div class="options">${check.byProtein.map((b) => `<button class="opt ${b.option === protein ? 'on' : ''}" data-opt="${esc(b.option)}">${diet ? `<i class="${b.verdict === 'ok' ? '' : b.verdict}"></i>` : ''}${esc(b.option)}</button>`).join('')}</div>`
    : '';
  return `<div class="page">
    <div class="top"><button class="back" data-act="home">‹ กลับ</button>${tools()}</div>
    <div class="hero"><div class="dish" ${menu.image ? `style="background-image:${cssUrl(menu.image.url)}"` : ''}>${menu.image ? '' : 'ยังไม่มีรูปเมนูนี้'}</div></div>
    <h1 class="title">${esc(menu.name)}${protein && !/^ไม่/.test(protein) ? ` <span style="font-weight:500">(${esc(protein)})</span>` : ''}</h1>
    ${pill}${options}
    <h2>วัตถุดิบทั้งหมด</h2>
    ${(diet ? sortRows(check.rows) : check.rows).map((r) => rowHtml(r, diet)).join('')}
    ${variants.length ? `<h2>เมนูใกล้เคียงที่ทานได้</h2>${variants.map((v) => `<button class="near" data-go="${esc(menu.name)}" data-protein="${esc(v.option)}"><div class="plate" ${menu.image ? `style="background-image:${cssUrl(menu.image.url)}"` : ''}></div>${esc(menu.name + v.option)}</button>`).join('')}` : ''}
    ${near.length ? `<h2>เมนูใกล้เคียงที่ทานได้</h2>${near.map((m) => `<button class="near" data-go="${esc(m.name)}"><div class="plate" ${m.image ? `style="background-image:${cssUrl(m.image.url)}"` : ''}></div>${esc(m.name)}</button>`).join('')}` : ''}
  </div>
  ${nav('home')}`;
}

function notFoundView(text: string): string {
  return `<div class="page">
    <div class="top"><button class="back" data-act="home">‹ กลับ</button>${tools()}</div>
    <div class="hero"><div class="dish">ยังไม่มีรูปเมนูนี้</div></div>
    <h1 class="title">${esc(text)}</h1>
    <div class="verdict"><span class="pill unsure">${DIET_CHIP} : ไม่แน่ใจ ควรเลี่ยง</span><p class="reasons">ยังไม่มีเมนูนี้ในฐานข้อมูล จึงตรวจวัตถุดิบไม่ได้ เมื่อไม่แน่ใจจะถือว่ายังไม่ผ่าน</p></div>
  </div>
  ${nav('home')}`;
}

function startSlides(): void {
  window.clearInterval(slideTimer);
  const track = document.getElementById('track');
  if (!track || track.children.length < 2) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const count = track.children.length;
  let i = 0;
  slideTimer = window.setInterval(() => {
    i++;
    track.style.transition = 'transform .5s ease';
    track.style.transform = `translateX(-${i * 84}px)`;
    if (i === count - 1) {
      window.setTimeout(() => {
        track.style.transition = 'none';
        track.style.transform = 'translateX(0)';
        i = 0;
      }, 520);
    }
  }, 2000);
}

/** With a diet chip on, only menus (and protein choices) that pass; otherwise every menu. */
function randomPool(): { menu: Menu; protein: string | null }[] {
  if (!state.chipOn) return d.menus.map((menu) => ({ menu, protein: null }));
  const pool: { menu: Menu; protein: string | null }[] = [];
  for (const menu of d.menus) {
    const c = checkMenu(d, menu, null);
    if (c.byProtein.length) {
      for (const b of c.byProtein) if (b.verdict === 'ok') pool.push({ menu, protein: b.option });
    } else if (c.verdict === 'ok') {
      pool.push({ menu, protein: null });
    }
  }
  return pool;
}

let page: 'home' | 'library' | 'notfound' = 'home';
let notFoundText = '';

export function start(data: Data): void {
  d = data;
  render();
}

export function render(): void {
  window.clearInterval(slideTimer);
  const r = route();
  let html: string;
  let menu: Menu | null = null;
  if (r) {
    menu = r.menu;
    html = resultView(r.menu, r.protein);
  } else if (page === 'notfound') {
    html = notFoundView(notFoundText);
  } else if (page === 'library') {
    html = libraryView();
  } else {
    html = homeView();
  }
  root.innerHTML = html + (state.infoOpen ? infoSheet(menu) : '') + (state.themeOpen ? themeSheet() : '');
  startSlides();
  const q = document.getElementById('q') as HTMLInputElement | null;
  if (q && document.activeElement === document.body && state.query) {
    q.focus();
    q.setSelectionRange(q.value.length, q.value.length);
  }
}

function submit(text: string): void {
  const t = text.trim();
  if (!t) return;
  const parsed = parseInput(d, t);
  if (parsed) {
    state.notFound = null;
    go(parsed.menu, parsed.protein);
  } else if (state.chipOn) {
    page = 'notfound';
    notFoundText = t;
    if (location.hash) location.hash = '';
    else render();
  } else {
    state.notFound = t;
    render();
  }
}

root.addEventListener('input', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id !== 'q') return;
  state.query = el.value;
  state.notFound = null;
  const pos = el.selectionStart;
  render();
  const q = document.getElementById('q') as HTMLInputElement;
  q.focus();
  q.setSelectionRange(pos, pos);
});

root.addEventListener('keydown', (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id === 'q' && e.key === 'Enter') submit(el.value);
});

root.addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  const inSheet = target.closest('[data-stop]');
  const modeBtn = target.closest<HTMLElement>('[data-set-mode]');
  const accentBtn = target.closest<HTMLElement>('[data-set-accent]');
  if (modeBtn || accentBtn) {
    if (modeBtn) theme.mode = modeBtn.dataset.setMode as Theme['mode'];
    if (accentBtn) theme.accent = accentBtn.dataset.setAccent!;
    applyTheme();
    render();
    return;
  }
  if (inSheet && !target.closest('[data-act="close-info"]') && !target.closest('[data-act="close-theme"]')) return;
  const pick = target.closest<HTMLElement>('[data-pick]');
  const opt = target.closest<HTMLElement>('[data-opt]');
  const goto = target.closest<HTMLElement>('[data-go]');
  const act = target.closest<HTMLElement>('[data-act]')?.dataset.act;
  if (pick) {
    state.query = pick.dataset.pick!;
    submit(state.query);
  } else if (opt) {
    const r = route();
    if (r) go(r.menu, opt.dataset.opt!);
  } else if (goto) {
    const m = d.menus.find((x) => x.name === goto.dataset.go);
    if (m) go(m, goto.dataset.protein ?? null);
  } else if (act === 'check') submit(state.query);
  else if (act === 'clear') {
    state.query = '';
    state.notFound = null;
    render();
  } else if (act === 'chip') {
    state.chipOn = !state.chipOn;
    render();
  } else if (act === 'random') {
    const pool = randomPool();
    const pick = pool[Math.floor(Math.random() * pool.length)];
    go(pick.menu, pick.protein);
  } else if (act === 'open-theme' || act === 'close-theme') {
    state.themeOpen = act === 'open-theme';
    render();
  } else if (act === 'open-info' || act === 'close-info') {
    state.infoOpen = act === 'open-info';
    render();
  } else if (act === 'home' || act === 'library') {
    page = act;
    if (location.hash) location.hash = '';
    else render();
  }
});

window.addEventListener('hashchange', () => {
  if (route()) page = 'home';
  window.scrollTo(0, 0);
  render();
});
