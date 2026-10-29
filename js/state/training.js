// 훈련 (사용자 팀): 주마다 팀 초점·강도·개인 훈련에 따라 컨디션 회복, 훈련 부상, 능력치 성장, 조직력(전술 숙련도)이 달라진다.
// 성장은 잠재력까지만 (시즌 끝 성장과 같은 상한) — 젊은 선수를 더 빨리 키우는 수단. 30세 이상은 노화를 늦춘다.
// 수치는 trainingConfig.js. AI 팀은 '균형' 훈련을 한 것으로 본다 (아무 효과 없음)
import { FAMILIARITY, POSITION_RATING_WEIGHTS } from '../engine/config.js';
import { overall } from '../engine/ratings.js';
import { createRng } from '../engine/rng.js';
import { systemKey } from './familiarity.js';
import { squadOf } from './game.js';
import { potentialFor } from './newSeason.js';
import { TRAINING as T } from './trainingConfig.js';
import { ensureWorld, packAttributes, unpackAttributes } from './world.js';

const DEFAULTS = { focus: 'balanced', intensity: 'normal', individual: {} };

// game.training = { focus, intensity, individual: { [선수 id]: 묶음 }, progress: { [선수 id]: { [능력치]: 0~1 } }, retention: { [선수 id]: 0~ }, log: [] }
export function trainingOf(game) {
  game.training ??= { ...DEFAULTS, individual: {}, progress: {}, retention: {}, log: [] };
  return game.training;
}

const lookup = (table, age) => table.find(([max]) => age <= max)[1];
const randInt = (rng, [a, b]) => a + Math.floor(rng.next() * (b - a + 1));

// 잠재력 여유 → 성장 배율 (0~1)
function headroomFactor(game, p) {
  const ovr = overall(p);
  const room = potentialFor(game, p, ovr) - ovr;
  return room <= 0 ? 0 : Math.min(1, room / T.headroomFull);
}

// 이 선수가 한 주에 각 능력치에서 얻는 진행량
export function weeklyRates(game, p, tr = trainingOf(game)) {
  const focus = T.focus[tr.focus] ?? T.focus.balanced;
  const intensity = T.intensity[tr.intensity] ?? T.intensity.normal;
  const age = lookup(T.ageRate, p.age);
  const room = headroomFactor(game, p);
  const base = T.baseRate * age * intensity.growth * room;
  if (base <= 0) return {};
  const weights = POSITION_RATING_WEIGHTS[p.position] ?? {};
  const rates = {};
  const add = (groupId, mult) => {
    const g = T.groups[groupId];
    if (!g || (g.gkOnly && p.position !== 'GK') || (!g.gkOnly && p.position === 'GK' && groupId !== 'physical')) return;
    for (const a of g.attrs) rates[a] = (rates[a] ?? 0) + base * mult * (weights[a] ? 1 : T.offRole);
  };
  for (const [groupId, mult] of Object.entries(focus.growth)) add(groupId, mult);
  const mine = tr.individual?.[p.id];
  if (mine) add(mine, T.individual.rate);
  return rates;
}

// 이번 주 훈련 효과 요약 (화면 미리보기용)
export function weekPreview(game) {
  const tr = trainingOf(game);
  const focus = T.focus[tr.focus] ?? T.focus.balanced;
  const intensity = T.intensity[tr.intensity] ?? T.intensity.normal;
  return {
    recovery: focus.recovery + intensity.recovery,
    injury: focus.injury + intensity.injury,
    familiarity: focus.familiarity * intensity.familiarity,
    matchBoost: focus.matchBoost ?? 0,
    growth: Object.keys(focus.growth).length > 0 || Object.keys(tr.individual ?? {}).length > 0,
  };
}

// 이번 주 경기 레이팅 보정 (경기 준비 훈련)
export const trainingMatchBoost = (game) => T.focus[trainingOf(game).focus]?.matchBoost ?? 0;

