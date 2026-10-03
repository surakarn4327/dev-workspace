// `npm run helper`: runs the helper by itself (the dev server starts one automatically; use this for a built app
// or to see its log). Settings come from the environment:
//   AGENT_OFFICE_HELPER_PORT   default 8071
//   AGENT_OFFICE_ORIGINS       comma-separated pages allowed to call it (default: the dev and preview servers)

import { DEFAULT_ORIGINS, HELPER_PORT } from './config.ts';
import { startHelper } from './server.ts';
import { createWebService } from './service.ts';

const port = Number(process.env.AGENT_OFFICE_HELPER_PORT) || HELPER_PORT;
const origins = new Set(
  (process.env.AGENT_OFFICE_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);
for (const o of DEFAULT_ORIGINS) origins.add(o);

const helper = await startHelper({ service: createWebService(), port, origins, log: (line) => console.log(`[helper] ${line}`) });
if (!helper) {
  console.error(`[helper] port ${port} is already in use: a helper is probably running already.`);
  process.exit(1);
}
console.log(`[helper] listening on http://127.0.0.1:${helper.port} (this machine only)`);
console.log(`[helper] pages allowed: ${[...origins].join(', ')}`);

const stop = (): void => {
  void helper.close().then(() => process.exit(0));
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
