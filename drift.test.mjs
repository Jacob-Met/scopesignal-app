import test from 'node:test';
import assert from 'node:assert/strict';
import { parseThread, findMomentsByRules, scopeOf, reviseByRules, summarize, messagesFromTranscript } from './src/drift.mjs';
import { SAMPLE_PROJECT, SAMPLE_THREAD } from './src/drift-sample.mjs';

const project = { project: { label: SAMPLE_PROJECT.label, brief: SAMPLE_PROJECT.brief }, checkpoints: SAMPLE_PROJECT.checkpoints.map(c => ({ title: c.title, amount: Number(c.amount) * 100, proposedEvidence: c.evidence })) };

test('parses a pasted thread with times and speakers', () => {
  const m = parseThread(SAMPLE_THREAD);
  assert.equal(m.length, 9);
  assert.equal(m[3].who, 'Mara'); assert.equal(m[3].at, '09:41'); assert.equal(m[4].mine, true);
});
test('flags asks outside the agreed scope and not plain praise', () => {
  const found = findMomentsByRules(parseThread(SAMPLE_THREAD), scopeOf(project));
  const titles = found.map(f => f.title.toLowerCase());
  assert.ok(titles.some(t => t.includes('shopfront banner')));
  assert.ok(titles.some(t => t.includes('packaging')));
  assert.ok(!found.some(f => /love the wheat/i.test(f.quote)));
  assert.ok(found.every(f => f.priceCents >= 5000 && /^Ready when/.test(f.readyWhen)));
});
test('corrections change price and ready-when', () => {
  const card = { priceCents: 30000, readyWhen: 'Ready when it is done.', title: 'X' };
  assert.equal(reviseByRules(card, 'make it $350').priceCents, 35000);
  assert.match(reviseByRules(card, 'ready when the PDF is print-ready').readyWhen, /^Ready when the PDF is print-ready\.$/);
  assert.equal(reviseByRules(card, 'double it').priceCents, 60000);
});
test('recording lines become timed messages and summary marks drift', () => {
  assert.equal(messagesFromTranscript([{ start: 65, end: 70, text: 'hello' }])[0].at, '1:05');
  assert.equal(summarize({ messages: [1], cards: [{ verdict: 'pending' }] }).status, 'drifting');
  assert.equal(summarize({ messages: [1], cards: [{ verdict: 'in_scope' }] }).status, 'on_scope');
});
