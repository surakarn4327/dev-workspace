// The real owner and secretary: Rex questions the user through a model, Sam writes and revises the brief.
// The opening greeting is fixed text (no call), so clicking Rex answers at once and the first request is saved.
// Questions are capped: once the cap is reached the owner must stop and the brief gets written.

import type { Exchange, IntakeBrain, OwnerTurn } from '../core/brain.ts';
import { getLang, msg, raw, tr } from '../core/i18n.ts';
import type { Lang, Msg } from '../core/i18n.ts';
import type { ChatTurn, ModelClient } from './model-client.ts';
import { OPENER, SHORTEN_NUDGE, briefRequest, ownerPrompt, reviseRequest, secretaryPrompt } from './prompts.ts';

export const MAX_QUESTIONS = 6;
/** A question longer than this is an essay, not a question. */
const MAX_QUESTION_CHARS = 700;

export interface GeminiBrainDeps {
  owner: ModelClient;
  secretary: ModelClient;
  /** Most questions the owner may ask in total, counting the opening greeting. */
  maxQuestions?: number;
  /** Language to fall back to when the client has not written anything yet. */
  lang?: () => Lang;
}

/** "READY:" (or bare "READY") at the start. A question that merely begins with the word "Ready ..." does not count. */
const isReady = (text: string): boolean => /^\s*READY\s*(:|$)/i.test(text);

/** Models sometimes add markdown even when told not to; the chat box shows plain text. */
export function plain(text: string): string {
  return text
    .replace(/\*\*|__/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[*•]\s+/gm, '- ')
    .trim();
}

export class GeminiBrain implements IntakeBrain {
  private readonly owner: ModelClient;
  private readonly secretary: ModelClient;
  private readonly maxQuestions: number;
  private readonly lang: () => Lang;
  private currentBrief = '';

  constructor(deps: GeminiBrainDeps) {
    this.owner = deps.owner;
    this.secretary = deps.secretary;
    this.maxQuestions = deps.maxQuestions ?? MAX_QUESTIONS;
    this.lang = deps.lang ?? getLang;
  }

  async ownerTurn(history: readonly Exchange[], _title: string): Promise<OwnerTurn> {
    if (history.length === 0) {
      return { kind: 'ask', question: { text: msg('ask.idea'), placeholder: msg('ask.idea.ph') } };
    }
    if (history.length >= this.maxQuestions) return { kind: 'ready' };

    const turns: ChatTurn[] = [{ role: 'user', text: OPENER }];
    for (const h of history) {
      turns.push({ role: 'model', text: tr(h.question) }, { role: 'user', text: h.text });
    }
    const system = ownerPrompt({ remaining: this.maxQuestions - history.length, fallbackLang: this.lang() });

    let reply = (await this.owner.generate({ system, history: turns, maxOutputTokens: 300 })).text.trim();
    if (!isReady(reply) && reply.length > MAX_QUESTION_CHARS) {
      // One repair attempt; if the model still rambles, keep the start of it rather than fail the job.
      const retry = await this.owner.generate({
        system,
        history: [...turns, { role: 'model', text: reply }, { role: 'user', text: SHORTEN_NUDGE }],
        maxOutputTokens: 300,
      });
      reply = retry.text.trim();
      if (!isReady(reply) && reply.length > MAX_QUESTION_CHARS) reply = reply.slice(0, MAX_QUESTION_CHARS).trimEnd();
    }
    if (isReady(reply)) return { kind: 'ready' };
    return { kind: 'ask', question: { text: raw(plain(reply)) } };
  }

  async writeBrief(history: readonly Exchange[], _title: string): Promise<Msg> {
    const transcript = history.map((h) => `Owner (Rex): ${tr(h.question)}\nClient: ${h.text}`).join('\n');
    const result = await this.secretary.generate({
      system: secretaryPrompt({ fallbackLang: this.lang() }),
      history: [{ role: 'user', text: briefRequest(transcript) }],
      maxOutputTokens: 500,
    });
    this.currentBrief = plain(result.text);
    return raw(this.currentBrief);
  }

  async reviseBrief(_history: readonly Exchange[], _title: string, change: Msg): Promise<Msg> {
    const result = await this.secretary.generate({
      system: secretaryPrompt({ fallbackLang: this.lang() }),
      history: [{ role: 'user', text: reviseRequest(this.currentBrief, tr(change)) }],
      maxOutputTokens: 500,
    });
    this.currentBrief = plain(result.text);
    return raw(this.currentBrief);
  }
}
