// Pairing code + AES-256-GCM envelope shared with the Windows agent
// (agent/Pairing.cs and agent/Envelope.cs — keep them identical).
//
// The MQTT broker is public, so anything sent to/from the agent is encrypted
// and authenticated with a key derived from the pairing code (which never
// travels over MQTT). Wire format: JSON {"n": base64(12-byte nonce), "c":
// base64(ciphertext || 16-byte tag)}. The AAD ("state" or "cmd") binds a
// message to its direction so a captured state message can't be replayed as a
// command.

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------- pairing code ----------

// "K7M2-P9X4-QA3D": 12 chars of Crockford base32 = 60 random bits. PBKDF2
// below makes each offline guess ~200,000x more expensive, since anyone can
// read the broker's retained messages and grind on them.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const CODE_LENGTH = 12;
const SALT = enc.encode('pc-controller-agent-v1');
const ITERATIONS = 200_000;

// Accepts what people paste (lower case, dashes, spaces, O/I/L look-alikes).
// Null if it isn't a valid code.
export function normalizeCode(input: string): string | null {
  let out = '';
  for (const raw of input.toUpperCase()) {
    const c = raw === 'O' ? '0' : raw === 'I' || raw === 'L' ? '1' : raw;
    if (ALPHABET.includes(c)) out += c;
    else if (/[A-Z0-9]/.test(c)) return null;
  }
  return out.length === CODE_LENGTH ? out : null;
}

export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8)}`;
}

export interface DerivedPairing {
  agentId: string; // 8 hex chars, the agent's topic namespace
  key: CryptoKey;
}

export async function deriveFromCode(code: string): Promise<DerivedPairing> {
  const material = await crypto.subtle.importKey('raw', enc.encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: SALT, iterations: ITERATIONS }, material, 288),
  );
  const key = await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
  const agentId = Array.from(bits.slice(32, 36), (b) => b.toString(16).padStart(2, '0')).join('');
  return { agentId, key };
}

// ---------- envelope ----------

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

export type Direction = 'state' | 'cmd';

export async function seal(key: CryptoKey, direction: Direction, payload: unknown): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const data = enc.encode(JSON.stringify(payload));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: enc.encode(direction) },
    key,
    data,
  );
  return JSON.stringify({ n: toB64(nonce), c: toB64(new Uint8Array(cipher)) });
}

// Returns null for anything that doesn't decrypt/authenticate with this key
// (wrong code, tampered, wrong direction, malformed).
export async function open<T>(key: CryptoKey, direction: Direction, text: string): Promise<T | null> {
  try {
    const env = JSON.parse(text) as { n: string; c: string };
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
