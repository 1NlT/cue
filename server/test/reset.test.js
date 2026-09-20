import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('resetting interests clears learned data but keeps saved events', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cue-reset-'));
  Object.assign(process.env, { CUE_TEST_MODE: '1', CUE_DEMO_MODE: '0', SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '',
    CATALOG_ADMIN_TOKEN: 'admin', CUE_DATA_FILE: path.join(directory, 'data.json'), CUE_DB_FILE: path.join(directory, 'data.sqlite') });
  const { server } = await import('../src/server.js');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (route, token, body, method = 'POST') => {
    const response = await fetch(`${base}${route}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, body: await response.json() };
  };
  try {
    const { token } = await (await fetch(`${base}/v1/session`, { method: 'POST' })).json();
    const event = (title, day) => ({ title, venue: '서울', category: '음악', startsAt: `2027-02-0${day}T18:00:00+09:00`, endsAt: `2027-02-0${day}T20:00:00+09:00` });
    await call('/v1/catalog/import', 'admin', { events: [event('추천 음악회', 3), event('다른 음악회', 4)] });
    assert.equal((await call('/v1/events', token, event('내 음악회', 1))).status, 201);
    const recommended = (await call('/v1/recommendations', token, null, 'GET')).body.events;
    assert.ok(recommended.length >= 1);
    assert.equal((await call('/v1/interactions', token, { eventId: recommended[0].id, action: 'not_interested' })).status, 201);
    const before = (await call('/v1/me', token, null, 'GET')).body;
    assert.ok(before.interests.length > 0);

    assert.equal((await call('/v1/interests', token, null, 'DELETE')).status, 200);
    const after = (await call('/v1/me', token, null, 'GET')).body;
    assert.deepEqual(after.interests, []);
    assert.equal(after.saved.length, 1);
    // 관심사가 비었으므로 추천도 처음 상태(개인화 추천 없음)로 돌아간다.
    const again = (await call('/v1/recommendations', token, null, 'GET')).body.events;
    assert.equal(again.length, 0);
    assert.equal((await call('/v1/memories', token, null, 'GET')).body.memories.length, 0);
  } finally { server.close(); }
});
