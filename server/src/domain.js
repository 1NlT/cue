import { randomUUID } from 'node:crypto';
import { categories } from './categories.js';
import { classifyEvent } from './classification.js';

export { categories } from './categories.js';
const hasTimezone = (value) => /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/.test(value);
const invalid = (message) => Object.assign(new Error(message), { status: 400 });

// 같은 장소에서 시간이 이어지거나 겹치는 항목은 한 행사의 식순이므로 하나의 세션으로 합친다.
function mergeContiguousSessions(items) {
  const merged = [];
  for (const item of [...items].sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))) {
    const last = merged[merged.length - 1];
    if (last && last.venue === item.venue && Date.parse(item.startsAt) <= Date.parse(last.endsAt)) {
      if (Date.parse(item.endsAt) > Date.parse(last.endsAt)) last.endsAt = item.endsAt;
      last.label = '';
    } else merged.push({ ...item });
  }
  return merged;
}

export function cleanExtraction(raw) {
  if (!raw || raw.is_event !== true) return null;
  const title = String(raw.title || '').trim().slice(0, 120);
  const category = categories.includes(raw.category) ? raw.category : '기타';
  const tags = (Array.isArray(raw.tags) ? raw.tags : []).filter((tag) => typeof tag === 'string')
    .map((tag) => tag.trim().slice(0, 40)).filter(Boolean).slice(0, 8);
  const rawSessions = (Array.isArray(raw.sessions) ? raw.sessions : [])
    .slice(0, 12)
    .map((item) => ({
      label: String(item.label || '').trim().slice(0, 80),
      startsAt: String(item.starts_at || '').trim(),
      endsAt: String(item.ends_at || '').trim(),
      venue: String(item.venue || '').trim().slice(0, 160),
    }))
    .filter((item) => {
      const start = Date.parse(item.startsAt);
      const end = Date.parse(item.endsAt);
      return hasTimezone(item.startsAt) && hasTimezone(item.endsAt) && Number.isFinite(start) && Number.isFinite(end) && end > start && item.venue;
    });
  const sessions = mergeContiguousSessions(rawSessions);
  const classification = classifyEvent({ ...raw, title, category, tags });
  return {
    id: randomUUID(), title, category, tags, ...classification,
    description: String(raw.description || '').trim().slice(0, 500),
    applicationDeadline: typeof raw.application_deadline === 'string' &&
      hasTimezone(raw.application_deadline) && Number.isFinite(Date.parse(raw.application_deadline))
      ? raw.application_deadline : null,
    participationFee: String(raw.participation_fee || '').trim().slice(0, 100) || null,
    fieldStatus: {
      applicationDeadline: typeof raw.application_deadline === 'string' &&
        hasTimezone(raw.application_deadline) && Number.isFinite(Date.parse(raw.application_deadline)) ? 'known' : 'unknown',
      participationFee: raw.participation_fee ? 'known' : 'unknown',
    },
    sessions,
    needsManualDetails: sessions.length === 0,
  };
}

export function validateSavedEvent(body) {
  const title = String(body.title || '').trim().slice(0, 120);
  const venue = String(body.venue || '').trim().slice(0, 160);
  const start = Date.parse(body.startsAt);
  const end = Date.parse(body.endsAt);
  if (!title || !venue || !hasTimezone(String(body.startsAt || '')) || !hasTimezone(String(body.endsAt || '')) || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw invalid('행사 이름, 장소, 올바른 시작·종료 시간이 필요합니다.');
  }
  if (end - start > 7 * 24 * 60 * 60 * 1000) throw invalid('행사 기간이 너무 깁니다.');
  const calendarId = typeof body.calendarId === 'string' ? body.calendarId.trim().slice(0, 256) : null;
  const calendarEventId = typeof body.calendarEventId === 'string' ? body.calendarEventId.trim().slice(0, 256) : null;
  if (Boolean(calendarId) !== Boolean(calendarEventId)) throw invalid('캘린더 연결 정보가 올바르지 않습니다.');
  const reminderMinutes = body.reminderMinutes == null ? null : Number(body.reminderMinutes);
  if (reminderMinutes != null && ![-1, 15, 60, 1440].includes(reminderMinutes)) throw invalid('알림 설정이 올바르지 않습니다.');
  const tags = (Array.isArray(body.tags) ? body.tags : []).filter((tag) => typeof tag === 'string')
    .map((tag) => tag.trim().slice(0, 40)).filter(Boolean).slice(0, 8);
  const applicationDeadline = body.applicationDeadline == null ? null : String(body.applicationDeadline);
  if (applicationDeadline && (!hasTimezone(applicationDeadline) || !Number.isFinite(Date.parse(applicationDeadline)))) throw invalid('신청 마감일이 올바르지 않습니다.');
  const sourceUrl = typeof body.sourceUrl === 'string' && /^https:\/\//.test(body.sourceUrl) ? body.sourceUrl.slice(0, 500) : null;
  const classification = classifyEvent(body);
  return {
    id: randomUUID(), title, venue,
    startsAt: new Date(start).toISOString(), endsAt: new Date(end).toISOString(),
    category: categories.includes(body.category) ? body.category : '기타',
    tags, ...classification, applicationDeadline: applicationDeadline ? new Date(applicationDeadline).toISOString() : null,
    participationFee: String(body.participationFee || '').trim().slice(0, 100) || null,
    locationAddress: String(body.locationAddress || '').trim().slice(0, 200) || null, sourceUrl,
    description: String(body.description || '').trim().slice(0, 500),
    calendarId, calendarEventId, reminderMinutes,
    createdAt: new Date().toISOString(),
  };
}

export function recommendations(profile, catalog, now = Date.now()) {
  const saved = profile.saved || [];
  if (saved.length === 0) return [];
  const counts = Object.create(null);
  for (const event of saved) counts[event.category] = (counts[event.category] || 0) + 1;
  const existing = new Set(saved.map((event) => `${event.title}|${event.startsAt}`));
  return catalog
    .filter((event) => Date.parse(event.endsAt) > now && !existing.has(`${event.title}|${event.startsAt}`) && counts[event.category] > 0)
    .map((event) => ({ ...event, score: counts[event.category] || 0 }))
    .sort((a, b) => b.score - a.score || Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .slice(0, 12);
}
