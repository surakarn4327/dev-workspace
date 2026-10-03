// What the office needs from a language model, whatever company runs it. The orchestrator only sees
// this interface, so another provider is one more adapter and no change to the UI or the event stream.

export interface ChatTurn {
  role: 'user' | 'model';
  text: string;
  /**
   * The provider's own content parts for this turn, used instead of `text` when present. A model turn that asked
   * for tools must be sent back exactly as it arrived (providers attach signatures to it), and the tool answers
   * go back as a user turn made of such parts. Opaque to everything except the adapter.
   */
  parts?: unknown[];
  /** Answers to the tools the previous model turn asked for, sent as this user turn (the adapter formats them). */
  toolAnswers?: ToolAnswer[];
}

/** A tool the model may ask for: a name, what it does, and the arguments it takes. */
export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, { type: 'string' | 'integer' | 'number' | 'boolean'; description?: string; enum?: string[] }>;
    required?: string[];
  };
}

/** One request from the model to use a tool. */
export interface ToolCall {
  id?: string;
  name: string;
  args: Record<string, unknown>;
}

/** What a tool answered, ready to go back to the model. `id` repeats the call's id when it had one. */
export interface ToolAnswer {
  id?: string;
  name: string;
  /** Any JSON-serialisable data, including an `{ error: ... }` object so the model can adapt. */
  response: unknown;
}

export interface GenerateRequest {
  /** The position's standing instructions (who they are, what they must produce). */
  system?: string;
  /** The conversation so far, oldest first; must end with a user turn. */
  history: ChatTurn[];
  maxOutputTokens?: number;
  /** Lets the caller abandon the call (the user cancelled the job). */
  signal?: AbortSignal;
  /** Tools the model may use in this call. */
  tools?: ToolDeclaration[];
  /** 'auto' (default): the model decides; 'none': it must answer in words, no tools. */
  toolMode?: 'auto' | 'none';
}

export interface Usage {
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Tokens the model spent thinking before answering (they count against maxOutputTokens). */
  thoughtTokens?: number;
}

export interface GenerateResult {
  text: string;
  usage?: Usage;
  /** Why the model stopped. 'MAX_TOKENS' means the reply was cut off at maxOutputTokens. */
  finishReason?: string;
  /** Tools the model wants used before it answers (then `text` may be empty). */
  toolCalls?: ToolCall[];
  /** The model's turn exactly as sent, to be put back into the history as `ChatTurn.parts` after answering the tools. */
  parts?: unknown[];
}

export interface ModelClient {
  generate(req: GenerateRequest): Promise<GenerateResult>;
}

/**
 * Why a call failed, in terms the office can act on:
 * - no-key / bad-key: the user must fix the key in the Menu
 * - rate-limit: free quota used up, wait `retryAfterMs` (if the provider said) and try again
 * - network / timeout / server / empty: usually temporary, worth a retry
 * - blocked: the provider refused this content, retrying the same prompt will not help
 * - bad-request: our request was malformed (a bug on our side)
 * - cancelled: the caller aborted
 */
export type ModelErrorKind =
  | 'no-key'
  | 'bad-key'
  | 'rate-limit'
  | 'network'
  | 'timeout'
  | 'server'
  | 'empty'
  | 'blocked'
  | 'bad-request'
  | 'cancelled';

/**
 * `message` is an English diagnostic for developers and logs only. Anything the user sees must be a
 * dictionary string chosen by `kind` (so it follows the language switch).
 */
export class ModelError extends Error {
  kind: ModelErrorKind;
  /** HTTP status, when the provider answered at all. */
  status?: number;
  /** For rate-limit: how long the provider asked us to wait. */
  retryAfterMs?: number;

  constructor(kind: ModelErrorKind, message: string, extra: { status?: number; retryAfterMs?: number } = {}) {
    super(message);
    this.name = 'ModelError';
    this.kind = kind;
    this.status = extra.status;
    this.retryAfterMs = extra.retryAfterMs;
  }
}

/** Errors that may succeed if we simply try the same call again. */
export const isTransient = (kind: ModelErrorKind): boolean =>
  kind === 'network' || kind === 'timeout' || kind === 'server' || kind === 'empty';
