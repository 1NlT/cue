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
