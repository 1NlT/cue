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
