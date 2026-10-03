// RPG-style conversation box. It shows whichever chat the store says is open,
// types the text out, and sends the user's reply back to the event source.

import { onLangChange, t, tr } from '../core/i18n.ts';
import { ROSTER, roleOf } from '../core/roster.ts';
import type { OfficeStore } from '../core/state.ts';
import type { ChatReply, OfficeSource } from '../core/types.ts';
import { drawPortrait } from '../render/view.ts';
import { el, h } from './dom.ts';

const TYPE_MS = 16;

/** The ✕ cancels: the source drops the question (or abandons the job), nobody keeps waiting. */
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

  const send = (reply: ChatReply): void => {
    const id = currentId;
    if (!id) return;
    if ('text' in reply) {
      const value = reply.text.trim();
      if (!value) return;
      source.answer(id, { text: value });
    } else {
      source.answer(id, reply);
    }
  };

  /** The language-dependent bits, rebuilt on a language switch without retyping or losing the typed answer. */
  const renderLabels = (): void => {
    const chat = store.state.chat;
    if (!chat) return;
    nameEl.textContent = `${ROSTER[chat.from].name} · ${roleOf(chat.from)}`;
    input.placeholder = chat.placeholder ? tr(chat.placeholder) : t('dlg.placeholder');
    const buttons = choicesEl.querySelectorAll<HTMLButtonElement>('button');
    (chat.choices ?? []).forEach((c, i) => {
      if (buttons[i]) buttons[i].textContent = tr(c.label);
    });
  };

  const open = (): void => {
    const chat = store.state.chat;
    if (!chat) return;
    currentId = chat.id;
    drawPortrait(portrait, chat.from, true);
    input.value = '';
    fullText = tr(chat.text);
    shown = 0;
    renderText();
    // While the agent is working out a reply there is nothing to answer: no input, no buttons, just the close button.
    root.classList.toggle('thinking', chat.thinking === true);
    choicesEl.replaceChildren();
    choicesEl.classList.add('pending');
    for (const c of chat.choices ?? []) {
      const b = h('button', 'btn choice');
      b.type = 'button';
      b.addEventListener('click', () => send({ choice: c.id }));
      choicesEl.append(b);
    }
    renderLabels();
    // The secretary talks to you at the reception mat (bottom), so keep the box out of the way.
    root.classList.toggle('top', chat.from === 'secretary');
    root.classList.remove('hidden');
    window.clearInterval(timer);
    timer = window.setInterval(() => {
      shown += 1;
      renderText();
      if (shown >= fullText.length) {
        finishTyping();
        if (!root.classList.contains('thinking')) input.focus({ preventScroll: true });
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
    // A "thinking" box can change its words (thinking -> waiting for quota) without changing id.
    if (chat && (chat.id !== currentId || (chat.thinking && tr(chat.text) !== fullText))) open();
    else if (!chat && currentId) close();
  });

  el<HTMLButtonElement>('#dlg-close').addEventListener('click', () => {
    if (currentId) source.cancel(currentId);
  });

  textEl.addEventListener('click', () => {
    if (shown < fullText.length) finishTyping();
  });
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    send({ text: input.value });
  });

  // Switching language mid-question: swap the words, keep the typing progress and the typed answer.
  onLangChange(() => {
    const chat = store.state.chat;
    if (!chat || chat.id !== currentId) return;
    fullText = tr(chat.text);
    shown = Math.min(shown, fullText.length);
    renderText();
    renderLabels();
    if (shown >= fullText.length) finishTyping();
  });
}
