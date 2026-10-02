// The shared "event vocabulary" of the office. The UI only ever reacts to these
// events, so the mock simulator and a future real orchestrator are interchangeable.

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
  | 'client'; // reception mat where the user is served

export type Activity =
  | 'idle'
  | 'typing'
  | 'thinking'
  | 'talking'
  | 'reviewing'
  | 'waiting'
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
  label: string;
  from: AgentId;
  to: AgentId;
}

export type OfficeEvent =
  | { type: 'sim.reset' }
  | { type: 'job.created'; jobId: string; title: string }
  | { type: 'job.stage'; jobId: string; stage: Stage }
  | { type: 'job.done'; jobId: string }
  | { type: 'agent.activity'; agent: AgentId; activity: Activity; note?: string }
  | { type: 'agent.walk'; agent: AgentId; to: PlaceId; speed: number }
  | { type: 'agent.carry'; agent: AgentId; label: string | null }
  | { type: 'agent.say'; agent: AgentId; text: string; to?: AgentId }
  | { type: 'user.say'; text: string; to: AgentId }
  | { type: 'doc.queued'; doc: Doc }
  | { type: 'doc.pickup'; doc: Doc }
  | { type: 'doc.delivered'; doc: Doc }
  | { type: 'doc.consumed'; agent: AgentId }
  | { type: 'review.verdict'; verdict: 'pass' | 'reject'; reason: string; round: number }
  | {
      type: 'chat.ask';
      id: string;
      from: AgentId;
      text: string;
      choices?: string[];
      placeholder?: string;
    }
  | { type: 'chat.closed'; id: string };

export type OfficeListener = (event: OfficeEvent) => void;

/** Anything that drives the office: the mock script now, real agents later. */
export interface OfficeSource {
  subscribe(listener: OfficeListener): () => void;
  /** The user's reply to a `chat.ask` event. */
  answer(chatId: string, text: string): void;
}
