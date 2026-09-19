import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverSemaExhibitions } from '../src/sema.js';

test('official exhibition dates become distinct future visit suggestions', async () => {
  const listing = [1, 2].map((id) =>
    `<div id="dv_${id}" data-ex-menu-div="EXM01"><strong class="o_h1">전시 ${id}</strong></div>`).join('');
  const detail = `<div class="o_h1">전시장소<!--전시장소--></div><p>서울시립미술관 1층<br>다른 장소</p>
    <div class="o_h1">전시기간<!--전시기간--></div><p>2026.09.01~2026.10.11</p>`;
  const fetchImpl = async (url) => new Response(url.includes('/landing?') ? listing : detail);
  const events = await discoverSemaExhibitions({ fetchImpl,
    currentTime: Date.parse('2026-09-20T04:00:00+09:00') });
  assert.equal(events.length, 2);
  assert.notEqual(events[0].startsAt, events[1].startsAt);
  assert.equal(events[0].venue, '서울시립미술관 1층');
  assert.ok(events.every((event) => event.sourceUrl.includes('/exhibition/detail?exNo=')));
});
