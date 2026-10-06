// Builds the app's real machinery once: the rate limiter, the model clients, the search helper's toolbox and its
// monitor, and the meter that lets the server room show all of it. main.ts takes what it needs from here.

import { createHelperMonitor } from './helper-monitor.ts';
import { createInfra } from './infra.ts';
import { RateLimiter } from './limiter.ts';
import { createModels } from './models.ts';
import { createToolbox } from './toolbox.ts';
import { UsageMeter } from '../core/usage.ts';

export function createRuntime() {
  const limiter = new RateLimiter();
  const rawToolbox = createToolbox();
  const helper = createHelperMonitor(rawToolbox);
  const usage = new UsageMeter();
  const infra = createInfra({ limiter, helper, usage });
  return {
    limiter,
    helper,
    infra,
    usage,
    /** The toolbox agents use: every call is counted for the server room. (Health checks are not.) */
    toolbox: infra.meterToolbox(rawToolbox),
    models: createModels(undefined, undefined, { limiter, meter: infra.meterClient, usage }),
  };
}

export type Runtime = ReturnType<typeof createRuntime>;
