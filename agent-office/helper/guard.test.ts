import assert from 'node:assert/strict';
import { test } from 'node:test';
import type dns from 'node:dns';
import { GuardError, checkUrl, guardedLookup, isBlockedAddress } from './guard.ts';

const blocked = (ip: string): boolean => isBlockedAddress(ip);

test('every private, loopback, link-local and reserved IPv4 range is blocked', () => {
  for (const ip of [
    '0.0.0.0', '0.1.2.3', '10.0.0.1', '10.255.255.255', '100.64.0.1', '100.127.255.254', '127.0.0.1', '127.255.255.255',
    '169.254.169.254', '172.16.0.1', '172.31.255.255', '192.0.0.5', '192.0.2.9', '192.88.99.1', '192.168.0.1',
    '198.18.0.1', '198.19.255.255', '198.51.100.7', '203.0.113.9', '224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255',
  ]) {
    assert.equal(blocked(ip), true, `${ip} should be blocked`);
  }
});

test('ordinary public IPv4 addresses are allowed, including ones next to private ranges', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '169.253.1.1', '192.167.1.1', '11.0.0.1', '223.255.255.254']) {
    assert.equal(blocked(ip), false, `${ip} should be allowed`);
  }
});

test('IPv6 loopback, link-local, unique-local, multicast and documentation ranges are blocked', () => {
  for (const ip of ['::', '::1', '0:0:0:0:0:0:0:1', 'fe80::1', 'febf::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '2001:db8::1', '2001:0:1234::1']) {
    assert.equal(blocked(ip), true, `${ip} should be blocked`);
  }
});

test('IPv6 forms that hide an IPv4 address are judged by that address', () => {
  for (const ip of ['::ffff:127.0.0.1', '::ffff:10.1.2.3', '::ffff:7f00:1', '::127.0.0.1', '2002:7f00:1::1', '2002:0a00:0001::', '64:ff9b::a00:1', '64:ff9b::7f00:1', '::ffff:169.254.169.254']) {
    assert.equal(blocked(ip), true, `${ip} should be blocked`);
  }
  for (const ip of ['::ffff:8.8.8.8', '::ffff:808:808', '2002:0808:0808::1', '64:ff9b::808:808']) {
    assert.equal(blocked(ip), false, `${ip} should be allowed`);
  }
});

test('public IPv6 addresses are allowed; zone ids and garbage are handled safely', () => {
  assert.equal(blocked('2606:4700:4700::1111'), false);
  assert.equal(blocked('2a00:1450:4001:81b::200e'), false);
  assert.equal(blocked('fe80::1%eth0'), true);
  assert.equal(blocked('not an ip'), true, 'unparseable means blocked');
  assert.equal(blocked(''), true);
});

const refused = (url: string, code: string): void => {
  assert.throws(() => checkUrl(url), (e: unknown) => e instanceof GuardError && e.code === code, `${url} should be refused with ${code}`);
};

test('ordinary web addresses pass', () => {
  assert.equal(checkUrl('https://www.bangkokpost.com/business').hostname, 'www.bangkokpost.com');
  assert.equal(checkUrl('http://example.com:8080/a?b=c').port, '8080');
  assert.equal(checkUrl('https://xn--12c1fe0br.xn--o3cw4h/path').protocol, 'https:');
  assert.equal(checkUrl('https://8.8.8.8/dns-query').hostname, '8.8.8.8');
});

test('addresses that are not plain public http(s) are refused with the right reason', () => {
  refused('', 'bad-url');
  refused('not a url', 'bad-url');
  refused('https://' + 'a'.repeat(2100) + '.com', 'bad-url');
  refused('file:///etc/passwd', 'bad-scheme');
  refused('ftp://example.com/file', 'bad-scheme');
  refused('javascript:alert(1)', 'bad-scheme');
  refused('gopher://example.com', 'bad-scheme');
  refused('https://user:pass@example.com/', 'credentials');
  refused('https://user@example.com/', 'credentials');
});

test('odd ports are refused', () => {
  for (const port of [22, 25, 3306, 5432, 6379, 8000, 9200, 5171, 8071]) refused(`http://example.com:${port}/`, 'bad-port');
});

test('the usual ways of writing localhost and private addresses are refused', () => {
  refused('http://localhost/', 'blocked-host');
  refused('http://LOCALHOST/', 'blocked-host');
  refused('http://localhost./', 'blocked-host');
  refused('http://app.localhost/', 'blocked-host');
  refused('http://printer.local/', 'blocked-host');
  refused('http://metadata.google.internal/', 'blocked-host');
  refused('http://intranet/', 'blocked-host');
  refused('http://127.0.0.1/', 'blocked-address');
  refused('http://127.1/', 'blocked-address');
  refused('http://2130706433/', 'blocked-address'); // 127.0.0.1 as one decimal number
  refused('http://0x7f.0.0.1/', 'blocked-address');
  refused('http://0177.0.0.1/', 'blocked-address'); // octal
  refused('http://169.254.169.254/latest/meta-data/', 'blocked-address');
  refused('http://10.0.0.5/', 'blocked-address');
  refused('http://192.168.1.1/', 'blocked-address');
  refused('http://[::1]/', 'blocked-address');
  refused('http://[::ffff:127.0.0.1]/', 'blocked-address');
  refused('http://[fd00::1]/', 'blocked-address');
  refused('http://0.0.0.0/', 'blocked-address');
});

test('the test-only switch lets this machine through but nothing else private, and never changes scheme or credential rules', () => {
  const rules = { allowLoopback: true };
  assert.equal(checkUrl('http://127.0.0.1:4555/x', rules).port, '4555');
  assert.equal(checkUrl('http://localhost:4555/', rules).hostname, 'localhost');
  assert.equal(checkUrl('http://[::1]:4555/', rules).port, '4555');
  for (const url of ['http://169.254.169.254/', 'http://10.0.0.1/', 'http://192.168.1.1/', 'http://[fd00::1]/', 'http://metadata.google.internal/', 'http://printer.local/']) {
    assert.throws(() => checkUrl(url, rules), (e: unknown) => e instanceof GuardError, `${url} must stay blocked`);
  }
  assert.throws(() => checkUrl('http://example.com:4555/', rules), (e: unknown) => e instanceof GuardError && e.code === 'bad-port');
  assert.throws(() => checkUrl('file:///etc/passwd', rules), (e: unknown) => e instanceof GuardError && e.code === 'bad-scheme');
  assert.throws(() => checkUrl('http://u:p@127.0.0.1/', rules), (e: unknown) => e instanceof GuardError && e.code === 'credentials');
});
// ---------- the connect-time check ----------

const resolver = (answer: dns.LookupAddress[]) => async (): Promise<dns.LookupAddress[]> => answer;
const lookupOnce = (lookup: ReturnType<typeof guardedLookup>, options: dns.LookupOptions | number | undefined) =>
  new Promise<{ err: NodeJS.ErrnoException | null; address?: string | dns.LookupAddress[]; family?: number }>((resolve) => {
    lookup('example.test', options, (err, address, family) => resolve({ err, address, family }));
  });

test('a name that resolves to a private address is refused at connect time (DNS rebinding)', async () => {
  const lookup = guardedLookup({}, resolver([{ address: '127.0.0.1', family: 4 }]));
  const r = await lookupOnce(lookup, { all: true });
  assert.ok(r.err instanceof GuardError && r.err.code === 'blocked-address');
});

test('when a name resolves to both private and public addresses only the public ones are used', async () => {
  const lookup = guardedLookup({}, resolver([
    { address: '10.0.0.7', family: 4 },
    { address: '93.184.216.34', family: 4 },
    { address: '::1', family: 6 },
  ]));
  const all = await lookupOnce(lookup, { all: true });
  assert.deepEqual(all.address, [{ address: '93.184.216.34', family: 4 }]);
  const single = await lookupOnce(lookup, {});
  assert.equal(single.address, '93.184.216.34');
  assert.equal(single.family, 4);
});

test('an address family can be requested, and a resolver failure is passed on', async () => {
  const mixed = guardedLookup({}, resolver([
    { address: '2606:4700::1111', family: 6 },
    { address: '1.1.1.1', family: 4 },
  ]));
  assert.equal((await lookupOnce(mixed, { family: 6 })).address, '2606:4700::1111');
  assert.equal((await lookupOnce(mixed, 4)).address, '1.1.1.1');

  const failing = guardedLookup({}, async () => {
    throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
  });
  assert.equal((await lookupOnce(failing, {})).err?.code, 'ENOTFOUND');
});

test('with the test-only switch loopback is allowed at connect time, other private addresses still are not', async () => {
  const rules = { allowLoopback: true };
  assert.equal((await lookupOnce(guardedLookup(rules, resolver([{ address: '127.0.0.1', family: 4 }])), {})).address, '127.0.0.1');
  assert.equal((await lookupOnce(guardedLookup(rules, resolver([{ address: '::1', family: 6 }])), {})).address, '::1');
  const refusedPrivate = await lookupOnce(guardedLookup(rules, resolver([{ address: '10.0.0.7', family: 4 }])), {});
  assert.ok(refusedPrivate.err instanceof GuardError);
});
