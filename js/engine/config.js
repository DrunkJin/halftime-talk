// 경기 엔진 수치. 엔진 결과를 바꾸는 숫자는 전부 여기에 둔다.
// 보정: node tools/simulate-matches.mjs --league 로 리그 전체 평균을 보며 조정
//   목표(EPL 평균): 경기당 2.7~2.9골, 팀당 슈팅 12~13개·유효슈팅 4~5개, 홈 승 약 45%·무 약 25%

export const MATCH_MINUTES = 90;
export const HALF_TIME_MINUTE = 45;

// 홈팀 공격·중원·수비 레이팅에 곱하는 배율 (1 + 값)
export const HOME_ADVANTAGE = 0.055;

// ── 포지션 적합도 ───────────────────────────────────────
// 선수가 슬롯 포지션에서 내는 능력 비율. 주 포지션 1.0
export const POSITION_FIT = {
  alt: 0.95, // 보조 포지션
  other: 0.6, // 아래 표에 없는 필드 포지션
  gkMismatch: 0.2, // GK ↔ 필드 플레이어
  neighbors: {
    CB: { LB: 0.85, RB: 0.85, DM: 0.85 },
    LB: { RB: 0.9, CB: 0.8, LW: 0.8, DM: 0.7 },
    RB: { LB: 0.9, CB: 0.8, RW: 0.8, DM: 0.7 },
    DM: { CM: 0.92, CB: 0.8, AM: 0.7 },
    CM: { DM: 0.9, AM: 0.9, LW: 0.7, RW: 0.7 },
    AM: { CM: 0.9, LW: 0.85, RW: 0.85, ST: 0.8 },
    LW: { RW: 0.9, AM: 0.85, ST: 0.8, LB: 0.65 },
    RW: { LW: 0.9, AM: 0.85, ST: 0.8, RB: 0.65 },
    ST: { AM: 0.8, LW: 0.8, RW: 0.8 },
  },
};

// ── 종합 능력치(OVR) ───────────────────────────────────
// 포지션별 능력치 가중치. 자동 선발과 화면 표시에 쓴다 (합이 1이 아니어도 정규화됨)
export const POSITION_RATING_WEIGHTS = {
  GK: { gkReflexes: 0.3, gkPositioning: 0.25, gkHandling: 0.25, gkDistribution: 0.1, composure: 0.1 },
  CB: { tackling: 0.2, marking: 0.2, positioning: 0.2, heading: 0.15, strength: 0.1, pace: 0.05, composure: 0.05, passing: 0.05 },
  LB: { tackling: 0.15, marking: 0.1, positioning: 0.1, pace: 0.15, stamina: 0.1, crossing: 0.15, passing: 0.1, dribbling: 0.05, workRate: 0.1 },
  DM: { tackling: 0.18, positioning: 0.18, passing: 0.16, marking: 0.1, workRate: 0.1, stamina: 0.08, composure: 0.1, vision: 0.05, strength: 0.05 },
  CM: { passing: 0.22, vision: 0.15, firstTouch: 0.12, composure: 0.1, workRate: 0.1, stamina: 0.1, tackling: 0.08, dribbling: 0.08, longShots: 0.05 },
  AM: { vision: 0.2, passing: 0.18, dribbling: 0.15, firstTouch: 0.14, finishing: 0.1, offTheBall: 0.1, longShots: 0.08, composure: 0.05 },
  LW: { dribbling: 0.2, pace: 0.18, crossing: 0.12, finishing: 0.12, offTheBall: 0.1, firstTouch: 0.1, passing: 0.08, agility: 0.1 },
  ST: { finishing: 0.3, offTheBall: 0.18, composure: 0.12, firstTouch: 0.1, heading: 0.1, pace: 0.08, strength: 0.06, dribbling: 0.06 },
};
POSITION_RATING_WEIGHTS.RB = POSITION_RATING_WEIGHTS.LB;
POSITION_RATING_WEIGHTS.RW = POSITION_RATING_WEIGHTS.LW;

