import test from 'node:test';
import assert from 'node:assert/strict';
import { interestSignals, memoryFromSignal, rankRecommendations } from '../src/personalization.js';

test('explicit feedback outweighs views and old signals fade', () => {
  const currentTime = Date.parse('2027-01-01T00:00:00Z');
  const signals = interestSignals([
    { action: 'viewed', category: '전시', created_at: '2026-12-31T00:00:00Z' },
    { action: 'not_interested', category: '전시', created_at: '2026-12-31T00:00:00Z' },
    { action: 'saved', category: '음악', created_at: '2026-01-01T00:00:00Z' },
  ], currentTime);
  assert.ok(signals.get('전시').score < 0);
  assert.ok(signals.get('음악').score < 0.1);
  assert.equal(memoryFromSignal('전시', signals.get('전시')).memoryType, 'avoidance');
  assert.equal(memoryFromSignal('음악', signals.get('음악')), null);
});

test('topic tags contribute to interest separately from broad categories', () => {
  const scores = interestSignals([
    { action: 'saved', category: '교육', tags: '["AI","Programming"]', created_at: '2027-01-01T00:00:00Z' },
  ], Date.parse('2027-01-01T00:00:00Z'));
  assert.equal(scores.get('교육').score, 4);
  assert.equal(scores.get('AI').score, 2.4);
  assert.equal(scores.get('Programming').score, 2.4);
});

test('canceling a calendar entry does not erase topic interest', () => {
  const timestamp = '2027-01-01T00:00:00Z';
  const scores = interestSignals([
    { action: 'saved', category: '전시', created_at: timestamp },
    { action: 'unsaved', category: '전시', created_at: timestamp },
  ], Date.parse(timestamp));
  assert.equal(scores.get('전시').score, 3);
});

test('recommendations filter expired deadlines and saved schedule conflicts', () => {
  const event = (id, startsAt, endsAt, deadline = null) =>
    ({ id, title: id, category: '음악', startsAt, endsAt, applicationDeadline: deadline });
  const catalog = [
    event('good', '2027-02-01T10:00:00Z', '2027-02-01T12:00:00Z'),
    event('conflict', '2027-02-01T15:00:00Z', '2027-02-01T17:00:00Z'),
    event('closed', '2027-02-02T10:00:00Z', '2027-02-02T12:00:00Z', '2026-01-01T00:00:00Z'),
  ];
  const results = rankRecommendations({ catalog, saved: [event('own', '2027-02-01T16:00:00Z', '2027-02-01T18:00:00Z')],
    interests: new Map([['음악', 4]]), excluded: new Set(), currentTime: Date.parse('2027-01-01T00:00:00Z') });
  assert.deepEqual(results.map((item) => item.id), ['good']);
  assert.match(results[0].reason, /음악/);
});
