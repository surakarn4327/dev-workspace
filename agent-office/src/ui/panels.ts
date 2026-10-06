// Side panels and the header tracker: inspector, courier queue, event feed, workflow steps.
// Everything is rendered from keys at display time, so a language switch re-labels it all (feed included).

import { getLang, onLangChange, t, tr } from '../core/i18n.ts';
import { DEPT_COLOR, ROSTER, blurbOf, modelOf, nameOf, roleOf } from '../core/roster.ts';
import type { OfficeStore } from '../core/state.ts';
import { describeEvent } from '../core/state.ts';
import type { AgentId, OfficeEvent, Stage } from '../core/types.ts';
import { WORK_STAGES } from '../core/types.ts';
import type { OfficeView } from '../render/view.ts';
import { drawPortrait } from '../render/view.ts';
import { el, h } from './dom.ts';

const FEED_LIMIT = 80;

interface FeedItem {
  e: OfficeEvent;
  at: number;
}

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** "5 h 12 min (around 14:00)" until the quota resets. */
export function deliveryIn(resetAt: number, now: number = Date.now()): string {
  const minutes = Math.max(1, Math.round((resetAt - now) / 60_000));
  const at = new Date(resetAt).toLocaleTimeString(getLang() === 'th' ? 'th-TH' : 'en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? t('usage.in.hm', { h, m, at }) : t('usage.in.m', { m, at });
}

export function mountPanels(store: OfficeStore, view: OfficeView): { onEvent: (e: OfficeEvent) => void; refresh: () => void } {
  const stepsEl = el<HTMLOListElement>('#steps');
  const jobTitle = el<HTMLSpanElement>('#job-title');
  const inspector = el<HTMLElement>('#inspector');
  const queueEl = el<HTMLUListElement>('#queue');
  const feedEl = el<HTMLUListElement>('#feed');
  const born = Date.now();
  const feed: FeedItem[] = []; // newest first

  const buildSteps = (): void => {
    stepsEl.replaceChildren();
    WORK_STAGES.forEach((stage, i) => {
      const li = h('li', 'step');
      li.dataset.stage = stage;
      li.title = t(`step.${stage}`);
      li.append(h('span', 'n', String(i + 1)), h('span', 'l', t(`step.${stage}`)));
      stepsEl.append(li);
    });
  };

  const renderSteps = (): void => {
    const cur = store.state.stage;
    const idx = WORK_STAGES.indexOf(cur as Stage);
    stepsEl.querySelectorAll<HTMLLIElement>('.step').forEach((li, i) => {
      li.classList.toggle('done', cur === 'done' || (idx >= 0 && i < idx));
      li.classList.toggle('current', idx === i);
    });
  };

  const renderJob = (): void => {
    const job = store.state.job;
    if (job) jobTitle.textContent = job.title;
    else if (store.state.stage === 'brief') jobTitle.textContent = t('hud.briefing');
    else jobTitle.textContent = t('hud.noJob');
  };

  const renderQueue = (): void => {
    const s = store.state;
    queueEl.replaceChildren();
    const carrying = s.agents.courier.carrying;
    if (carrying) queueEl.append(h('li', 'carrying', t('queue.carrying', { label: carrying })));
    for (const doc of s.queue) {
      queueEl.append(h('li', undefined, `${tr(doc.label)}  ${nameOf(doc.from)} → ${nameOf(doc.to)}`));
    }
    if (!queueEl.children.length) queueEl.append(h('li', 'empty', t('queue.empty')));
  };

  const renderInspector = (): void => {
    inspector.replaceChildren();
    const id: AgentId | null = view.selected;
    if (!id) {
      inspector.append(h('h2', undefined, t('inspector.title')), h('p', 'hint', t('inspector.hint')));
      return;
    }
    const def = ROSTER[id];
    const st = store.state.agents[id];
    const head = h('div', 'insp-head');
    const portrait = h('canvas', 'portrait small');
    drawPortrait(portrait, id);
    const who = h('div', 'who');
    const name = h('div', 'name', def.name);
    const role = h('div', 'role', roleOf(id));
    role.style.color = DEPT_COLOR[def.dept];
    who.append(name, role);
    head.append(portrait, who);

    const chips = h('div', 'chips');
    chips.append(h('span', `chip act-${st.activity}`, t(`act.${st.activity}`)));
    if (st.inbox > 0) chips.append(h('span', 'chip', t('inspector.inbox', { n: st.inbox })));
    if (st.carrying) chips.append(h('span', 'chip', t('inspector.carrying', { label: st.carrying })));

    const rows = h('dl', 'kv');
    const kv = (k: string, v: string): void => {
      rows.append(h('dt', undefined, k), h('dd', undefined, v));
    };
    kv(t('inspector.doing'), st.note ? tr(st.note) : '—');
    kv(t('inspector.model'), modelOf(id));
    // The day's use of the free AI quota, told as printing: each model call is a page from the lobby printer.
    const { usage } = store.state.infra;
    const printed = usage.byAgent[id] ?? 0;
    if (id !== 'courier') kv(t('inspector.today'), printed > 0 ? t('usage.agent', { n: printed }) : t('usage.agent.none'));
    else {
      // Zip brings the paper, so Zip's card is where the whole office's use and the next delivery show.
      kv(t('inspector.today'), t('usage.zip.total', { n: usage.calls, k: Math.round(usage.tokens / 1000) }));
      const paper = store.state.paper;
      const when = deliveryIn(usage.resetAt);
      kv(t('inspector.paper'), paper.due ? t('usage.zip.due') : paper.empty ? t('usage.zip.empty', { when }) : t('usage.zip.next', { when }));
    }

    const convo = h('ul', 'convo');
    const mine = store.state.log.filter((l) => l.from === id || l.to === id).slice(-8);
    for (const line of mine) {
      const li = h('li');
      li.append(h('b', undefined, `${nameOf(line.from)}${line.to ? ` → ${nameOf(line.to)}` : ''}: `), tr(line.text));
      convo.append(li);
    }
    if (!mine.length) convo.append(h('li', 'empty', t('inspector.noConvos')));

    inspector.append(head, chips, h('p', 'blurb', blurbOf(id)), rows, h('h3', undefined, t('inspector.convos')), convo);
  };

  const renderFeed = (): void => {
    feedEl.replaceChildren();
    for (const { e, at } of feed) {
      const text = describeEvent(e);
      if (!text) continue;
      const li = h('li');
      li.append(h('time', undefined, clock(at - born)), ` ${text}`);
      if (e.type === 'review.verdict') li.classList.add(e.verdict);
      if (e.type === 'agent.activity') li.classList.add('reject');
      if (e.type === 'job.stage' || e.type === 'job.created' || e.type === 'job.done') li.classList.add('stage');
      feedEl.append(li);
    }
  };

  const renderAll = (): void => {
    renderSteps();
    renderJob();
    renderQueue();
    renderInspector();
  };

  let scheduled = false;
  const refresh = (): void => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      renderAll();
    });
  };
  store.subscribe(refresh);
  buildSteps();
  refresh();

  // Switching language re-renders immediately (no waiting for the next frame or event).
  onLangChange(() => {
    buildSteps();
    renderAll();
    renderFeed();
  });

  const onEvent = (e: OfficeEvent): void => {
    if (e.type === 'sim.reset') feed.length = 0;
    if (!describeEvent(e)) return;
    feed.unshift({ e, at: Date.now() });
    feed.length = Math.min(feed.length, FEED_LIMIT);
    renderFeed();
  };

  return { onEvent, refresh };
}