// ── 팀 레이팅 ───────────────────────────────────────────
// 팀 공격·중원·수비 = 슬롯별 가중치 × 선수 능력(적합도 반영)의 가중평균 × 포메이션 형태 보정
export const UNIT_SKILL_WEIGHTS = {
  attack: { finishing: 0.2, offTheBall: 0.15, dribbling: 0.15, pace: 0.12, passing: 0.1, vision: 0.1, firstTouch: 0.1, composure: 0.08 },
  midfield: { passing: 0.25, firstTouch: 0.15, vision: 0.15, composure: 0.15, workRate: 0.15, stamina: 0.15 },
  defense: { tackling: 0.2, marking: 0.2, positioning: 0.2, heading: 0.1, strength: 0.1, pace: 0.1, workRate: 0.1 },
  goalkeeping: { gkReflexes: 0.35, gkPositioning: 0.25, gkHandling: 0.25, gkDistribution: 0.05, composure: 0.1 },
};
// 슬롯 포지션이 각 유닛에 기여하는 정도. GK는 goalkeeping만 담당
export const UNIT_SLOT_WEIGHTS = {
  attack: { GK: 0, CB: 0.05, LB: 0.3, RB: 0.3, DM: 0.2, CM: 0.45, AM: 0.9, LW: 0.9, RW: 0.9, ST: 1.0 },
  midfield: { GK: 0, CB: 0.2, LB: 0.4, RB: 0.4, DM: 0.9, CM: 1.0, AM: 0.8, LW: 0.5, RW: 0.5, ST: 0.25 },
  defense: { GK: 0, CB: 1.0, LB: 0.8, RB: 0.8, DM: 0.8, CM: 0.45, AM: 0.15, LW: 0.2, RW: 0.2, ST: 0.05 },
};
// 포메이션의 슬롯 가중치 합이 기준 포메이션보다 크면 그 유닛이 강해진다. 효과 크기는 지수로 완화
export const REFERENCE_FORMATION = '4-3-3';
export const FORMATION_SHAPE_EXP = 0.5;

// ── 점유 ───────────────────────────────────────────────
// P(홈 점유) = 홈중원^k / (홈중원^k + 원정중원^k)
export const POSSESSION_EXP = 2.2;

// ── 공격 ───────────────────────────────────────────────
// 점유 1분당 공격 시도 확률 = ATTACK_BASE × (공격 / 상대 수비)^ATTACK_EXP
export const ATTACK_BASE = 0.375; // AI 팀 전술 성향 도입 뒤 리그 평균 골 수(2.6~3.0)에 맞춤
export const ATTACK_EXP = 1.5;
export const ATTACK_PROB_MAX = 0.75;
// 큰 전력 차 완화: (공격 / 상대 수비) 비가 knee를 넘으면 넘는 만큼을 slope 배로 줄인다 (약한 쪽도 대칭).
// 비슷한 전력끼리는 그대로, 압도적인 매치업만 덜 일방적으로 — 리그 안 전력 차가 큰 리그의 독주를 줄인다
export const RATIO_SOFTCAP = { knee: 1.15, slope: 0.25 };
// 공격 시도가 슈팅까지 이어질 확률 (나머지는 수비 차단)
export const SHOT_AFTER_ATTACK = 0.78;

// ── 전술 지시 ───────────────────────────────────────────
// 선택지마다 배율. 모든 선택지에 이득과 대가가 함께 있다 (없는 항목은 1)
//   attack·midfield·defense: 우리 레이팅 배율 / attempts: 공격 시도 확률 배율
//   bigChance: 결정적 찬스 비중 배율 / drain: 체력 소모 배율 / cards: 수비할 때 카드 확률 배율
// 멘탈리티는 공격·수비를 거의 대칭으로 바꿔 골이 양쪽 다 늘거나 준다 (강팀은 공격적일수록, 약팀은 수비적일수록 유리)
export const TACTICS = {
  defaults: { mentality: 'balanced', pressing: 'normal', style: 'mixed' },
  mentality: {
    veryDefensive: { label: '매우 수비적', attack: 0.84, defense: 1.12 },
    defensive: { label: '수비적', attack: 0.92, defense: 1.06 },
    balanced: { label: '균형' },
    attacking: { label: '공격적', attack: 1.07, defense: 0.93 },
    veryAttacking: { label: '매우 공격적', attack: 1.13, defense: 0.86 },
  },
  pressing: {
    low: { label: '내려앉기', midfield: 0.96, defense: 1.06, attack: 0.97, drain: 0.85, cards: 0.85 }, // 뒤 공간을 지우지만 역습이 멀다
    normal: { label: '보통' },
    high: { label: '강한 압박', midfield: 1.05, bigChance: 1.12, defense: 0.98, drain: 1.35, cards: 1.25 }, // 높은 위치에서 뺏지만 뒷공간이 열리고 빨리 지친다
  },
  style: {
    short: { label: '짧은 패스', midfield: 1.04, attempts: 0.92, bigChance: 1.08, defense: 0.98 }, // 점유·질 높은 찬스, 대신 슈팅이 적고 후방 실수 위험
    mixed: { label: '혼합' },
    direct: { label: '직선적', midfield: 0.95, attempts: 1.1, bigChance: 0.9, defense: 1.03 }, // 빨리 전방으로: 슈팅은 많지만 점유를 내준다. 후방 실수는 적다
  },
};

