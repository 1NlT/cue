import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanExtraction, recommendations, validateSavedEvent } from '../src/domain.js';

test('rejects non-events before creating any candidate', () => {
  assert.equal(cleanExtraction({ is_event: false, title: 'Sale', sessions: [] }), null);
});

test('keeps distinct time and venue choices, ignoring unusable candidates', () => {
  const event = cleanExtraction({
    is_event: true, title: '음악 축제', category: '음악', description: '',
    sessions: [
      { label: '토요일', starts_at: '2026-10-03T18:00:00+09:00', ends_at: '2026-10-03T20:00:00+09:00', venue: '서울' },
      { label: '일요일', starts_at: '2026-10-04T18:00:00+09:00', ends_at: '2026-10-04T20:00:00+09:00', venue: '부산' },
      { label: '불확실', starts_at: '', ends_at: '', venue: '' },
    ],
  });
  assert.equal(event.sessions.length, 2);
  assert.equal(event.sessions[1].venue, '부산');
});

test('recommendations require a saved interest and a future matching event', () => {
  const catalog = [
    { title: '전시 A', category: '전시', startsAt: '2027-01-02T00:00:00Z', endsAt: '2027-01-03T00:00:00Z' },
    { title: '음악 B', category: '음악', startsAt: '2027-01-02T00:00:00Z', endsAt: '2027-01-03T00:00:00Z' },
  ];
  assert.deepEqual(recommendations({ saved: [] }, catalog, 0), []);
  assert.deepEqual(recommendations({ saved: [{ title: '전시 X', category: '전시', startsAt: '2026-01-01T00:00:00Z' }] }, catalog, 0).map((e) => e.title), ['전시 A']);
});

test('saved events require an ordered time and a location', () => {
  assert.throws(() => validateSavedEvent({ title: '행사', venue: '', startsAt: '2027-01-01T10:00:00Z', endsAt: '2027-01-01T09:00:00Z' }));
});
