// 계약 만료 선수 경쟁 입찰: 시즌을 넘길 때 풀린 주전급 선수에게 AI 구단들이 계약금을 걸고, 사용자도 입찰할 수 있다.
// 여름 이적시장 마지막 라운드 경기 뒤 선수가 가장 좋은 제안(계약금 + 구단 명성)을 고른다. 수치는 config.js FREE_AGENCY
import { overall } from '../engine/ratings.js';
import { createRng } from '../engine/rng.js';
import { t } from '../i18n.js';
import { currentTeamId, squadOf } from '../state/game.js';
import { RULES } from '../state/rules.js';
import { FREE_AGENCY as F } from './config.js';
import { demandedContract, wageRoom } from './finance.js';
import { formatMoney, playerValue, topElevenOvr } from './value.js';

const round1 = (v) => Math.round(v * 10) / 10;

// 구단 명성 0~1: 전체 구단 주전 평균 OVR 순위
function prestigeTable(dataset, game) {
  const ranked = dataset.allTeams.map((t) => ({ id: t.id, ovr: topElevenOvr(squadOf(dataset, game, t.id)) })).sort((a, b) => b.ovr - a.ovr);
  const n = Math.max(1, ranked.length - 1);
  return new Map(ranked.map(({ id }, i) => [id, 1 - i / n]));
}

// 선수 눈에 보이는 제안의 크기
const scoreOf = (bonus, value, prestige) => bonus + value * F.appeal * prestige;

// 이 구단이 지금 이 계약금으로 데려올 수 있는지 (인원·잔고·주급 한도)
function canAfford(dataset, game, teamId, player, bonus) {
  return (
    squadOf(dataset, game, teamId).length < RULES.squadMax &&
    bonus <= (game.budgets[teamId] ?? 0) &&
    demandedContract(dataset, game, player, teamId).wage <= wageRoom(dataset, game, teamId)
  );
}

// 시즌을 넘긴 직후 (새 시즌 재정까지 정한 뒤). ids: 이번에 계약이 끝나 풀린 선수. decideRound: 결정 라운드
// → 경쟁 입찰이 붙은 선수 목록 [{ playerId, from, bids }]
export function openFreeAgency(dataset, game, ids, decideRound, rng) {
  const prestige = prestigeTable(dataset, game);
  const tops = new Map(dataset.allTeams.map((t) => [t.id, topElevenOvr(squadOf(dataset, game, t.id))]));
  const players = {};
  for (const { id, from } of ids) {
    const p = dataset.playerById.get(id);
    if (!p || currentTeamId(dataset, game, id) !== null) continue;
    const value = playerValue(p);
    const ovr = overall(p);
    const bids = dataset.allTeams
      .filter((t) => t.id !== game.teamId && t.id !== from && ovr >= tops.get(t.id) + F.starterGap)
      .sort((a, b) => prestige.get(b.id) - prestige.get(a.id))
      .map((t) => {
        const bonus = round1(Math.min(value * (F.bid[0] + rng.next() * (F.bid[1] - F.bid[0])), game.budgets[t.id] * F.maxBudgetShare));
        return { teamId: t.id, bonus };
      })
      .filter((b) => b.bonus > 0 && canAfford(dataset, game, b.teamId, p, b.bonus))
      .slice(0, F.maxBidders);
    if (bids.length) players[id] = { from, bids, user: null };
  }
  game.freeAgency = { season: game.seasonIndex, decideRound, players };
  return Object.entries(players).map(([playerId, e]) => ({ playerId, ...e }));
}

// 경쟁 입찰 중인 선수면 그 항목 (없으면 null)
export function pendingFreeAgent(game, playerId) {
  const fa = game.freeAgency;
  if (!fa || fa.season !== game.seasonIndex || game.round > fa.decideRound) return null;
  return fa.players[playerId] ?? null;
}