// ── 선수 구성 프로필 · 전술 적합도 · 상성 ────────────────────
// 팀 프로필: 경기장 선수의 능력치로 만든 6개 성향. 팀 자신의 평균과 비교해 강점·약점을 본다
//   energy 활동량(압박) · technique 후방 빌드업 기술 · speed 공격진 속도 · backPace 수비진 속도 · aerial 크로스·제공권 · shape 수비 조직
// 프로필 차이는 10점을 1단위로 쓰고 ±maxUnits로 자른다
export const PROFILE = { unit: 10, maxUnits: 1.5 };

// 전술 적합도: 선택지의 이득(1보다 큰 배율)이 우리 선수 성향에 따라 커지거나 줄어든다.
// 이득 배율 = 1 + (원래 이득) × (1 + scale × 성향 단위). 대가(1보다 작은 배율·체력·카드)는 그대로
export const TACTIC_FIT = {
  scale: 1.0,
  pressing: { high: ['energy'], low: ['shape'] },
  style: { short: ['technique'], direct: ['speed', 'aerial'] },
};

// 상성: 두 팀 전술과 성향이 맞물릴 때 생기는 효과 (값은 1단위당 배율 증감)
export const MATCHUPS = {
  // 역습: 내려앉기·직선적 팀이 공격적 멘탈리티·강한 압박 팀의 뒷공간을 노린다. 우리 공격진 속도 vs 상대 수비진 속도
  counter: {
    exposure: { mentality: { attacking: 1, veryAttacking: 1.5 }, pressing: { high: 1 } }, // 상대가 뒷공간을 내주는 정도
    bigChance: 0.3, attempts: 0.07, paceWeight: 0.5, // 속도 차 1단위마다 효과 ±50%
  },
  // 압박 vs 빌드업: 강한 압박 팀 활동량 vs 짧은 패스(혼합은 절반) 팀 후방 기술.
  // 압박이 이기면 상대 중원이 흔들리고 우리 결정적 찬스가 늘고, 지면 압박이 뚫려 상대 결정적 찬스가 는다
  press: { styleWeight: { short: 1, mixed: 0.5, direct: 0 }, oppMidfield: 0.08, bigChance: 0.24, oppBigChanceIfBeaten: 0.2, defenseIfBeaten: 0.04 },
  // 수비 블록 vs 점유: 내려앉은 팀이 짧은 패스 팀의 슈팅 기회를 줄인다 (수비 조직이 좋을수록)
  lowBlock: { oppAttempts: 0.14, oppBigChance: 0.18, shapeWeight: 0.5 },
  // 측면·직선 공격 vs 내려앉은 팀: 크로스·제공권으로 블록을 넘는다
  crossing: { attempts: 0.12, header: 0.55, aerialWeight: 0.5 },
  limits: [0.7, 1.6], // 한 항목 배율의 범위
};

// AI 팀 전술 성향: 선수 구성에서 가장 잘 맞는 압박·스타일을 고른다 (성향이 이 단위 이상 두드러질 때)
//   전력 차가 크면 강팀은 짧은 패스 쪽으로 기운다. 약팀이 상대에 맞춰 내려앉아 역습하는 건 AI가 알아서 하지 않는다
//   (선수 구성이 맞는 팀만) — 상대를 분석해 상성을 노리는 것이 사용자 감독의 무기
export const AI_IDENTITY = { threshold: 0.5, favoriteStyle: 'short', underdogPressing: null };

// 전술 숙련도: 같은 포메이션·압박·스타일로 경기할수록 손발이 맞는다 (사용자 팀). AI 팀은 aiLevel 수준으로 본다
//   경기 레이팅 배율 = max × (숙련도 - aiLevel) / (1 - aiLevel) (aiLevel 아래면 같은 비율로 손해, 최저 -max/2)
export const FAMILIARITY = { max: 0.04, aiLevel: 0.5, start: 0.5, gain: 0.15, decay: 0.85 };

