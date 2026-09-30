// Cross-language check that the phone app (src/crypto.ts) and the Windows agent
// (agent/Pairing.cs + agent/Envelope.cs) derive the same agent ID and key from
// a pairing code and speak the same encrypted envelope format.
//
//   node scripts/crypto-vector.mjs make   <dir>   writes <dir>/vector.json (made by the JS code)
//   PcControllerAgent.exe --selftest --vector <dir>/vector.json --data-dir <dir>
//                                                 (C# checks it, writes <dir>/vector-from-csharp.json)
//   node scripts/crypto-vector.mjs verify <dir>   JS opens the envelope C# made
//
// Needs Node 22.18+/24 (imports the TypeScript source directly).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deriveFromCode, normalizeCode, open, seal } from '../src/crypto.ts';

const [mode, dir] = process.argv.slice(2);
if (!mode || !dir) {
  console.error('usage: node scripts/crypto-vector.mjs <make|verify> <dir>');
  process.exit(2);
}

const code = 'K7M2P9X4QA3D';

if (mode === 'make') {
  mkdirSync(dir, { recursive: true });
  const { agentId, key } = await deriveFromCode(code);
  const envelope = await seal(key, 'cmd', { type: 'cfg-test', thai: 'สวัสดี ทดสอบ', n: 1 });
  writeFileSync(join(dir, 'vector.json'), JSON.stringify({ code, agentId, direction: 'cmd', envelope }));
  console.log('wrote', join(dir, 'vector.json'), '(agent id', agentId + ')');
} else if (mode === 'verify') {
  const v = JSON.parse(readFileSync(join(dir, 'vector-from-csharp.json'), 'utf8'));
  const { key } = await deriveFromCode(v.code);
  const body = await open(key, v.direction, v.envelope);
  const ok = body && body.type === 'state-test' && body.thai === 'สวัสดี ทดสอบ' && body.n === 7;
  const wrongKey = (await deriveFromCode('K7M2P9X4QA3E')).key;
  const wrong = await open(wrongKey, v.direction, v.envelope);
  const norm = normalizeCode(' k7m2-p9x4 qa3d ') === code && normalizeCode('K7M2-P9X4') === null && normalizeCode('K7M2-P9X4-QA3U') === null;
  console.log(ok ? 'PASS  JS opens the envelope made by C#' : 'FAIL  JS could not open the envelope made by C#');
  console.log(wrong === null ? 'PASS  wrong code rejected' : 'FAIL  wrong code accepted');
  console.log(norm ? 'PASS  code normalization' : 'FAIL  code normalization');
  process.exit(ok && wrong === null && norm ? 0 : 1);
}
