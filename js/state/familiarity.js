// 전술 숙련도 (사용자 팀): 같은 포메이션·공격 방식으로 경기할수록 손발이 맞아 경기 레이팅이 오른다.
// 압박·멘탈리티는 상대마다 바꿔도 숙련도에 영향이 없다. 수치는 engine/config.js FAMILIARITY
import { FAMILIARITY, TACTICS } from '../engine/config.js';
import { formationLabel } from '../engine/formations.js';

// 숙련도 기준: 포메이션 + 공격 방식
export const systemKey = (game, tactics = game.tactics) => `${formationLabel(game.formation.cells)}|${tactics?.style ?? TACTICS.defaults.style}`;

// 처음 쓰는 게임(예전 세이브 포함)은 지금 쓰는 체계를 AI 팀 수준에서 시작한다
function table(game) {
  game.familiarity ??= { [systemKey(game)]: FAMILIARITY.start };
  return game.familiarity;
}

// 0~1
export const familiarityOf = (game, tactics = game.tactics) => table(game)[systemKey(game, tactics)] ?? 0;

// 숙련도 → 경기 레이팅 배율 보정 (AI 팀 수준이면 0)
export function familiarityBoost(value) {
  const { max, aiLevel } = FAMILIARITY;
  return value >= aiLevel ? (max * (value - aiLevel)) / (1 - aiLevel) : (-(max / 2) * (aiLevel - value)) / aiLevel;
}

// 사용자 팀이 경기를 치른 뒤: 쓴 체계는 오르고, 나머지는 조금씩 잊는다
export function trainFamiliarity(game) {
  const t = table(game);
  const key = systemKey(game);
  for (const k of Object.keys(t)) {
    if (k === key) continue;
    t[k] *= FAMILIARITY.decay;
    if (t[k] < 0.02) delete t[k];
  }
  // 경기로는 matchCap까지만 (그 위는 전술 훈련). 이미 넘었으면 그대로 둔다
  const now = t[key] ?? 0;
  t[key] = Math.max(now, Math.min(FAMILIARITY.matchCap, now + FAMILIARITY.gain));
}
