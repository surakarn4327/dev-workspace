// Lets an agent work with tools: ask the model, carry out the tools it asks for, give it the answers, and repeat
// until it replies in words. Everything it opened or saw is recorded, so the work can show real sources and the
// reviewer can tell a checked fact from an unchecked one.

import { HELPER_GONE, WEB_TOOLS, runTool } from './agent-tools.ts';
import type { Source, ToolContext } from './agent-tools.ts';
import { ModelError } from './model-client.ts';
import type { ChatTurn, GenerateRequest, ModelClient, ToolAnswer, ToolCall } from './model-client.ts';
import type { ToolErrorKind } from './toolbox.ts';

export interface ToolRunOptions {
  /** Most model calls in one run, the last of which must answer in words. */
  maxSteps?: number;
  /** Most tool calls in one run. */
  maxToolCalls?: number;
  /** Most tool calls honoured from a single model reply. */
  maxPerStep?: number;
  /** Characters of page text the model sees per page. */
  maxPageChars?: number;
  /** Hears about each tool use as it happens (for the office's visuals). */
  onProgress?: (event: ToolProgress) => void;
}

export type ToolProgress =
  | { type: 'call'; name: string; args: Record<string, unknown> }
  | { type: 'result'; name: string; ok: boolean; error?: ToolErrorKind; read: number; seen: number };

export interface ToolRunResult {
  text: string;
  /** Pages opened and results seen, in order, without repeats. */
  read: Source[];
  seen: Source[];
  /** Model calls made. */
  steps: number;
  toolCalls: number;
  /** Every tool failure, in order. */
  errors: ToolErrorKind[];
  /** False when the helper turned out to be unavailable: the answer is unchecked. */
  toolsWorked: boolean;
}

const DEFAULTS = { maxSteps: 6, maxToolCalls: 10, maxPerStep: 4 };

const key = (call: ToolCall): string => `${call.name}:${JSON.stringify(call.args, Object.keys(call.args).sort())}`;

export async function runWithTools(
  client: ModelClient,
  request: Omit<GenerateRequest, 'tools' | 'toolMode'>,
  toolbox: ToolContext['toolbox'],
  options: ToolRunOptions = {},
): Promise<ToolRunResult> {
  const maxSteps = options.maxSteps ?? DEFAULTS.maxSteps;
  const maxToolCalls = options.maxToolCalls ?? DEFAULTS.maxToolCalls;
  const maxPerStep = options.maxPerStep ?? DEFAULTS.maxPerStep;
  const ctx: ToolContext = { toolbox, signal: request.signal, maxPageChars: options.maxPageChars };

  const history: ChatTurn[] = [...request.history];
  const read: Source[] = [];
  const seen: Source[] = [];
  const errors: ToolErrorKind[] = [];
  const remembered = new Map<string, ToolAnswer['response']>();
  let toolCalls = 0;
  let toolsWorked = true;
  let helperGone = false;

  const addSources = (into: Source[], more: Source[]): void => {
    for (const s of more) if (!into.some((x) => x.url === s.url)) into.push(s);
  };

  for (let step = 1; ; step++) {
    // On the last allowed step (or when tools can no longer be used) the model must answer in words.
    const mustAnswer = step >= maxSteps || toolCalls >= maxToolCalls || helperGone;
    const result = await client.generate({ ...request, history, tools: WEB_TOOLS, toolMode: mustAnswer ? 'none' : 'auto' });

    if (!result.toolCalls?.length) {
      return { text: result.text, read, seen, steps: step, toolCalls, errors, toolsWorked };
    }
    if (mustAnswer) {
      // A model that keeps asking for tools after being told not to: take what it said, or give up on this reply.
      if (result.text.trim()) return { text: result.text, read, seen, steps: step, toolCalls, errors, toolsWorked };
      throw new ModelError('empty', 'The model kept asking for tools instead of answering.');
    }

    history.push({ role: 'model', text: result.text, parts: result.parts });
    const answers: ToolAnswer[] = [];
    for (const [i, call] of result.toolCalls.entries()) {
      if (i >= maxPerStep || toolCalls >= maxToolCalls) {
        answers.push({ id: call.id, name: call.name, response: { ok: false, error: 'skipped', advice: 'Too many tool calls at once. Use the answers you have.' } });
        continue;
      }
      options.onProgress?.({ type: 'call', name: call.name, args: call.args });
      const memo = remembered.get(key(call));
      if (memo !== undefined) {
        answers.push({ id: call.id, name: call.name, response: memo }); // the same question twice costs nothing
        continue;
      }
      toolCalls++;
      const run = await runTool(call, ctx);
      remembered.set(key(call), run.answer.response);
      answers.push(run.answer);
      addSources(read, run.read);
      addSources(seen, run.seen);
      if (run.error) {
        errors.push(run.error);
        if (HELPER_GONE.has(run.error)) {
          helperGone = true;
          toolsWorked = false;
        }
      }
      options.onProgress?.({ type: 'result', name: call.name, ok: !run.error, error: run.error, read: run.read.length, seen: run.seen.length });
    }
    history.push({ role: 'user', text: '', toolAnswers: answers });
  }
}
