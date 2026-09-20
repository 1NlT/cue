import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudStore } from '../src/cloud-store.js';

test('overlapping interest recomputes for one user never run at the same time', async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  const userId = '11111111-1111-1111-1111-111111111111';
  const realFetch = globalThis.fetch;
  const log = [];
  globalThis.fetch = async (url, options) => {
    const target = new URL(url);
    if (!target.pathname.startsWith('/rest/v1/')) return realFetch(url, options);
    // 재계산 하나는 event_interactions 읽기로 시작해 interest_profiles 저장으로 끝난다.
    const isStart = target.pathname.endsWith('/event_interactions') && options.method === 'GET';
    const isEnd = target.pathname.endsWith('/interest_profiles') && options.method === 'POST';
    if (isStart) log.push('start');
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (isEnd) log.push('end');
    const rows = isStart ? [{ event_id: '22222222-2222-2222-2222-222222222222', action: 'saved', metadata: {}, created_at: new Date().toISOString() }] : [];
    return new Response(JSON.stringify(rows), { status: 200 });
  };
  try {
    const store = () => new CloudStore({ id: userId, token: 't' }, { url: 'https://example.supabase.co', key: 'k' });
    await Promise.all([store().recomputeInterests(), store().recomputeInterests(), store().recomputeInterests()]);
    assert.deepEqual(log, ['start', 'end', 'start', 'end', 'start', 'end']);
  } finally { globalThis.fetch = realFetch; }
});
