// 선수·팀 레이팅 계산. 수치는 전부 config.js
import {
  CONDITION,
  FORMATION_SHAPE_EXP,
  POSITION_FIT,
  POSITION_RATING_WEIGHTS,
  REFERENCE_FORMATION,
  UNIT_SKILL_WEIGHTS,
  UNIT_SLOT_WEIGHTS,
} from './config.js';
import { FORMATIONS, resolveSlots } from './formations.js';

const FIELD_UNITS = ['attack', 'midfield', 'defense'];

// 능력치 가중평균 (가중치 합으로 정규화).
// 선발 고르기에서 같은 (선수, 가중치) 조합을 수없이 다시 계산하므로 캐시한다.
// 능력치 객체는 바꾸지 말고 새 객체로 교체할 것 (성장·노화도 마찬가지) — 그래야 캐시가 맞다.
const skillCache = new WeakMap();
export function weightedSkill(attributes, weights) {
  let byWeights = skillCache.get(attributes);
  if (!byWeights) skillCache.set(attributes, (byWeights = new Map()));
  let v = byWeights.get(weights);
  if (v === undefined) byWeights.set(weights, (v = computeWeightedSkill(attributes, weights)));
  return v;
}

function computeWeightedSkill(attributes, weights) {
  let sum = 0;
  let total = 0;
  for (const [key, w] of Object.entries(weights)) {
    sum += attributes[key] * w;
    total += w;
  }
  return sum / total;
}

// 익히기 전 적합도 (데이터의 주·보조 포지션 기준)
export function baseFit(player, slotPosition) {
  if (player.position === slotPosition) return 1;
  if ((player.position === 'GK') !== (slotPosition === 'GK')) return POSITION_FIT.gkMismatch;
  const neighbor = POSITION_FIT.neighbors[player.position]?.[slotPosition] ?? POSITION_FIT.other;
  return player.altPositions.includes(slotPosition) ? Math.max(neighbor, POSITION_FIT.alt) : neighbor;
}

// 선수가 slotPosition에서 내는 능력 비율 (0~1). posLearn: 포지션 전환으로 익힌 정도 (state/world.js가 붙인다)
export function positionFit(player, slotPosition) {
  const base = baseFit(player, slotPosition);
  const learned = player.posLearn?.[slotPosition] ?? 0;
  return learned > 0 && base > POSITION_FIT.gkMismatch ? base + (1 - base) * Math.min(1, learned) : base;
}

// 특정 포지션 기준 능력 (적합도 미반영)
export function positionRating(player, position) {
  return weightedSkill(player.attributes, POSITION_RATING_WEIGHTS[position]);
}

// 컨디션(0~100) → 능력 배율
export function conditionFactor(condition = 100) {
  return 1 - (CONDITION.impact * (100 - condition)) / 100;
}

// 종합 능력치(OVR): 주 포지션 기준
export function overall(player) {
  return Math.round(positionRating(player, player.position));
}

function slotWeightSum(unit, slots) {
  return slots.reduce((s, pos) => s + UNIT_SLOT_WEIGHTS[unit][pos], 0);
}

const REFERENCE_SUMS = Object.fromEntries(
  FIELD_UNITS.map((unit) => [unit, slotWeightSum(unit, FORMATIONS[REFERENCE_FORMATION])]),
);

// 선발 → { attack, midfield, defense, goalkeeping }
// formation: 포메이션 ID 또는 슬롯 배열. lineup[i]가 i번째 슬롯에 선다.
// lineup[i]가 null이면 빈 슬롯(퇴장 등) — 가중치 합이 줄어 그 유닛이 약해진다.
// factorOf(player): 컨디션 등 능력 배율 (기본 1)
// mods[i]: 역할·개별 지시 효과 (roles.js slotMods) — 자리 가중치 증감(unit)과 역할 적합도(fit)
export function computeTeamRatings(formation, lineup, factorOf = () => 1, mods = null) {
  const slots = resolveSlots(formation);
  const ratings = {};
  for (const unit of FIELD_UNITS) {
    let sum = 0;
    let total = 0;
    slots.forEach((pos, i) => {
      const w = Math.max(0, UNIT_SLOT_WEIGHTS[unit][pos] + (mods?.[i]?.unit[unit] ?? 0));
      const p = lineup[i];
      if (!w || !p) return;
      sum += w * weightedSkill(p.attributes, UNIT_SKILL_WEIGHTS[unit]) * positionFit(p, pos) * factorOf(p) * (mods?.[i]?.fit ?? 1);
      total += w;
    });
    // 슬롯 가중치 합이 기준 포메이션보다 크면 그 유닛이 강해진다 (예: 4-4-2의 공격)
    ratings[unit] = total > 0 ? (sum / total) * (total / REFERENCE_SUMS[unit]) ** FORMATION_SHAPE_EXP : 1;
  }
  const gkIndex = slots.indexOf('GK');
  const gk = lineup[gkIndex];
  ratings.goalkeeping = gk ? weightedSkill(gk.attributes, UNIT_SKILL_WEIGHTS.goalkeeping) * positionFit(gk, 'GK') * factorOf(gk) : 20;
  return ratings;
}
