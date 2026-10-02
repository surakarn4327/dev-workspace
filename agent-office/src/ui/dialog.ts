// RPG-style conversation box. It shows whichever chat the store says is open,
// types the text out, and sends the user's reply back to the event source.

import { ROSTER } from '../core/roster.ts';
import type { OfficeStore } from '../core/state.ts';
import type { OfficeSource } from '../core/types.ts';
import { drawPortrait } from '../render/view.ts';
import { el, h } from './dom.ts';

const TYPE_MS = 16;

export function mountDialog(store: OfficeStore, source: OfficeSource): void {
  const root = el<HTMLDivElement>('#dialog');
  const portrait = el<HTMLCanvasElement>('#dlg-portrait');
  const nameEl = el<HTMLDivElement>('#dlg-name');
  const textEl = el<HTMLDivElement>('#dlg-text');
  const choicesEl = el<HTMLDivElement>('#dlg-choices');
  const form = el<HTMLFormElement>('#dlg-form');
  const input = el<HTMLInputElement>('#dlg-input');

  let currentId: string | null = null;
  let fullText = '';
  let shown = 0;
  let timer = 0;

  // The not-yet-typed remainder stays in the layout (invisible) so the box doesn't jump in size.
  const renderText = (): void => {
    textEl.replaceChildren(
      h('span', undefined, fullText.slice(0, shown)),
      h('span', 'ghost', fullText.slice(shown)),
    );
  };

  const finishTyping = (): void => {
    window.clearInterval(timer);
    shown = fullText.length;
    renderText();
    choicesEl.classList.remove('pending');
  };

  const send = (text: string): void => {
    const id = currentId;
    const value = text.trim();
    if (!id || !value) return;
    source.answer(id, value);
  };

  const open = (): void => {
    const chat = store.state.chat;
    if (!chat) return;
    currentId = chat.id;
    const def = ROSTER[chat.from];
    nameEl.textContent = `${def.name} · ${def.role}`;
    drawPortrait(portrait, chat.from, true);
    input.value = '';
    input.placeholder = chat.placeholder ?? 'Type your answer...';
    fullText = chat.text;
    shown = 0;
    renderText();
    choicesEl.replaceChildren();
    choicesEl.classList.add('pending');
    for (const choice of chat.choices ?? []) {
      const b = h('button', 'btn choice', choice);
      b.type = 'button';
      b.addEventListener('click', () => send(choice));
      choicesEl.append(b);
    }
    // The secretary talks to you at the reception mat (bottom), so keep the box out of the way.
    root.classList.toggle('top', chat.from === 'secretary');
    root.classList.remove('hidden');
    window.clearInterval(timer);
    timer = window.setInterval(() => {
      shown += 1;
      renderText();
      if (shown >= fullText.length) {
        finishTyping();
        input.focus({ preventScroll: true });
      }
    }, TYPE_MS);
  };

  const close = (): void => {
    currentId = null;
    window.clearInterval(timer);
    root.classList.add('hidden');
  };

  store.subscribe(() => {
    const chat = store.state.chat;
    if (chat && chat.id !== currentId) open();
    else if (!chat && currentId) close();
  });

  textEl.addEventListener('click', () => {
    if (shown < fullText.length) finishTyping();
  });
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    send(input.value);
  });
}
