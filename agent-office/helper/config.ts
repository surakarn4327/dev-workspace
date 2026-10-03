// Settings shared by the helper server, its Vite plugin and the app's toolbox.

/** Port of the local helper: the 8000-8099 range is reserved for backend services in this workspace. */
export const HELPER_PORT = 8071;
/** Bumped when the request/response shapes change in a way the app must notice. */
export const HELPER_PROTOCOL = 1;
export const HELPER_NAME = 'agent-office-helper';

/** Pages allowed to talk to the helper: the dev server (5171) and `vite preview` (4173). */
export const DEFAULT_ORIGINS: readonly string[] = [
  'http://localhost:5171',
  'http://127.0.0.1:5171',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
];

/** Every request must carry this header: a plain cross-site page cannot add it without a CORS preflight. */
export const CLIENT_HEADER = 'x-agent-office';
