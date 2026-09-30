// Cross-language check that the phone app (src/crypto.ts) and the Windows agent
// (agent/Envelope.cs) speak the same encrypted envelope format.
//
//   node scripts/crypto-vector.mjs make   <dir>   writes <dir>/vector.json (sealed by the JS code)
//   PcControllerAgent.exe --selftest --vector <dir>/vector.json --data-dir <dir>
//                                                 (C# opens it, writes <dir>/vector-from-csharp.json)
//   node scripts/crypto-vector.mjs verify <dir>   JS opens the envelope C# made
//
// Needs Node 22.18+/24 (imports the TypeScript source directly).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { open, seal } from '../src/crypto.ts';

const [mode, dir] = process.argv.slice(2);
if (!mode || !dir) {
  console.error('usage: node scripts/crypto-vector.mjs <make|verify> <dir>');
  process.exit(2);
}

const token = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

if (mode === 'make') {
  mkdirSync(dir, { recursive: true });
  const envelope = await seal(token, 'cmd', { type: 'cfg-test', thai: 'สวัสดี ทดสอบ', n: 1 });
  writeFileSync(join(dir, 'vector.json'), JSON.stringify({ token, direction: 'cmd', envelope }));
  console.log('wrote', join(dir, 'vector.json'));
} else if (mode === 'verify') {
  const v = JSON.parse(readFileSync(join(dir, 'vector-from-csharp.json'), 'utf8'));
  const body = await open(v.token, v.direction, v.envelope);
  const ok = body && body.type === 'state-test' && body.thai === 'สวัสดี ทดสอบ' && body.n === 7;
  const wrong = await open('ffffffffffffffffffffffffffffffff', v.direction, v.envelope);
  console.log(ok ? 'PASS  JS opens the envelope made by C#' : 'FAIL  JS could not open the envelope made by C#');
  console.log(wrong === null ? 'PASS  wrong token rejected' : 'FAIL  wrong token accepted');
  process.exit(ok && wrong === null ? 0 : 1);
}
