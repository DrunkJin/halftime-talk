// 선수 가치·구단 예산 공식 (금액 단위: 백만 파운드)
import { overall } from '../engine/ratings.js';
import { MARKET } from './config.js';

const round1 = (v) => Math.round(v * 10) / 10;

export function playerValue(player) {
  const V = MARKET.value;
  const ageFactor = V.ageFactors.find(([maxAge]) => player.age <= maxAge)[1];
  const raw = Math.exp((overall(player) - V.ovrBase) / V.ovrScale) * ageFactor * (player.position === 'GK' ? V.gkFactor : 1);
  return round1(Math.max(V.min, raw));
}

// 팀 전력 지표: OVR 상위 11명 평균 (포메이션과 무관하게 빠르게 계산)
export function topElevenOvr(squad) {
  const top = squad.map((p) => overall(p)).sort((a, b) => b - a).slice(0, 11);
  return top.length ? top.reduce((s, v) => s + v, 0) / top.length : 0;
}

export const formatMoney = (m) => (m >= 100 ? `£${Math.round(m)}M` : `£${m.toFixed(1)}M`);
