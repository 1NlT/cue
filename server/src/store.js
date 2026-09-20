import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { interestSignals, memoryFromSignal, rankRecommendations } from './personalization.js';
import { classifyEvent } from './classification.js';

const databasePath = path.resolve(process.env.CUE_DB_FILE || 'data/cue.sqlite');
fs.mkdirSync(path.dirname(databasePath), { recursive: true, mode: 0o700 });
const db = new DatabaseSync(databasePath);
if (databasePath !== ':memory:') fs.chmodSync(databasePath, 0o600);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
db.exec(`
CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS cloud_sync_state (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, synced_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS profiles (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  onboarding_completed INTEGER NOT NULL DEFAULT 0, personalization_enabled INTEGER NOT NULL DEFAULT 1,
  recommendation_enabled INTEGER NOT NULL DEFAULT 1, locale TEXT NOT NULL DEFAULT 'ko-KR',
  timezone TEXT NOT NULL DEFAULT 'Asia/Seoul', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL, tags TEXT NOT NULL DEFAULT '[]',
  start_at TEXT NOT NULL, end_at TEXT NOT NULL, application_deadline TEXT,
  location_name TEXT NOT NULL, location_address TEXT, source_url TEXT,
  source_type TEXT NOT NULL CHECK(source_type IN ('scan','recommendation','catalog','import')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS event_sessions (id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT '', start_at TEXT NOT NULL, end_at TEXT NOT NULL,
  location_name TEXT NOT NULL, location_address TEXT);
CREATE TABLE IF NOT EXISTS user_events (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('discovered','viewed','interested','saved','planned','completed','dismissed','unsaved')),
  origin TEXT NOT NULL CHECK(origin IN ('scan','recommendation')),
  calendar_id TEXT, calendar_event_id TEXT, reminder_minutes INTEGER,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id,event_id));
CREATE TABLE IF NOT EXISTS event_interactions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE, action TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS interest_profiles (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  interest_key TEXT NOT NULL, score REAL NOT NULL, confidence REAL NOT NULL,
  evidence_count INTEGER NOT NULL, last_updated_at TEXT NOT NULL, PRIMARY KEY(user_id,interest_key));
CREATE TABLE IF NOT EXISTS goals (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  related_event_id TEXT REFERENCES events(id) ON DELETE SET NULL, title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, target_at TEXT, completed_at TEXT);
CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE, depends_on_task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
  title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, due_at TEXT, completed_at TEXT);
CREATE TABLE IF NOT EXISTS agent_memories (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  memory_type TEXT NOT NULL, interest_key TEXT NOT NULL, content TEXT NOT NULL,
  confidence REAL NOT NULL, evidence_count INTEGER NOT NULL, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, expires_at TEXT, UNIQUE(user_id,memory_type,interest_key));
CREATE TABLE IF NOT EXISTS recommendations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  recommendation_score REAL NOT NULL, reason TEXT NOT NULL, created_at TEXT NOT NULL,
  opened_at TEXT, dismissed_at TEXT, accepted_at TEXT, UNIQUE(user_id,event_id));
CREATE INDEX IF NOT EXISTS events_owner_idx ON events(owner_user_id);
CREATE INDEX IF NOT EXISTS user_events_user_idx ON user_events(user_id,status);
CREATE INDEX IF NOT EXISTS interactions_user_idx ON event_interactions(user_id,created_at);
CREATE INDEX IF NOT EXISTS recommendations_user_idx ON recommendations(user_id,created_at);
`);

for (const [column, type] of [['format', "TEXT NOT NULL DEFAULT '기타'"], ['domains', "TEXT NOT NULL DEFAULT '[]'"], ['participation_fee', 'TEXT']]) {
  if (!db.prepare('PRAGMA table_info(events)').all().some((row) => row.name === column)) db.exec(`ALTER TABLE events ADD COLUMN ${column} ${type}`);
}
const now = () => new Date().toISOString();
const bool = (value) => value === 1;
const asEvent = (row) => ({
  id: row.id, title: row.title, venue: row.location_name,
  startsAt: row.start_at, endsAt: row.end_at, category: row.category,
  description: row.description, createdAt: row.created_at,
  tags: JSON.parse(row.tags || '[]'), ...classifyEvent({ ...row, tags: JSON.parse(row.tags || '[]'), domains: JSON.parse(row.domains || '[]') }), applicationDeadline: row.application_deadline, participationFee: row.participation_fee,
  locationAddress: row.location_address, sourceUrl: row.source_url,
  ...(row.calendar_id != null ? { calendarId: row.calendar_id } : {}),
  ...(row.calendar_event_id != null ? { calendarEventId: row.calendar_event_id } : {}),
  ...(row.reminder_minutes != null ? { reminderMinutes: row.reminder_minutes } : {}),
});

