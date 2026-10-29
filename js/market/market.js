// 이적: 영입 제안, AI 구단의 구매 제안, 받은 제안, 계약 해지·재계약. 소속 변경은 game.players[id].teamId로만 기록한다.
import { overall } from '../engine/ratings.js';
import { createRng } from '../engine/rng.js';
import { localeTag, t } from '../i18n.js';
import { currentTeamId, fixLineup, isSeasonOver, loanOf, squadOf } from '../state/game.js';
import { RULES } from '../state/rules.js';
import { onSigning } from '../state/training.js';
import { FINANCE, MARKET } from './config.js';
import { bidFreeAgent, minSigningBonus, pendingFreeAgent } from './freeAgency.js';
import { bookLedger, contractOf, demandedContract, releaseCost, renewalTerms, seasonsLeft, signContract, wageBill, wageRoom } from './finance.js';
import { formatMoney, playerValue, topElevenOvr } from './value.js';

const round1 = (v) => Math.round(v * 10) / 10;
// 결과 문장은 부를 때 지금 언어로 (message는 화면이 바로 보여 주고 저장하지 않는다)
const LOANED = () => t('market.err.loanedIn');
const JUST_SIGNED = () => t('market.err.justSigned');
const CLOSED = () => t('market.err.windowClosed');
const SQUAD_MIN = () => t('market.err.squadMin', { n: RULES.squadMin });
export const formatWage = (k) => t('market.wage', { k: k.toLocaleString(localeTag()) });

// 이적시장 기간: 진행률 구간 → 사용자 리그의 라운드 구간 [{ name, from, to }]
export const transferWindows = (game) =>
  MARKET.windows.map((w) => {
    const from = Math.floor(w.from * game.totalRounds) + 1;
    return { id: w.id, name: w.name, from, to: Math.max(from, Math.round(w.to * game.totalRounds)) };
  });

// { open, name, closesAfter, next } — next는 다음에 열릴 창
export function windowStatus(game) {
  if (isSeasonOver(game)) return { open: false, name: null, next: null };
  const windows = transferWindows(game);
  const current = windows.find((w) => game.round >= w.from && game.round <= w.to);
  if (current) return { open: true, name: current.name, closesAfter: current.to, next: null };
  const next = windows.find((w) => w.from > game.round) ?? null;
  return { open: false, name: null, next };
}

// 이번 이적시장에 우리가 영입한 선수: 같은 시장 안에서는 되팔 수 없다 (공짜로 데려와 바로 파는 꼼수 방지)
export function signedThisWindow(game, playerId) {
  const w = transferWindows(game).find((x) => game.round >= x.from && game.round <= x.to);
  if (!w) return false;
  return game.transfers.some((t) => t.playerId === playerId && t.to === game.teamId && t.season === game.seasonIndex && t.round >= w.from && t.round <= w.to);
}

// 판매 구단의 요구액: 팀 내 OVR 순위로 역할을 판단, 계약이 곧 끝나는 선수는 싸게.
// 무소속은 선수에게 주는 계약금 하한 (이적료가 없는 대신)
export function askingPrice(dataset, game, player) {
  const teamId = currentTeamId(dataset, game, player.id);
  const value = playerValue(player);
  if (teamId === null) return minSigningBonus(player);
  const A = MARKET.asking;
  const rank = squadOf(dataset, game, teamId)
    .map((p) => overall(p))
    .sort((a, b) => b - a)
    .indexOf(overall(player)) + 1;
  let mult = rank <= A.keyUntilRank ? A.key : rank <= A.rotationUntilRank ? A.rotation : A.fringe;
  if (seasonsLeft(game, contractOf(dataset, game, player.id)) <= 1) mult *= FINANCE.shortContractDiscount;
  const leagueId = dataset.teamById.get(teamId)?.leagueId;
  mult *= MARKET.leagueFee[leagueId] ?? MARKET.defaultLeagueFee;
  return round1(value * mult);
}

