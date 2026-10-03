// Where the user's own Gemini API key lives: this browser's localStorage and nowhere else.
// Never log it, never put it in an event, never show it back. The key is only ever read by the
// code that calls Google.

const STORAGE_KEY = 'agent-office.gemini-key';

/** The few Storage methods we use, so tests can pass a fake (or a throwing) store. */
export interface KeyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStore(): KeyStore | null {
  try {
    return localStorage;
  } catch {
    return null; // blocked storage: the accessor itself can throw
  }
}

export type SaveResult = 'saved' | 'empty' | 'failed';

export function loadKey(store: KeyStore | null = defaultStore()): string | null {
  try {
    const key = store?.getItem(STORAGE_KEY)?.trim();
    return key ? key : null;
  } catch {
    return null;
  }
}

export function hasKey(store?: KeyStore | null): boolean {
  return loadKey(store) !== null;
}

export function saveKey(input: string, store: KeyStore | null = defaultStore()): SaveResult {
  const key = input.trim();
  if (!key) return 'empty';
  try {
    if (!store) return 'failed';
    store.setItem(STORAGE_KEY, key);
    // Some browsers accept the write silently and drop it; check it really stuck.
    return store.getItem(STORAGE_KEY) === key ? 'saved' : 'failed';
  } catch {
    return 'failed';
  }
}

export function clearKey(store: KeyStore | null = defaultStore()): void {
  try {
    store?.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
}
