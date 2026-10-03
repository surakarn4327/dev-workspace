// Where finished recordings are kept: on this computer only, newest first, the last few. The in-memory
// version is for tests and as the fallback when the browser has no usable IndexedDB (a private window).

import { metaOf } from './recording.ts';
import type { Recording, RecordingMeta } from './recording.ts';

export interface RecordingStore {
  /** Newest first. Never rejects: a store that cannot be read is simply empty. */
  list(): Promise<RecordingMeta[]>;
  get(id: string): Promise<Recording | null>;
  /** Saves a recording and forgets the oldest ones beyond the limit. */
  put(recording: Recording): Promise<void>;
  remove(id: string): Promise<void>;
}

export const KEEP_RECORDINGS = 12;

export function memoryRecordingStore(keep = KEEP_RECORDINGS): RecordingStore {
  const items = new Map<string, Recording>();
  const newestFirst = (): Recording[] => [...items.values()].sort((a, b) => b.startedAt - a.startedAt);
  return {
    async list() {
      return newestFirst().map(metaOf);
    },
    async get(id) {
      return items.get(id) ?? null;
    },
    async put(recording) {
      items.set(recording.id, recording);
      for (const old of newestFirst().slice(keep)) items.delete(old.id);
    },
    async remove(id) {
      items.delete(id);
    },
  };
}

// ---------- IndexedDB (the browser's own database) ----------

const DB = 'agent-office';
const STORE = 'recordings';

function open(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB could not be opened'));
    req.onblocked = () => reject(new Error('IndexedDB is blocked'));
  });
}

function done<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

/**
 * Recordings in IndexedDB. If the database cannot be used at all, this quietly behaves like the in-memory
 * store, so replay still works for the current session.
 */
export function indexedDbRecordingStore(keep = KEEP_RECORDINGS, factory: IDBFactory | undefined = globalThis.indexedDB): RecordingStore {
  const fallback = memoryRecordingStore(keep);
  let broken = factory === undefined;
  let dbPromise: Promise<IDBDatabase> | null = null;

  const db = (): Promise<IDBDatabase> => {
    dbPromise ??= open(factory as IDBFactory);
    return dbPromise;
  };
  const guard = async <T>(use: (d: IDBDatabase) => Promise<T>, otherwise: () => Promise<T>): Promise<T> => {
    if (broken) return otherwise();
    try {
      return await use(await db());
    } catch {
      broken = true; // from now on this session uses the in-memory copy
      return otherwise();
    }
  };

  return {
    list: () =>
      guard(
        async (d) => {
          const all = (await done(d.transaction(STORE).objectStore(STORE).getAll())) as Recording[];
          return all.sort((a, b) => b.startedAt - a.startedAt).map(metaOf);
        },
        () => fallback.list(),
      ),
    get: (id) => guard(async (d) => ((await done(d.transaction(STORE).objectStore(STORE).get(id))) as Recording | undefined) ?? null, () => fallback.get(id)),
    put: (recording) =>
      guard(
        async (d) => {
          await done(d.transaction(STORE, 'readwrite').objectStore(STORE).put(recording));
          const all = (await done(d.transaction(STORE).objectStore(STORE).getAll())) as Recording[];
          const old = all.sort((a, b) => b.startedAt - a.startedAt).slice(keep);
          for (const o of old) await done(d.transaction(STORE, 'readwrite').objectStore(STORE).delete(o.id));
        },
        () => fallback.put(recording),
      ),
    remove: (id) => guard(async (d) => void (await done(d.transaction(STORE, 'readwrite').objectStore(STORE).delete(id))), () => fallback.remove(id)),
  };
}
