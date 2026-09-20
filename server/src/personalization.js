import { classifyEvent } from './classification.js';

export const personalizationRules = Object.freeze({
  decayDays: 90,
  interestWeights: Object.freeze({ viewed: 0.2, recommendation_opened: 0.3, interested: 2,
    saved: 4, plan_created: 5, completed: 4, not_interested: -3,
    recommendation_dismissed: -2, unsaved: -1 }),
});
const parse = (value, fallback) => { try { return typeof value === 'string' ? JSON.parse(value) : (value ?? fallback); } catch { return fallback; } };
const normalizeTag = (tag) => String(tag).toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
const aliases = { 인공지능: 'ai', 생성형ai: 'ai', 미래교육: '교육', 교육정책: '교육정책', 현대미술: '미술' };
const tagKey = (tag) => aliases[normalizeTag(tag)] || normalizeTag(tag);
const relatedDomains = {
  AI: ['소프트웨어', '로봇', '과학', '교육', '정책'],
  교육: ['AI', '정책', '과학', '소프트웨어'],
  정책: ['교육', 'AI', '과학', '창업'],
  소프트웨어: ['AI', '로봇', '과학', '창업'],
  로봇: ['AI', '소프트웨어', '과학'],
  과학: ['AI', '로봇', '소프트웨어', '교육'],
  미술: ['디자인'], 디자인: ['미술'],
  음악: [], 창업: ['소프트웨어', 'AI', '정책'],
};

export function interestSignals(interactions, currentTime = Date.now()) {
  const scores = new Map();
  for (const row of interactions) {
    const metadata = parse(row.metadata, {});
    const reason = metadata?.reason;
    const weight = row.action === 'not_interested' && reason && reason !== '관심 없는 분야'
      ? 0 : (personalizationRules.interestWeights[row.action] ?? 0);
    if (!weight) continue;
    const ageDays = Math.max(0, (currentTime - Date.parse(row.created_at)) / 86400000);
    const value = weight * Math.exp(-ageDays / personalizationRules.decayDays);
    const classification = classifyEvent({ ...row, tags: parse(row.tags, []), domains: parse(row.domains, []) });
    for (const [key, strength] of [
      ...classification.domains.filter((domain) => domain !== '기타').map((domain) => [`domain:${domain}`, 1]),
      ...parse(row.tags, []).map((tag) => [`tag:${tagKey(tag)}`, 0.55]),
      [`format:${classification.format}`, 0.12],
    ]) {
      if (!key || key.endsWith(':')) continue;
      const entry = scores.get(key) || { score: 0, count: 0 };
      entry.score += value * strength;
      entry.count += 1;
      scores.set(key, entry);
    }
  }
  return scores;
}

// 시연 모드: 관심사가 없거나 맞는 행사가 적어도 다가오는 행사를 탐색용으로 채워 보여준다.
const exploreMinimum = 6;
const exploreSize = 8;
export const exploreEnabled = () => process.env.CUE_DEMO_MODE === '1';

// 같은 seed와 행사 id면 항상 같은 0~1 값을 돌려주는 가벼운 해시. 새로고침마다 seed를 바꿔 순서를 섞는다.
function seededRandom(seed, id) {
  let h = 2166136261 ^ Number(seed);
  for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h ^= h >>> 15; h = Math.imul(h, 2246822507); h ^= h >>> 13;
  return ((h >>> 0) % 100000) / 100000;
}
const varietyJitter = 0.4;
const seenPenalty = 0.4;

export function rankRecommendations({ catalog, saved, interests, excluded, currentTime = Date.now(), explore = false, seed = null, seen = new Set() }) {
  // Old profile keys can still be read until the store recomputes them.
  const positiveDomains = [...interests.entries()].filter(([key, score]) => key.startsWith('domain:') && score > 0);
  const specificInterests = positiveDomains.filter(([key]) => !['domain:문화', 'domain:기타'].includes(key));
  const ranked = catalog
    .filter((event) => Date.parse(event.endsAt) > currentTime &&
      (!event.applicationDeadline || Date.parse(event.applicationDeadline) > currentTime) &&
      !excluded.has(event.id) && !saved.some((own) => own.title === event.title) &&
      !saved.some((own) => Date.parse(own.startsAt) < Date.parse(event.endsAt) &&
        Date.parse(event.startsAt) < Date.parse(own.endsAt)))
    .map((event) => {
      const classification = classifyEvent(event);
      const matchedDomains = classification.domains.filter((domain) => (interests.get(`domain:${domain}`) || 0) > 0 && domain !== '기타');
      const domainScore = matchedDomains.reduce((sum, domain) => sum + interests.get(`domain:${domain}`), 0);
      const relatedScore = [...interests.entries()].filter(([key, value]) => key.startsWith('domain:') && value > 0 &&
        relatedDomains[key.slice(7)]?.some((domain) => classification.domains.includes(domain)))
        .reduce((sum, [, value]) => sum + value, 0);
      const tagScore = (event.tags || []).reduce((sum, tag) => sum + Math.max(0, interests.get(`tag:${tagKey(tag)}`) || 0), 0);
      // A matching format alone must never recommend an unrelated topic.
      const eligible = positiveDomains.length > 0 && (matchedDomains.length > 0 || relatedScore > 0) &&
        (!specificInterests.length || matchedDomains.some((domain) => domain !== '문화') || relatedScore > 0);
      const formatScore = Math.max(0, interests.get(`format:${classification.format}`) || 0);
      const score = eligible ? domainScore * 4 + relatedScore * 0.6 + tagScore * 1.5 + formatScore * 0.2 : 0;
      const reason = matchedDomains.length ? `${matchedDomains.slice(0, 2).join('·')} 주제에 보인 관심을 바탕으로 추천해요.` :
        relatedScore > 0 ? '관심 주제와 가까운 분야의 행사예요.' : '';
      return { ...event, ...classification, score, reason };
    })
    .sort((a, b) => b.score - a.score || Date.parse(a.startsAt) - Date.parse(b.startsAt));
  // seed가 있으면 점수를 조금 흔들고 방금 본 행사는 뒤로 미뤄 새로고침마다 다른 행사가 섞여 나오게 한다.
  const varied = (event, base) => seed == null ? base
    : base * (1 + varietyJitter * (seededRandom(seed, event.id) * 2 - 1)) * (seen.has(event.id) ? seenPenalty : 1);
  const byVariety = (list) => seed == null ? list
    : [...list].sort((a, b) => varied(b, b.score) - varied(a, a.score));
  const matched = byVariety(ranked.filter((event) => event.score > 0));
  if (!explore || matched.length >= exploreMinimum) return matched.slice(0, 12);
  const reason = positiveDomains.length ? '새로운 관심사를 발견할 수 있는 행사예요.' : '지금 인기 있는 행사예요. 저장하면 취향에 맞춰 추천해요.';
  const filler = byVariety(ranked.filter((event) => event.score <= 0).map((event) => ({ ...event, score: 1, reason })))
    .map((event) => ({ ...event, score: 0.01 }));
  return [...matched, ...filler].slice(0, Math.max(exploreSize, matched.length));
}

export function memoryFromSignal(key, value) {
  if (value.count < 2 || Math.abs(value.score) < 2) return null;
  const positive = value.score > 0;
  const label = key.replace(/^(domain|tag|format):/, '');
  return { memoryType: positive ? 'interest' : 'avoidance',
    content: positive ? `${label} 주제에 반복적으로 관심을 보였습니다.` : `${label} 주제에 반복적으로 관심 없음을 표시했습니다.`,
    confidence: Math.min(0.95, 0.2 + value.count * 0.15) };
}
