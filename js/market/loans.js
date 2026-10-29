// 임대: 다른 구단 비주전·유망주를 시즌 끝까지 데려오거나(임대 영입), 우리 선수를 뛸 수 있는 구단에 보낸다(임대 보내기).
// 계약은 원소속 그대로, 주급은 빌린 구단이 wageShare만큼 내고 나머지는 원소속이 낸다 (finance.js wageBill).
// 소속은 game.players[id].teamId로 옮기고, 시즌 넘기기 때 returnLoans가 원소속으로 돌려보낸다.
// 임대 간 선수의 출전 수는 그대로 성장(newSeason.js)에 반영된다 → 어린 선수를 뛰게 하려면 임대.
import { overall } from '../engine/ratings.js';
import { createRng } from '../engine/rng.js';
import { availabilityOf, currentTeamId, loanOf, squadOf } from '../state/game.js';
import { RULES } from '../state/rules.js';
import { LOAN, MARKET } from './config.js';
import { contractOf, wageRoom } from './finance.js';
import { formatWage, transferPlayer, windowStatus } from './market.js';
import { playerValue, topElevenOvr } from './value.js';

const round1 = (v) => Math.round(v * 10) / 10;
const loansOf = (game) => (game.loans ??= []);
export const loansIn = (game) => (game.loans ?? []).filter((l) => l.to === game.teamId);
export const loansOut = (game) => (game.loans ?? []).filter((l) => l.from === game.teamId);

// 팀 내 OVR 순위 (1부터)
function rankIn(dataset, game, teamId, p) {
  return squadOf(dataset, game, teamId).filter((q) => overall(q) > overall(p)).length + 1;
}
// 상위 11명 중 11번째 OVR (주전 자리의 문턱)
function xiFloor(dataset, game, teamId) {
  const ovrs = squadOf(dataset, game, teamId).map(overall).sort((a, b) => b - a);
  return ovrs[Math.min(10, ovrs.length - 1)] ?? 0;
}
// 예상 역할: 주전 / 로테이션 / 백업
export function expectedRole(dataset, game, teamId, p) {
  const r = squadOf(dataset, game, teamId).filter((q) => q.id !== p.id && overall(q) > overall(p)).length + 1;
  return r <= 11 ? '주전' : r <= 16 ? '로테이션' : '백업';
}

const isYoung = (p) => p.age <= LOAN.youngAge;
const shareRange = (p) => (isYoung(p) ? LOAN.wageShare.young : LOAN.wageShare.other);
const pickShare = ([lo, hi], rng) => Math.round((lo + rng.next() * (hi - lo)) * 20) / 20; // 5% 단위

// 원소속 구단이 임대를 내줄 만한 선수인지 (주축 선수는 안 된다). 목록에서 버튼을 보일지 정할 때도 쓴다
export function isLoanable(dataset, game, p, teamId = currentTeamId(dataset, game, p.id)) {
  if (!teamId || teamId === game.teamId || dataset.isGuest(teamId) || loanOf(game, p.id)) return false;
  return rankIn(dataset, game, teamId, p) >= (isYoung(p) ? LOAN.youngMinRank : LOAN.minRank);
}

