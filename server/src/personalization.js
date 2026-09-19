// Raw interactions are kept in the store; these rules can change without changing the schema.
import { categoryGroup } from './categories.js';
export const personalizationRules = Object.freeze({
  decayDays: 90,
  interestWeights: Object.freeze({
    viewed: 0.2, recommendation_opened: 0.3, interested: 2,
    saved: 4, plan_created: 5, completed: 4,
    not_interested: -3, recommendation_dismissed: -2, unsaved: -1,
  }),
});

export function interestSignals(interactions, currentTime = Date.now()) {
  const scores = new Map();
  for (const row of interactions) {
    const weight = personalizationRules.interestWeights[row.action] ?? 0;
    if (!weight) continue;
    const ageDays = Math.max(0, (currentTime - Date.parse(row.created_at)) / 86400000);
    const value = weight * Math.exp(-ageDays / personalizationRules.decayDays);
    const tags = typeof row.tags === 'string' ? JSON.parse(row.tags || '[]') : (row.tags || []);
    for (const [key, strength] of [[row.category, 1], ...tags.map((tag) => [tag, 0.6])]) {
      if (!key || typeof key !== 'string') continue;
      const entry = scores.get(key) || { score: 0, count: 0 };
      entry.score += value * strength;
      entry.count += 1;
      scores.set(key, entry);
    }
  }
  return scores;
}

export function rankRecommendations({ catalog, saved, interests, excluded, currentTime = Date.now() }) {
  const categoryScore = (category) => {
    const exact = interests.get(category) || 0;
    const family = categoryGroup(category);
    if (family === '기타' || category === family) return exact;
    const related = Math.max(0, ...[...interests.entries()]
      .filter(([key]) => categoryGroup(key) === family)
      .map(([, score]) => score));
    return exact + related * 0.55;
  };
  return catalog
    .filter((event) => Date.parse(event.endsAt) > currentTime &&
      (!event.applicationDeadline || Date.parse(event.applicationDeadline) > currentTime) &&
      !excluded.has(event.id) &&
      !saved.some((own) => own.title === event.title) &&
      !saved.some((own) => Date.parse(own.startsAt) < Date.parse(event.endsAt) &&
        Date.parse(event.startsAt) < Date.parse(own.endsAt)))
    .map((event) => ({ ...event, score: categoryScore(event.category) +
      Math.max(0,...(event.tags || []).map((tag) => interests.get(tag) || 0)) * 0.6 }))
    .filter((event) => event.score > 0)
    .sort((a, b) => b.score - a.score || Date.parse(a.startsAt) - Date.parse(b.startsAt))
    .slice(0, 12)
    .map((event) => ({ ...event, reason: `${event.category} 행사에 보인 관심을 바탕으로 추천해요.` }));
}

export function memoryFromSignal(key, value) {
  if (value.count < 2 || Math.abs(value.score) < 2) return null;
  const positive = value.score > 0;
  return {
    memoryType: positive ? 'interest' : 'avoidance',
    content: positive ? `${key} 행사에 반복적으로 관심을 보였습니다.` : `${key} 행사에 반복적으로 관심 없음을 표시했습니다.`,
    confidence: Math.min(0.95, 0.2 + value.count * 0.15),
  };
}
