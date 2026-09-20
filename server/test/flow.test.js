import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('analysis stops after rejection and approved interests drive recommendations', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cue-test-'));
  process.env.CUE_TEST_MODE = '1';
  process.env.CUE_DEMO_MODE = '0';
  process.env.CUE_DATA_FILE = path.join(directory, 'data.json');
  process.env.CUE_DB_FILE = path.join(directory, 'data.sqlite');
  process.env.SUPABASE_URL = '';
  process.env.SUPABASE_PUBLISHABLE_KEY = '';
  process.env.OPENAI_API_KEY = 'test-key';
  process.env.CATALOG_ADMIN_TOKEN = 'test-admin-token';
  const { server } = await import('../src/server.js');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const realFetch = globalThis.fetch;
  const answers = [];
  const aiInputs = [];
  let aiCalls = 0;
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith('https://api.openai.com/')) return realFetch(url, options);
    aiCalls += 1;
    aiInputs.push(JSON.parse(options.body).input[0].content);
    const answer = answers.shift();
    assert.ok(answer, 'unexpected AI call');
    return new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'output_text', text: JSON.stringify(answer) }] }] }), { status: 200 });
  };
  const request = async (route, token, body, method = 'POST') => {
    const response = await realFetch(`${base}${route}`, {
      method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body == null ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() };
  };
  try {
    const session = await request('/v1/session', null, {});
    assert.equal(session.status, 201);
    const token = session.body.token;
    for (let i = 0; i < 95; i += 1) {
      assert.equal((await request('/v1/me', token, null, 'GET')).status, 200);
    }
    const image = { image: 'data:image/jpeg;base64,AA==', timezoneOffsetMinutes: 540 };

    answers.push({ is_event: false });
    const rejected = await request('/v1/analyze', token, image);
    assert.equal(rejected.body.status, 'not_event');
    assert.equal(aiCalls, 1);

    answers.push({ is_event: false });
    const rejectedPdf = await request('/v1/analyze', token, {
      file: { name: '공지.pdf', data: Buffer.from('%PDF-1.4\n%%EOF').toString('base64') },
    });
    assert.equal(rejectedPdf.body.status, 'not_event');
    assert.equal(aiCalls, 2);
    assert.equal(aiInputs[1][1].type, 'input_file');

    answers.push({ is_event: true }, {
      is_event: true, title: '음악회', category: '음악', description: '',
      sessions: [
        { label: '금요일', starts_at: '2027-01-01T18:00:00+09:00', ends_at: '2027-01-01T20:00:00+09:00', venue: '서울' },
        { label: '토요일', starts_at: '2027-01-02T18:00:00+09:00', ends_at: '2027-01-02T20:00:00+09:00', venue: '부산' },
      ],
    });
    const accepted = await request('/v1/analyze', token, image);
    assert.equal(accepted.body.event.sessions.length, 2);
    assert.equal(aiCalls, 4);

    const catalog = await request('/v1/catalog/import', 'test-admin-token', { events: [
      { title: '다른 음악회', venue: '인천', startsAt: '2027-02-01T18:00:00+09:00', endsAt: '2027-02-01T20:00:00+09:00', category: '음악' },
      { title: '전시회', venue: '서울', startsAt: '2027-02-01T18:00:00+09:00', endsAt: '2027-02-01T20:00:00+09:00', category: '전시' },
    ] });
    assert.equal(catalog.status, 200);
    assert.equal((await request('/v1/recommendations', token, null, 'GET')).body.events.length, 0);
    const profileOff = await request('/v1/profile', token, { personalizationEnabled: false }, 'PATCH');
    assert.equal(profileOff.body.profile.personalizationEnabled, false);
    assert.equal((await request('/v1/recommendations', token, null, 'GET')).body.events.length, 0);
    const profileOn = await request('/v1/profile', token, { personalizationEnabled: true }, 'PATCH');
    assert.equal(profileOn.body.profile.personalizationEnabled, true);
    const saved = await request('/v1/events', token, {
      title: '음악회', venue: '서울', startsAt: '2027-01-01T09:00:00Z', endsAt: '2027-01-01T11:00:00Z', category: '음악',
      calendarId: 'device-calendar', calendarEventId: 'device-event', reminderMinutes: 60,
    });
    assert.equal(saved.status, 201);
    assert.equal(saved.body.event.calendarEventId, 'device-event');
    const recommendations = await request('/v1/recommendations', token, null, 'GET');
    assert.deepEqual(recommendations.body.events.map((event) => event.title), ['다른 음악회']);
    const other = await request('/v1/session', null, {});
    assert.equal((await request('/v1/interactions', other.body.token, {
      eventId: saved.body.event.id, action: 'interested',
    })).status, 404);
    const route = `/v1/events/${saved.body.event.id}`;
    assert.equal((await request(route, other.body.token, null, 'DELETE')).status, 404);
    const updated = await request(route, token, {
      title: '바뀐 전시', venue: '부산', startsAt: '2027-01-03T09:00:00Z', endsAt: '2027-01-03T11:00:00Z', category: '전시',
      calendarId: 'device-calendar', calendarEventId: 'device-event', reminderMinutes: -1,
    }, 'PATCH');
    assert.equal(updated.status, 200);
    assert.equal(updated.body.event.id, saved.body.event.id);
    assert.equal(updated.body.event.createdAt, saved.body.event.createdAt);
    assert.equal(updated.body.event.reminderMinutes, -1);
    const exhibitionRecommendations = await request('/v1/recommendations', token, null, 'GET');
    assert.deepEqual(exhibitionRecommendations.body.events.map((event) => event.title), ['전시회']);
    const exhibitionId = exhibitionRecommendations.body.events[0].id;
    assert.equal((await request(route, token, null, 'DELETE')).status, 200);
    assert.equal((await request('/v1/me', token, null, 'GET')).body.saved.length, 0);
    assert.equal((await request('/v1/recommendations', token, null, 'GET')).body.events.length, 1);
    assert.equal((await request('/v1/interactions', token, { eventId: exhibitionId, action: 'interested' })).status, 201);
    assert.equal((await request('/v1/recommendations', token, null, 'GET')).body.events.length, 1);
    const goal = await request('/v1/goals', token, { eventId: exhibitionId });
    assert.equal(goal.status, 201);
    assert.equal(goal.body.goal.relatedEventId, exhibitionId);
    assert.equal((await request('/v1/goals', token, null, 'GET')).body.goals.length, 1);
    assert.equal((await request('/v1/interactions', token, { eventId: exhibitionId, action: 'not_interested' })).status, 201);
    assert.equal((await request('/v1/recommendations', token, null, 'GET')).body.events.length, 0);
  } finally {
    globalThis.fetch = realFetch;
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
});
