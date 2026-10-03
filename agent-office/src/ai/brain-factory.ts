// Chooses who plays the owner and the secretary for a job: Gemini when the user has saved an API key, the
// canned script otherwise. It is called once per job, when the first question opens, so saving or removing
// a key never changes a job that is already under way.

import { hasKey } from '../core/ai-settings.ts';
import type { IntakeBrain } from '../core/brain.ts';
import type { AgentId } from '../core/types.ts';
import { ScriptedBrain } from '../sim/scripted-brain.ts';
import { GeminiBrain } from './gemini-brain.ts';
import { MODEL_FOR } from './models.ts';
import type { Models } from './models.ts';

export interface BrainChoice {
  /** Whether a key is saved right now. Swappable for tests. */
  keySaved?: () => boolean;
  /** Told which models play which positions in this job (null = none, the demo script). */
  onChosen?: (live: Partial<Record<AgentId, string>> | null) => void;
}

export function chooseBrain(models: Models, choice: BrainChoice = {}): IntakeBrain {
  if (!(choice.keySaved ?? (() => hasKey()))()) {
    choice.onChosen?.(null);
    return new ScriptedBrain();
  }
  choice.onChosen?.({
    owner: MODEL_FOR.owner ?? undefined,
    secretary: MODEL_FOR.secretary ?? undefined,
  });
  return new GeminiBrain({
    owner: models.clientFor('owner'),
    secretary: models.clientFor('secretary'),
    limiter: models.limiter,
  });
}
