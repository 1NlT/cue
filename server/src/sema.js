import { validateSavedEvent } from './domain.js';

const listingUrl = 'https://sema.seoul.go.kr/kr/whatson/landing?whatChoice2=N&whatChoice3=N&whatChoice4=N&whatsonMenuDivList=EX&whenType=NEXT_WEEK';
const detailUrl = (id) => `https://sema.seoul.go.kr/kr/whatson/exhibition/detail?exNo=${id}`;
const plain = (value) => String(value || '').replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

export function parseSemaListing(html) {
  return [...html.matchAll(/<div id="dv_(\d+)"[^>]*data-ex-menu-div="EXM01"[\s\S]*?<strong class="o_h1">([^<]+)<\/strong>/g)]
    .map(([, id, title]) => ({ id, title: plain(title) })).filter((item) => item.title);
}

export function parseSemaDetail(html) {
  const venue = plain(html.match(/<div class="o_h1">전시장소[\s\S]*?<\/div>\s*<p>([\s\S]*?)<\/p>/)?.[1]?.split(/<br\s*\/?\s*>/i)[0]);
  const period = plain(html.match(/<div class="o_h1">전시기간[\s\S]*?<\/div>\s*<p>([\s\S]*?)<\/p>/)?.[1]);
  const hours = plain(html.match(/<span style="white-space:\s*pre-line;?">\s*(\d\d:\d\d\s*[-~]\s*\d\d:\d\d[^<]*)<\/span>/)?.[1]);
  const dates = period.match(/(\d{4})[.\/-](\d\d)[.\/-](\d\d)\s*~\s*(\d{4})[.\/-](\d\d)[.\/-](\d\d)/);
  const times = hours.match(/(\d\d):?(\d\d)\s*[-~]\s*(\d\d):?(\d\d)/);
  if (!dates || !venue || (!times && !venue.includes('서울시립'))) return null;
  return { venue,
    firstDate: `${dates[1]}-${dates[2]}-${dates[3]}`,
    lastDate: `${dates[4]}-${dates[5]}-${dates[6]}`,
    opensAt: times ? Number(times[1]) * 60 + Number(times[2]) : 10 * 60,
    closesAt: times ? Number(times[3]) * 60 + Number(times[4]) : 18 * 60,
  };
}

function visitDate(detail, currentTime, usedDates) {
  const today = new Date(currentTime + 9 * 3600000).toISOString().slice(0, 10);
  for (let days = 1; days <= 21; days += 1) {
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    if (date.getUTCDay() === 1) continue;
    const day = date.toISOString().slice(0, 10);
    if (day < detail.firstDate || day > detail.lastDate || usedDates.has(day)) continue;
    if (detail.opensAt <= 14 * 60 && detail.closesAt >= 16 * 60)
      return day;
  }
  return null;
}

export async function discoverSemaExhibitions({ fetchImpl = fetch, currentTime = Date.now() } = {}) {
  const headers = { 'user-agent': 'Cue event recommendations (contact: github.com/1NlT/cue)' };
  const listResponse = await fetchImpl(listingUrl, { headers, signal: AbortSignal.timeout(15000) });
  if (!listResponse.ok) throw new Error('서울시립미술관 목록을 읽지 못했습니다.');
  const listing = parseSemaListing(await listResponse.text()).slice(0, 12);
  const details = await Promise.all(listing.map(async (item) => {
    try {
      const response = await fetchImpl(detailUrl(item.id), { headers, signal: AbortSignal.timeout(12000) });
      if (!response.ok) return null;
      return { ...item, detail: parseSemaDetail(await response.text()) };
    } catch { return null; }
  }));
  const events = [];
  const usedDates = new Set();
  for (const item of details) {
    if (!item?.detail || !item.detail.venue.includes('서울')) continue;
    const date = visitDate(item.detail, currentTime, usedDates);
    if (!date) continue;
    try {
      events.push(validateSavedEvent({
        title: item.title, category: item.title.includes('사진') ? '사진 전시' : '미술 전시',
        tags: ['전시'], venue: item.detail.venue,
        startsAt: `${date}T14:00:00+09:00`, endsAt: `${date}T16:00:00+09:00`,
        description: '서울시립미술관 공식 안내를 바탕으로 고른 추천 방문 시간입니다. 방문 전 운영 정보를 확인해 주세요.',
        sourceUrl: detailUrl(item.id),
      }));
      usedDates.add(date);
    } catch { /* Skip incomplete official listings. */ }
    if (events.length >= 5) break;
  }
  return events;
}