function insertEvent(event, ownerId, sourceType) {
  const timestamp = event.createdAt || now();
  db.prepare(`INSERT INTO events(id,owner_user_id,title,description,category,tags,start_at,end_at,application_deadline,location_name,
    location_address,source_url,source_type,created_at,updated_at,format,domains,participation_fee) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(event.id, ownerId, event.title, event.description || '', event.category,
      JSON.stringify(event.tags || []), event.startsAt, event.endsAt, event.applicationDeadline || null,
      event.venue, event.locationAddress || null, event.sourceUrl || null, sourceType, timestamp, timestamp, event.format || '기타', JSON.stringify(event.domains || []), event.participationFee || null);
  db.prepare(`INSERT INTO event_sessions(id,event_id,start_at,end_at,location_name) VALUES(?,?,?,?,?)`)
    .run(randomUUID(), event.id, event.startsAt, event.endsAt, event.venue);
}

function transact(work) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = work(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

function migrateLegacy() {
  if (db.prepare('SELECT count(*) AS total FROM users').get().total > 0) return;
  let legacy;
  try { legacy = JSON.parse(fs.readFileSync(path.resolve(process.env.CUE_DATA_FILE || 'data/cue.json'), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  transact(() => {
    for (const user of Object.values(legacy.users || {})) {
      const timestamp = user.createdAt || now();
      db.prepare('INSERT INTO users(id,token_hash,created_at) VALUES(?,?,?)').run(user.id, user.tokenHash, timestamp);
      db.prepare('INSERT INTO profiles(user_id,created_at,updated_at) VALUES(?,?,?)').run(user.id, timestamp, timestamp);
      for (const event of user.saved || []) {
        insertEvent(event, user.id, 'scan');
        db.prepare(`INSERT INTO user_events(user_id,event_id,status,origin,calendar_id,calendar_event_id,reminder_minutes,created_at,updated_at)
          VALUES(?,?,'saved','scan',?,?,?,?,?)`).run(user.id, event.id, event.calendarId || null,
          event.calendarEventId || null, event.reminderMinutes ?? null, timestamp, timestamp);
        db.prepare(`INSERT INTO event_interactions(id,user_id,event_id,action,created_at) VALUES(?,?,?,'saved',?)`)
          .run(randomUUID(), user.id, event.id, timestamp);
      }
    }
    for (const event of legacy.catalog || []) insertEvent(event, null, 'catalog');
  });
}
migrateLegacy();

export const store = {
  createUser(id, tokenHash) {
    const timestamp = now();
    transact(() => {
      db.prepare('INSERT INTO users(id,token_hash,created_at) VALUES(?,?,?)').run(id, tokenHash, timestamp);
      db.prepare('INSERT INTO profiles(user_id,created_at,updated_at) VALUES(?,?,?)').run(id, timestamp, timestamp);
    });
  },
  userByTokenHash(tokenHash) { return db.prepare('SELECT id FROM users WHERE token_hash = ?').get(tokenHash) || null; },
  ensureSupabaseUser(userId) {
    if (db.prepare('SELECT id FROM users WHERE id=?').get(userId)) return;
    this.createUser(userId, createHash('sha256').update(`supabase:${userId}`).digest('hex'));
  },
  cloudSynced(userId) { return !!db.prepare('SELECT 1 FROM cloud_sync_state WHERE user_id=?').get(userId); },
  markCloudSynced(userId) {
    db.prepare('INSERT OR REPLACE INTO cloud_sync_state(user_id,synced_at) VALUES(?,?)').run(userId, now());
  },
  claimLegacyAccount(userId, legacyTokenHash) {
    const old = this.userByTokenHash(legacyTokenHash);
    if (!old || old.id === userId) return false;
    if (db.prepare('SELECT count(*) AS total FROM user_events WHERE user_id=?').get(userId).total > 0) return false;
    transact(() => {
      db.prepare('UPDATE events SET owner_user_id=? WHERE owner_user_id=?').run(userId,old.id);
      for (const table of ['user_events','event_interactions','interest_profiles','goals','tasks','agent_memories','recommendations'])
        db.prepare(`UPDATE ${table} SET user_id=? WHERE user_id=?`).run(userId,old.id);
      db.prepare(`UPDATE profiles SET onboarding_completed=old.onboarding_completed,
        personalization_enabled=old.personalization_enabled,recommendation_enabled=old.recommendation_enabled,
        locale=old.locale,timezone=old.timezone,updated_at=? FROM profiles old WHERE profiles.user_id=? AND old.user_id=?`)
        .run(now(),userId,old.id);
      db.prepare('DELETE FROM users WHERE id=?').run(old.id);
    });
    return true;
  },
  profile(userId) {
    const row = db.prepare('SELECT * FROM profiles WHERE user_id = ?').get(userId);
    return row && { userId: row.user_id, onboardingCompleted: bool(row.onboarding_completed),
      personalizationEnabled: bool(row.personalization_enabled), recommendationEnabled: bool(row.recommendation_enabled),
      locale: row.locale, timezone: row.timezone, createdAt: row.created_at, updatedAt: row.updated_at };
  },
  updateProfile(userId, changes) {
    const old = this.profile(userId);
    if (!old) return null;
    const personalization = typeof changes.personalizationEnabled === 'boolean' ? changes.personalizationEnabled : old.personalizationEnabled;
    const recommendations = typeof changes.recommendationEnabled === 'boolean' ? changes.recommendationEnabled : old.recommendationEnabled;
    const onboarding = typeof changes.onboardingCompleted === 'boolean' ? changes.onboardingCompleted : old.onboardingCompleted;
    const locale = typeof changes.locale === 'string' && changes.locale.length <= 16 ? changes.locale : old.locale;
    const timezone = typeof changes.timezone === 'string' && changes.timezone.length <= 64 ? changes.timezone : old.timezone;
    db.prepare(`UPDATE profiles SET personalization_enabled=?,recommendation_enabled=?,onboarding_completed=?,locale=?,timezone=?,updated_at=? WHERE user_id=?`)
      .run(+personalization, +recommendations, +onboarding, locale, timezone, now(), userId);
    if (!personalization) db.prepare('DELETE FROM interest_profiles WHERE user_id=?').run(userId);
    if (!personalization) db.prepare('DELETE FROM agent_memories WHERE user_id=?').run(userId);
    if (personalization && !old.personalizationEnabled) this.recomputeInterests(userId);
    return this.profile(userId);
  },
  saved(userId) { return db.prepare(`SELECT e.*,ue.calendar_id,ue.calendar_event_id,ue.reminder_minutes FROM user_events ue
    JOIN events e ON e.id=ue.event_id WHERE ue.user_id=? AND ue.status IN ('saved','completed') ORDER BY ue.created_at`).all(userId).map(asEvent); },
  catalog() { return db.prepare("SELECT * FROM events WHERE source_type='catalog' ORDER BY start_at").all().map(asEvent); },
  importCatalog(events) { transact(() => { for (const event of events) insertEvent(event, null, 'catalog'); }); },
  save(userId, event) {
    transact(() => {
      insertEvent(event, userId, 'scan');
      db.prepare(`INSERT INTO user_events(user_id,event_id,status,origin,calendar_id,calendar_event_id,reminder_minutes,created_at,updated_at)
        VALUES(?,?,'saved','scan',?,?,?,?,?)`).run(userId, event.id, event.calendarId, event.calendarEventId,
        event.reminderMinutes, event.createdAt, event.createdAt);
      this.interact(userId, event.id, 'saved');
    });
    return event;
  },
  updateSaved(userId, eventId, event) {
    const current = db.prepare(`SELECT e.id,e.created_at FROM events e JOIN user_events ue ON ue.event_id=e.id
      WHERE e.id=? AND e.owner_user_id=? AND ue.user_id=? AND ue.status IN ('saved','completed')`).get(eventId, userId, userId);
    if (!current) return null;
    transact(() => {
      db.prepare(`UPDATE events SET title=?,description=?,category=?,tags=?,start_at=?,end_at=?,application_deadline=?,
        location_name=?,location_address=?,source_url=?,updated_at=?,format=?,domains=?,participation_fee=? WHERE id=? AND owner_user_id=?`)
        .run(event.title,event.description,event.category,JSON.stringify(event.tags || []),event.startsAt,event.endsAt,
          event.applicationDeadline || null,event.venue,event.locationAddress || null,event.sourceUrl || null,now(),event.format,JSON.stringify(event.domains || []),event.participationFee || null,eventId,userId);
      db.prepare(`UPDATE event_sessions SET start_at=?,end_at=?,location_name=? WHERE event_id=?`)
        .run(event.startsAt,event.endsAt,event.venue,eventId);
      db.prepare(`UPDATE user_events SET calendar_id=?,calendar_event_id=?,reminder_minutes=?,updated_at=? WHERE user_id=? AND event_id=?`)
        .run(event.calendarId,event.calendarEventId,event.reminderMinutes,now(),userId,eventId);
      this.recomputeInterests(userId);
    });
    return { ...event, id: eventId, createdAt: current.created_at };
  },
  removeSaved(userId, eventId) {
    const row = db.prepare(`SELECT e.id FROM events e JOIN user_events ue ON ue.event_id=e.id
      WHERE e.id=? AND e.owner_user_id=? AND ue.user_id=? AND ue.status IN ('saved','completed')`).get(eventId,userId,userId);
    if (!row) return false;
    transact(() => {
      db.prepare("UPDATE user_events SET status='unsaved',calendar_id=NULL,calendar_event_id=NULL,updated_at=? WHERE user_id=? AND event_id=?")
        .run(now(),userId,eventId);
      this.interact(userId,eventId,'unsaved');
    });
    return true;
  },
  eventVisible(userId, eventId) {
    return db.prepare('SELECT * FROM events WHERE id=? AND (owner_user_id IS NULL OR owner_user_id=?)').get(eventId,userId) || null;
  },
  interact(userId, eventId, action, metadata = {}) {
    const event = this.eventVisible(userId,eventId);
    if (!event) return false;
    const profile = this.profile(userId);
    if (profile?.personalizationEnabled) {
      db.prepare('INSERT INTO event_interactions(id,user_id,event_id,action,metadata,created_at) VALUES(?,?,?,?,?,?)')
        .run(randomUUID(),userId,eventId,action,JSON.stringify(metadata),now());
      this.recomputeInterests(userId);
    }
    if (['interested','not_interested','recommendation_opened'].includes(action)) {
      const status = action === 'not_interested' ? 'dismissed' : action === 'interested' ? 'interested' : 'viewed';
      db.prepare(`INSERT INTO user_events(user_id,event_id,status,origin,created_at,updated_at) VALUES(?, ?, ?, 'recommendation', ?, ?)
        ON CONFLICT(user_id,event_id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at`)
        .run(userId,eventId,status,now(),now());
      if (action === 'not_interested') db.prepare('UPDATE recommendations SET dismissed_at=? WHERE user_id=? AND event_id=?').run(now(),userId,eventId);
      if (action === 'recommendation_opened') db.prepare('UPDATE recommendations SET opened_at=? WHERE user_id=? AND event_id=?').run(now(),userId,eventId);
      if (action === 'interested') db.prepare('UPDATE recommendations SET accepted_at=? WHERE user_id=? AND event_id=?').run(now(),userId,eventId);
    }
    return true;
  },
  recomputeInterests(userId) {
    const rows = db.prepare(`SELECT i.action,i.created_at,i.metadata,e.title,e.description,e.category,e.tags,e.format,e.domains FROM event_interactions i JOIN events e ON e.id=i.event_id WHERE i.user_id=?`).all(userId);
    const scores = interestSignals(rows);
    const activeMemories = new Set();
    db.prepare('DELETE FROM interest_profiles WHERE user_id=?').run(userId);
    for (const [key,value] of scores) {
      db.prepare('INSERT INTO interest_profiles(user_id,interest_key,score,confidence,evidence_count,last_updated_at) VALUES(?,?,?,?,?,?)')
        .run(userId,key,Math.round(value.score*100)/100,Math.min(0.95,0.2+value.count*0.15),value.count,now());
      const memory = memoryFromSignal(key,value);
      if (memory) {
        activeMemories.add(`${memory.memoryType}|${key}`);
        db.prepare(`INSERT INTO agent_memories(id,user_id,memory_type,interest_key,content,confidence,evidence_count,created_at,updated_at,expires_at)
          VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,memory_type,interest_key) DO UPDATE SET
          content=excluded.content,confidence=excluded.confidence,evidence_count=excluded.evidence_count,
          updated_at=excluded.updated_at,expires_at=excluded.expires_at`)
          .run(randomUUID(),userId,memory.memoryType,key,memory.content,memory.confidence,value.count,now(),now(),new Date(Date.now()+90*86400000).toISOString());
      }
    }
    for (const old of db.prepare('SELECT id,memory_type,interest_key FROM agent_memories WHERE user_id=?').all(userId)) {
      if (!activeMemories.has(`${old.memory_type}|${old.interest_key}`))
        db.prepare('DELETE FROM agent_memories WHERE id=? AND user_id=?').run(old.id,userId);
    }
  },
  interests(userId) { return db.prepare('SELECT interest_key AS interestKey,score,confidence,evidence_count AS evidenceCount,last_updated_at AS lastUpdatedAt FROM interest_profiles WHERE user_id=? ORDER BY score DESC').all(userId); },
  memories(userId) { return db.prepare('SELECT id,memory_type AS memoryType,content,confidence,evidence_count AS evidenceCount,expires_at AS expiresAt FROM agent_memories WHERE user_id=? AND (expires_at IS NULL OR expires_at>?)').all(userId,now()); },
  recommendations(userId) {
    const profile = this.profile(userId);
    if (!profile?.personalizationEnabled || !profile.recommendationEnabled) return [];
    if (!this.interests(userId).some((item) => item.interestKey.startsWith('domain:')) &&
        db.prepare("SELECT 1 FROM event_interactions WHERE user_id=? AND action='saved' LIMIT 1").get(userId))
      this.recomputeInterests(userId);
    const interests = new Map(this.interests(userId).map((item) => [item.interestKey,item.score]));
    const excluded = new Set(db.prepare("SELECT event_id FROM user_events WHERE user_id=? AND status IN ('saved','planned','completed','dismissed','unsaved')").all(userId).map((item) => item.event_id));
    const results = rankRecommendations({ catalog: this.catalog(), saved: this.saved(userId), interests, excluded });
    for (const event of results) {
      db.prepare(`INSERT INTO recommendations(id,user_id,event_id,recommendation_score,reason,created_at) VALUES(?,?,?,?,?,?)
        ON CONFLICT(user_id,event_id) DO UPDATE SET recommendation_score=excluded.recommendation_score,reason=excluded.reason`)
        .run(randomUUID(),userId,event.id,event.score,event.reason,now());
    }
    return results;
  },
  createGoal(userId, eventId, title) {
    if (!this.eventVisible(userId,eventId)) return null;
    const existing = db.prepare("SELECT * FROM goals WHERE user_id=? AND related_event_id=? AND status='active'").get(userId,eventId);
    if (existing) return { id: existing.id, userId, relatedEventId: eventId, title: existing.title,
      status: existing.status, createdAt: existing.created_at };
    const id = randomUUID(), timestamp = now();
    transact(() => {
      db.prepare('INSERT INTO goals(id,user_id,related_event_id,title,created_at) VALUES(?,?,?,?,?)').run(id,userId,eventId,title,timestamp);
      db.prepare('INSERT INTO tasks(id,user_id,goal_id,title,created_at) VALUES(?,?,?,?,?)')
        .run(randomUUID(),userId,id,'행사 일정과 참가 방법 확인',timestamp);
      this.interact(userId,eventId,'plan_created');
      db.prepare(`INSERT INTO user_events(user_id,event_id,status,origin,created_at,updated_at) VALUES(?,?,'planned','recommendation',?,?)
        ON CONFLICT(user_id,event_id) DO UPDATE SET status='planned',updated_at=excluded.updated_at`)
        .run(userId,eventId,timestamp,timestamp);
      db.prepare('UPDATE recommendations SET accepted_at=? WHERE user_id=? AND event_id=?').run(timestamp,userId,eventId);
    });
    return { id,userId,relatedEventId:eventId,title,status:'active',createdAt:timestamp };
  },
  goals(userId) { return db.prepare('SELECT * FROM goals WHERE user_id=? ORDER BY created_at DESC').all(userId); },
  exportUser(userId) {
    const rows = (table, column = 'user_id') => db.prepare(`SELECT * FROM ${table} WHERE ${column}=?`).all(userId);
    const events = rows('events', 'owner_user_id').map((row) => ({ ...row,
      tags: JSON.parse(row.tags || '[]'), domains: JSON.parse(row.domains || '[]') }));
    const eventIds = new Set(events.map((event) => event.id));
    return {
      events,
      event_sessions: db.prepare('SELECT * FROM event_sessions').all().filter((row) => eventIds.has(row.event_id)),
      user_events: rows('user_events').filter((row) => eventIds.has(row.event_id)),
      event_interactions: rows('event_interactions').filter((row) => eventIds.has(row.event_id))
        .map((row) => ({ ...row, metadata: JSON.parse(row.metadata || '{}') })),
      interest_profiles: rows('interest_profiles'), goals: rows('goals'), tasks: rows('tasks'),
      agent_memories: rows('agent_memories'),
      recommendations: rows('recommendations').filter((row) => eventIds.has(row.event_id)),
    };
  },
  deleteAccount(userId) { db.prepare('DELETE FROM users WHERE id=?').run(userId); },
  close() { db.close(); },
};