// 소속 이동 + 이적료 + 새 계약. by: 'user' | 'ai', loan: 임대 (계약은 그대로, market/loans.js)
export function transferPlayer(dataset, game, playerId, to, fee, { contract = null, by = 'user', loan = false } = {}) {
  const from = currentTeamId(dataset, game, playerId);
  if (from && game.budgets[from] != null) {
    game.budgets[from] = round1(game.budgets[from] + fee);
    bookLedger(game, from, 'transfersOut', fee);
  }
  if (to && game.budgets[to] != null) {
    game.budgets[to] = round1(game.budgets[to] - fee);
    bookLedger(game, to, 'transfersIn', fee);
  }
  const s = (game.players[playerId] ??= {});
  s.teamId = to;
  // 스쿼드가 바뀐 AI 팀은 포메이션을 다시 고른다
  if (game.aiFormations) {
    delete game.aiFormations[from];
    delete game.aiFormations[to];
  }
  if (from === game.teamId) game.bench = (game.bench ?? []).filter((id) => id !== playerId);
  if (to && contract) signContract(game, playerId, contract);
  if (to === game.teamId && by === 'user') onSigning(game); // 새 얼굴: 조직력이 잠시 어긋난다
  if (!to) delete game.contracts[playerId];
  game.transfers.push({ round: game.round, season: game.seasonIndex, playerId, from, to, fee, by, ...(loan ? { loan: true } : {}) });
  // 받은 제안 중 이 선수 것은 무효
  game.incomingOffers = (game.incomingOffers ?? []).filter((o) => o.playerId !== playerId);
  // 사용자 선발에서 빠졌으면 자리를 메운다
  if (from === game.teamId) fixLineup(dataset, game);
}

// 영입 시 조건 미리보기: { asking, contract, wageOk }
export function offerTerms(dataset, game, playerId) {
  const player = dataset.playerById.get(playerId);
  const contract = demandedContract(dataset, game, player, game.teamId);
  return { asking: askingPrice(dataset, game, player), contract, wageOk: contract.wage <= wageRoom(dataset, game, game.teamId) };
}

// 영입 제안 → { ok, accepted, message }
export function makeOffer(dataset, game, playerId, amount) {
  const player = dataset.playerById.get(playerId);
  const from = currentTeamId(dataset, game, playerId);
  const fail = (message) => ({ ok: false, accepted: false, message });
  const contract = demandedContract(dataset, game, player, game.teamId);

  if (!windowStatus(game).open) return fail(CLOSED());
  if (from === game.teamId) return fail(t('market.err.alreadyOurs'));
  if (loanOf(game, playerId)) return fail(t('market.err.onLoanNoBuy'));
  if (dataset.isGuest(from)) return fail(t('market.err.guestNoBuy'));
  if (!(amount >= 0)) return fail(t('market.err.checkAmount'));
  if (amount > game.budgets[game.teamId]) return fail(t('market.err.noFunds'));
  if (contract.wage > wageRoom(dataset, game, game.teamId)) return fail(t('market.err.wageCap', { wage: formatWage(contract.wage), room: formatWage(Math.max(0, wageRoom(dataset, game, game.teamId))) }));
  if (squadOf(dataset, game, game.teamId).length >= RULES.squadMax) return fail(t('market.err.squadFull', { n: RULES.squadMax }));

  if (from === null) {
    // 계약 만료 스타: 다른 구단과 경쟁 입찰 (결정은 freeAgency.js resolveFreeAgency)
    if (pendingFreeAgent(game, playerId)) return bidFreeAgent(dataset, game, playerId, amount);
    const bonus = minSigningBonus(player);
    if (amount < bonus) return fail(t('market.err.bonusTooLow', { bonus: formatMoney(bonus) }));
    transferPlayer(dataset, game, playerId, game.teamId, amount, { contract });
    return { ok: true, accepted: true, message: t('market.ok.freeSigned', { name: player.name, bonus: formatMoney(amount), wage: formatWage(contract.wage), n: contract.years }) };
  }
  if (squadOf(dataset, game, from).length <= RULES.squadMin) {
    return { ok: true, accepted: false, message: t('market.err.sellerShort', { club: dataset.teamById.get(from).shortName }) };
  }

  const asking = askingPrice(dataset, game, player);
  const { rejectBelow, certainAbove } = MARKET.acceptance;
  const ratio = amount / asking;
  const p = Math.min(1, Math.max(0, (ratio - rejectBelow) / (certainAbove - rejectBelow)));
  // 같은 라운드에 같은 금액이면 같은 답 (다시 눌러서 운을 바꿀 수 없게)
  const accepted = createRng(`${game.seed}:offer:${game.seasonIndex}:${game.round}:${playerId}:${Math.round(amount * 10)}`).chance(p);
  if (!accepted) {
    return { ok: true, accepted: false, message: t(ratio < rejectBelow ? 'market.reject.tooLow' : 'market.reject.close') };
  }
  transferPlayer(dataset, game, playerId, game.teamId, amount, { contract });
  return { ok: true, accepted: true, message: t('market.ok.signed', { name: player.name, club: dataset.teamById.get(from).shortName, fee: formatMoney(amount), wage: formatWage(contract.wage) }) };
}