// 한 주 훈련을 적용한다 (리그 라운드를 마친 뒤). → { gains: [{ name, attr, value }], injuries: [{ name, weeks }] }
export function applyTrainingWeek(dataset, game) {
  const tr = trainingOf(game);
  const week = weekPreview(game);
  const rng = createRng(`${game.seed}:train:${game.seasonIndex}:${game.round}`);
  const squad = squadOf(dataset, game, game.teamId);
  const ids = new Set(squad.map((p) => p.id));
  // 팀을 떠난 선수의 개인 훈련 지정은 정리
  for (const id of Object.keys(tr.individual)) if (!ids.has(id)) delete tr.individual[id];
  const gains = [];
  const injuries = [];
  let changed = false;

  for (const p0 of squad) {
    // 여러 주를 한 번에 진행하면 dataset이 지난주 그대로일 수 있다 → 능력치는 world의 최신값으로
    const saved = game.world?.players?.[p0.id];
    const p = saved ? { ...p0, attributes: unpackAttributes(saved) } : p0;
    const s = (game.players[p.id] ??= {});
    // 1) 컨디션: 훈련 부담·회복 (경기 회복과 별개로 더하거나 뺀다)
    if (week.recovery) {
      const now = s.condition ?? 100;
      const next = Math.max(T.minCondition, Math.min(100, now + week.recovery));
      if (next >= 100) delete s.condition;
      else s.condition = Math.round(next);
    }
    // 2) 훈련 중 부상 (이미 다친 선수 제외)
    if (week.injury && !s.injury && rng.next() < week.injury) {
      const weeks = randInt(rng, T.injuryWeeks);
      s.injury = { type: '훈련 중 부상', matchesOut: weeks };
      injuries.push({ id: p.id, name: p.name, weeks });
    }
    // 3) 성장 (잠재력까지)
    const rates = weeklyRates(game, p, tr);
    if (Object.keys(rates).length) {
      const prog = (tr.progress[p.id] ??= {});
      const attrs = { ...p.attributes };
      let grew = false;
      for (const [a, r] of Object.entries(rates)) {
        prog[a] = (prog[a] ?? 0) + r;
        while (prog[a] >= 1 && attrs[a] < T.attrMax) {
          prog[a] -= 1;
          attrs[a] += 1;
          grew = true;
          gains.push({ id: p.id, name: p.name, attr: a, value: attrs[a] });
        }
      }
      if (grew) {
        ensureWorld(dataset, game).players[p.id] = packAttributes(p.age, attrs);
        changed = true;
      }
    }
    // 4) 30세 이상 개인 훈련: 노화 늦추기
    if (tr.individual[p.id] && p.age >= T.veteranFrom) tr.retention[p.id] = Math.min(T.retentionMax, (tr.retention[p.id] ?? 0) + T.retentionPerWeek);
  }
  if (changed) game.world.version++;

  // 5) 조직력: 전술 훈련은 지금 체계의 숙련도를 경기 밖에서도 올린다
  if (week.familiarity) {
    const key = systemKey(game);
    game.familiarity ??= { [key]: FAMILIARITY.start };
    game.familiarity[key] = Math.min(1, (game.familiarity[key] ?? 0) + week.familiarity);
  }

  // 이번 시즌 선수별 훈련 성장 합계 (화면용)
  if (tr.seasonOf !== game.seasonIndex) {
    tr.seasonOf = game.seasonIndex;
    tr.seasonGains = {};
  }
  for (const g of gains) tr.seasonGains[g.id] = (tr.seasonGains[g.id] ?? 0) + 1;

  const label = `${game.seasonIndex}:${game.round}`;
  for (const g of gains) tr.log.unshift({ week: label, round: game.round, kind: 'gain', name: g.name, attr: g.attr, value: g.value });
  for (const i of injuries) tr.log.unshift({ week: label, round: game.round, kind: 'injury', name: i.name, weeks: i.weeks });
  tr.log.length = Math.min(tr.log.length, T.log);
  return { gains, injuries };
}

// 새 시즌: 쌓인 노화 늦추기 효과를 돌려주고 비운다 (newSeason에서 하락폭에 곱한다)
export function takeRetention(game, playerId) {
  const r = game.training?.retention?.[playerId] ?? 0;
  if (game.training?.retention) delete game.training.retention[playerId];
  return r;
}

// 영입: 새 선수가 들어오면 지금 체계의 손발이 잠시 어긋난다
export function onSigning(game) {
  const key = systemKey(game);
  if (game.familiarity?.[key] != null) game.familiarity[key] = Math.max(0, game.familiarity[key] - T.signingFamiliarityLoss);
}

// 이번 시즌 이 선수가 훈련으로 올린 능력치 합계
export const seasonGainsOf = (game, playerId) => (game.training?.seasonOf === game.seasonIndex ? game.training.seasonGains?.[playerId] ?? 0 : 0);

// 개인 훈련 추천: 잠재력 여유 × 나이 성장 배율이 큰 선수 순 (GK는 골키퍼, 수비 포지션은 수비, 나머지는 포지션에 맞게)
export function suggestIndividual(dataset, game, count = T.individual.max) {
  const DEF = ['CB', 'LB', 'RB'];
  const groupFor = (p) => (p.position === 'GK' ? 'goalkeeping' : DEF.includes(p.position) ? 'defending' : p.position === 'DM' ? 'defending' : p.position === 'CM' ? 'creativity' : p.position === 'ST' ? 'finishing' : 'dribbling');
  return squadOf(dataset, game, game.teamId)
    .map((p) => ({ p, score: headroomFactor(game, p) * lookup(T.ageRate, p.age) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map(({ p }) => ({ id: p.id, group: groupFor(p) }));
}
