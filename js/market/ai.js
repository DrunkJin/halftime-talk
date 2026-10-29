// AI 구단 이적: 이적시장 기간에 라운드마다 약한 포지션을 보강하고, 우리 선수에게 제안을 건다.
import { isRequesting } from '../state/squadMood.js';
import { MOOD } from '../state/moodConfig.js';
import { POSITIONS } from '../data/schema.js';
import { FORMATIONS } from '../engine/formations.js';
import { autoSelectLineup } from '../engine/lineup.js';
import { overall, positionFit, positionRating } from '../engine/ratings.js';
import { createRng } from '../engine/rng.js';
import { aiFormationOf, availabilityOf, currentTeamId, loanOf, squadOf } from '../state/game.js';
import { RULES } from '../state/rules.js';
import { AI_MARKET } from './config.js';
import { demandedContract } from './finance.js';
import { askingPrice, canAiBuy, transferPlayer } from './market.js';
import { playerValue, topElevenOvr } from './value.js';

const round1 = (v) => Math.round(v * 10) / 10;

// 포지션별 영입 후보 (우리 팀 선수·고령 제외), OVR 높은 순
function candidatesByPosition(dataset, game) {
  const byPos = new Map(POSITIONS.map((p) => [p, []]));
  for (const p of dataset.players) {
    const teamId = currentTeamId(dataset, game, p.id);
    // 게스트 팀(대륙 대회 전용, 재정 없음) 선수는 이적시장에 나오지 않는다
    if (teamId === game.teamId || dataset.isGuest(teamId) || p.age > AI_MARKET.maxAge || !availabilityOf(game, p.id).available || loanOf(game, p.id)) continue;
    byPos.get(p.position).push({ p, ovr: overall(p) });
  }
  for (const list of byPos.values()) list.sort((a, b) => b.ovr - a.ovr);
  return byPos;
}

// 한 라운드의 AI 영입. 반환: 성사된 이적 목록
export function aiTransferRound(dataset, game) {
  const rng = createRng(`${game.seed}:ai:${game.seasonIndex}:${game.round}`);
  const byPos = candidatesByPosition(dataset, game);
  const done = [];
  for (const team of dataset.allTeams) {
    if (team.id === game.teamId || !rng.chance(AI_MARKET.activeChance)) continue;
    const squad = squadOf(dataset, game, team.id);
    if (squad.length >= RULES.squadMax || squad.length < 11) continue;

    // 그 팀 포메이션에서 가장 약한 주전 자리
    const slots = FORMATIONS[aiFormationOf(dataset, game, team.id)];
    const xi = autoSelectLineup(squad, slots);
    let weakest = 0;
    let weakestScore = Infinity;
    xi.forEach((p, i) => {
      const score = positionRating(p, slots[i]) * positionFit(p, slots[i]);
      if (score < weakestScore) [weakest, weakestScore] = [i, score];
    });
    const pos = slots[weakest];
    const target = weakestScore + AI_MARKET.upgradeMin;
    const maxFee = game.budgets[team.id] * AI_MARKET.maxFeeShare;

    // 목표 수준 이상인 후보 중 가장 싸게 데려올 수 있는 선수 (상위 후보만 살펴본다)
    let best = null;
    let bestFee = Infinity;
    const list = byPos.get(pos);
    for (let i = 0; i < list.length && i < AI_MARKET.candidatesPerSearch; i++) {
      const { p, ovr } = list[i];
      if (ovr < target) break;
      const from = currentTeamId(dataset, game, p.id);
      if (from === team.id || (from && squadOf(dataset, game, from).length <= RULES.squadMin)) continue;
      const fee = askingPrice(dataset, game, p);
      if (fee < bestFee && fee <= maxFee && canAiBuy(dataset, game, team.id, p, fee)) [best, bestFee] = [p, fee];
    }
    if (!best) continue;
    const from = currentTeamId(dataset, game, best.id);
    transferPlayer(dataset, game, best.id, team.id, bestFee, { contract: demandedContract(dataset, game, best, team.id), by: 'ai' });
    list.splice(list.findIndex((c) => c.p === best), 1);
    done.push({ playerId: best.id, from, to: team.id, fee: bestFee });
  }
  return done;
}

// 우리 주전급 선수에게 들어오는 제안 (game.incomingOffers에 추가). 반환: 새 제안 목록
export function generateIncomingOffers(dataset, game) {
  const rng = createRng(`${game.seed}:incoming:${game.seasonIndex}:${game.round}`);
  const squad = squadOf(dataset, game, game.teamId);
  const bar = topElevenOvr(squad) - 2;
  const fresh = [];
  for (const p of squad) {
    // 이적을 요청한(허락한) 선수는 주전급이 아니어도, 더 자주 제안이 온다
    if (loanOf(game, p.id)) continue; // 임대 온 선수는 원소속 선수
    const requested = isRequesting(game, p.id);
    if ((!requested && overall(p) < bar) || !rng.chance(AI_MARKET.incomingChance * (requested ? MOOD.requestOfferBoost : 1))) continue;
    if ((game.incomingOffers ?? []).some((o) => o.playerId === p.id)) continue;
    const [lo, hi] = AI_MARKET.incomingRatio;
    const amount = round1(playerValue(p) * (lo + rng.next() * (hi - lo)));
    // 이 선수가 주전이 될 만하고 돈이 있는 구단 중 무작위
    const buyers = dataset.allTeams.filter((t) => {
      if (t.id === game.teamId) return false;
      const theirs = squadOf(dataset, game, t.id);
      return overall(p) >= topElevenOvr(theirs) - (requested ? 6 : 3) && canAiBuy(dataset, game, t.id, p, amount);
    });
    if (buyers.length === 0) continue;
    const buyer = buyers[Math.floor(rng.next() * buyers.length)];
    const offer = { id: `${game.seasonIndex}-${game.round}-${p.id}`, playerId: p.id, teamId: buyer.id, amount, expires: game.round + AI_MARKET.offerLifetime };
    (game.incomingOffers ??= []).push(offer);
    fresh.push(offer);
  }
  return fresh;
}

export function expireIncomingOffers(game) {
  game.incomingOffers = (game.incomingOffers ?? []).filter((o) => o.expires >= game.round);
}
