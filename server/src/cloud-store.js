import { randomUUID } from 'node:crypto';
import { exploreEnabled, interestSignals, memoryFromSignal, rankRecommendations } from './personalization.js';
import { classifyEvent } from './classification.js';

const tables = new Set([
  'profiles', 'events', 'event_sessions', 'user_events', 'event_interactions',
  'interest_profiles', 'goals', 'tasks', 'agent_memories', 'recommendations',
]);
const serverComputedTables = new Set(['interest_profiles', 'agent_memories', 'recommendations']);
const now = () => new Date().toISOString();
// CloudStore는 요청마다 만들어지므로, 같은 사용자의 관심도 재계산이 겹치지 않게 모듈 단위로 순서를 맞춘다.
const recomputeQueues = new Map();
const serialized = (userId, task) => {
  const run = (recomputeQueues.get(userId) || Promise.resolve()).catch(() => {}).then(task);
  const tail = run.catch(() => {}).finally(() => { if (recomputeQueues.get(userId) === tail) recomputeQueues.delete(userId); });
  recomputeQueues.set(userId, tail);
  return run;
};
const eq = (value) => `eq.${value}`;
const eventFromRow = (row, userEvent = {}) => ({
  id: row.id, title: row.title, venue: row.location_name,
  startsAt: row.start_at, endsAt: row.end_at, category: row.category,
  description: row.description, createdAt: row.created_at,
  tags: row.tags || [], ...classifyEvent({ ...row, title: row.title, description: row.description, category: row.category, tags: row.tags, domains: row.domains, format: row.format }), applicationDeadline: row.application_deadline, participationFee: row.participation_fee,
  locationAddress: row.location_address, sourceUrl: row.source_url,
  ...(userEvent.calendar_id != null ? { calendarId: userEvent.calendar_id } : {}),
  ...(userEvent.calendar_event_id != null ? { calendarEventId: userEvent.calendar_event_id } : {}),
  ...(userEvent.reminder_minutes != null ? { reminderMinutes: userEvent.reminder_minutes } : {}),
});
const eventRow = (event, userId, sourceType = 'scan') => ({
  id: event.id, owner_user_id: userId, title: event.title,
  description: event.description || '', category: event.category,
  tags: event.tags || [], format: event.format, domains: event.domains || [], participation_fee: event.participationFee || null, start_at: event.startsAt, end_at: event.endsAt,
  application_deadline: event.applicationDeadline || null,
  location_name: event.venue, location_address: event.locationAddress || null,
  source_url: event.sourceUrl || null, source_type: sourceType,
  created_at: event.createdAt || now(), updated_at: now(),
});

export class CloudStore {
  constructor({ id, token }, { url = process.env.SUPABASE_URL, key = process.env.SUPABASE_PUBLISHABLE_KEY } = {}) {
    this.userId = id;
    this.token = token;
    this.url = url.replace(/\/$/, '');
    this.key = key;
  }

