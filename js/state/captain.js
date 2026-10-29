// 주장·전담 키커: 주장은 경기장에 있으면 팀 경기력 보너스(리더십), 지정하지 않으면 리더십이 가장 좋은 선발.
// 페널티·세트피스 키커는 엔진이 지정 선수(경기장에 없으면 가장 잘 차는 선수)를 쓴다. 수치는 engine/config.js CAPTAIN·SET_PIECES
import { CAPTAIN } from '../engine/config.js';
import { weightedSkill } from '../engine/ratings.js';

// 리더십 (0~100): 침착성·활동량·경험(나이)
export function leadership(p) {
  const W = CAPTAIN.weights;
  const experience = Math.max(40, Math.min(100, 40 + (p.age - 18) * 4));
  return p.attributes.composure * W.composure + p.attributes.workRate * W.workRate + experience * W.experience;
}

// 주장이 주는 경기력 배율 보정 (0 ~ max)
export const captainBoostOf = (p) => (p ? Math.max(0, Math.min(CAPTAIN.max, CAPTAIN.base + ((leadership(p) - 70) / 10) * CAPTAIN.perUnit)) : 0);

// 이 선발의 주장: { player, vice } — 지정 주장이 선발에 없으면 리더십이 가장 좋은 선발이 부주장으로 (효과 절반)
export function captainFor(lineup, designatedId = null) {
  const field = lineup.filter(Boolean);
  const designated = designatedId ? field.find((p) => p.id === designatedId) : null;
  if (designated) return { player: designated, vice: false };
  const best = field.reduce((a, b) => (!a || leadership(b) > leadership(a) ? b : a), null);
  return { player: best, vice: Boolean(designatedId) };
}

export function captainBoost(lineup, designatedId = null) {
  const { player, vice } = captainFor(lineup, designatedId);
  return captainBoostOf(player) * (vice ? 0.5 : 1);
}

// 자동 추천 (화면 기본값): 스쿼드에서 리더십·페널티·크로스가 가장 좋은 선수
export const bestLeader = (squad) => squad.reduce((a, b) => (!a || leadership(b) > leadership(a) ? b : a), null);
export const bestPenaltyTaker = (squad, takerSkill) => squad.filter((p) => p.position !== 'GK').reduce((a, b) => (!a || weightedSkill(b.attributes, takerSkill) > weightedSkill(a.attributes, takerSkill) ? b : a), null);
export const bestSetPieceTaker = (squad) => squad.filter((p) => p.position !== 'GK').reduce((a, b) => (!a || b.attributes.crossing > a.attributes.crossing ? b : a), null);
