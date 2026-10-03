// What the local helper may and may not fetch. The helper downloads web pages on behalf of the app, so it must
// never be tricked into reaching the user's own machine or network (SSRF): no loopback, no private ranges, no
// cloud metadata addresses, no odd ports, no credentials in URLs. The address check runs when the connection is
// made (guardedLookup), not only when the URL is read, so a hostname that changes its answer between the check
// and the connect (DNS rebinding) is still caught.

import dns from 'node:dns';
import { isIP } from 'node:net';

export type GuardCode = 'bad-url' | 'bad-scheme' | 'bad-port' | 'credentials' | 'blocked-host' | 'blocked-address';

export class GuardError extends Error {
  code: GuardCode;
  constructor(code: GuardCode, message: string) {
    super(message);
    this.name = 'GuardError';
    this.code = code;
  }
}

/** Ports an ordinary public web page is served on. Everything else (databases, admin panels...) is refused. */
export const ALLOWED_PORTS: ReadonlySet<number> = new Set([80, 443, 8080, 8443]);

const MAX_URL_LENGTH = 2048;

/** Names that only make sense inside a private network. The resolved address is checked as well. */
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home', '.corp', '.intranet', '.localdomain'];

function parseIPv4(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return nums.every((n) => n >= 0 && n <= 255) ? nums : null;
}

/** IPv6 text -> 16 bytes (handles "::" compression, an embedded IPv4 tail and a %zone suffix). */
function parseIPv6(input: string): number[] | null {
  const ip = input.split('%')[0].toLowerCase();
  if (isIP(ip) !== 6) return null;
  let head = ip;
  let tail4: number[] | null = null;
  const lastColon = ip.lastIndexOf(':');
  if (ip.includes('.')) {
    tail4 = parseIPv4(ip.slice(lastColon + 1));
    if (!tail4) return null;
    head = ip.slice(0, lastColon + 1) + '0:0'; // placeholder for the two groups the IPv4 tail fills
  }
  const [left, right] = head.split('::');
  const toGroups = (s: string | undefined): number[] => (s ? s.split(':').map((g) => parseInt(g || '0', 16)) : []);
  const l = toGroups(left);
  const r = head.includes('::') ? toGroups(right) : [];
  const groups = head.includes('::') ? [...l, ...new Array(8 - l.length - r.length).fill(0), ...r] : l;
  if (groups.length !== 8 || groups.some((g) => Number.isNaN(g) || g < 0 || g > 0xffff)) return null;
  if (tail4) {
    groups[6] = (tail4[0] << 8) | tail4[1];
    groups[7] = (tail4[2] << 8) | tail4[3];
  }
  return groups.flatMap((g) => [g >> 8, g & 0xff]);
}

function blockedIPv4(b: number[]): boolean {
  const [a, c] = b;
  return (
    a === 0 || // "this" network
    a === 10 || // private
    (a === 100 && c >= 64 && c <= 127) || // carrier-grade NAT
    a === 127 || // loopback
    (a === 169 && c === 254) || // link-local (cloud metadata lives here)
    (a === 172 && c >= 16 && c <= 31) || // private
    (a === 192 && c === 0 && b[2] === 0) || // IETF protocol assignments
    (a === 192 && c === 0 && b[2] === 2) || // documentation
    (a === 192 && c === 88 && b[2] === 99) || // 6to4 relay
    (a === 192 && c === 168) || // private
    (a === 198 && (c === 18 || c === 19)) || // benchmarking
    (a === 198 && c === 51 && b[2] === 100) || // documentation
    (a === 203 && c === 0 && b[2] === 113) || // documentation
    a >= 224 // multicast, reserved, broadcast
  );
}