// 화면용: 관심 구단, 결정 라운드, 에이전트 귀띔(우리가 이기려면 필요한 계약금 범위), 우리 입찰
export function freeAgentOutlook(dataset, game, playerId) {
  const e = pendingFreeAgent(game, playerId);
  if (!e) return null;
  const p = dataset.playerById.get(playerId);
  const value = playerValue(p);
  const prestige = prestigeTable(dataset, game);
  const best = Math.max(...e.bids.map((b) => scoreOf(b.bonus, value, prestige.get(b.teamId))));
  // 에이전트도 정확히는 모른다: 선수마다 고정된 흔들림 (범위 위쪽 끝을 불러도 질 수 있게)
  const blur = 1 + (createRng(`${game.seed}:fahint:${game.seasonIndex}:${playerId}`).next() * 2 - 1) * F.hintNoise;
  const need = Math.max(round1(value * F.minBonus), (best - value * F.appeal * (prestige.get(game.teamId) ?? 0)) * blur);
  return {
    clubs: e.bids.map((b) => b.teamId),
    decideRound: game.freeAgency.decideRound,
    hint: [round1(need * (1 - F.hint)), round1(need * (1 + F.hint))],
    userBid: e.user?.bonus ?? null,
  };
}

// 우리 입찰 (계약금). 이적시장이 열려 있는지는 부르는 쪽(makeOffer)이 확인한다
export function bidFreeAgent(dataset, game, playerId, bonus) {
  const e = pendingFreeAgent(game, playerId);
  const p = dataset.playerById.get(playerId);
  const min = round1(playerValue(p) * F.minBonus);
  if (!e) return { ok: false, accepted: false, message: t('market.fa.err.closed') };
  if (bonus < min) return { ok: false, accepted: false, message: t('market.fa.err.tooLow', { min: formatMoney(min) }) };
  e.user = { bonus: round1(bonus) };
  return {
    ok: true,
    accepted: false,
    bid: true,
    message: t('market.fa.ok.bid', { name: p.name, bonus: formatMoney(bonus), round: game.freeAgency.decideRound }),
  };
}

export function withdrawFreeAgentBid(game, playerId) {
  const e = pendingFreeAgent(game, playerId);
  if (e) e.user = null;
}

// 결정 라운드 경기 뒤: 선수마다 가장 좋은 제안을 고른다. sign(playerId, teamId, bonus)로 계약 (market.js transferPlayer)
// → [{ playerId, teamId, bonus, userBid }] (우리가 입찰한 선수와 AI가 데려간 선수 모두)
export function resolveFreeAgency(dataset, game, playedRound, sign) {
  const fa = game.freeAgency;
  if (!fa || fa.season !== game.seasonIndex || playedRound !== fa.decideRound) return [];
  const prestige = prestigeTable(dataset, game);
  const results = [];
  for (const [playerId, e] of Object.entries(fa.players)) {
    const p = dataset.playerById.get(playerId);
    if (!p || currentTeamId(dataset, game, playerId) !== null) continue;
    const value = playerValue(p);
    const offers = [...e.bids, ...(e.user ? [{ teamId: game.teamId, bonus: e.user.bonus }] : [])]
      .filter((b) => canAfford(dataset, game, b.teamId, p, b.bonus))
      .sort((a, b) => scoreOf(b.bonus, value, prestige.get(b.teamId) ?? 0) - scoreOf(a.bonus, value, prestige.get(a.teamId) ?? 0));
    const win = offers[0];
    if (win) sign(playerId, win.teamId, win.bonus);
    results.push({ playerId, teamId: win?.teamId ?? null, bonus: win?.bonus ?? 0, userBid: e.user?.bonus ?? null });
  }
  game.freeAgency = null;
  return results;
}

// 경쟁 없는 무소속 선수의 계약금 하한 (AI·사용자 공통)
export const minSigningBonus = (player) => round1(playerValue(player) * F.minBonus);
