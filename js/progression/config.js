// 시즌 넘기기 수치: 성장·노화·은퇴·유스·계약 만료 (경기 수치는 engine/config.js)
// 표 형식 [이 나이 이하, 값] 은 나이가 처음으로 맞는 줄을 쓴다
export const PROGRESSION = {
  // 숨은 잠재력 = 지금 OVR + 여유 × (선수 ID로 정해지는 0~1 값^skew). 나이가 어릴수록 여유가 크다
  // 강등 팀 정리: 내려간 리그 최강 팀(주전 11명 평균)보다 gap 이상 높은 선수는 chance 확률로 다른 구단에 팔린다 (팀당 최대 maxLeaving명,
  // 이적료 = 가치 × feeFactor). 대신 낙하산 지원금 = 지난 시즌 수입 × parachute
  relegation: { gap: 2, chance: 0.7, maxLeaving: 6, feeFactor: 0.7, parachute: 0.25 },
  scout: { maxAge: 23, minHeadroom: 3, width: 5 }, // 선수 정보 창의 잠재력 범위 표시
  potential: { headroom: [[17, 26], [19, 21], [21, 15], [23, 9], [25, 4], [27, 1], [99, 0]], skew: 1.4 },
  // 성장 (27세 이하): OVR 변화 = (잠재력 - OVR) × 비율 × (기본 + 출전 보너스 × 출전 비중) ± 편차
  growth: { rate: [[18, 0.38], [20, 0.34], [22, 0.28], [24, 0.2], [27, 0.1]], playFloor: 0.45, playBonus: 0.75, noise: 1.0 },
  // 정체기 (28~29세): 작은 편차만
  peakNoise: 0.8,
  // 노화: from세부터 매년 -(perYear + (나이 - from) × accel) ± 편차. GK는 gkShift년 늦게
  decline: { from: 30, gkShift: 3, perYear: 0.6, accel: 0.35, noise: 0.8 },
  physical: ['pace', 'agility', 'stamina', 'strength'], // 노화 때 더 크게 떨어지는 능력치
  physicalExtra: 0.7, // 신체 능력치는 감소폭 ×(1 + physicalExtra)
  attributeNoise: 1.0, // 능력치별 추가 편차
  // 은퇴: 나이가 from 이상이면 확률 base + (나이 - from) × perYear (GK는 gkShift년 늦게). 무소속 노장은 더 쉽게
  // 무소속: freeAgentFrom세 이상은 freeAgentChance, 그보다 어려도 youngFreeAgentChance 확률로 은퇴(하부 리그로 떠남)
  retire: { from: 34, base: 0.12, perYear: 0.15, gkShift: 2, freeAgentFrom: 29, freeAgentChance: 0.8, youngFreeAgentChance: 0.5, hardAge: 41 },
  // 유스: 팀당 인원, 나이, OVR = 팀 주전 평균 - 차이, 잠재력 = OVR + 여유 (가끔 대형 유망주)
  youth: { perTeam: [2, 3], age: [16, 18], belowTeam: [14, 24], potentialAbove: [6, 32], potentialSkew: 1.8, homeNation: 0.85, contractYears: 3 },
  // 계약 만료 시 AI 팀(과 자동 진행 중인 사용자 팀): 팀 내 OVR 상위 keepTop 명 안이고 maxAge 미만이면 renewChance 확률로 재계약.
  // youngAge 이하 유망주는 상위 youngKeepTop 명 안이면 재계약
  contracts: { keepTop: 23, maxAge: 34, renewChance: 0.9, youngAge: 23, youngKeepTop: 32 },
  // 새 시즌 보강: 인원이 minSquad보다 적으면 무소속 선수로 채운다. mustSquad보다 적으면 주급 한도를 넘어서라도
  aiFill: { minSquad: 23, mustSquad: 20, maxAge: 33 },
};

export const lookup = (table, age) => table.find(([max]) => age <= max)?.[1] ?? table.at(-1)[1];