/** True for any address the helper must never connect to. Unparseable input counts as blocked. */
export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip.split('%')[0]);
  if (kind === 4) {
    const v4 = parseIPv4(ip);
    return v4 === null || blockedIPv4(v4);
  }
  if (kind === 6) {
    const b = parseIPv6(ip);
    if (!b) return true;
    const allZeroTo = (n: number): boolean => b.slice(0, n).every((x) => x === 0);
    if (allZeroTo(15) && (b[15] === 0 || b[15] === 1)) return true; // :: and ::1
    if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true; // fe80::/10 link-local
    if ((b[0] & 0xfe) === 0xfc) return true; // fc00::/7 unique local
    if (b[0] === 0xff) return true; // multicast
    if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // 2001:db8::/32 documentation
    if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0 && b[3] === 0) return true; // 2001::/32 Teredo
    if (allZeroTo(10) && b[10] === 0xff && b[11] === 0xff) return blockedIPv4(b.slice(12)); // ::ffff:a.b.c.d (IPv4-mapped)
    if (allZeroTo(12)) return blockedIPv4(b.slice(12)); // ::a.b.c.d (IPv4-compatible)
    if (b[0] === 0x20 && b[1] === 0x02) return blockedIPv4(b.slice(2, 6)); // 6to4 embeds an IPv4
    if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((x) => x === 0)) {
      return blockedIPv4(b.slice(12)); // 64:ff9b::/96 NAT64 embeds an IPv4
    }
    return false;
  }
  return true;
}

export interface UrlRules {
  /**
   * Tests only: let the helper reach a server on this machine (127.0.0.0/8, ::1, "localhost", any port) so the
   * fetcher can be tested against a local server. Every other private range stays blocked.
   */
  allowLoopback?: boolean;
}

const isLoopback = (ip: string): boolean => {
  const kind = isIP(ip.split('%')[0]);
  if (kind === 4) return parseIPv4(ip)?.[0] === 127;
  const b = kind === 6 ? parseIPv6(ip) : null;
  if (!b) return false;
  if (b.slice(0, 15).every((x) => x === 0) && b[15] === 1) return true;
  return b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff && b[12] === 127;
};

/** Validates a URL the helper was asked to fetch and returns it parsed. Throws GuardError when it must be refused. */
export function checkUrl(raw: string, rules: UrlRules = {}): URL {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_URL_LENGTH) {
    throw new GuardError('bad-url', 'The address is missing or too long.');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new GuardError('bad-url', 'The address is not a valid URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new GuardError('bad-scheme', 'Only http and https addresses are allowed.');
  if (url.username || url.password) throw new GuardError('credentials', 'Addresses with a user name or password are not allowed.');

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (!host) throw new GuardError('bad-url', 'The address has no host name.');
  if (rules.allowLoopback && (host === 'localhost' || (isIP(host) && isLoopback(host)))) return url;

  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  if (!ALLOWED_PORTS.has(port)) throw new GuardError('bad-port', `Port ${port} is not allowed.`);
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new GuardError('blocked-address', 'That address is inside a private network.');
  } else if (host === 'localhost' || !host.includes('.') || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) {
    throw new GuardError('blocked-host', 'That host name only exists inside a private network.');
  }
  return url;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address?: string | dns.LookupAddress[], family?: number) => void;
type Resolver = (hostname: string) => Promise<dns.LookupAddress[]>;

const systemResolver: Resolver = (hostname) => dns.promises.lookup(hostname, { all: true, verbatim: true });

/**
 * A `lookup` function for http.request / net.connect. It resolves the name itself and only ever hands back
 * addresses that are safe, so the connection cannot go anywhere private even if DNS lies.
 */
export function guardedLookup(rules: UrlRules = {}, resolve: Resolver = systemResolver) {
  return (hostname: string, options: dns.LookupOptions | number | undefined, callback: LookupCallback): void => {
    const wantAll = typeof options === 'object' && options !== null && options.all === true;
    const family = typeof options === 'object' && options !== null ? options.family : typeof options === 'number' ? options : 0;
    resolve(hostname).then(
      (found) => {
        const usable = found.filter(
          (a) => (!isBlockedAddress(a.address) || (rules.allowLoopback === true && isLoopback(a.address))) && (!family || a.family === family),
        );
        if (usable.length === 0) {
          callback(new GuardError('blocked-address', `${hostname} resolves only to private addresses.`));
          return;
        }
        if (wantAll) callback(null, usable);
        else callback(null, usable[0].address, usable[0].family);
      },
      (err: NodeJS.ErrnoException) => callback(err),
    );
  };
}
