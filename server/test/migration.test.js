import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('existing anonymous user and saved events survive JSON to SQLite migration', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cue-migration-'));
  const legacy = path.join(directory, 'legacy.json');
  const database = path.join(directory, 'cue.sqlite');
  const userId = 'cfe47cc3-019c-48f7-a646-f23592754e70';
  const eventId = 'fdbde6aa-bc32-44fe-a7aa-01ce769f7f8a';
  await fs.writeFile(legacy, JSON.stringify({ users: {
    [userId]: { id: userId, tokenHash: 'test-token-hash', createdAt: '2026-01-01T00:00:00Z', saved: [{
      id: eventId, title: '기존 행사', venue: '서울', startsAt: '2027-01-01T00:00:00Z',
      endsAt: '2027-01-01T02:00:00Z', category: '음악', createdAt: '2026-01-01T00:00:00Z',
    }] },
  }, catalog: [] }));
  try {
    const cwd = path.dirname(fileURLToPath(import.meta.url));
    const newUserId = '65240432-37dd-4c8c-aa98-0d8760ff5e83';
    const script = `import { store } from './src/store.js';
      store.createUser('${newUserId}','new-token-hash');
      const claimed = store.claimLegacyAccount('${newUserId}','test-token-hash');
      console.log(JSON.stringify({ claimed, old: store.userByTokenHash('test-token-hash'), user: store.userByTokenHash('new-token-hash'), saved: store.saved('${newUserId}') }));`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
      cwd: path.join(cwd, '..'), encoding: 'utf8',
      env: { ...process.env, CUE_DATA_FILE: legacy, CUE_DB_FILE: database },
    });
    assert.equal(result.status, 0, result.stderr);
    const imported = JSON.parse(result.stdout);
    assert.equal(imported.claimed, true);
    assert.equal(imported.old, null);
    assert.equal(imported.user.id, newUserId);
    assert.equal(imported.saved[0].id, eventId);
    assert.equal(imported.saved[0].title, '기존 행사');
    assert.equal((await fs.stat(database)).mode & 0o777, 0o600);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
