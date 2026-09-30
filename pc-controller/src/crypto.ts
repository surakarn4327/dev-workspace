// AES-256-GCM envelope shared with the Windows agent (agent/Crypto.cs).
//
// The MQTT broker is public, so anything sent to/from the agent is encrypted
// and authenticated with a key derived from the pairing token (which never
// travels over MQTT). Wire format: JSON {"n": base64(12-byte nonce), "c":
// base64(ciphertext || 16-byte tag)}. The AAD ("state" or "cmd") binds a
// message to its direction so a captured state message can't be replayed as a
// command.

const enc = new TextEncoder();
const dec = new TextDecoder();

function toB64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(text: string): Uint8Array<ArrayBuffer> {
  const s = atob(text);
  const out = new Uint8Array(new ArrayBuffer(s.length));
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function keyFrom(token: string): Promise<CryptoKey> {
  let key = keyCache.get(token);
  if (!key) {
    key = crypto.subtle
      .digest('SHA-256', enc.encode(token))
      .then((hash) => crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt']));
    keyCache.set(token, key);
  }
  return key;
}

export type Direction = 'state' | 'cmd';

export async function seal(token: string, direction: Direction, payload: unknown): Promise<string> {
  const key = await keyFrom(token);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const data = enc.encode(JSON.stringify(payload));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: enc.encode(direction) },
    key,
    data,
  );
  return JSON.stringify({ n: toB64(nonce), c: toB64(new Uint8Array(cipher)) });
}

// Returns null for anything that doesn't decrypt/authenticate with this token
// (wrong token, tampered, wrong direction, malformed).
export async function open<T>(token: string, direction: Direction, text: string): Promise<T | null> {
  try {
    const env = JSON.parse(text) as { n: string; c: string };
    const key = await keyFrom(token);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64(env.n), additionalData: enc.encode(direction) },
      key,
      fromB64(env.c),
    );
    return JSON.parse(dec.decode(plain)) as T;
  } catch {
    return null;
  }
}
