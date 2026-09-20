import test from 'node:test';
import assert from 'node:assert/strict';
import { CloudStore } from '../src/cloud-store.js';

test('overlapping interest recomputes for one user never run at the same time', async () => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  const userId = '11111111-1111-1111-1111-111111111111';
  const realFetch = globalThis.fetch;
  let active = 0, overlapped = false;
  const upserts = [];
  globalThis.fetch = async (url, options) => {
    const target = new URL(url);
    if (!target.pathname.startsWith('/rest/v1/')) return realFetch(url, options);
    active += 1;
    if (active > 1) overlapped = true;
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    if (options.method === 'POST') upserts.push([target.pathname, target.searchParams.get('on_conflict')]);
    return new Response(options.method === 'GET' ? '[]' : '[]', { status: 200 });
  };
  try {
    const store = () => new CloudStore({ id: userId, token: 't' }, { url: 'https://example.supabase.co', key: 'k' });
    await Promise.all([store().recomputeInterests(), store().recomputeInterests(), store().recomputeInterests()]);
    assert.equal(overlapped, false);
  } finally { globalThis.fetch = realFetch; }
});
