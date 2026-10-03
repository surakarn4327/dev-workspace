// The shared "event vocabulary" of the office. The UI only ever reacts to these
// events, so the mock simulator and a future real orchestrator are interchangeable.

import type { Msg } from './i18n.ts';

export const AGENT_IDS = [
  'owner',
  'secretary',
  'research-head',
  'research-1',
  'research-2',
  'prod-head',
  'prod-1',
  'prod-2',
  'qa',
  'courier',
] as const;
export type AgentId = (typeof AGENT_IDS)[number];

export type Pod = 'research' | 'production';
export type MeetSlot = 0 | 1 | 2 | 3 | 4 | 5;
export type HuddleSlot = 0 | 1 | 2;

/** A named spot on the office floor that an agent can walk to. */
export type PlaceId =
  | `desk:${AgentId}` // own seat (agent sits down on arrival)
  | `visit:${AgentId}` // standing beside somebody's desk
  | `meet:${MeetSlot}` // around the meeting table
  | `huddle:${Pod}:${HuddleSlot}` // pod stand-up spot
  | `pantry:${0 | 1 | 2}` // coffee machine, fridge, table
  | `restroom:${0 | 1}`
  | 'server:0' // in front of the server racks
  | 'archive:0' // in front of the archive shelves
  | 'client'; // lobby spot where the user is served

export type Activity =
  | 'idle'
  | 'typing'
  | 'thinking'
  | 'talking'
  | 'reviewing'
  | 'waiting'
  | 'break' // sipping coffee
  | 'error'
  | 'celebrate';

/** The seven steps of the company workflow (plus idle/done bookends). */
export type Stage =
  | 'idle'
  | 'brief'
  | 'approval'
  | 'meeting'
  | 'team'
  | 'work'
  | 'review'
  | 'delivery'
  | 'done';

export const WORK_STAGES: readonly Stage[] = [
  'brief',
  'approval',
  'meeting',
  'team',
  'work',
  'review',
  'delivery',
];

export interface Doc {
  id: string;
  label: Msg;
  from: AgentId;
  to: AgentId;
}

/** A button under a chat question. `id` is language-independent; `label` is what the user sees. */
export interface ChatChoice {
  id: string;
  label: Msg;
}

/** The user's reply: a pressed choice button, or free text they typed (in any language). */
export type ChatReply = { choice: string } | { text: string };

// All words travel as `Msg` (dictionary key + params), never as ready-made sentences, so the UI
// picks the language at display time. User-typed text is the one exception (`raw`, or `title`).
export type OfficeEvent =
  | { type: 'sim.reset' }
  | { type: 'job.created'; jobId: string; title: string }
  | { type: 'job.stage'; jobId: string; stage: Stage }
  | { type: 'job.done'; jobId: string }
  | { type: 'agent.activity'; agent: AgentId; activity: Activity; note?: Msg }
  | { type: 'agent.walk'; agent: AgentId; to: PlaceId; speed: number }
  | { type: 'agent.carry'; agent: AgentId; label: Msg | null }
  | { type: 'agent.say'; agent: AgentId; text: Msg; to?: AgentId }
  | { type: 'user.say'; text: Msg; to: AgentId }
  | { type: 'doc.queued'; doc: Doc }
  | { type: 'doc.pickup'; doc: Doc }
  | { type: 'doc.delivered'; doc: Doc } // the courier brought it across rooms
  | { type: 'doc.handed'; doc: Doc } // handed over by hand inside one room (no courier)
  | { type: 'doc.consumed'; agent: AgentId }
  | { type: 'archive.filed'; jobId: string }
  | { type: 'review.verdict'; verdict: 'pass' | 'reject'; reason: Msg; round: number }
  | {
      type: 'chat.ask';
      id: string;
      from: AgentId;
      text: Msg;
      choices?: ChatChoice[];
      placeholder?: Msg;
    }
  | { type: 'chat.closed'; id: string };

export type OfficeListener = (event: OfficeEvent) => void;

/** Anything that drives the office: the mock script now, real agents later. */
export interface OfficeSource {
  subscribe(listener: OfficeListener): () => void;
  /** The user's reply to a `chat.ask` event. */
  answer(chatId: string, reply: ChatReply): void;
}
