// What the office needs from a language model, whatever company runs it. The orchestrator only sees
// this interface, so another provider is one more adapter and no change to the UI or the event stream.

export interface ChatTurn {
  role: 'user' | 'model';
  text: string;
}

export interface GenerateRequest {
  /** The position's standing instructions (who they are, what they must produce). */
  system?: string;
  /** The conversation so far, oldest first; must end with a user turn. */
  history: ChatTurn[];
  maxOutputTokens?: number;
  /** Lets the caller abandon the call (the user cancelled the job). */
  signal?: AbortSignal;
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
