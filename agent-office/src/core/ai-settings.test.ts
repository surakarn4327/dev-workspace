import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clearKey, hasKey, loadKey, saveKey } from './ai-settings.ts';
import type { KeyStore } from './ai-settings.ts';

function memoryStore(): KeyStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const throwing: KeyStore = {
  getItem: () => {
    throw new Error('blocked');
  },
  setItem: () => {
    throw new Error('blocked');
  },
  removeItem: () => {
    throw new Error('blocked');
  },
};

test('a saved key is trimmed, stored and loaded back', () => {
  const s = memoryStore();
  assert.equal(hasKey(s), false);
  assert.equal(saveKey('  abc123  ', s), 'saved');
  assert.equal(loadKey(s), 'abc123');
  assert.equal(hasKey(s), true);
});

test('an empty or blank key is refused and nothing is stored', () => {
  const s = memoryStore();
  assert.equal(saveKey('', s), 'empty');
  assert.equal(saveKey('   ', s), 'empty');
  assert.equal(s.data.size, 0);
});

test('removing the key forgets it', () => {
  const s = memoryStore();
  saveKey('abc123', s);
  clearKey(s);
  assert.equal(loadKey(s), null);
});

test('blocked or missing storage never throws, saving just reports failure', () => {
  assert.equal(saveKey('abc123', throwing), 'failed');
  assert.equal(saveKey('abc123', null), 'failed');
  assert.equal(loadKey(throwing), null);
  assert.equal(loadKey(null), null);
  assert.doesNotThrow(() => clearKey(throwing));
  assert.doesNotThrow(() => clearKey(null));
});

test('a store that silently drops writes counts as a failed save', () => {
  const dropping: KeyStore = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  assert.equal(saveKey('abc123', dropping), 'failed');
});
