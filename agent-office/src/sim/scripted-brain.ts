// The canned conversation used by the demo (and whenever there is no API key): idea, audience, limits,
// then a brief built from those three answers. Behaves exactly as the office did before brains existed.

import { choice } from '../core/brain.ts';
import type { Exchange, IntakeBrain, OwnerTurn } from '../core/brain.ts';
import { msg, raw } from '../core/i18n.ts';
import type { Msg } from '../core/i18n.ts';

export class ScriptedBrain implements IntakeBrain {
  /** Changes the user asked for, newest last, as one growing message. */
  private changes: Msg = raw('');

  async ownerTurn(history: readonly Exchange[], title: string): Promise<OwnerTurn> {
    switch (history.length) {
      case 0:
        return { kind: 'ask', question: { text: msg('ask.idea'), placeholder: msg('ask.idea.ph'), auto: msg('auto.idea') } };
      case 1:
        return {
          kind: 'ask',
          question: { text: msg('ask.audience', { title }), placeholder: msg('ask.audience.ph'), auto: msg('auto.audience') },
        };
      case 2:
        return {
          kind: 'ask',
          question: {
            text: msg('ask.limits'),
            choices: [choice('none', 'choice.none'), choice('one-page', 'choice.onePage'), choice('detailed', 'choice.detailed')],
            placeholder: msg('ask.limits.ph'),
          },
        };
      default:
        return { kind: 'ready' };
    }
  }

  async writeBrief(history: readonly Exchange[], title: string): Promise<Msg> {
    this.changes = raw('');
    return this.body(history, title);
  }

  async reviseBrief(history: readonly Exchange[], title: string, change: Msg): Promise<Msg> {
    this.changes = msg('brief.change', { prev: this.changes, text: change });
    return this.body(history, title);
  }

  private body(history: readonly Exchange[], title: string): Msg {
    return msg('brief.body', {
      goal: title,
      audience: history[1].answer,
      limits: history[2].answer,
      changes: this.changes,
    });
  }
}