// AI 감독 전술: 경기 전 전력 차(필드 레이팅 평균 차)로 멘탈리티, fromMinute 이후 스코어로 조정
export const AI_TACTICS = {
  underdogGap: 4, // 상대가 이만큼 강하면 수비적
  favoriteGap: 4, // 우리가 이만큼 강하면 공격적
  fromMinute: 60,
  trailing: 'attacking',
  trailingLate: 'veryAttacking', // lateMinute 이후 지고 있으면
  lateMinute: 80,
  leading: 'defensive',
};

// ── 슈팅 ───────────────────────────────────────────────
// weight: 기본 비중 / xg: 평균 득점 확률 / onTarget: 기본 유효슈팅 확률
// shooterSkill: 슈터 능력 / assistSkill: 도움 능력 / assistChance: 득점 시 도움이 붙을 확률
export const SHOT_TYPES = {
  open: {
    weight: 0.5, xg: 0.1, onTarget: 0.37, assistChance: 0.8,
    shooterSkill: { finishing: 0.5, composure: 0.2, firstTouch: 0.15, offTheBall: 0.15 },
    assistSkill: { passing: 0.45, vision: 0.45, firstTouch: 0.1 },
  },
  long: {
    weight: 0.25, xg: 0.035, onTarget: 0.3, assistChance: 0.35,
    shooterSkill: { longShots: 0.7, composure: 0.15, finishing: 0.15 },
    assistSkill: { passing: 0.6, vision: 0.4 },
  },
  header: {
    weight: 0.15, xg: 0.09, onTarget: 0.33, assistChance: 0.9,
    shooterSkill: { heading: 0.6, strength: 0.2, offTheBall: 0.2 },
    assistSkill: { crossing: 0.8, vision: 0.2 },
  },
  big: {
    weight: 0.1, xg: 0.38, onTarget: 0.6, assistChance: 0.85,
    shooterSkill: { finishing: 0.5, composure: 0.4, firstTouch: 0.1 },
    assistSkill: { passing: 0.4, vision: 0.5, dribbling: 0.1 },
  },
};
// 큰 찬스 비중 × (공격 / 상대 수비)^exp : 압도할수록 결정적 찬스가 늘어난다
export const BIG_CHANCE_EXP = 1.2;

// 슬롯별 슈팅·도움 관여 비중 (슈팅 종류별)
export const SHOOTER_SLOT_WEIGHTS = {
  open: { GK: 0, CB: 0.03, LB: 0.06, RB: 0.06, DM: 0.08, CM: 0.25, AM: 0.55, LW: 0.6, RW: 0.6, ST: 0.7 },
  long: { GK: 0, CB: 0.08, LB: 0.15, RB: 0.15, DM: 0.35, CM: 0.6, AM: 0.7, LW: 0.45, RW: 0.45, ST: 0.35 },
  header: { GK: 0, CB: 0.55, LB: 0.1, RB: 0.1, DM: 0.2, CM: 0.3, AM: 0.25, LW: 0.25, RW: 0.25, ST: 0.75 },
  big: { GK: 0, CB: 0.02, LB: 0.05, RB: 0.05, DM: 0.05, CM: 0.2, AM: 0.5, LW: 0.6, RW: 0.6, ST: 0.8 },
};
export const ASSIST_SLOT_WEIGHTS = {
  open: { GK: 0.01, CB: 0.08, LB: 0.45, RB: 0.45, DM: 0.35, CM: 0.75, AM: 1.0, LW: 0.8, RW: 0.8, ST: 0.45 },
  long: { GK: 0.02, CB: 0.2, LB: 0.3, RB: 0.3, DM: 0.6, CM: 0.8, AM: 0.8, LW: 0.5, RW: 0.5, ST: 0.3 },
  header: { GK: 0, CB: 0.1, LB: 0.9, RB: 0.9, DM: 0.2, CM: 0.45, AM: 0.5, LW: 1.0, RW: 1.0, ST: 0.2 },
  big: { GK: 0.01, CB: 0.05, LB: 0.4, RB: 0.4, DM: 0.35, CM: 0.75, AM: 1.0, LW: 0.8, RW: 0.8, ST: 0.5 },
};
// 슈터·도움 선수를 고를 때 능력 차이를 얼마나 강하게 반영할지: 비중 × (능력/70)^exp
export const PLAYER_PICK_SKILL_EXP = 1.5;

