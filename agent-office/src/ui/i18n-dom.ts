// Applies the current language to everything in the page that is written once in index.html.
// Elements opt in with data-i18n (text), data-i18n-title, data-i18n-aria and data-i18n-placeholder.

import { getLang, setLang, t } from '../core/i18n.ts';
import type { Lang } from '../core/i18n.ts';

export function applyStatic(root: ParentNode = document): void {
  const lang = getLang();
  document.documentElement.lang = lang;
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n]')) node.textContent = t(node.dataset.i18n ?? '');
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) node.title = t(node.dataset.i18nTitle ?? '');
  for (const node of root.querySelectorAll<HTMLElement>('[data-i18n-aria]')) {
    node.setAttribute('aria-label', t(node.dataset.i18nAria ?? ''));
  }
  for (const node of root.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]')) {
    node.placeholder = t(node.dataset.i18nPlaceholder ?? '');
  }
  for (const b of root.querySelectorAll<HTMLButtonElement>('button[data-lang]')) {
    const on = b.dataset.lang === lang;
    b.classList.toggle('active', on);
    b.setAttribute('aria-pressed', String(on));
  }
}

/** Wire the language buttons in the Menu drawer. */
export function mountLanguageSwitch(root: ParentNode = document): void {
  for (const b of root.querySelectorAll<HTMLButtonElement>('button[data-lang]')) {
    b.addEventListener('click', () => setLang(b.dataset.lang as Lang));
  }
}
