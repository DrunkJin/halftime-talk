// 훈련 수치. 한 주 = 리그 한 라운드. AI 팀은 '균형' 훈련을 한 것으로 본다 (효과 없음 = 기존 성장 그대로)
import { t } from '../i18n.js';

export const TRAINING = {
  // 능력치 묶음 (팀 초점·개인 훈련이 키우는 능력치)
  groups: {
    finishing: { get label() { return t('state.training.group.finishing'); }, attrs: ['finishing', 'offTheBall', 'composure', 'longShots'] },
    creativity: { get label() { return t('state.training.group.creativity'); }, attrs: ['passing', 'vision', 'firstTouch', 'crossing'] },
    dribbling: { get label() { return t('state.training.group.dribbling'); }, attrs: ['dribbling', 'agility', 'firstTouch'] },
    defending: { get label() { return t('state.training.group.defending'); }, attrs: ['tackling', 'marking', 'positioning', 'heading'] },
    physical: { get label() { return t('state.training.group.physical'); }, attrs: ['pace', 'stamina', 'strength', 'workRate'] },
    goalkeeping: { get label() { return t('state.training.group.goalkeeping'); }, attrs: ['gkReflexes', 'gkHandling', 'gkPositioning', 'gkDistribution'], gkOnly: true },
  },

  // 팀 훈련 초점 (부담은 시즌 내내 쌓이므로 작게: 집중 훈련 한 시즌의 승점 손해가 몇 점 정도가 되게). recovery: 주간 컨디션 회복 가감 / injury: 선수 1명당 주간 훈련 부상 확률 /
  // growth: 키우는 묶음과 비율 / familiarity: 전술 숙련도 주간 추가 상승 / matchBoost: 이번 주 경기 레이팅 보정
  focus: {
    balanced: { get label() { return t('state.training.focus.balanced'); }, get desc() { return t('state.training.focus.balanced.desc'); }, recovery: 0, injury: 0, growth: {}, familiarity: 0 },
    recovery: { get label() { return t('state.training.focus.recovery'); }, get desc() { return t('state.training.focus.recovery.desc'); }, recovery: 6, injury: 0, growth: {}, familiarity: 0 },
    tactical: { get label() { return t('state.training.focus.tactical'); }, get desc() { return t('state.training.focus.tactical.desc'); }, recovery: 0, injury: 0, growth: {}, familiarity: 0.08 },
    attacking: { get label() { return t('state.training.focus.attacking'); }, get desc() { return t('state.training.focus.attacking.desc'); }, recovery: -1, injury: 0.0005, growth: { finishing: 1, creativity: 0.5, dribbling: 0.5 }, familiarity: 0 },
    defending: { get label() { return t('state.training.focus.defending'); }, get desc() { return t('state.training.focus.defending.desc'); }, recovery: -1, injury: 0.0005, growth: { defending: 1, goalkeeping: 0.6 }, familiarity: 0.02 },
    physical: { get label() { return t('state.training.focus.physical'); }, get desc() { return t('state.training.focus.physical.desc'); }, recovery: -2, injury: 0.0015, growth: { physical: 1 }, familiarity: 0 },
    matchPrep: { get label() { return t('state.training.focus.matchPrep'); }, get desc() { return t('state.training.focus.matchPrep.desc'); }, recovery: 0, injury: 0, growth: {}, familiarity: 0, matchBoost: 0.02 },
  },
  intensity: {
    light: { get label() { return t('state.training.intensity.light'); }, get desc() { return t('state.training.intensity.light.desc'); }, recovery: 2, injury: 0, growth: 0.6, familiarity: 0.7 },
    normal: { get label() { return t('state.training.intensity.normal'); }, get desc() { return t('state.training.intensity.normal.desc'); }, recovery: 0, injury: 0, growth: 1, familiarity: 1 },
    hard: { get label() { return t('state.training.intensity.hard'); }, get desc() { return t('state.training.intensity.hard.desc'); }, recovery: -1, injury: 0.001, growth: 1.4, familiarity: 1.3 },
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