// 임대 영입 조건 → { ok, reason?, fee, wageShare, wage, role }
export function loanInTerms(dataset, game, p) {
  const from = currentTeamId(dataset, game, p.id);
  const wage = contractOf(dataset, game, p.id).wage;
  const wageShare = pickShare(shareRange(p), createRng(`${game.seed}:loanshare:${game.seasonIndex}:${p.id}`));
  const leagueId = dataset.teamById.get(from)?.leagueId;
  const fee = round1(playerValue(p) * LOAN.feeRatio[isYoung(p) ? 'young' : 'other'] * (MARKET.leagueFee[leagueId] ?? MARKET.defaultLeagueFee));
  const role = expectedRole(dataset, game, game.teamId, p);
  const terms = { ok: false, fee, wageShare, wage, role };
  const fail = (reason) => ({ ...terms, reason });
  if (!windowStatus(game).open) return fail('이적시장이 닫혀 있습니다.');
  if (!from) return fail('무소속 선수는 바로 영입할 수 있습니다.');
  if (from === game.teamId) return fail('이미 우리 팀 선수입니다.');
  if (dataset.isGuest(from)) return fail('대륙 대회 전용 팀 선수는 데려올 수 없습니다.');
  if (loanOf(game, p.id)) return fail('이미 임대 중인 선수입니다.');
  if (!availabilityOf(game, p.id).available) return fail('부상·징계 중인 선수는 임대할 수 없습니다.');
  if (!isLoanable(dataset, game, p, from)) return fail(`${dataset.teamById.get(from).shortName}의 주축 선수라 임대를 내주지 않습니다.`);
  if (overall(p) < xiFloor(dataset, game, game.teamId) - LOAN.playGap) return fail('우리 팀에서는 뛸 자리가 없어 보인다며 선수가 거절했습니다.');
  if (loansIn(game).length >= LOAN.maxIn) return fail(`임대 선수는 동시에 ${LOAN.maxIn}명까지입니다.`);
  if (squadOf(dataset, game, game.teamId).length >= RULES.squadMax) return fail(`스쿼드가 가득 찼습니다 (최대 ${RULES.squadMax}명).`);
  if (squadOf(dataset, game, from).length <= RULES.squadMin) return fail(`${dataset.teamById.get(from).shortName}: 스쿼드 인원이 부족해 보낼 수 없습니다.`);
  if (fee > game.budgets[game.teamId]) return fail('잔고가 부족합니다.');
  const room = wageRoom(dataset, game, game.teamId);
  if (wage * wageShare > room) return fail(`주급 한도 초과: 부담할 주급 ${formatWage(Math.round(wage * wageShare))}, 남은 한도 ${formatWage(Math.max(0, room))}`);
  return { ...terms, ok: true };
}

function startLoan(dataset, game, p, from, to, fee, wageShare) {
  transferPlayer(dataset, game, p.id, to, fee, { by: 'user', loan: true });
  // 출전 기록은 시즌 통산이라 임대 시작 때 값을 남겨 임대 기간 기록만 따로 본다
  const s = game.playerStats[p.id] ?? {};
  loansOf(game).push({ playerId: p.id, from, to, season: game.seasonIndex, round: game.round, wageShare, fee, appsAt: s.apps ?? 0, goalsAt: s.goals ?? 0 });
}

// 임대 영입 → { ok, message }
export function loanIn(dataset, game, playerId) {
  const p = dataset.playerById.get(playerId);
  const t = loanInTerms(dataset, game, p);
  if (!t.ok) return { ok: false, message: t.reason };
  const from = currentTeamId(dataset, game, p.id);
  startLoan(dataset, game, p, from, game.teamId, t.fee, t.wageShare);
  return { ok: true, message: `${p.name} 임대 영입 (${dataset.teamById.get(from).shortName}, 시즌 끝까지 · 주급 ${Math.round(t.wageShare * 100)}% 부담)` };
}

// 우리 선수 임대 보내기가 가능한지 → 안 되면 이유, 되면 null
export function loanOutBlock(dataset, game, p) {
  const loan = loanOf(game, p.id);
  if (loan) return loan.to === game.teamId ? '임대 온 선수는 다시 보낼 수 없습니다.' : '이미 임대 중입니다.';
  if (!windowStatus(game).open) return '이적시장이 닫혀 있습니다.';
  if (!availabilityOf(game, p.id).available) return '부상·징계 중인 선수는 보낼 수 없습니다.';
  if (loansOut(game).length >= LOAN.maxOut) return `임대는 동시에 ${LOAN.maxOut}명까지 보낼 수 있습니다.`;
  if (squadOf(dataset, game, game.teamId).length <= RULES.squadMin) return `스쿼드 최소 인원은 ${RULES.squadMin}명입니다.`;
  return null;
}