  async request(method, table, { filters = {}, body, upsert, select = '*', all = false } = {}) {
    if (!tables.has(table)) throw new Error('Unsupported table');
    const computed = serverComputedTables.has(table);
    if (computed) {
      if (method === 'POST') {
        if (!Array.isArray(body) || body.some((row) => row.user_id !== this.userId))
          throw new Error('Cross-user computed write rejected');
      } else if (filters.user_id !== eq(this.userId)) {
        throw new Error('Unscoped computed request rejected');
      }
    }
    const url = new URL(`${this.url}/rest/v1/${table}`);
    for (const [name, value] of Object.entries(filters)) url.searchParams.set(name, value);
    if (method === 'GET') url.searchParams.set('select', select);
    if (upsert) url.searchParams.set('on_conflict', upsert);
    const serviceKey = computed ? process.env.SUPABASE_SERVICE_ROLE_KEY : null;
    if (computed && !serviceKey) throw Object.assign(new Error('Supabase 계산 데이터 서버 키가 필요합니다.'), { status: 503 });
    const headers = { apikey: serviceKey || this.key, authorization: `Bearer ${serviceKey || this.token}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (method !== 'GET') headers.prefer = `${upsert ? 'resolution=merge-duplicates,' : ''}return=representation`;
    const getPage = async (offset) => {
      if (all) url.searchParams.set('offset', String(offset));
      if (all) url.searchParams.set('limit', '1000');
      const response = await fetch(url, {
        method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => ({}));
        console.error('Supabase request failed:', table, method, response.status, detail.code || 'unknown');
        throw Object.assign(new Error('Supabase 데이터 저장에 실패했습니다.'), { status: 502 });
      }
      return response.status === 204 ? [] : response.json();
    };
    if (!all) return getPage(0);
    const rows = [];
    for (let offset = 0; ; offset += 1000) {
      const page = await getPage(offset);
      rows.push(...page);
      if (page.length < 1000) break;
    }
    return rows;
  }

  async one(table, filters) { return (await this.request('GET', table, { filters }))[0] || null; }
  async rows(table, filters = {}) { return this.request('GET', table, { filters, all: true }); }
  async insert(table, rows, conflict) {
    if (!rows.length) return [];
    return this.request('POST', table, { body: rows, upsert: conflict });
  }
  async patch(table, filters, body) { return this.request('PATCH', table, { filters, body }); }
  async remove(table, filters) { return this.request('DELETE', table, { filters }); }

  async migrateLocal(local) {
    if (local.cloudSynced(this.userId)) return false;
    const data = local.exportUser(this.userId);
    if (!data.events.length) { local.markCloudSynced(this.userId); return false; }
    for (const [table, keys] of [
      ['events', ['id']], ['event_sessions', ['id']], ['user_events', ['user_id', 'event_id']],
      ['event_interactions', ['id']], ['interest_profiles', ['user_id', 'interest_key']],
      ['goals', ['id']], ['tasks', ['id']],
      ['agent_memories', ['user_id', 'memory_type', 'interest_key']],
      ['recommendations', ['user_id', 'event_id']],
    ]) {
      const filter = table === 'events' ? { owner_user_id: eq(this.userId) }
        : table === 'event_sessions' ? {} : { user_id: eq(this.userId) };
      const keyFor = (row) => keys.map((key) => row[key]).join('|');
      const existing = new Set((await this.rows(table, filter)).map(keyFor));
      await this.insert(table, data[table].filter((row) => !existing.has(keyFor(row))));
    }
    local.markCloudSynced(this.userId);
    return true;
  }

  async onProfileChanged(previous, profile) {
    if (!profile.personalizationEnabled) {
      await this.remove('interest_profiles', { user_id: eq(this.userId) });
      await this.remove('agent_memories', { user_id: eq(this.userId) });
    } else if (!previous.personalizationEnabled) await this.recomputeInterests();
  }

  // 행사 여러 개를 요청 한 번(또는 100개 단위 묶음)으로 읽는다.
  async eventsByIds(ids) {
    const unique = [...new Set(ids)];
    const chunks = [];
    for (let i = 0; i < unique.length; i += 100) chunks.push(unique.slice(i, i + 100));
    const pages = await Promise.all(chunks.map((chunk) => this.rows('events', { id: `in.(${chunk.join(',')})` })));
    return new Map(pages.flat().map((row) => [row.id, row]));
  }
  async saved() {
    const links = await this.rows('user_events', { user_id: eq(this.userId), status: 'in.(saved,completed)', order: 'created_at.asc' });
    const events = await this.eventsByIds(links.map((link) => link.event_id));
    return links.flatMap((link) => events.has(link.event_id) ? [eventFromRow(events.get(link.event_id), link)] : []);
  }
  // 백그라운드 재계산이 끝난 뒤의 관심도를 읽도록 기다린다.
  async settled() { await recomputeQueues.get(this.userId); }
  async interests() {
    await this.settled();
    return (await this.rows('interest_profiles', { user_id: eq(this.userId), order: 'score.desc' }))
      .map((row) => ({ interestKey: row.interest_key, score: row.score, confidence: row.confidence,
        evidenceCount: row.evidence_count, lastUpdatedAt: row.last_updated_at }));
  }
  async memories() {
    await this.settled();
    return (await this.rows('agent_memories', { user_id: eq(this.userId), or: `(expires_at.is.null,expires_at.gt.${now()})` }))
      .map((row) => ({ id: row.id, memoryType: row.memory_type, content: row.content,
        confidence: row.confidence, evidenceCount: row.evidence_count, expiresAt: row.expires_at }));
  }
  async eventVisible(_userId, eventId) { return this.one('events', { id: eq(eventId) }); }
  async save(_userId, event) {
    await this.insert('events', [eventRow(event, this.userId)]);
    try {
      await this.insert('event_sessions', [{ id: randomUUID(), event_id: event.id, label: '',
        start_at: event.startsAt, end_at: event.endsAt, location_name: event.venue }]);
      await this.insert('user_events', [{ user_id: this.userId, event_id: event.id,
        status: 'saved', origin: 'scan', calendar_id: event.calendarId,
        calendar_event_id: event.calendarEventId, reminder_minutes: event.reminderMinutes }]);
      await this.interact(this.userId, event.id, 'saved');
    } catch (error) {
      await this.remove('events', { id: eq(event.id), owner_user_id: eq(this.userId) }).catch(() => {});
      throw error;
    }
    return event;
  }
  async updateSaved(_userId, eventId, event) {
    const link = await this.one('user_events', { user_id: eq(this.userId), event_id: eq(eventId), status: 'in.(saved,completed)' });
    const current = await this.one('events', { id: eq(eventId), owner_user_id: eq(this.userId) });
    if (!link || !current) return null;
    const row = eventRow({ ...event, id: eventId, createdAt: current.created_at }, this.userId);
    delete row.id; delete row.owner_user_id; delete row.created_at; delete row.source_type;
    await this.patch('events', { id: eq(eventId), owner_user_id: eq(this.userId) }, row);
    await this.patch('event_sessions', { event_id: eq(eventId) }, {
      start_at: event.startsAt, end_at: event.endsAt, location_name: event.venue,
    });
    await this.patch('user_events', { user_id: eq(this.userId), event_id: eq(eventId) }, {
      calendar_id: event.calendarId, calendar_event_id: event.calendarEventId,
      reminder_minutes: event.reminderMinutes, updated_at: now(),
    });
    await this.recomputeInterests();
    return { ...event, id: eventId, createdAt: current.created_at };
  }
  async removeSaved(_userId, eventId) {
    const link = await this.one('user_events', { user_id: eq(this.userId), event_id: eq(eventId), status: 'in.(saved,completed)' });
    if (!link || !(await this.one('events', { id: eq(eventId), owner_user_id: eq(this.userId) }))) return false;
    await this.patch('user_events', { user_id: eq(this.userId), event_id: eq(eventId) }, {
      status: 'unsaved', calendar_id: null, calendar_event_id: null, updated_at: now(),
    });
    await this.interact(this.userId, eventId, 'unsaved');
    return true;
  }
  async interact(_userId, eventId, action, metadata = {}) {
    const [event, profile] = await Promise.all([
      this.eventVisible(this.userId, eventId), this.one('profiles', { user_id: eq(this.userId) })]);
    if (!event) return false;
    const work = [];
    if (profile?.personalization_enabled) {
      // 기록만 저장하고 응답한다. 관심도 재계산은 뒤에서 하며 읽기 쪽이 끝나길 기다린다.
      work.push(this.insert('event_interactions', [{ id: randomUUID(), user_id: this.userId,
        event_id: eventId, action, metadata }]).then(() => {
        this.recomputeInterests().catch((error) => console.error('Interest recompute:', error instanceof Error ? error.message : error));
      }));
    }
    if (['interested', 'not_interested', 'recommendation_opened'].includes(action)) {
      const status = action === 'not_interested' ? 'dismissed' : action === 'interested' ? 'interested' : 'viewed';
      const field = action === 'not_interested' ? 'dismissed_at' : action === 'interested' ? 'accepted_at' : 'opened_at';
      work.push(this.insert('user_events', [{ user_id: this.userId, event_id: eventId,
        status, origin: 'recommendation', updated_at: now() }], 'user_id,event_id'));
      work.push(this.patch('recommendations', { user_id: eq(this.userId), event_id: eq(eventId) }, { [field]: now() }));
    }
    await Promise.all(work);
    return true;
  }
  recomputeInterests() { return serialized(this.userId, () => this.computeInterests()); }
  async computeInterests() {
    const rows = await this.rows('event_interactions', { user_id: eq(this.userId) });
    const events = await this.eventsByIds(rows.map((row) => row.event_id));
    const scores = interestSignals(rows.map((row) => ({ ...row,
      ...events.get(row.event_id), metadata: row.metadata,
    })));
    const interests = [], memories = [];
    for (const [key, value] of scores) {
      interests.push({ user_id: this.userId, interest_key: key,
        score: Math.round(value.score * 100) / 100,
        confidence: Math.min(0.95, 0.2 + value.count * 0.15),
        evidence_count: value.count, last_updated_at: now() });
      const memory = memoryFromSignal(key, value);
      if (memory) memories.push({ id: randomUUID(), user_id: this.userId,
        memory_type: memory.memoryType, interest_key: key, content: memory.content,
        confidence: memory.confidence, evidence_count: value.count,
        expires_at: new Date(Date.now() + 90 * 86400000).toISOString() });
    }
    await Promise.all([this.remove('interest_profiles', { user_id: eq(this.userId) }),
      this.remove('agent_memories', { user_id: eq(this.userId) })]);
    await Promise.all([this.insert('interest_profiles', interests, 'user_id,interest_key'),
      this.insert('agent_memories', memories, 'user_id,memory_type,interest_key')]);
  }
  async recommendations(_userId, { seed = null, seen = new Set() } = {}) {
    await this.settled();
    // 서로 독립적인 조회는 한꺼번에 보낸다. 카탈로그는 아직 끝나지 않은 행사만 읽는다.
    const [profile, firstInterests, links, catalogRows, saved] = await Promise.all([
      this.one('profiles', { user_id: eq(this.userId) }),
      this.interests(),
      this.rows('user_events', { user_id: eq(this.userId) }),
      this.rows('events', { source_type: 'eq.catalog', end_at: `gt.${now()}` }),
      this.saved(),
    ]);
    if (!profile?.personalization_enabled || !profile.recommendation_enabled) return [];
    let interestRows = firstInterests;
    if (!interestRows.some((row) => row.interestKey.startsWith('domain:')) &&
        (await this.rows('event_interactions', { user_id: eq(this.userId), action: 'eq.saved' })).length) {
      await this.recomputeInterests();
      interestRows = await this.interests();
    }
    const interests = new Map(interestRows.map((row) => [row.interestKey, row.score]));
    const excluded = new Set(links.filter((row) => ['saved', 'planned', 'completed', 'dismissed', 'unsaved'].includes(row.status))
      .map((row) => row.event_id));
    const catalog = catalogRows.map((row) => eventFromRow(row));
    const results = rankRecommendations({ catalog, saved, interests, excluded, explore: exploreEnabled(), seed, seen });
    // 추천 기록 저장은 응답을 막지 않는다.
    this.insert('recommendations', results.map((event) => ({
      user_id: this.userId, event_id: event.id,
      recommendation_score: event.score, reason: event.reason,
    })), 'user_id,event_id').catch(() => {});
    return results;
  }
  async createGoal(_userId, eventId, title) {
    if (!(await this.eventVisible(this.userId, eventId))) return null;
    const existing = await this.one('goals', { user_id: eq(this.userId), related_event_id: eq(eventId), status: 'eq.active' });
    if (existing) return { id: existing.id, userId: this.userId, relatedEventId: eventId,
      title: existing.title, status: existing.status, createdAt: existing.created_at };
    const id = randomUUID(), timestamp = now();
    await this.insert('goals', [{ id, user_id: this.userId, related_event_id: eventId,
      title, status: 'active', created_at: timestamp }]);
    await this.insert('tasks', [{ id: randomUUID(), user_id: this.userId, goal_id: id,
      title: '행사 일정과 참가 방법 확인', created_at: timestamp }]);
    await this.interact(this.userId, eventId, 'plan_created');
    await this.insert('user_events', [{ user_id: this.userId, event_id: eventId,
      status: 'planned', origin: 'recommendation', updated_at: timestamp }], 'user_id,event_id');
    await this.patch('recommendations', { user_id: eq(this.userId), event_id: eq(eventId) }, { accepted_at: timestamp });
    return { id, userId: this.userId, relatedEventId: eventId, title, status: 'active', createdAt: timestamp };
  }
  async goals() { return this.rows('goals', { user_id: eq(this.userId), order: 'created_at.desc' }); }
}

export async function importCloudCatalog(events) {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw Object.assign(new Error('Supabase 카탈로그 서버 키가 필요합니다.'), { status: 503 });
  const write = async (table, rows) => {
    const response = await fetch(`${url}/rest/v1/${table}`, {
      method: 'POST',
      headers: { apikey: key, authorization: `Bearer ${key}`,
        'content-type': 'application/json', prefer: 'return=minimal' },
      body: JSON.stringify(rows), signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      console.error('Supabase catalog import failed:', table, response.status);
      throw Object.assign(new Error('Supabase 행사 목록 저장에 실패했습니다.'), { status: 502 });
    }
  };
  await write('events', events.map((event) => eventRow(event, null, 'catalog')));
  await write('event_sessions', events.map((event) => ({ id: randomUUID(), event_id: event.id,
    label: '', start_at: event.startsAt, end_at: event.endsAt, location_name: event.venue })));
}