// AI 구단이 이 선수를 살 수 있는지 (잔고·주급 한도·인원)
export function canAiBuy(dataset, game, teamId, player, fee) {
  const contract = demandedContract(dataset, game, player, teamId);
  return (
    squadOf(dataset, game, teamId).length < RULES.squadMax &&
    fee <= game.budgets[teamId] &&
    contract.wage <= wageRoom(dataset, game, teamId)
  );
}

// 우리 선수에 대한 AI 구단 제안 (최대 3개, 금액 높은 순)
export function sellOffers(dataset, game, playerId) {
  if (loanOf(game, playerId) || signedThisWindow(game, playerId)) return [];
  const player = dataset.playerById.get(playerId);
  const value = playerValue(player);
  const S = MARKET.sellOffers;
  const offers = [];
  // 모든 리그 구단이 후보. 우리 선수가 자기 팀 주전급이면 관심
  for (const team of dataset.allTeams) {
    if (team.id === game.teamId) continue;
    const squad = squadOf(dataset, game, team.id);
    if (overall(player) < topElevenOvr(squad) - S.interestGap) continue;
    const rng = createRng(`${game.seed}:sell:${game.seasonIndex}:${game.round}:${playerId}:${team.id}`);
    const amount = round1(Math.min(game.budgets[team.id], value * (S.minRatio + rng.next() * (S.maxRatio - S.minRatio))));
    if (amount >= value * S.minRatio && canAiBuy(dataset, game, team.id, player, amount)) offers.push({ teamId: team.id, amount });
  }
  return offers.sort((a, b) => b.amount - a.amount).slice(0, S.max);
}

export function acceptSellOffer(dataset, game, playerId, offer) {
  if (!windowStatus(game).open) return { ok: false, message: CLOSED() };
  if (loanOf(game, playerId)) return { ok: false, message: LOANED() };
  if (signedThisWindow(game, playerId)) return { ok: false, message: JUST_SIGNED() };
  if (squadOf(dataset, game, game.teamId).length <= RULES.squadMin) return { ok: false, message: SQUAD_MIN() };
  const player = dataset.playerById.get(playerId);
  if (!canAiBuy(dataset, game, offer.teamId, player, offer.amount)) return { ok: false, message: t('market.err.buyerCantPay') };
  transferPlayer(dataset, game, playerId, offer.teamId, offer.amount, { contract: demandedContract(dataset, game, player, offer.teamId), by: 'ai' });
  return { ok: true, message: t('market.ok.sold', { name: player.name, fee: formatMoney(offer.amount) }) };
}

// 받은 제안 (AI 구단이 먼저 걸어온 것)
export function respondIncomingOffer(dataset, game, offerId, accept) {
  const offer = (game.incomingOffers ?? []).find((o) => o.id === offerId);
  if (!offer) return { ok: false, message: t('market.err.offerGone') };
  game.incomingOffers = game.incomingOffers.filter((o) => o.id !== offerId);
  if (!accept) return { ok: true, message: t('market.ok.offerRejected') };
  return acceptSellOffer(dataset, game, offer.playerId, offer);
}

// 계약 해지: 이적시장과 무관하게 언제든. 남은 계약 주급의 일부를 위약금으로 낸다
export function releasePlayer(dataset, game, playerId) {
  if (loanOf(game, playerId)) return { ok: false, message: LOANED() };
  if (squadOf(dataset, game, game.teamId).length <= RULES.squadMin) return { ok: false, message: SQUAD_MIN() };
  const cost = releaseCost(dataset, game, playerId);
  if (cost > game.budgets[game.teamId]) return { ok: false, message: t('market.err.cantPayRelease', { cost: formatMoney(cost) }) };
  game.budgets[game.teamId] = round1(game.budgets[game.teamId] - cost);
  bookLedger(game, game.teamId, 'compensation', cost);
  transferPlayer(dataset, game, playerId, null, 0);
  return { ok: true, message: t('market.ok.released', { name: dataset.playerById.get(playerId).name, cost: formatMoney(cost) }) };
}

// 재계약: 요구 조건을 받아들이면 계약 연장
export function renewContract(dataset, game, playerId) {
  if (loanOf(game, playerId)?.to === game.teamId) return { ok: false, message: LOANED() }; // 임대 보낸 선수는 재계약할 수 있다
  const terms = renewalTerms(dataset, game, playerId);
  const extra = terms.wage - contractOf(dataset, game, playerId).wage;
  if (extra > wageRoom(dataset, game, game.teamId)) return { ok: false, message: t('market.err.wageCapRaise', { wage: formatWage(extra) }) };
  signContract(game, playerId, terms);
  return { ok: true, message: t('market.ok.renewed', { name: dataset.playerById.get(playerId).name, wage: formatWage(terms.wage), n: terms.years }) };
}

export { wageBill, wageRoom };
