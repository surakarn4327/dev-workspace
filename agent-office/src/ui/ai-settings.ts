// The "AI settings" panel in the Menu drawer: paste a Gemini key, save it, remove it.
// The key never goes back into the page: the field is cleared after saving and the status
// line only says whether a key exists.

import { clearKey, hasKey, saveKey } from '../core/ai-settings.ts';
import type { KeyStore } from '../core/ai-settings.ts';
import { t } from '../core/i18n.ts';
import { el } from './dom.ts';

type Flash = 'empty' | 'failed' | null;

export function mountAiSettings(store?: KeyStore | null): { refresh(): void } {
  const input = el<HTMLInputElement>('#ai-key');
  const status = el<HTMLElement>('#ai-status');
  const saveBtn = el<HTMLButtonElement>('#ai-save');
  const removeBtn = el<HTMLButtonElement>('#ai-remove');
  let flash: Flash = null;

  function refresh(): void {
    const saved = hasKey(store);
    removeBtn.disabled = !saved;
    status.textContent = flash ? t(`ai.status.${flash}`) : t(saved ? 'ai.status.saved' : 'ai.status.none');
    status.classList.toggle('warn', flash !== null);
  }

  function save(): void {
    const result = saveKey(input.value, store);
    flash = result === 'saved' ? null : result;
    if (result === 'saved') input.value = ''; // the key is not kept on screen
    refresh();
  }

  saveBtn.addEventListener('click', save);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') save();
  });
  removeBtn.addEventListener('click', () => {
    clearKey(store);
    flash = null;
    input.value = '';
    refresh();
  });
  input.addEventListener('input', () => {
    if (flash) {
      flash = null;
      refresh();
    }
  });

  refresh();
  return { refresh };
}
