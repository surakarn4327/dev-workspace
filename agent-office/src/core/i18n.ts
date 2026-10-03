// Tiny i18n: the dictionary lives in strings.ts, events carry keys + params (Msg),
// and the UI translates at display time, so switching language re-labels old log lines too.

import { STRINGS } from './strings.ts';

export type Lang = 'en' | 'th';
export const LANGS: readonly Lang[] = ['en', 'th'];

export type Param = string | number | Msg;
/** A translatable message: a dictionary key plus values to fill into its {placeholders}. */
export interface Msg {
  key: string;
  params?: Record<string, Param>;
}

export const msg = (key: string, params?: Record<string, Param>): Msg => ({ key, params });
/** User-typed (or otherwise untranslatable) text, wrapped so it can travel as a Msg. */
export const raw = (text: string): Msg => ({ key: 'text', params: { text } });

const STORAGE_KEY = 'agent-office.lang';

let current: Lang = 'en';
const listeners = new Set<(lang: Lang) => void>();

export const getLang = (): Lang => current;

export function setLang(lang: Lang, persist = true): void {
  if (!LANGS.includes(lang)) return;
  const changed = lang !== current;
  current = lang;
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* private mode / blocked storage: the choice just won't be remembered */
    }
  }
  if (changed) for (const fn of [...listeners]) fn(lang);
}

export function onLangChange(fn: (lang: Lang) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Saved choice if any, otherwise Thai for Thai browsers and English for everyone else. */
export function pickInitialLang(stored: string | null | undefined, browserLangs: readonly string[]): Lang {
  if (stored === 'en' || stored === 'th') return stored;
  return browserLangs.some((l) => l.toLowerCase().startsWith('th')) ? 'th' : 'en';
}

export function initLang(): Lang {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  const nav = typeof navigator === 'undefined' ? [] : (navigator.languages?.length ? navigator.languages : [navigator.language ?? '']);
  setLang(pickInitialLang(stored, nav), false);
  return current;
}

export function t(key: string, params?: Record<string, Param>, lang: Lang = current): string {
  const template = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const v = params[name];
    if (v === undefined) return whole;
    return typeof v === 'object' ? tr(v, lang) : String(v);
  });
}

export function tr(m: Msg, lang: Lang = current): string {
  return t(m.key, m.params, lang);
}
