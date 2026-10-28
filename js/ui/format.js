// 화면 표시용 이름·색상 규칙

export const POSITION_NAMES = {
  GK: '골키퍼', CB: '센터백', LB: '왼쪽 풀백', RB: '오른쪽 풀백', DM: '수비형 미드필더',
  CM: '중앙 미드필더', AM: '공격형 미드필더', LW: '왼쪽 윙어', RW: '오른쪽 윙어', ST: '스트라이커',
};

export const ATTRIBUTE_LABELS = {
  finishing: '결정력', longShots: '중거리', passing: '패스', crossing: '크로스', dribbling: '드리블',
  firstTouch: '퍼스트터치', tackling: '태클', marking: '마킹', heading: '헤딩',
  vision: '시야', positioning: '위치선정', offTheBall: '침투', composure: '침착성', workRate: '활동량',
  pace: '속도', stamina: '체력', strength: '몸싸움', agility: '민첩성',
  gkReflexes: '반사신경', gkHandling: '핸들링', gkPositioning: 'GK 위치선정', gkDistribution: '볼배급',
};

export const ATTRIBUTE_GROUP_LABELS = { technical: '기술', mental: '정신', physical: '신체', goalkeeping: '골키핑' };

// 능력치 색 단계 (FM처럼 높을수록 밝게)
export function attrClass(v) {
  if (v >= 85) return 'a5';
  if (v >= 75) return 'a4';
  if (v >= 65) return 'a3';
  if (v >= 50) return 'a2';
  return 'a1';
}

// 성 앞에 붙는 소사 (van de Ven, De Bruyne, dos Santos)
const SURNAME_PARTICLES = new Set(['van', 'von', 'de', 'der', 'den', 'da', 'das', 'do', 'dos', 'di', 'du', 'del', 'della', 'la', 'le', 'el', 'al', 'ten', 'ter', 'mac', 'st.']);

// 피치 칩처럼 좁은 곳에 쓸 이름: 성(마지막 단어 + 앞의 소사)
export function shortName(name) {
  const parts = name.split(' ');
  if (parts.length === 1) return name;
  let start = parts.length - 1;
  while (start > 1 && SURNAME_PARTICLES.has(parts[start - 1].toLowerCase())) start--;
  return parts.slice(start).join(' ');
}

export const fmt1 = (v) => v.toFixed(1);
