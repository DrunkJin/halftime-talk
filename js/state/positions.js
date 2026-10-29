// 포지션 전환 (사용자 팀): 원래 포지션이 아닌 자리에서 뛰거나 개인 훈련으로 지정하면 그 자리를 익힌다.
// 익힘(0~1)은 game.world.positions에 두고, worldDataset이 선수 객체의 posLearn으로 붙인다 → 엔진 positionFit이 감점을 줄인다.
// 능력치가 새 자리에 더 맞는 선수는 다 익히면 원래 자리보다 잘한다 ('변신 성공'). 맞지 않는 먼 자리에 계속 세우면 불만.
// AI 팀은 익히지 않는다. 수치는 engine/config.js POSITION_FIT.learn
import { POSITION_FIT } from '../engine/config.js';
import { baseFit, positionRating } from '../engine/ratings.js';
import { t } from '../i18n.js';
import { squadOf } from './game.js';
import { pushNews } from './inbox.js';
import { nudgeMood } from './squadMood.js';
import { ensureWorld } from './world.js';

const L = POSITION_FIT.learn;
const TRAIN_PREFIX = 'pos:';

// 개인 훈련 값 'pos:RB' ↔ 자리
export const positionTrainingValue = (pos) => `${TRAIN_PREFIX}${pos}`;
export const trainedPosition = (value) => (typeof value === 'string' && value.startsWith(TRAIN_PREFIX) ? value.slice(TRAIN_PREFIX.length) : null);

// 익힐 수 있는 자리: 필드 선수만, 원래 포지션 말고 (보조 포지션도 더 익힐 수 있다)
export const learnablePositions = (p, positions) => (p.position === 'GK' ? [] : positions.filter((pos) => pos !== 'GK' && pos !== p.position));

export const learnedOf = (game, id) => game.world?.positions?.[id] ?? {};

// 익힘 단계 (화면에는 숫자 대신 이 말)
export const learnLevel = (v) => (v >= 1 ? 'natural' : v >= L.familiar ? 'familiar' : v >= 0.15 ? 'learning' : 'new');
export const learnWord = (v) => t(`state.posLearn.${learnLevel(v)}`);

const ageFactor = (age) => L.age.find(([max]) => age <= max)[1];
const speedOf = (p, pos) => ageFactor(p.age) * (baseFit(p, pos) >= L.near ? 1 : L.farFactor);

// 익힘을 더하고 단계가 바뀌면 소식. → 바뀌었는지
function addLearn(dataset, game, p, pos, delta) {
  const w = ensureWorld(dataset, game);
  const table = ((w.positions ??= {})[p.id] ??= {});
  const before = table[pos] ?? 0;
  if (before >= 1) return false;
  const after = Math.min(1, before + delta);
  table[pos] = Math.round(after * 1000) / 1000;
  if (before < L.familiar && after >= L.familiar && after < 1) pushNews(game, 'player.posFamiliar', { name: p.name, id: p.id, pos });
  if (after >= 1) {
    // 다 익혔다: 그 자리 능력이 원래 자리보다 높으면 '변신 성공'
    const better = positionRating(p, pos) >= positionRating(p, p.position) + L.successGap;
    pushNews(game, better ? 'player.posSuccess' : 'player.posAdapted', { name: p.name, id: p.id, pos, from: p.position }, { important: better });
    if (better) nudgeMood(game, p.id, 5);
  }
  return true;
}

// 사용자 팀 경기 하나가 끝난 뒤: 뛴 자리를 익히고, 안 뛴 자리는 조금 잊고, 맞지 않는 자리에 계속 세운 선수는 불만
export function learnFromMatch(dataset, game, result, side) {
  if (!result || !side) return;
  const off = result.teams?.[side]?.offPosition ?? {};
  const squad = squadOf(dataset, game, game.teamId);
  let changed = false;
  for (const p of squad) {
    const played = off[p.id] ?? {};
    for (const [pos, minutes] of Object.entries(played)) {
      if (baseFit(p, pos) <= POSITION_FIT.gkMismatch) continue; // GK ↔ 필드는 익히지 않는다
      changed = addLearn(dataset, game, p, pos, (minutes / 90) * L.perMatch * speedOf(p, pos)) || changed;
    }
    // 다 익히지 못한 자리는 안 뛰면 잊는다
    const table = game.world?.positions?.[p.id];
    if (table) {
      for (const pos of Object.keys(table)) {
        if (played[pos] || table[pos] >= 1) continue;
        table[pos] = Math.round((table[pos] - L.decay) * 1000) / 1000;
        if (table[pos] < L.min) delete table[pos];
        changed = true;
      }
      if (!Object.keys(table).length) delete game.world.positions[p.id];
    }
    complaintCheck(game, p, played, result.playerMinutes?.[p.id] ?? 0);
  }
  if (changed) game.world.version++;
}

// 줄이 다른 자리에서 원래보다 확실히 못한데 계속 세우면: complaint.matches경기째 한 번 불만 (시즌에 한 번), 그 뒤로는 경기마다 기분이 조금씩
function complaintCheck(game, p, played, minutes) {
  const C = L.complaint;
  const s = (game.players[p.id] ??= {});
  const learned = learnedOf(game, p.id);
  const misfit = Object.entries(played).find(
    ([pos, m]) => m >= C.minutes && baseFit(p, pos) < L.near && baseFit(p, pos) > POSITION_FIT.gkMismatch && (learned[pos] ?? 0) < L.familiar && positionRating(p, pos) < positionRating(p, p.position) - C.gap,
  );
  if (!misfit) {
    if (minutes > 0) delete s.misfit; // 제자리(또는 맞는 자리)에서 뛰면 다시 센다
    return;
  }
  const [pos] = misfit;
  s.misfit = (s.misfit ?? 0) + 1;
  if (s.misfit < C.matches) return;
  if (s.misfitSeason !== game.seasonIndex) {
    s.misfitSeason = game.seasonIndex;
    nudgeMood(game, p.id, C.mood);
    pushNews(game, 'player.posComplaint', { name: p.name, id: p.id, pos, from: p.position }, { important: true });
  } else {
    nudgeMood(game, p.id, C.perMatch);
  }
}

// 한 주 훈련 뒤: 개인 훈련으로 자리를 지정한 선수
export function trainPositionsWeek(dataset, game, individual = {}) {
  let changed = false;
  for (const p of squadOf(dataset, game, game.teamId)) {
    const pos = trainedPosition(individual[p.id]);
    if (!pos || baseFit(p, pos) <= POSITION_FIT.gkMismatch) continue;
    changed = addLearn(dataset, game, p, pos, L.training * speedOf(p, pos)) || changed;
  }
  if (changed) game.world.version++;
}
