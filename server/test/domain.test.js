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

test('analysis separates event form, topic, and unknown details', () => {
  const event = cleanExtraction({ is_event: true, title: 'AI 교육 정책방향 탐색토론회',
    category: '강연', format: '토론회', domains: ['AI', '교육', '정책'],
    tags: ['인공지능', '교육정책'], application_deadline: '', participation_fee: '', sessions: [] });
  assert.equal(event.format, '토론회');
  assert.deepEqual(event.domains, ['AI', '교육', '정책']);
  assert.equal(event.fieldStatus.applicationDeadline, 'unknown');
  assert.equal(event.fieldStatus.participationFee, 'unknown');
  assert.equal(event.applicationDeadline, null);
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

test('back-to-back programs at one venue become a single session', () => {
  const at = (from, to) => ({ label: '', starts_at: `2023-06-01T${from}:00+09:00`, ends_at: `2023-06-01T${to}:00+09:00`, venue: '태화강국가정원 남구둔치' });
  const event = cleanExtraction({
    is_event: true, title: '2023 울산공업축제', category: '음악 페스티벌', description: '',
    sessions: [
      { ...at('19:30', '20:00'), label: '서막공연' }, { ...at('20:00', '20:20'), label: '개막식' },
      { ...at('20:20', '20:40'), label: '주제공연' }, { ...at('20:40', '21:50'), label: '축하공연' },
    ],
  });
  assert.equal(event.sessions.length, 1);
  assert.equal(event.sessions[0].startsAt, '2023-06-01T19:30:00+09:00');
  assert.equal(event.sessions[0].endsAt, '2023-06-01T21:50:00+09:00');
  assert.equal(event.sessions[0].label, '');
});

test('venues merged into one line become separate choices, but detailed locations stay whole', () => {
  const session = (venue) => ({ label: '', starts_at: '2026-11-07T10:00:00+09:00', ends_at: '2026-11-07T17:30:00+09:00', venue });
  const build = (venue) => cleanExtraction({ is_event: true, title: '메이커톤', category: '교육', description: '', sessions: [session(venue)] }).sessions;
  const split = build('서울 건국대학교, 대전 KT인재개발원');
  assert.deepEqual(split.map((item) => item.venue), ['서울 건국대학교', '대전 KT인재개발원']);
  assert.deepEqual(build('서울 건국대학교 및 대전 KT인재개발원 ').map((item) => item.venue), ['서울 건국대학교', '대전 KT인재개발원']);
  assert.equal(build('서울 코엑스, 3층 A홀').length, 1);
  assert.equal(build('서울 예술의전당 콘서트홀').length, 1);
});

test('sessions whose date is not printed on the flyer are dropped so the user picks it', () => {
  const session = (dateText, day) => ({ label: '', starts_at: `2026-11-0${day}T10:00:00+09:00`, ends_at: `2026-11-0${day}T12:00:00+09:00`, venue: '서울', date_text: dateText });
  const event = cleanExtraction({ is_event: true, title: '캠프', category: '교육', description: '',
    sessions: [session('11.7(토)', 7), session('', 8), session('   ', 9), session('2일간 진행', 6), session('추후 공지', 5), session('2026년 10월 9일', 4)] });
  assert.deepEqual(event.sessions.map((item) => item.startsAt), ['2026-11-04T10:00:00+09:00', '2026-11-07T10:00:00+09:00']);
  assert.equal(cleanExtraction({ is_event: true, title: '캠프', category: '교육', description: '', sessions: [session('', 8)] }).needsManualDetails, true);
});
