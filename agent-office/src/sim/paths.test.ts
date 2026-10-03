// The less common user paths: revising the brief, and asking for changes at delivery.
// A scripted "user" answers every question the office asks. Every path runs in both languages,
// including answers typed by hand, because the simulator must not depend on the UI language.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setLang, tr } from '../core/i18n.ts';
import type { Lang } from '../core/i18n.ts';
import type { ChatReply, OfficeEvent } from '../core/types.ts';
import { MockOffice } from './simulator.ts';

type Ask = Extract<OfficeEvent, { type: 'chat.ask' }>;

/** Run a whole job with a scripted user; `decide` returns the answer to each question. */
function run(decide: (ask: Ask, n: number) => ChatReply): Promise<{ events: OfficeEvent[]; asks: Ask[] }> {
  const office = new MockOffice({ timeScale: 4000, ambient: false });
  const events: OfficeEvent[] = [];
  const asks: Ask[] = [];
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('job did not finish in time')), 20000);
    office.subscribe((e) => {
      events.push(e);
      if (e.type === 'chat.ask') {
        asks.push(e);
        const answer = decide(e, asks.length);
        setTimeout(() => office.answer(e.id, answer), 0);
      }
      if (e.type === 'job.done') {
        clearTimeout(timer);
        setTimeout(() => {
          office.dispose();
          resolve({ events, asks });
        }, 50);
      }
    });
    office.start();
  });
}

const isBriefApproval = (a: Ask): boolean => a.text.key === 'ask.approve';
const isDelivery = (a: Ask): boolean => a.text.key === 'ask.deliver';
const is = (a: Ask, key: string): boolean => a.text.key === key;
/** The default answer to questions a test does not care about: the first button, or some text. */
const defaultReply = (ask: Ask): ChatReply => (ask.choices?.[0] ? { choice: ask.choices[0].id } : { text: 'Sounds good' });

const TYPED: Record<Lang, { change: string; shorter: string; table: string; approve: string; revise: string; accept: string }> = {
  en: { change: 'Add a one-line summary at the top', shorter: 'Make it shorter please', table: 'Please add a table', approve: 'ok', revise: 'Revise', accept: 'accept' },
  th: { change: 'ขอสรุปหนึ่งบรรทัดไว้ด้านบน', shorter: 'ช่วยทำให้สั้นลงหน่อย', table: 'ช่วยเพิ่มตารางด้วย', approve: 'ตกลงครับ', revise: 'แก้ไข', accept: 'ยอมรับค่ะ' },
};

