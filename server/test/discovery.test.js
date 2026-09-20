import test from 'node:test';
import assert from 'node:assert/strict';
import { discoveryTopic, verifiedDiscoveries } from '../src/discovery.js';
import { rankRecommendations } from '../src/personalization.js';

const currentTime = Date.parse('2026-09-20T00:00:00+09:00');
const detail = 'https://sema.seoul.go.kr/kr/whatson/exhibition/detail?exNo=1579618';
const candidate = { title: '최혜련 개인전', category: '미술 전시', tags: ['설치미술'],
  startsAt: '2026-09-23T14:00:00+09:00', endsAt: '2026-09-23T16:00:00+09:00',
  venue: '서울', description: '추천 방문 시간', sourceUrl: detail };

test('only sourced, future event detail pages enter discovery catalog', () => {
  const response = {
    status: 'completed',
    output: [
      { type: 'web_search_call', action: { sources: [{ url: detail }] } },
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ events: [
        candidate,
        { ...candidate, title: '출처 없는 행사', sourceUrl: 'https://example.com/event' },
        { ...candidate, title: '지난 행사', startsAt: '2026-09-19T14:00:00+09:00' },
      ] }) }] },
    ],
  };
  const events = verifiedDiscoveries(response, currentTime);
  assert.equal(events.length, 1);
  assert.equal(events[0].sourceUrl, detail);
  assert.equal(events[0].category, '미술 전시');
});

test('broad saved category matches verified finer exhibition category', () => {
  assert.equal(discoveryTopic(new Map([['domain:미술', 8], ['domain:기타', 20]])), '미술 전시');
  const results = rankRecommendations({
    catalog: [{ id: 'detail', ...candidate }], saved: [],
    interests: new Map([['domain:미술', 8]]), excluded: new Set(), currentTime,
  });
  assert.equal(results.length, 1);
  assert.ok(results[0].score > 0);
});

test('next edition search keeps only the same sourced upcoming event and picks the nearest', async () => {
  const { findNextEdition, eventCoreName } = await import('../src/discovery.js');
  assert.equal(eventCoreName('제25회 2025 서울억새축제'), '서울억새축제');
  const source = (n) => n === 2 ? 'https://blog.example.com/festival/2' : `https://www.example.go.kr/festival/${n}`;
  const event = (title, day, n) => ({ ...candidate, title, category: '음악 페스티벌', venue: '하늘공원',
    startsAt: `2026-10-${day}T15:00:00+09:00`, endsAt: `2026-10-${day}T20:00:00+09:00`, sourceUrl: source(n) });
  const replies = [[event('제26회 서울억새축제', '30', 1)], [event('서울억새축제 2026', '16', 2), event('전혀 다른 행사', '10', 3)], []];
  let call = 0;
  const fetchImpl = async () => {
    const events = replies[call++ % replies.length];
    return new Response(JSON.stringify({ status: 'completed', output: [
      { type: 'web_search_call', action: { sources: [1, 2, 3].map((n) => ({ url: source(n) })) } },
      { type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ events }) }] },
    ] }), { status: 200 });
  };
  const past = { title: '2025 서울억새축제', venue: '하늘공원', category: '커뮤니티', endedAt: '2025-10-19T18:00:00+09:00' };
  const found = await findNextEdition(past, { fetchImpl, currentTime });
  // 더 이른 일정이 있어도 공공 도메인 출처를 우선한다.
  assert.equal(found.title, '제26회 서울억새축제');
  assert.equal(found.startsAt, '2026-10-30T06:00:00.000Z');
  const failing = async () => { throw new Error('network'); };
  assert.equal(await findNextEdition(past, { fetchImpl: failing, currentTime }), null);
});
