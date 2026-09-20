import test from 'node:test';
import assert from 'node:assert/strict';
import { interestSignals, memoryFromSignal, rankRecommendations } from '../src/personalization.js';

test('explicit feedback outweighs views and old signals fade', () => {
  const currentTime = Date.parse('2027-01-01T00:00:00Z');
  const signals = interestSignals([
    { action: 'viewed', title: '미술 전시', category: '전시', created_at: '2026-12-31T00:00:00Z' },
    { action: 'not_interested', title: '미술 전시', category: '전시', created_at: '2026-12-31T00:00:00Z' },
    { action: 'saved', title: '음악 콘서트', category: '음악', created_at: '2026-01-01T00:00:00Z' },
  ], currentTime);
  assert.ok(signals.get('domain:미술').score < 0);
  assert.ok(signals.get('domain:음악').score < 0.1);
  assert.equal(memoryFromSignal('domain:미술', signals.get('domain:미술')).memoryType, 'avoidance');
  assert.equal(memoryFromSignal('domain:음악', signals.get('domain:음악')), null);
});

test('topic tags contribute to interest separately from broad categories', () => {
  const scores = interestSignals([
    { action: 'saved', title: '교육 행사', category: '교육', tags: '["AI","Programming"]', created_at: '2027-01-01T00:00:00Z' },
  ], Date.parse('2027-01-01T00:00:00Z'));
  assert.equal(scores.get('domain:교육').score, 4);
  assert.equal(scores.get('tag:ai').score, 2.2);
  assert.equal(scores.get('tag:programming').score, 2.2);
});

test('canceling a calendar entry does not erase topic interest', () => {
  const timestamp = '2027-01-01T00:00:00Z';
  const scores = interestSignals([
    { action: 'saved', title: '미술 전시', category: '전시', created_at: timestamp },
    { action: 'unsaved', title: '미술 전시', category: '전시', created_at: timestamp },
  ], Date.parse(timestamp));
  assert.equal(scores.get('domain:미술').score, 3);
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
    interests: new Map([['domain:음악', 4]]), excluded: new Set(), currentTime: Date.parse('2027-01-01T00:00:00Z') });
  assert.deepEqual(results.map((item) => item.id), ['good']);
  assert.match(results[0].reason, /음악/);
});


test('AI education policy interest excludes art but keeps cross-format AI education', () => {
  const timestamp = '2027-01-01T00:00:00Z';
  const interests = new Map([...interestSignals([{ action: 'saved', title: 'AI 교육 정책방향 탐색토론회',
    category: '강연', tags: ['인공지능', '교육정책'], created_at: timestamp }], Date.parse(timestamp))]
    .map(([key, value]) => [key, value.score]));
  const base = { startsAt: '2027-02-01T10:00:00Z', endsAt: '2027-02-01T12:00:00Z' };
  const catalog = [
    { ...base, id: 'art', title: '신진미술인 지원 프로그램 최혜련 개인전 오늘 다시 사심을', category: '강연', tags: ['현대미술'] },
    { ...base, id: 'ai', title: 'AI 윤리 세미나', title: '교육 행사', category: '교육', tags: ['인공지능'] },
    { ...base, id: 'edu', title: '교육 AI 포럼', category: '강연', tags: ['미래교육'] },
    { ...base, id: 'future', title: '미래교육 컨퍼런스', title: '교육 행사', category: '교육', tags: ['미래교육'] },
  ];
  const results = rankRecommendations({ catalog, saved: [], interests, excluded: new Set(), currentTime: Date.parse(timestamp) });
  assert.deepEqual(new Set(results.map((item) => item.id)), new Set(['ai', 'edu', 'future']));
  assert.ok(results.every((item) => item.reason.includes('주제')));
});

test('logistical dismissal does not lower domain interest', () => {
  const timestamp = '2027-01-01T00:00:00Z';
  const rows = [{ action: 'saved', title: 'AI 세미나', created_at: timestamp },
    { action: 'not_interested', title: 'AI 세미나', metadata: { reason: '장소가 멂' }, created_at: timestamp }];
  assert.equal(interestSignals(rows, Date.parse(timestamp)).get('domain:AI').score, 4);
  rows[1].metadata.reason = '관심 없는 분야';
  assert.equal(interestSignals(rows, Date.parse(timestamp)).get('domain:AI').score, 1);
});