// 능력 기준점과 기울기. 슈터 능력이 기준보다 10 높으면 유효슈팅 확률 ×(1 + 10×slope)
export const SKILL_REF = 70;
// 슈팅·선방 비교 기준을 경기마다 두 팀 평균 수준으로 맞춘다 (리그 수준이 달라도 골 수가 비슷하도록).
// 기준 = SKILL_REF + (두 팀 공격·중원·수비 평균 - SKILL_REF) × LEVEL_REF_WEIGHT. 0이면 항상 SKILL_REF
export const LEVEL_REF_WEIGHT = 1;
export const ON_TARGET_SKILL_SLOPE = 0.006;
export const GOAL_SKILL_SLOPE = 0.012; // 유효슈팅의 득점 전환율에 대한 슈터 능력 효과
export const GK_SKILL_SLOPE = 0.008; // 유효슈팅의 득점 전환율에 대한 GK 능력 효과 (나눗셈)
export const PROB_LIMITS = { onTarget: [0.1, 0.9], goalIfOnTarget: [0.02, 0.95] };

// 빗나간 슈팅 중 수비 블록·골대 비율 (중계 문구용, 결과에는 영향 없음)
export const MISS_BREAKDOWN = { blocked: 0.3, woodwork: 0.05 };

// ── 체력(경기 중 컨디션) ─────────────────────────────────
// 컨디션 0~100. 능력 배율 = 1 - impact × (100 - 컨디션) / 100
export const CONDITION = {
  drainPerMinute: 0.3, // stamina 70 선수의 분당 감소량
  staminaEffect: 0.012, // stamina가 70보다 1 낮을 때마다 감소량 +1.2%
  gkDrainFactor: 0.3, // GK는 덜 지친다
  impact: 0.3,
  recalcEvery: 5, // 몇 분마다 레이팅을 다시 계산할지
  min: 20,
};

// ── 교체 (자동) ─────────────────────────────────────────
export const SUBSTITUTIONS = {
  max: 5,
  fatigueFrom: 60, // 이 분부터 지친 선수를 교체
  fatigueCheckEvery: 10,
  fatigueThreshold: 75, // 컨디션이 이보다 낮으면 교체 후보
  minFit: 0.8, // 체력 교체로 들어올 선수의 최소 포지션 적합도
  reserveUntil: 80, // 이 분 전까지는 부상 대비로 교체 1장을 남긴다
  fatigueUntil: 85, // 이 분 이후에는 체력 교체를 하지 않는다
};

// ── 부상 ───────────────────────────────────────────────
// 선수 1명의 분당 부상 확률 = perMinute × 나이 배율 × 피로 배율
// 목표: 팀당 시즌 10~15건
export const INJURY = {
  perMinute: 2.9e-4,
  ageFrom: 28,
  agePerYear: 0.05, // ageFrom 이후 1살마다 +5%
  fatigueMultiplier: 1.5, // 컨디션 0이면 ×2.5
  // 결장 경기 수는 [min, max] 사이 균등
  types: [
    { name: '타박상', weight: 0.3, min: 1, max: 1 },
    { name: '발목 염좌', weight: 0.25, min: 1, max: 3 },
    { name: '햄스트링 부상', weight: 0.2, min: 2, max: 5 },
    { name: '종아리 부상', weight: 0.12, min: 2, max: 4 },
    { name: '무릎 인대 부상', weight: 0.08, min: 6, max: 14 },
    { name: '골절', weight: 0.05, min: 10, max: 20 },
  ],
};

// ── 카드 ───────────────────────────────────────────────
// 수비하는 팀(그 분에 점유하지 못한 팀)에서만 발생. 목표: 팀당 경고 1.9장, 경기당 퇴장 약 0.1장
export const CARDS = {
  yellowPerMinute: 0.042,
  redPerMinute: 0.0007,
  slotWeights: { GK: 0.1, CB: 1.0, LB: 0.9, RB: 0.9, DM: 1.1, CM: 0.8, AM: 0.5, LW: 0.5, RW: 0.5, ST: 0.4 },
  composureEffect: 0.01, // 침착성이 70보다 1 낮을 때마다 +1%
  bookedFactor: 0.12, // 경고 받은 선수는 조심한다: 이후 카드 비중 ×0.12
};

// ── 중계 ───────────────────────────────────────────────
// 아무 일 없는 분에 분위기 문구를 넣을 확률
export const QUIET_MINUTE_COMMENT = 0.2;