for (const lang of ['en', 'th'] as const) {
  const words = TYPED[lang];
  const label = (s: string): string => `[${lang}] ${s}`;

  test(label('pressing Revise on the brief asks what to change, updates the brief and asks again'), async () => {
    setLang(lang, false);
    let revised = false;
    const { events, asks } = await run((ask) => {
      if (isBriefApproval(ask)) {
        if (!revised) {
          revised = true;
          return { choice: 'revise' };
        }
        return { choice: 'approve' };
      }
      if (is(ask, 'ask.reviseWhat')) return { text: words.change };
      return defaultReply(ask);
    });
    const approvals = asks.filter(isBriefApproval);
    assert.equal(approvals.length, 2, 'the brief should be put to the user twice');
    assert.ok(!tr(approvals[0].text).includes(lang === 'en' ? 'Change:' : 'แก้ไข:'), 'the first brief has no change yet');
    assert.ok(tr(approvals[1].text).includes(words.change), 'the second brief must include the change');
    assert.ok(events.some((e) => e.type === 'job.done'));
    const firstAsk = events.findIndex((e) => e.type === 'chat.ask' && isBriefApproval(e));
    const secondAsk = events.findIndex((e, i) => i > firstAsk && e.type === 'chat.ask' && isBriefApproval(e));
    const rewrote = events
      .slice(firstAsk, secondAsk)
      .some((e) => e.type === 'agent.activity' && e.agent === 'secretary' && e.note?.key === 'note.updateBrief');
    assert.ok(rewrote, 'the secretary should update the brief between the two questions');
  });

  test(label('typing the bare word "revise" instead of pressing the button also asks what to change'), async () => {
    setLang(lang, false);
    let n = 0;
    const { asks } = await run((ask) => {
      if (isBriefApproval(ask)) return n++ === 0 ? { text: words.revise } : { text: words.approve };
      if (is(ask, 'ask.reviseWhat')) return { text: words.change };
      return defaultReply(ask);
    });
    assert.equal(asks.filter((a) => is(a, 'ask.reviseWhat')).length, 1);
    assert.equal(asks.filter(isBriefApproval).length, 2);
    assert.ok(tr(asks.filter(isBriefApproval)[1].text).includes(words.change));
  });

  test(label('typing a change instead of pressing a button also counts as a revision'), async () => {
    setLang(lang, false);
    let n = 0;
    const { asks } = await run((ask) => {
      if (isBriefApproval(ask)) return n++ === 0 ? { text: words.shorter } : { text: words.approve };
      return defaultReply(ask);
    });
    const approvals = asks.filter(isBriefApproval);
    assert.equal(approvals.length, 2);
    assert.ok(tr(approvals[1].text).includes(words.shorter));
    assert.equal(asks.filter((a) => is(a, 'ask.reviseWhat')).length, 0, 'free text skips the follow-up question');
  });

  test(label('Request changes at delivery sends the work back, QA re-checks, and it is delivered again before filing'), async () => {
    setLang(lang, false);
    let delivered = 0;
    const { events, asks } = await run((ask) => {
      if (isDelivery(ask)) return ++delivered === 1 ? { choice: 'request-changes' } : { choice: 'accept' };
      if (is(ask, 'ask.changeWhat')) return { text: words.shorter };
      return defaultReply(ask);
    });
    assert.equal(asks.filter(isDelivery).length, 2, 'the result should be delivered twice');
    assert.equal(asks.filter((a) => is(a, 'ask.changeWhat')).length, 1);
    const carried = events.filter((e) => e.type === 'doc.queued').map((e) => e.doc.label.key);
    const byHand = events.filter((e) => e.type === 'doc.handed').map((e) => e.doc.label.key);
    assert.ok(carried.includes('doc.changeRequest'), 'the change request crosses rooms, so the courier carries it');
    assert.ok(byHand.includes('doc.fixList'), 'the producer is handed the fix list in person (same room)');
    const passes = events.filter((e) => e.type === 'review.verdict' && e.verdict === 'pass');
    assert.equal(passes.length, 2, 'QA should pass the original and the reworked version');
    const filed = events.filter((e) => e.type === 'archive.filed');
    assert.equal(filed.length, 1, 'only the accepted version is filed');
    const lastDelivery = events.map((e, i) => (e.type === 'chat.ask' && isDelivery(e) ? i : -1)).filter((i) => i >= 0).pop() as number;
    assert.ok(events.findIndex((e) => e.type === 'archive.filed') > lastDelivery, 'filing happens after the second delivery');
  });

  test(label('answering a delivery with free text counts as a change request; typed acceptance is accepted'), async () => {
    setLang(lang, false);
    let delivered = 0;
    const { asks, events } = await run((ask) => {
      if (isDelivery(ask)) return ++delivered === 1 ? { text: words.table } : { text: words.accept };
      return defaultReply(ask);
    });
    assert.equal(asks.filter(isDelivery).length, 2);
    assert.equal(asks.filter((a) => is(a, 'ask.changeWhat')).length, 0, 'free text skips the follow-up question');
    assert.equal(events.filter((e) => e.type === 'archive.filed').length, 1);
  });

  test(label('the answer is echoed as a translatable message (button label or raw typed text)'), async () => {
    setLang(lang, false);
    const { events } = await run((ask) => (isBriefApproval(ask) ? { text: words.approve } : defaultReply(ask)));
    const says = events.filter((e) => e.type === 'user.say');
    assert.ok(says.some((e) => e.text.key === 'text' && e.text.params?.text === words.approve), 'typed text travels as raw');
    assert.ok(says.some((e) => e.text.key === 'choice.none'), 'a pressed button travels as its label key');
  });
}

test('an unknown choice id is ignored and the question stays open', async () => {
  setLang('en', false);
  const office = new MockOffice({ timeScale: 4000, ambient: false });
  let ask: Ask | undefined;
  const events: OfficeEvent[] = [];
  office.subscribe((e) => {
    events.push(e);
    if (e.type === 'chat.ask') ask = e;
  });
  office.start();
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(ask);
  office.answer(ask.id, { choice: 'nonsense' });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(events.some((e) => e.type === 'chat.closed'), false);
  office.dispose();
});
