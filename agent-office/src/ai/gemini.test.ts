// Every test here uses a fake fetch: nothing touches the network or the user's quota.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createGeminiClient, DEFAULT_GEMINI_MODEL } from './gemini.ts';
import { ModelError } from './model-client.ts';
import type { ModelErrorKind } from './model-client.ts';

const KEY = 'SECRET-TEST-KEY-123';
const ok = (text: string, extra: Record<string, unknown> = {}): Response =>
  new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, totalTokenCount: 14 },
      ...extra,
    }),
    { status: 200 },
  );
const failure = (status: number, error: Record<string, unknown>, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify({ error: { code: status, ...error } }), { status, headers });

const history = [{ role: 'user' as const, text: 'Hello' }];

function client(fetchFn: typeof fetch, getKey: () => string | null = () => KEY, timeoutMs?: number) {
  return createGeminiClient({ model: 'test-model', getKey, fetchFn, timeoutMs });
}

async function kindOf(p: Promise<unknown>): Promise<ModelErrorKind | 'resolved'> {
  try {
    await p;
    return 'resolved';
  } catch (err) {
    assert.ok(err instanceof ModelError, `expected a ModelError, got ${String(err)}`);
    return err.kind;
  }
}

test('a good reply returns the text and the token usage', async () => {
  const c = client(async () => ok('Hi there'));
  const r = await c.generate({ history });
  assert.equal(r.text, 'Hi there');
  assert.deepEqual(r.usage, { promptTokens: 10, outputTokens: 4, totalTokens: 14 });
});

test('the request goes to the model URL with the key in a header, never in the URL', async () => {
  let url = '';
  let init: RequestInit = {};
  const c = client(async (u, i) => {
    url = String(u);
    init = i ?? {};
    return ok('x');
  });
  await c.generate({
    system: 'You are the owner.',
    history: [
      { role: 'user', text: 'Make a newsletter' },
      { role: 'model', text: 'For whom?' },
      { role: 'user', text: 'Parents' },
    ],
    maxOutputTokens: 500,
  });
  assert.ok(url.endsWith('/models/test-model:generateContent'));
  assert.ok(!url.includes(KEY), 'the key must not be in the URL');
  assert.equal((init.headers as Record<string, string>)['x-goog-api-key'], KEY);
  const body = JSON.parse(String(init.body));
  assert.deepEqual(body.systemInstruction, { parts: [{ text: 'You are the owner.' }] });
  assert.deepEqual(
    body.contents.map((t: { role: string }) => t.role),
    ['user', 'model', 'user'],
  );
  assert.equal(body.contents[2].parts[0].text, 'Parents');
  assert.deepEqual(body.generationConfig, { maxOutputTokens: 500 });
});

test('with no key saved nothing is sent', async () => {
  let called = false;
  const c = client(async () => {
    called = true;
    return ok('x');
  }, () => null);
  assert.equal(await kindOf(c.generate({ history })), 'no-key');
  assert.equal(called, false);
});

test('an empty history is refused before sending', async () => {
  const c = client(async () => ok('x'));
  assert.equal(await kindOf(c.generate({ history: [] })), 'bad-request');
});

test('a wrong key is reported as bad-key (400 API_KEY_INVALID, 401 and 403)', async () => {
  for (const res of [
    () => failure(400, { message: 'API key not valid.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] }),
    () => failure(401, { message: 'nope' }),
    () => failure(403, { message: 'denied' }),
  ]) {
    assert.equal(await kindOf(client(async () => res()).generate({ history })), 'bad-key');
  }
});

test('a 429 is a rate-limit and carries how long Google asked us to wait', async () => {
  const c = client(async () =>
    failure(429, {
      message: 'Quota exceeded',
      status: 'RESOURCE_EXHAUSTED',
      details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '12s' }],
    }),
  );
  await assert.rejects(c.generate({ history }), (err: unknown) => {
    assert.ok(err instanceof ModelError);
    assert.equal(err.kind, 'rate-limit');
    assert.equal(err.retryAfterMs, 12_000);
    assert.equal(err.status, 429);
    return true;
  });
});

