export const categoryGroups = Object.freeze({
  음악: ['음악', '콘서트', '클래식', '재즈', '음악 페스티벌'],
  전시: ['전시', '미술 전시', '사진 전시', '박람회'],
  공연: ['공연', '뮤지컬', '연극', '무용'],
  스포츠: ['스포츠', '경기 관람', '러닝', '아웃도어'],
  음식: ['음식', '푸드 페스티벌', '커피·와인'],
  교육: ['교육', '강연', '워크숍', '기술'],
  커뮤니티: ['커뮤니티', '모임', '봉사'],
  기타: ['기타'],
});

export const categories = Object.freeze(Object.values(categoryGroups).flat());

export function categoryGroup(category) {
  return Object.entries(categoryGroups).find(([, values]) => values.includes(category))?.[0] || '기타';
}