// ── 사기 · 인터뷰 · 팀 토크 ──────────────────────────────
// 사기 0~100 (50 = 보통). 경기 레이팅 배율 = 1 + (사기 - 50) / 50 × maxBoost
// 사기 = 50 + 최근 경기 흐름 + (사용자 팀만) 인터뷰·팀 토크로 쌓인 보정
export const MORALE = {
  neutral: 50,
  maxBoost: 0.05, // 사기 100이면 +5%, 0이면 -5% (인터뷰·팀 토크·연승 관리가 경기력에 닿도록)
  form: { matches: 5, perPoint: 4 }, // (최근 5경기 승점 - 경기당 1.5) × 4 → 최대 ±30
  adjustDecay: 0.7, // 보정은 라운드마다 이 비율만 남는다
  adjustLimit: 25,
  derbyMultiplier: [1, 1.2, 1.4, 1.6], // 더비 강도(1~3)별 인터뷰 효과 배율

  // 경기 전 기자회견: now = 답하자마자, win/draw/loss = 경기 결과가 나온 뒤
  pre: {
    confident: { now: 2, win: 6, draw: -3, loss: -8 },
    cautious: { now: 0, win: 2, draw: 1, loss: 0 },
    respect: { now: -1, win: 5, draw: 2, loss: -1 },
    demand: { now: 4, win: 1, draw: -2, loss: -6 },
    deflect: { now: 0, win: 0, draw: 0, loss: 0 },
  },
  // 경기 후 인터뷰: 결과별 사기 보정. backfire: 그 확률로 value가 대신 적용 (선수단 반발)
  post: {
    praise: { win: 4, draw: 3, loss: 1 },
    critical: { win: -4, draw: 1, loss: 4, backfire: { chance: 0.3, value: -6 } },
    blame: { win: -1, draw: 1, loss: 3 },
    humble: { win: 1, draw: 1, loss: 1 },
    forward: { win: 0, draw: 1, loss: 2 },
  },
  // 하프타임 팀 토크: 후반 레이팅 보정 (스코어 상황별). 반응은 ±noise 안에서 무작위
  talk: {
    praise: { leading: 0.02, drawing: 0.005, trailing: -0.02 },
    encourage: { leading: 0.005, drawing: 0.015, trailing: 0.02 },
    demand: { leading: -0.015, drawing: 0.015, trailing: 0.025 },
    calm: { leading: 0.015, drawing: 0.01, trailing: 0 },
    passion: { leading: -0.005, drawing: 0.02, trailing: 0.015 },
    noise: 0.012,
    moraleScale: 150, // 사기 보정 = 후반 보정 × moraleScale (0.02 → +3)
    goodAbove: 0.012, // 반응 문구 기준: 이 이상이면 좋음, 0 미만이면 나쁨
  },

  // 인터뷰 상황 판정 기준
  context: {
    strengthGap: 4, // 필드 레이팅 평균 차가 이 이상이면 강팀/약팀
    lateSeason: 0.6, // 시즌 진행률이 이 이상이면 우승·강등 경쟁 질문
    topRank: 4,
    titleRank: 2,
    relegationZone: 4, // 아래에서 이 순위 안
    streak: 3,
    longRun: 5, // 무승·무패 행진 기준
    bigMargin: 3,
    lateGoalMinute: 85,
    injuryCrisis: 3, // 주전 11명 중 결장자 수
    newSigningRounds: 4, // 영입 후 이 라운드 안에 처음 선발이면 '새 얼굴'
    xgGap: 0.5, // 내용(기대 득점) 차이 기준
  },
};

// ── 연장전 · 승부차기 (토너먼트) ──────────────────────────
// 90분 뒤 합계(1·2차전)가 같으면 연장 30분, 그래도 같으면 승부차기
export const EXTRA_TIME = {
  minutes: 30,
  halfMinute: 105, // 연장 전반 종료
  drainFactor: 1.3, // 연장에는 더 지친다
  extraSubs: 1, // 연장에 교체 1장 추가
  fatigueCheckMinutes: [91, 106], // 연장 중 AI 체력 교체 시점
};
// 키커 성공 확률 = base + takerSlope × (키커 능력 - 경기 기준) - gkSlope × (GK 능력 - 경기 기준). 목표: 성공률 약 75%
export const PENALTIES = {
  base: 0.76,
  takerSlope: 0.005,
  gkSlope: 0.004,
  limits: [0.55, 0.92],
  rounds: 5,
  takerSkill: { finishing: 0.45, composure: 0.45, firstTouch: 0.1 },
  gkSkill: { gkReflexes: 0.6, gkPositioning: 0.25, composure: 0.15 },
};