test('a 429 falls back to the Retry-After header, and to "unknown" when neither is given', async () => {
  const withHeader = client(async () => failure(429, { message: 'slow down' }, { 'retry-after': '7' }));
  await assert.rejects(withHeader.generate({ history }), (e: unknown) => e instanceof ModelError && e.retryAfterMs === 7000);
  const bare = client(async () => failure(429, { message: 'slow down' }));
  await assert.rejects(bare.generate({ history }), (e: unknown) => e instanceof ModelError && e.retryAfterMs === undefined);
});

test('server errors are "server", other 4xx are "bad-request"', async () => {
  assert.equal(await kindOf(client(async () => failure(503, { message: 'busy' })).generate({ history })), 'server');
  assert.equal(await kindOf(client(async () => failure(400, { message: 'bad json' })).generate({ history })), 'bad-request');
});

test('an unreachable network (or CORS block) is "network"', async () => {
  const c = client(async () => {
    throw new TypeError('Failed to fetch');
  });
  assert.equal(await kindOf(c.generate({ history })), 'network');
});

test('a call that takes too long is "timeout"', async () => {
  // A fetch that never answers but honours the abort signal, like the real one.
  const hang: typeof fetch = (_u, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  assert.equal(await kindOf(client(hang, () => KEY, 30).generate({ history })), 'timeout');
});

test('the caller can cancel a call in flight, or before it starts', async () => {
  const hang: typeof fetch = (_u, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  const ctl = new AbortController();
  const p = kindOf(client(hang).generate({ history, signal: ctl.signal }));
  setTimeout(() => ctl.abort(), 10);
  assert.equal(await p, 'cancelled');
  assert.equal(await kindOf(client(hang).generate({ history, signal: ctl.signal })), 'cancelled', 'already aborted');
});

test('blocked prompts and stopped replies are "blocked", an empty reply is "empty"', async () => {
  const blockedPrompt = client(async () => new Response(JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }), { status: 200 }));
  assert.equal(await kindOf(blockedPrompt.generate({ history })), 'blocked');
  const stopped = client(async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'SAFETY' }] }), { status: 200 }));
  assert.equal(await kindOf(stopped.generate({ history })), 'blocked');
  const empty = client(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '  ' }] }, finishReason: 'STOP' }] }), { status: 200 }));
  assert.equal(await kindOf(empty.generate({ history })), 'empty');
});

test('the key never appears in an error message, even if the provider echoes it back', async () => {
  const echo = client(async () => failure(400, { message: `Invalid argument for key ${KEY}` }));
  await assert.rejects(echo.generate({ history }), (e: unknown) => e instanceof ModelError && !e.message.includes(KEY));
  const netEcho = client(async () => {
    throw new TypeError(`connect failed for ${KEY}`);
  });
  await assert.rejects(netEcho.generate({ history }), (e: unknown) => e instanceof ModelError && !e.message.includes(KEY));
});

test('the default model is a rolling alias so it does not go stale', () => {
  assert.match(DEFAULT_GEMINI_MODEL, /latest$/);
});

test('the reply reports why it stopped and how many tokens went on thinking', async () => {
  const c = client(async () =>
    ok('Hello', { usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 4, totalTokenCount: 214, thoughtsTokenCount: 200 } }),
  );
  const r = await c.generate({ history });
  assert.equal(r.finishReason, 'STOP');
  assert.equal(r.usage?.thoughtTokens, 200);
});

test('a reply cut off at the token limit comes back with finishReason MAX_TOKENS instead of failing', async () => {
  const cut = client(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'half a sen' }] }, finishReason: 'MAX_TOKENS' }] }), { status: 200 }));
  assert.deepEqual(await cut.generate({ history }).then((r) => [r.text, r.finishReason]), ['half a sen', 'MAX_TOKENS']);
  // Thinking used every token: no text at all, but the caller can retry with more room.
  const none = client(async () => new Response(JSON.stringify({ candidates: [{ finishReason: 'MAX_TOKENS' }] }), { status: 200 }));
  assert.deepEqual(await none.generate({ history }).then((r) => [r.text, r.finishReason]), ['', 'MAX_TOKENS']);
});

