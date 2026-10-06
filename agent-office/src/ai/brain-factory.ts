// Chooses who plays the owner and the secretary for a job: Gemini when the user has saved an API key, the
// canned script otherwise. It is called once per job, when the first question opens, so saving or removing
// a key never changes a job that is already under way.

import { hasKey } from '../core/ai-settings.ts';
import type { AttachmentStore } from '../core/attachments.ts';
import type { IntakeBrain } from '../core/brain.ts';
import type { AgentId } from '../core/types.ts';
import { ScriptedBrain } from '../sim/scripted-brain.ts';
import { GeminiBrain } from './gemini-brain.ts';
import { GeminiResearch } from './gemini-research.ts';
import type { GeminiResearchDeps } from './gemini-research.ts';
import type { ResearchBrain } from '../core/research.ts';
import type { WorkBrain } from '../core/work.ts';
import { GeminiWork } from './gemini-work.ts';
import type { GeminiWorkDeps } from './gemini-work.ts';
import { MODEL_FOR } from './models.ts';
import type { Models } from './models.ts';

export interface BrainChoice {
  /** Whether a key is saved right now. Swappable for tests. */
  keySaved?: () => boolean;
  /** Told which models play which positions in this job (null = none, the demo script). */
  onChosen?: (live: Partial<Record<AgentId, string>> | null) => void;
  /** The files the client attached: the owner is told their names, the researchers read them. */
  attachments?: AttachmentStore;
}

export function chooseBrain(models: Models, choice: BrainChoice = {}): IntakeBrain {
  if (!(choice.keySaved ?? (() => hasKey()))()) {
    choice.onChosen?.(null);
    return new ScriptedBrain();
  }
  choice.onChosen?.({
    owner: MODEL_FOR.owner ?? undefined,
    secretary: MODEL_FOR.secretary ?? undefined,
    'research-head': MODEL_FOR['research-head'] ?? undefined,
    'research-1': MODEL_FOR['research-1'] ?? undefined,
    'research-2': MODEL_FOR['research-2'] ?? undefined,
    'prod-head': MODEL_FOR['prod-head'] ?? undefined,
    'prod-1': MODEL_FOR['prod-1'] ?? undefined,
    'prod-2': MODEL_FOR['prod-2'] ?? undefined,
    qa: MODEL_FOR.qa ?? undefined,
  });
  return new GeminiBrain({
    owner: models.clientFor('owner'),
    secretary: models.clientFor('secretary'),
    limiter: models.limiter,
    attachedNames: () => choice.attachments?.names() ?? [],
  });
}

/** Who plays the owner's team choice, production and the reviewer for a job: real models when a key is saved, the demo script otherwise. */
export function chooseWork(models: Models, choice: Pick<BrainChoice, 'keySaved' | 'attachments'> = {}): WorkBrain | null {
  if (!(choice.keySaved ?? (() => hasKey()))()) return null;
  const clients: GeminiWorkDeps['clients'] = {};
  for (const a of ['owner', 'prod-head', 'prod-1', 'prod-2', 'qa', 'research-1', 'research-2'] as const) clients[a] = models.clientFor(a);
  return new GeminiWork({ clients, limiter: models.limiter, attachments: () => choice.attachments?.list() ?? [] });
}

/** Who plays the research department for a job: real researchers with web tools when a key is saved, the demo script otherwise. */
export function chooseResearch(models: Models, toolbox: GeminiResearchDeps['toolbox'], choice: Pick<BrainChoice, 'keySaved' | 'attachments'> = {}): ResearchBrain | null {
  if (!(choice.keySaved ?? (() => hasKey()))()) return null;
  return new GeminiResearch({
    head: models.clientFor('research-head'),
    researchers: { 'research-1': models.clientFor('research-1'), 'research-2': models.clientFor('research-2') },
    toolbox,
    limiter: models.limiter,
    attachments: () => choice.attachments?.list() ?? [],
  });
}
