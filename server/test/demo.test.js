import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { demoEvents } from '../src/demo-catalog.js';
import { rankRecommendations } from '../src/personalization.js';

test('demo events are valid, upcoming and marked as samples', () => {
  const currentTime = Date.parse('2026-09-20T00:00:00+09:00');
  const events = demoEvents(currentTime);
  assert.ok(events.length >= 10);
  assert.ok(events.every((event) => Date.parse(event.startsAt) > currentTime && event.description.startsWith('시연용 예시')));
});

test('explore mode recommends upcoming events even without interests', () => {
  const currentTime = Date.parse('2026-09-20T00:00:00+09:00');
  const catalog = demoEvents(currentTime);
  const args = { catalog, saved: [], interests: new Map(), excluded: new Set(), currentTime };
  assert.equal(rankRecommendations({ ...args, explore: false }).length, 0);
  const results = rankRecommendations({ ...args, explore: true });
  assert.ok(results.length >= 6);
  const withInterest = rankRecommendations({ ...args, interests: new Map([['domain:AI', 4]]), explore: true });
  assert.ok(withInterest[0].domains.includes('AI') && withInterest[0].score > 1);
});

test('demo mode seeds the catalog so a brand-new user gets recommendations', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cue-demo-'));
  Object.assign(process.env, { CUE_TEST_MODE: '1', CUE_DEMO_MODE: '1', SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '',
    CUE_DATA_FILE: path.join(directory, 'data.json'), CUE_DB_FILE: path.join(directory, 'data.sqlite') });
  const { server } = await import('../src/server.js');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const session = await (await fetch(`${base}/v1/session`, { method: 'POST' })).json();
    const headers = { authorization: `Bearer ${session.token}` };
    const first = (await (await fetch(`${base}/v1/recommendations`, { headers })).json()).events;
    assert.ok(first.length >= 6);
    assert.ok(first.every((event) => event.reason));
    const again = (await (await fetch(`${base}/v1/recommendations`, { headers })).json()).events;
    assert.equal(new Set(again.map((event) => event.id)).size, again.length);
    assert.deepEqual(again.map((event) => event.id), first.map((event) => event.id));
  } finally { server.close(); }
});

test('refresh seeds rotate recommendations, keep a seed stable and push seen events back', () => {
  const currentTime = Date.parse('2026-09-20T00:00:00+09:00');
  const catalog = demoEvents(currentTime).map((event, index) => ({ ...event, id: `00000000-0000-0000-0000-${String(index).padStart(12, '0')}` }));
  const args = { catalog, saved: [], interests: new Map([['domain:AI', 4]]), excluded: new Set(), currentTime, explore: true };
  const ids = (results) => results.map((event) => event.id);
  const first = ids(rankRecommendations({ ...args, seed: 1 }));
  assert.deepEqual(ids(rankRecommendations({ ...args, seed: 1 })), first);
  const second = ids(rankRecommendations({ ...args, seed: 2 }));
  assert.notDeepEqual(second, first);
  // 이미 본 행사를 넘기면 새 행사가 더 많이 들어온다.
  const third = ids(rankRecommendations({ ...args, seed: 3, seen: new Set(first) }));
  assert.ok(third.filter((id) => !first.includes(id)).length >= third.filter((id) => !second.includes(id)).length - 2);
  assert.ok(new Set(third).size === third.length);
  // 시드가 없으면 예전처럼 항상 같은 순서다.
  assert.deepEqual(ids(rankRecommendations(args)), ids(rankRecommendations(args)));
  // 관심사가 없어도 여러 번 새로고침하면 서로 다른 행사가 나온다.
  const cold = { ...args, interests: new Map() };
  const seenAcross = new Set();
  for (let seed = 1; seed <= 5; seed += 1) ids(rankRecommendations({ ...cold, seed })).forEach((id) => seenAcross.add(id));
  assert.ok(seenAcross.size > 8);
});
