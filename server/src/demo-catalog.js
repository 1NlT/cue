import { validateSavedEvent } from './domain.js';

// 시연용 예시 행사. 실제 일정이 아니므로 description 첫 문장에 명시하고 sourceUrl은 넣지 않는다.
const samples = [
  { title: '생성형 AI 실무 활용 세미나', category: '강연', format: '세미나', domains: ['AI', '소프트웨어'], tags: ['인공지능', '생성형AI'], venue: '서울 강남구 코엑스 컨퍼런스룸', day: 3, hour: 14, hours: 3, description: '생성형 AI를 업무와 서비스에 적용한 사례를 나누는 세미나' },
  { title: 'AI 시대의 미래교육 토론회', category: '강연', format: '토론회', domains: ['AI', '교육', '정책'], tags: ['미래교육', '교육정책'], venue: '서울 서초구 국립중앙도서관 국제회의장', day: 5, hour: 15, hours: 2, description: '인공지능이 바꾸는 교실과 교육 정책 방향을 논의하는 토론회' },
  { title: '대학생 AI 해커톤 데모데이', category: '워크숍', format: '해커톤', domains: ['AI', '소프트웨어', '창업'], tags: ['해커톤', '스타트업'], venue: '서울 성동구 서울숲 D.CAMP', day: 7, hour: 13, hours: 5, description: '24시간 해커톤 결과물을 발표하고 투자자 피드백을 받는 데모데이' },
  { title: '로봇과 함께하는 스마트시티 체험전', category: '박람회', format: '체험', domains: ['로봇', '과학', '소프트웨어'], tags: ['로봇', '스마트시티'], venue: '서울 마포구 상암 DMC 홍보관', day: 9, hour: 11, hours: 5, description: '서비스 로봇과 자율주행 기술을 직접 체험하는 전시형 행사' },
  { title: '클라우드·개발자 커뮤니티 밋업', category: '모임', format: '세미나', domains: ['소프트웨어', 'AI'], tags: ['개발자', '클라우드', '코딩'], venue: '서울 강남구 스파크플러스 선릉점', day: 4, hour: 19, hours: 2, description: '개발자들이 모여 프로젝트 경험과 기술 스택을 공유하는 밋업' },
  { title: '스타트업 투자 유치 전략 특강', category: '강연', format: '강연', domains: ['창업', '정책'], tags: ['창업', '스타트업', '벤처'], venue: '서울 종로구 광화문 창업허브', day: 6, hour: 18, hours: 2, description: '초기 창업가를 위한 투자 유치와 정부 지원사업 활용 특강' },
  { title: '현대미술 기획전 도슨트 투어', category: '미술 전시', format: '전시', domains: ['미술', '문화'], tags: ['현대미술', '전시'], venue: '서울 중구 서울시립미술관 서소문본관', day: 2, hour: 14, hours: 2, description: '큐레이터와 함께 기획전을 둘러보는 도슨트 투어. 추천 방문 시간 14:00~16:00' },
  { title: '미디어아트와 디자인 특별전', category: '전시', format: '전시', domains: ['디자인', '미술', '과학'], tags: ['미디어아트', '디자인'], venue: '서울 종로구 대림미술관', day: 8, hour: 14, hours: 2, description: '기술과 예술이 만나는 미디어아트 특별전. 추천 방문 시간 14:00~16:00' },
  { title: '가을 오케스트라 클래식 콘서트', category: '클래식', format: '공연', domains: ['음악', '문화'], tags: ['클래식', '오케스트라'], venue: '서울 서초구 예술의전당 콘서트홀', day: 10, hour: 19, hours: 2, description: '가을 밤에 즐기는 오케스트라 정기 연주회' },
  { title: '서울 재즈 페스티벌 나이트', category: '재즈', format: '공연', domains: ['음악'], tags: ['재즈', '콘서트'], venue: '서울 송파구 올림픽공원 88잔디마당', day: 12, hour: 17, hours: 4, description: '국내외 재즈 아티스트가 참여하는 야외 음악 페스티벌' },
  { title: '데이터 과학·연구 트렌드 컨퍼런스', category: '강연', format: '세미나', domains: ['과학', 'AI'], tags: ['과학', '연구', '머신러닝'], venue: '서울 동대문구 KAIST 서울캠퍼스', day: 11, hour: 10, hours: 6, description: '데이터 과학과 머신러닝 연구 성과를 발표하는 컨퍼런스' },
  { title: '공공데이터 정책 포럼', category: '강연', format: '토론회', domains: ['정책', '소프트웨어'], tags: ['정책', '공공데이터'], venue: '서울 중구 서울시청 다목적홀', day: 13, hour: 14, hours: 3, description: '공공데이터 개방 정책과 활용 서비스 사례를 논의하는 포럼' },
];

const kst = (base, day, hour) => {
  const date = new Date(base + 9 * 3600000);
  date.setUTCDate(date.getUTCDate() + day);
  return `${date.toISOString().slice(0, 10)}T${String(hour).padStart(2, '0')}:00:00+09:00`;
};

export function demoEvents(currentTime = Date.now()) {
  return samples.map(({ day, hour, hours, description, ...item }) => validateSavedEvent({
    ...item, tags: [...item.tags, '시연용'],
    startsAt: kst(currentTime, day, hour), endsAt: kst(currentTime, day, hour + hours),
    description: `시연용 예시 행사입니다. ${description}`,
  }));
}

export const isDemoEvent = (event) => (event.tags || []).includes('시연용');
