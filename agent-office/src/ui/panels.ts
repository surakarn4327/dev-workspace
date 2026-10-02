// Side panels and the header tracker: inspector, courier queue, event feed, workflow steps.

import { DEPT_COLOR, ROSTER, nameOf } from '../core/roster.ts';
import type { OfficeStore } from '../core/state.ts';
import { describeEvent } from '../core/state.ts';
import type { AgentId, OfficeEvent, Stage } from '../core/types.ts';
import { WORK_STAGES } from '../core/types.ts';
import type { OfficeView } from '../render/view.ts';
import { drawPortrait } from '../render/view.ts';
import { el, h } from './dom.ts';

const STEP_LABEL: Record<string, string> = {
  brief: 'Brief',
  approval: 'Approve',
  meeting: 'Meeting',
  team: 'Team',
  work: 'Work',
  review: 'Review',
  delivery: 'Deliver',
};

const ACTIVITY_LABEL: Record<string, string> = {
  idle: 'Idle',
  typing: 'Working',
  thinking: 'Thinking',
  talking: 'Talking',
  reviewing: 'Reviewing',
  waiting: 'Waiting',
  error: 'Error!',
  celebrate: 'Celebrating',
};

function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function mountPanels(store: OfficeStore, view: OfficeView): { onEvent: (e: OfficeEvent) => void; refresh: () => void } {
  const stepsEl = el<HTMLOListElement>('#steps');
  const jobTitle = el<HTMLSpanElement>('#job-title');
  const inspector = el<HTMLElement>('#inspector');
  const queueEl = el<HTMLUListElement>('#queue');
  const feedEl = el<HTMLUListElement>('#feed');
  const born = Date.now();

  WORK_STAGES.forEach((stage, i) => {
    const li = h('li', 'step');
    li.dataset.stage = stage;
    li.append(h('span', 'n', String(i + 1)), h('span', 'l', STEP_LABEL[stage]));
    stepsEl.append(li);
  });

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
    else if (store.state.stage === 'brief') jobTitle.textContent = 'Talking to Rex about the order...';
    else jobTitle.textContent = 'No active job — press Start or click Rex';
  };

  const renderQueue = (): void => {
    const s = store.state;
    queueEl.replaceChildren();
    const carrying = s.agents.courier.carrying;
    if (carrying) queueEl.append(h('li', 'carrying', `Carrying: ${carrying}`));
    for (const doc of s.queue) {
      queueEl.append(h('li', undefined, `${doc.label}  ${nameOf(doc.from)} → ${nameOf(doc.to)}`));
    }
    if (!queueEl.children.length) queueEl.append(h('li', 'empty', 'Queue is empty'));
  };

  const renderInspector = (): void => {
    inspector.replaceChildren();
    const id: AgentId | null = view.selected;
    if (!id) {
      inspector.append(
        h('h2', undefined, 'Inspector'),
        h('p', 'hint', 'Click a character to see what they are doing and their conversations.'),
      );
      return;
    }
    const def = ROSTER[id];
    const st = store.state.agents[id];
    const head = h('div', 'insp-head');
    const portrait = h('canvas', 'portrait small');
    drawPortrait(portrait, id);
    const who = h('div', 'who');
    const name = h('div', 'name', def.name);
    const role = h('div', 'role', def.role);
    role.style.color = DEPT_COLOR[def.dept];
    who.append(name, role);
    head.append(portrait, who);

    const chips = h('div', 'chips');
    chips.append(h('span', `chip act-${st.activity}`, ACTIVITY_LABEL[st.activity] ?? st.activity));
    if (st.inbox > 0) chips.append(h('span', 'chip', `Inbox ${st.inbox}`));
    if (st.carrying) chips.append(h('span', 'chip', `Carrying ${st.carrying}`));

    const rows = h('dl', 'kv');
    const kv = (k: string, v: string): void => {
      rows.append(h('dt', undefined, k), h('dd', undefined, v));
    };
    kv('Doing', st.note || '—');
    kv('Model', def.model);

    const convo = h('ul', 'convo');
    const mine = store.state.log.filter((l) => l.from === id || l.to === id).slice(-8);
    for (const line of mine) {
      const li = h('li');
      li.append(h('b', undefined, `${nameOf(line.from)}${line.to ? ` → ${nameOf(line.to)}` : ''}: `), line.text);
      convo.append(li);
    }
    if (!mine.length) convo.append(h('li', 'empty', 'No conversations yet'));

    inspector.append(head, chips, h('p', 'blurb', def.blurb), rows, h('h3', undefined, 'Conversations'), convo);
  };

  let scheduled = false;
  const refresh = (): void => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      renderSteps();
      renderJob();
      renderQueue();
      renderInspector();
    });
  };
  store.subscribe(refresh);
  refresh();

  const onEvent = (e: OfficeEvent): void => {
    const text = describeEvent(e);
    if (e.type === 'sim.reset') feedEl.replaceChildren();
    if (!text) return;
    const li = h('li');
    li.append(h('time', undefined, clock(Date.now() - born)), ` ${text}`);
    if (e.type === 'review.verdict') li.classList.add(e.verdict);
    if (e.type === 'agent.activity') li.classList.add('reject');
    if (e.type === 'job.stage' || e.type === 'job.created' || e.type === 'job.done') li.classList.add('stage');
    feedEl.prepend(li);
    while (feedEl.children.length > 80) feedEl.lastElementChild?.remove();
  };

  return { onEvent, refresh };
}
