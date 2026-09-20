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
  { title: 'LLM 에이전트 개발 워크숍', category: '워크숍', format: '체험', domains: ['AI', '소프트웨어'], tags: ['인공지능', '에이전트', '개발자'], venue: '서울 강남구 구글스타트업캠퍼스', day: 15, hour: 14, hours: 4, description: 'LLM 기반 에이전트를 직접 만들어 보는 실습 워크숍' },
  { title: '교육 데이터와 AI 튜터 심포지엄', category: '강연', format: '토론회', domains: ['교육', 'AI'], tags: ['미래교육', '에듀테크'], venue: '서울 서대문구 연세대학교 백주년기념관', day: 16, hour: 13, hours: 4, description: '에듀테크 기업과 교사가 AI 튜터 도입 사례를 공유하는 심포지엄' },
  { title: '서울 로보틱스 챌린지', category: '박람회', format: '공모전', domains: ['로봇', '과학'], tags: ['로봇', '경진대회'], venue: '서울 성동구 서울숲 복합문화공간', day: 17, hour: 10, hours: 7, description: '학생과 일반인 팀이 자율주행 로봇 과제를 겨루는 경진대회' },
  { title: '오픈소스 컨트리뷰톤 밋업', category: '모임', format: '세미나', domains: ['소프트웨어'], tags: ['오픈소스', '개발자', '코딩'], venue: '서울 마포구 마포구청 창업센터', day: 18, hour: 19, hours: 2, description: '오픈소스 프로젝트 기여 방법과 후기를 나누는 밋업' },
  { title: '창업가를 위한 IR 피칭 데이', category: '강연', format: '세미나', domains: ['창업'], tags: ['창업', '피칭', '스타트업'], venue: '서울 영등포구 서울핀테크랩', day: 19, hour: 15, hours: 3, description: '초기 스타트업이 투자자 앞에서 발표하고 피드백을 받는 행사' },
  { title: '기후위기 대응 과학 강연 시리즈', category: '강연', format: '강연', domains: ['과학', '정책'], tags: ['과학', '기후'], venue: '서울 종로구 국립과천과학관 서울분관', day: 20, hour: 14, hours: 2, description: '기후 과학자와 함께하는 시민 대상 과학 강연' },
  { title: '개인정보·AI 규제 정책 세미나', category: '강연', format: '세미나', domains: ['정책', 'AI'], tags: ['정책', '규제', '인공지능'], venue: '서울 중구 프레스센터 20층', day: 21, hour: 14, hours: 3, description: 'AI 기본법과 개인정보 규제 흐름을 짚어보는 정책 세미나' },
  { title: '사진으로 보는 서울 특별전', category: '사진 전시', format: '전시', domains: ['미술', '문화'], tags: ['사진', '전시'], venue: '서울 용산구 한미사진미술관', day: 22, hour: 14, hours: 2, description: '도시 풍경을 담은 사진 작품 특별전. 추천 방문 시간 14:00~16:00' },
  { title: '현대 조각과 공간 디자인전', category: '미술 전시', format: '전시', domains: ['미술', '디자인'], tags: ['조각', '디자인', '현대미술'], venue: '서울 종로구 아라리오뮤지엄', day: 23, hour: 14, hours: 2, description: '조각과 공간 설치 작품을 함께 보는 기획전. 추천 방문 시간 14:00~16:00' },
  { title: 'UX 디자인 시스템 컨퍼런스', category: '강연', format: '세미나', domains: ['디자인', '소프트웨어'], tags: ['디자인', 'UX'], venue: '서울 강남구 삼성동 코엑스 그랜드볼룸', day: 24, hour: 10, hours: 6, description: '디자인 시스템 운영 사례를 공유하는 실무자 컨퍼런스' },
  { title: '실내악 앙상블 살롱 콘서트', category: '클래식', format: '공연', domains: ['음악'], tags: ['클래식', '실내악'], venue: '서울 종로구 세종문화회관 체임버홀', day: 14, hour: 19, hours: 2, description: '가까운 거리에서 듣는 실내악 앙상블 공연' },
  { title: '인디 밴드 라이브 나이트', category: '콘서트', format: '공연', domains: ['음악'], tags: ['인디', '콘서트'], venue: '서울 마포구 홍대 롤링홀', day: 6, hour: 19, hours: 3, description: '신진 인디 밴드 다섯 팀이 함께하는 라이브 공연' },
  { title: '국립극장 창작 연극 <가을의 문>', category: '연극', format: '공연', domains: ['문화'], tags: ['연극', '공연'], venue: '서울 중구 국립극장 달오름극장', day: 25, hour: 19, hours: 2, description: '창작 희곡을 무대에 올린 신작 연극' },
  { title: '대학 로봇 동아리 연합 발표회', category: '워크숍', format: '세미나', domains: ['로봇', '교육'], tags: ['로봇', '학생'], venue: '서울 관악구 서울대학교 신공학관', day: 26, hour: 15, hours: 3, description: '대학 로봇 동아리들이 프로젝트를 발표하고 교류하는 자리' },
  { title: '데이터 시각화 실전 워크숍', category: '워크숍', format: '체험', domains: ['소프트웨어', '디자인', '과학'], tags: ['데이터', '시각화'], venue: '서울 성동구 헤이그라운드', day: 27, hour: 14, hours: 3, description: '실제 공공데이터로 시각화를 만들어 보는 실습' },
  { title: '청년 창업 정책 설명회', category: '강연', format: '강연', domains: ['창업', '정책'], tags: ['정책', '창업', '지원사업'], venue: '서울 중구 서울시청 시민청', day: 28, hour: 14, hours: 2, description: '청년 창업 지원사업과 신청 방법을 안내하는 설명회' },
  { title: 'K-사이언스 페스티벌', category: '박람회', format: '체험', domains: ['과학', '교육'], tags: ['과학', '체험'], venue: '서울 강서구 마곡 서울식물원', day: 29, hour: 11, hours: 5, description: '가족과 함께 즐기는 과학 체험 페스티벌' },
  { title: 'AI 윤리와 안전 토론회', category: '강연', format: '토론회', domains: ['AI', '정책', '교육'], tags: ['인공지능', '윤리'], venue: '서울 서초구 국회도서관 대강당', day: 30, hour: 14, hours: 3, description: 'AI 윤리와 안전 기준을 둘러싼 전문가 토론회' },
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

export const demoEventCount = samples.length;
export const isDemoEvent = (event) => (event.tags || []).includes('시연용');