// 임대 보내기 제안: 주전으로 쓸 수 있는 구단만 [{ teamId, wageShare, role }] (전력 높은 구단 먼저)
export function loanOutOffers(dataset, game, playerId) {
  const p = dataset.playerById.get(playerId);
  if (loanOutBlock(dataset, game, p)) return [];
  const wage = contractOf(dataset, game, p.id).wage;
  const countryOf = (id) => dataset.leagueById.get(dataset.teamById.get(id)?.leagueId)?.country;
  const home = countryOf(game.teamId);
  const offers = [];
  for (const team of dataset.allTeams) {
    if (team.id === game.teamId) continue;
    const squad = squadOf(dataset, game, team.id);
    if (squad.length >= RULES.squadMax || overall(p) < xiFloor(dataset, game, team.id) + LOAN.outGap) continue;
    const rng = createRng(`${game.seed}:loanout:${game.seasonIndex}:${game.round}:${p.id}:${team.id}`);
    const wageShare = pickShare(shareRange(p), rng);
    if (wage * wageShare > wageRoom(dataset, game, team.id)) continue;
    offers.push({ teamId: team.id, wageShare, level: topElevenOvr(squad), w: rng.next() * (countryOf(team.id) === home ? LOAN.sameCountryWeight : 1) });
  }
  // 수준 높은 구단을 앞에 두되, 매번 같은 구단만 나오지 않게 상위 몇 곳 중에서 (같은 나라 먼저) 고른다
  return offers
    .sort((a, b) => b.level - a.level)
    .slice(0, LOAN.outOffers * 4)
    .sort((a, b) => b.w - a.w)
    .slice(0, LOAN.outOffers)
    .sort((a, b) => b.level - a.level)
    .map(({ teamId, wageShare }) => ({ teamId, wageShare, role: expectedRole(dataset, game, teamId, p) }));
}

// 임대 보내기 → { ok, message }
export function loanOut(dataset, game, playerId, offer) {
  const p = dataset.playerById.get(playerId);
  const block = loanOutBlock(dataset, game, p);
  if (block) return { ok: false, message: block };
  if (squadOf(dataset, game, offer.teamId).length >= RULES.squadMax) return { ok: false, message: '상대 구단 스쿼드가 가득 찼습니다.' };
  startLoan(dataset, game, p, game.teamId, offer.teamId, 0, offer.wageShare);
  return { ok: true, message: `${p.name} 임대 (${dataset.teamById.get(offer.teamId).shortName}, 시즌 끝까지)` };
}

// 시즌 넘기기: 모든 임대 선수를 원소속으로 → 우리 팀으로 돌아온 선수 이름 목록
export function returnLoans(dataset, game, retired = new Set()) {
  const back = [];
  for (const l of game.loans ?? []) {
    if (retired.has(l.playerId) || !dataset.playerById.get(l.playerId)) continue;
    (game.players[l.playerId] ??= {}).teamId = l.from;
    game.transfers.push({ round: game.round, season: game.seasonIndex, playerId: l.playerId, from: l.to, to: l.from, fee: 0, by: 'loanEnd' });
    if (l.from === game.teamId) back.push(dataset.playerById.get(l.playerId).name);
  }
  game.loans = [];
  return back;
}

// 임대 기간 기록 { apps, goals }
export function loanStats(game, l) {
  const s = game.playerStats[l.playerId] ?? {};
  return { apps: Math.max(0, (s.apps ?? 0) - (l.appsAt ?? 0)), goals: Math.max(0, (s.goals ?? 0) - (l.goalsAt ?? 0)) };
}

// 임대 보낸 선수 근황 (reportEvery 라운드마다) → [{ id, name, club, apps, goals, rounds(임대 뒤 라운드 수) }]
export function loanReports(dataset, game) {
  const played = game.round - 1;
  if (played <= 0 || played % LOAN.reportEvery !== 0) return [];
  return loansOut(game)
    .filter((l) => l.season === game.seasonIndex && l.round < game.round - 1) // 막 보낸 선수는 다음 근황부터
    .map((l) => {
      const p = dataset.playerById.get(l.playerId);
      return p && { id: p.id, name: p.name, club: dataset.teamById.get(l.to)?.shortName ?? '', rounds: game.round - l.round, ...loanStats(game, l) };
    })
    .filter(Boolean);
}