// ---------- tools (function calling) ----------

const reply = (parts: unknown[]): Response => new Response(JSON.stringify({ candidates: [{ content: { role: 'model', parts }, finishReason: 'STOP' }] }), { status: 200 });
const SEARCH_TOOL = { name: 'web_search', description: 'Search', parameters: { type: 'object' as const, properties: { query: { type: 'string' as const } }, required: ['query'] } };

async function sentBody(req: Parameters<ReturnType<typeof client>['generate']>[0], answer: Response = ok('x')): Promise<Record<string, unknown>> {
  let body: Record<string, unknown> = {};
  await client(async (_u, init) => {
    body = JSON.parse(String(init?.body));
    return answer;
  }).generate(req);
  return body;
}

test('tools are declared with automatic or disabled calling; without tools the request has neither field', async () => {
  const auto = await sentBody({ history, tools: [SEARCH_TOOL] });
  assert.deepEqual(auto.tools, [{ functionDeclarations: [SEARCH_TOOL] }]);
  assert.deepEqual(auto.toolConfig, { functionCallingConfig: { mode: 'AUTO' } });
  const none = await sentBody({ history, tools: [SEARCH_TOOL], toolMode: 'none' });
  assert.deepEqual(none.toolConfig, { functionCallingConfig: { mode: 'NONE' } });
  const plain = await sentBody({ history });
  assert.equal(plain.tools, undefined);
  assert.equal(plain.toolConfig, undefined);
});

test('a turn holding the provider\'s own parts goes back untouched, signature included', async () => {
  const modelParts = [{ functionCall: { id: 'call-1', name: 'web_search', args: { query: 'gold' } }, thoughtSignature: 'SIG-abc' }];
  const body = (await sentBody({
    history: [
      { role: 'user', text: 'What is the gold price?' },
      { role: 'model', text: '', parts: modelParts },
      { role: 'user', text: '', toolAnswers: [{ id: 'call-1', name: 'web_search', response: { ok: true, results: [] } }] },
    ],
    tools: [SEARCH_TOOL],
  })) as { contents: { role: string; parts: unknown[] }[] };
  assert.deepEqual(body.contents[0], { role: 'user', parts: [{ text: 'What is the gold price?' }] });
  assert.deepEqual(body.contents[1], { role: 'model', parts: modelParts }, 'echoed exactly, with its signature');
  assert.deepEqual(body.contents[2], {
    role: 'user',
    parts: [{ functionResponse: { name: 'web_search', id: 'call-1', response: { result: { ok: true, results: [] } } } }],
  });
});

test('a reply that asks for tools is returned as tool calls plus the model\'s own parts, and is not an "empty" reply', async () => {
  const parts = [
    { functionCall: { id: 'a', name: 'web_search', args: { query: 'ราคาทอง' } }, thoughtSignature: 'SIG' },
    { functionCall: { name: 'read_page', args: { url: 'https://x.example/' } } },
  ];
  const r = await client(async () => reply(parts)).generate({ history, tools: [SEARCH_TOOL] });
  assert.equal(r.text, '');
  assert.deepEqual(r.toolCalls, [
    { id: 'a', name: 'web_search', args: { query: 'ราคาทอง' } },
    { name: 'read_page', args: { url: 'https://x.example/' } },
  ]);
  assert.deepEqual(r.parts, parts);
});

test('text next to a tool call is kept; thinking parts never count as text; a plain reply has no tool fields', async () => {
  const mixed = await client(async () => reply([{ text: 'Let me check. ' }, { functionCall: { name: 'web_search', args: {} } }])).generate({ history });
  assert.equal(mixed.text, 'Let me check. ');
  assert.equal(mixed.toolCalls?.length, 1);
  const thought = await client(async () => reply([{ text: 'secret reasoning', thought: true }, { text: 'Visible answer' }])).generate({ history });
  assert.equal(thought.text, 'Visible answer');
  const plain = await client(async () => ok('hello')).generate({ history });
  assert.equal('toolCalls' in plain, false);
  assert.equal('parts' in plain, false);
});
