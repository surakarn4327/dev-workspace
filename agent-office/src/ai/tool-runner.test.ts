// A scripted fake model and a fake toolbox: no network, no quota.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WEB_TOOLS, citedUrls, runTool, unverifiedUrls } from './agent-tools.ts';
import { ModelError } from './model-client.ts';
import type { GenerateRequest, GenerateResult, ModelClient, ToolCall } from './model-client.ts';
import { runWithTools } from './tool-runner.ts';
import type { ToolProgress } from './tool-runner.ts';
import { ToolError } from './toolbox.ts';
import type { Toolbox } from './toolbox.ts';

type Step = GenerateResult | Error;

function scriptedModel(steps: Step[]): ModelClient & { requests: GenerateRequest[] } {
  const requests: GenerateRequest[] = [];
  return {
    requests,
    async generate(req) {
      requests.push({ ...req, history: [...req.history] });
      const next = steps.shift();
      if (!next) throw new Error('the scripted model ran out of steps');
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

const asks = (...calls: ToolCall[]): GenerateResult => ({ text: '', toolCalls: calls, parts: calls.map((c) => ({ functionCall: { id: c.id, name: c.name, args: c.args }, thoughtSignature: `sig-${c.id ?? c.name}` })) });
const says = (text: string): GenerateResult => ({ text });

interface Calls {
  search: unknown[][];
  news: unknown[][];
  page: unknown[][];
}
function fakeToolbox(overrides: Partial<Toolbox> = {}): { toolbox: Pick<Toolbox, 'search' | 'news' | 'page'>; calls: Calls } {
  const calls: Calls = { search: [], news: [], page: [] };
  const toolbox: Pick<Toolbox, 'search' | 'news' | 'page'> = {
    search: async (...a) => {
      calls.search.push(a);
      return { engine: 'bing', cached: false, hits: [{ title: 'Gold price today', url: 'https://gold.example/price', snippet: '65,900 baht' }] };
    },
    news: async (...a) => {
      calls.news.push(a);
      return { cached: false, items: [{ title: 'Gold falls', source: 'Sanook', published: '2026-10-03T02:10:00.000Z', link: 'https://news.google.com/rss/articles/CBMiAAA' }] };
    },
    page: async (...a) => {
      calls.page.push(a);
      return { title: 'Gold price', description: '', text: 'Gold bar sells at 65,900 baht. '.repeat(30), chars: 900, truncated: false, language: 'en', url: String(a[0]), requestedUrl: String(a[0]), fetchedAt: '2026-10-03T00:00:00.000Z', cached: false };
    },
    ...overrides,
  };
  return { toolbox, calls };
}

const base: Omit<GenerateRequest, 'tools' | 'toolMode'> = { system: 'You are a researcher.', history: [{ role: 'user', text: 'What is the gold price today?' }] };

test('a model that needs no tools just answers: one call, tools offered, nothing recorded', async () => {
  const model = scriptedModel([says('About 65,900 baht.')]);
  const r = await runWithTools(model, base, fakeToolbox().toolbox);
  assert.equal(r.text, 'About 65,900 baht.');
  assert.deepEqual([r.steps, r.toolCalls, r.read.length, r.seen.length, r.toolsWorked], [1, 0, 0, 0, true]);
  assert.deepEqual(model.requests[0].tools, WEB_TOOLS);
  assert.equal(model.requests[0].toolMode, 'auto');
});

test('a tool round: the call is carried out, the model\'s own turn and the answer go back, then the model answers', async () => {
  const model = scriptedModel([asks({ id: 'c1', name: 'web_search', args: { query: 'ราคาทอง', region: 'th-th' } }), says('Gold is 65,900 baht (gold.example).')]);
  const { toolbox, calls } = fakeToolbox();
  const r = await runWithTools(model, base, toolbox);
  assert.equal(r.text, 'Gold is 65,900 baht (gold.example).');
  assert.equal(r.steps, 2);
  assert.deepEqual(calls.search[0].slice(0, 2), ['ราคาทอง', { region: 'th-th', limit: 6, signal: undefined }]);

  const second = model.requests[1].history;
  assert.equal(second.length, 3);
  assert.deepEqual(second[1].parts, [{ functionCall: { id: 'c1', name: 'web_search', args: { query: 'ราคาทอง', region: 'th-th' } }, thoughtSignature: 'sig-c1' }], 'the model turn is echoed exactly, signature included');
  const answer = second[2].toolAnswers?.[0];
  assert.equal(answer?.id, 'c1');
  assert.equal(answer?.name, 'web_search');
  assert.deepEqual(answer?.response, { ok: true, results: [{ title: 'Gold price today', url: 'https://gold.example/price', snippet: '65,900 baht' }] });
  assert.deepEqual(r.seen.map((s) => [s.url, s.via]), [['https://gold.example/price', 'web_search']]);
});

test('several tool calls in one reply are all answered, in order, in one turn', async () => {
  const model = scriptedModel([
    asks({ id: 'a', name: 'web_search', args: { query: 'gold' } }, { id: 'b', name: 'news_search', args: { query: 'gold', language: 'en', days: 2 } }),
    says('done'),
  ]);
  const { toolbox, calls } = fakeToolbox();
  await runWithTools(model, base, toolbox);
  assert.deepEqual(model.requests[1].history[2].toolAnswers?.map((a) => [a.id, a.name]), [['a', 'web_search'], ['b', 'news_search']]);
  assert.deepEqual(calls.news[0].slice(0, 2), ['gold', { lang: 'en', days: 2, limit: 8, signal: undefined }]);
});

test('read_page records the page as read (with the address it was asked for) and warns about near-empty pages', async () => {
  const model = scriptedModel([asks({ id: 'p', name: 'read_page', args: { url: 'https://news.google.com/rss/articles/CBMiAAA' } }), says('ok')]);
  const { toolbox } = fakeToolbox({
    page: async () => ({ title: 'Gold falls', description: '', text: 'short', chars: 5, truncated: false, language: 'en', url: 'https://www.sanook.com/money/1/', requestedUrl: 'https://news.google.com/rss/articles/CBMiAAA', fetchedAt: '', cached: false }),
  });
  const r = await runWithTools(model, base, toolbox);
  assert.deepEqual(r.read, [{ url: 'https://www.sanook.com/money/1/', title: 'Gold falls', via: 'read_page', requestedUrl: 'https://news.google.com/rss/articles/CBMiAAA' }]);
  const response = model.requests[1].history[2].toolAnswers?.[0].response as { note?: string; address: string };
  assert.equal(response.address, 'https://www.sanook.com/money/1/');
  assert.match(response.note ?? '', /JavaScript/);
});

test('the page length shown to the model is capped, whatever the model asks for', async () => {
  const sizes: number[] = [];
  const { toolbox } = fakeToolbox({
    page: async (url, o) => {
      sizes.push(o?.maxChars ?? -1);
      return { title: '', description: '', text: 'x'.repeat(400), chars: 400, truncated: false, language: 'en', url, requestedUrl: url, fetchedAt: '', cached: false };
    },
  });
  const model = scriptedModel([asks({ name: 'read_page', args: { url: 'https://a.example/', max_chars: 999_999 } }, { name: 'read_page', args: { url: 'https://b.example/', max_chars: 10 } }, { name: 'read_page', args: { url: 'https://c.example/' } }), says('ok')]);
  await runWithTools(model, base, toolbox, { maxPageChars: 3000 });
  assert.deepEqual(sizes, [3000, 500, 3000]);
});

test('a failing tool is reported to the model as an answer with advice, not thrown, and the run goes on', async () => {
  const model = scriptedModel([asks({ id: 'p', name: 'read_page', args: { url: 'https://gone.example/' } }), says('I could not open that page.')]);
  const { toolbox } = fakeToolbox({ page: async () => { throw new ToolError('not-found', 'nope'); } });
  const r = await runWithTools(model, base, toolbox);
  assert.equal(r.text, 'I could not open that page.');
  assert.deepEqual(r.errors, ['not-found']);
  assert.equal(r.toolsWorked, true, 'one dead page is not a dead helper');
  const response = model.requests[1].history[2].toolAnswers?.[0].response as { ok: boolean; error: string; advice: string };
  assert.deepEqual([response.ok, response.error], [false, 'not-found']);
  assert.match(response.advice, /different result/);
});

test('when the helper is gone the model is told so and tools are switched off for the rest of the run', async () => {
  const model = scriptedModel([asks({ name: 'web_search', args: { query: 'x' } }), says('Unchecked answer.')]);
  const { toolbox } = fakeToolbox({ search: async () => { throw new ToolError('missing', 'not running'); } });
  const r = await runWithTools(model, base, toolbox);
  assert.equal(r.toolsWorked, false);
  assert.deepEqual(r.errors, ['missing']);
  assert.equal(model.requests[1].toolMode, 'none', 'no point offering tools that cannot work');
  assert.match(String((model.requests[1].history[2].toolAnswers?.[0].response as { advice: string }).advice), /could not be checked/);
});

test('invalid tool use gets a clear error answer: unknown tool, missing words, an address that is not http(s)', async () => {
  const { toolbox, calls } = fakeToolbox();
  for (const call of [
    { name: 'delete_everything', args: {} },
    { name: 'web_search', args: {} },
    { name: 'web_search', args: { query: '   ' } },
    { name: 'news_search', args: { query: 5 } },
    { name: 'read_page', args: { url: 'file:///etc/passwd' } },
    { name: 'read_page', args: { url: 'javascript:alert(1)' } },
    { name: 'read_page', args: {} },
  ]) {
    const run = await runTool(call, { toolbox });
    assert.equal((run.answer.response as { ok: boolean }).ok, false, JSON.stringify(call));
    assert.equal(run.error, 'bad-request');
  }
  assert.deepEqual([calls.search.length, calls.news.length, calls.page.length], [0, 0, 0], 'nothing reached the helper');
});

test('asking the same thing twice costs one tool call, whatever the order of the arguments', async () => {
  const model = scriptedModel([
    asks({ id: 'a', name: 'read_page', args: { url: 'https://x.example/', max_chars: 1000 } }, { id: 'b', name: 'read_page', args: { max_chars: 1000, url: 'https://x.example/' } }),
    says('ok'),
  ]);
  const { toolbox, calls } = fakeToolbox();
  const r = await runWithTools(model, base, toolbox);
  assert.equal(calls.page.length, 1);
  assert.equal(r.toolCalls, 1);
  const answers = model.requests[1].history[2].toolAnswers ?? [];
  assert.equal(answers.length, 2, 'both calls still get an answer');
  assert.deepEqual(answers[0].response, answers[1].response);
});

test('the run is bounded: after the allowed steps the model must answer in words', async () => {
  const model = scriptedModel([
    asks({ id: '1', name: 'web_search', args: { query: 'a' } }),
    asks({ id: '2', name: 'web_search', args: { query: 'b' } }),
    says('Final answer from what I have.'),
  ]);
  const r = await runWithTools(model, base, fakeToolbox().toolbox, { maxSteps: 3 });
  assert.equal(r.text, 'Final answer from what I have.');
  assert.deepEqual(model.requests.map((q) => q.toolMode), ['auto', 'auto', 'none']);
});

test('a model that ignores "answer now" and asks for tools again: its words are used, or the run fails clearly', async () => {
  const withText = scriptedModel([{ ...asks({ name: 'web_search', args: { query: 'a' } }), text: 'Best I can say.' }]);
  assert.equal((await runWithTools(withText, base, fakeToolbox().toolbox, { maxSteps: 1 })).text, 'Best I can say.');
  const silent = scriptedModel([asks({ name: 'web_search', args: { query: 'a' } })]);
  await assert.rejects(runWithTools(silent, base, fakeToolbox().toolbox, { maxSteps: 1 }), (e: unknown) => e instanceof ModelError && e.kind === 'empty');
});

test('the number of tool calls is capped overall and per reply; extra calls are answered as skipped', async () => {
  const model = scriptedModel([
    asks(...[1, 2, 3, 4, 5].map((n) => ({ id: String(n), name: 'web_search', args: { query: `q${n}` } }))),
    says('ok'),
  ]);
  const { toolbox, calls } = fakeToolbox();
  const r = await runWithTools(model, base, toolbox, { maxPerStep: 2 });
  assert.equal(calls.search.length, 2);
  const answers = model.requests[1].history[2].toolAnswers ?? [];
  assert.equal(answers.length, 5, 'every call is answered');
  assert.equal((answers[4].response as { error: string }).error, 'skipped');
  assert.equal(r.toolCalls, 2);

  const capped = scriptedModel([asks({ id: '1', name: 'web_search', args: { query: 'a' } }), asks({ id: '2', name: 'web_search', args: { query: 'b' } }), says('enough')]);
  await runWithTools(capped, base, fakeToolbox().toolbox, { maxToolCalls: 2 });
  assert.equal(capped.requests[2].toolMode, 'none', 'with the budget spent the model must answer');
});

test('progress is reported for each tool use, and sources are recorded without repeats', async () => {
  const model = scriptedModel([asks({ id: '1', name: 'web_search', args: { query: 'a' } }), asks({ id: '2', name: 'web_search', args: { query: 'b' } }), says('ok')]);
  const events: ToolProgress[] = [];
  const r = await runWithTools(model, base, fakeToolbox().toolbox, { onProgress: (e) => events.push(e) });
  assert.deepEqual(events.map((e) => e.type), ['call', 'result', 'call', 'result']);
  assert.deepEqual(events[1], { type: 'result', name: 'web_search', ok: true, error: undefined, read: 0, seen: 1 });
  assert.equal(r.seen.length, 1, 'the same address from two searches is one source');
});

test('a cancel passes straight through, and model errors are not swallowed', async () => {
  const model = scriptedModel([asks({ name: 'web_search', args: { query: 'a' } })]);
  const { toolbox } = fakeToolbox({ search: async () => { throw new ToolError('cancelled', 'stop'); } });
  await assert.rejects(runWithTools(model, base, toolbox), (e: unknown) => e instanceof ToolError && e.kind === 'cancelled');
  const failing = scriptedModel([new ModelError('rate-limit', 'quota', { retryAfterMs: 5000 })]);
  await assert.rejects(runWithTools(failing, base, fakeToolbox().toolbox), (e: unknown) => e instanceof ModelError && e.kind === 'rate-limit');
});

// ---------- checking that cited sources are real ----------

test('addresses written in a text are found without their trailing punctuation', () => {
  assert.deepEqual(
    citedUrls('See https://www.sanook.com/money/1/, and (https://gold.example/price). Also https://gold.example/price! Done.'),
    ['https://www.sanook.com/money/1/', 'https://gold.example/price'],
  );
  assert.deepEqual(citedUrls('no links here'), []);
});

test('an address the agent never opened or saw is reported as unverified; www, scheme, case and a trailing slash do not matter', () => {
  const sources = {
    read: [{ url: 'https://www.sanook.com/money/958635/', title: 'a', via: 'read_page' as const, requestedUrl: 'https://news.google.com/rss/articles/CBMiAAA' }],
    seen: [{ url: 'https://gold.example/price', title: 'b', via: 'web_search' as const }],
  };
  const text = 'Sources: http://sanook.com/money/958635 and https://GOLD.example/price/ and https://news.google.com/rss/articles/CBMiAAA and https://made-up.example/report';
  assert.deepEqual(unverifiedUrls(text, sources), ['https://made-up.example/report']);
  assert.deepEqual(unverifiedUrls('nothing cited', sources), []);
});
