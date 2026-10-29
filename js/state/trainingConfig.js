// 훈련 수치. 한 주 = 리그 한 라운드. AI 팀은 '균형' 훈련을 한 것으로 본다 (효과 없음 = 기존 성장 그대로)
export const TRAINING = {
  // 능력치 묶음 (팀 초점·개인 훈련이 키우는 능력치)
  groups: {
    finishing: { label: '결정력', attrs: ['finishing', 'offTheBall', 'composure', 'longShots'] },
    creativity: { label: '패스·창의성', attrs: ['passing', 'vision', 'firstTouch', 'crossing'] },
    dribbling: { label: '드리블', attrs: ['dribbling', 'agility', 'firstTouch'] },
    defending: { label: '수비', attrs: ['tackling', 'marking', 'positioning', 'heading'] },
    physical: { label: '피지컬', attrs: ['pace', 'stamina', 'strength', 'workRate'] },
    goalkeeping: { label: '골키퍼', attrs: ['gkReflexes', 'gkHandling', 'gkPositioning', 'gkDistribution'], gkOnly: true },
  },

  // 팀 훈련 초점 (부담은 시즌 내내 쌓이므로 작게: 집중 훈련 한 시즌의 승점 손해가 몇 점 정도가 되게). recovery: 주간 컨디션 회복 가감 / injury: 선수 1명당 주간 훈련 부상 확률 /
  // growth: 키우는 묶음과 비율 / familiarity: 전술 숙련도 주간 추가 상승 / matchBoost: 이번 주 경기 레이팅 보정
  focus: {
    balanced: { label: '균형', desc: '평소대로 고르게 훈련합니다. 특별한 이득도 부담도 없습니다.', recovery: 0, injury: 0, growth: {}, familiarity: 0 },
    recovery: { label: '회복', desc: '가벼운 회복 위주. 지친 선수들이 빨리 돌아오지만 성장은 없습니다.', recovery: 6, injury: 0, growth: {}, familiarity: 0 },
    tactical: { label: '전술', desc: '포메이션·공격 방식을 반복 연습해 조직력(전술 숙련도)을 올립니다.', recovery: 0, injury: 0, growth: {}, familiarity: 0.08 },
    attacking: { label: '공격', desc: '마무리와 공격 전개를 다듬습니다.', recovery: -1, injury: 0.0005, growth: { finishing: 1, creativity: 0.5, dribbling: 0.5 }, familiarity: 0 },
    defending: { label: '수비', desc: '수비 조직과 1대1 수비를 다듬습니다.', recovery: -1, injury: 0.0005, growth: { defending: 1, goalkeeping: 0.6 }, familiarity: 0.02 },
    physical: { label: '피지컬', desc: '체력·속도·근력을 끌어올립니다. 몸이 무거워지고 부상 위험이 커집니다.', recovery: -2, injury: 0.0015, growth: { physical: 1 }, familiarity: 0 },
    matchPrep: { label: '경기 준비', desc: '다음 상대에 맞춘 세부 준비. 그 경기 경기력이 오르지만 성장은 없습니다.', recovery: 0, injury: 0, growth: {}, familiarity: 0, matchBoost: 0.02 },
  },
  intensity: {
    light: { label: '가볍게', desc: '부담 없이. 회복이 늘고 성장은 줄어듭니다.', recovery: 2, injury: 0, growth: 0.6, familiarity: 0.7 },
    normal: { label: '보통', desc: '평소 강도.', recovery: 0, injury: 0, growth: 1, familiarity: 1 },
    hard: { label: '강하게', desc: '성장이 빨라지지만 지치고 다칠 위험이 커집니다.', recovery: -1, injury: 0.001, growth: 1.4, familiarity: 1.3 },
  },
  injuryWeeks: [1, 3], // 훈련 중 부상 결장 경기 수
  minCondition: 40, // 훈련 부담으로 컨디션이 이보다 내려가지 않는다

  // 성장: 주간 진행량 = baseRate × 나이 배율 × 강도 × 잠재력 여유 × (주 포지션에 쓰는 능력치면 1, 아니면 offRole)
  // 진행량이 1이 될 때마다 능력치 +1. 잠재력(OVR 기준)에 닿으면 멈춘다
  baseRate: 0.04,
  ageRate: [[19, 1.4], [21, 1.25], [23, 1.05], [25, 0.8], [27, 0.5], [29, 0.25], [99, 0]],
  headroomFull: 6, // 잠재력까지 이만큼 이상 남았으면 성장 100%, 가까워질수록 줄어든다
  offRole: 0.35,
  attrMax: 99,

  // 개인 훈련: 최대 인원, 지정한 묶음의 성장 배율 (팀 초점과 더해진다)
  individual: { max: 5, rate: 1.6 },
  // 30세 이상은 개인 훈련이 노화를 늦춘다: 주마다 retention이 쌓여 시즌 끝 하락폭을 그만큼(최대 retentionMax) 줄인다
  veteranFrom: 30,
  retentionPerWeek: 0.012,
  retentionMax: 0.35,

  // 새로 영입한 선수가 들어오면 지금 전술 체계의 숙련도가 이만큼 내려간다 (전술 훈련으로 되찾는다)
  signingFamiliarityLoss: 0.04,

  log: 40, // 최근 훈련 성장·부상 기록 보관 개수
};
