// 재정·계약. 데이터에는 계약·주급이 없으므로(CLAUDE.md 데이터 규칙) 게임 공식으로 만든다.
// 바뀐 계약(영입·재계약)만 game.contracts에 저장하고 나머지는 선수 데이터로 매번 같은 값을 계산한다.
//
// 금액: 잔고(game.budgets)·수입은 £M, 주급은 £k/주
// 계약: { wage, until } — until은 계약이 끝나는 시즌 번호 (game.seasonIndex 기준)
import { createRng } from '../engine/rng.js';
import { computeTable } from '../league/table.js';
import { currentTeamId, fixturesOf, squadOf } from '../state/game.js';
import { FINANCE } from './config.js';
import { playerValue, topElevenOvr } from './value.js';

const round1 = (v) => Math.round(v * 10) / 10;
const wageFactor = (leagueId) => FINANCE.leagueWageFactor[leagueId] ?? FINANCE.defaultWageFactor;
const leagueOfTeam = (dataset, teamId) => dataset.teamById.get(teamId)?.leagueId;

// 그 리그 기준 주급 (£k/주)
export function baseWage(player, leagueId) {
  return Math.max(FINANCE.minWage, Math.round(playerValue(player) * FINANCE.wagePerValue * wageFactor(leagueId)));
}

function contractYears(player, seed) {
  const range = player.age <= 23 ? FINANCE.contractYears.young : player.age <= 30 ? FINANCE.contractYears.prime : FINANCE.contractYears.veteran;
  const r = createRng(`${seed}:contract:${player.id}`).next();
  return range[0] + Math.floor(r * (range[1] - range[0] + 1));
}

// 데이터 기준 기본 계약 (게임 시작 시점 소속 리그 주급, 남은 기간은 선수 ID로 고정)
const defaultCache = new Map();
function defaultContract(dataset, player) {
  let c = defaultCache.get(player.id);
  if (!c || c.dataset !== dataset) {
    c = { dataset, wage: baseWage(player, leagueOfTeam(dataset, player.teamId)), years: contractYears(player, 'data') };
    defaultCache.set(player.id, c);
  }
  return { wage: c.wage, until: c.years }; // 1시즌째 기준: until = 남은 시즌 수
}

export function contractOf(dataset, game, playerId) {
  return game.contracts[playerId] ?? defaultContract(dataset, dataset.playerById.get(playerId));
}

// 이번 시즌 포함 남은 시즌 수
export const seasonsLeft = (game, contract) => Math.max(0, contract.until - game.seasonIndex + 1);

export function wageBill(dataset, game, teamId) {
  return squadOf(dataset, game, teamId).reduce((s, p) => s + contractOf(dataset, game, p.id).wage, 0);
}

// 이적·재계약 때 선수가 요구하는 계약
export function demandedContract(dataset, game, player, toTeamId) {
  const current = currentTeamId(dataset, game, player.id) ? contractOf(dataset, game, player.id).wage : 0;
  const wage = Math.round(Math.max(current, baseWage(player, leagueOfTeam(dataset, toTeamId))) * FINANCE.signingRaise);
  return { wage, years: contractYears(player, `${game.seed}:${game.seasonIndex}:${toTeamId}`) };
}

export function renewalTerms(dataset, game, playerId) {
  const player = dataset.playerById.get(playerId);
  const contract = contractOf(dataset, game, playerId);
  const wage = Math.round(Math.max(contract.wage, baseWage(player, leagueOfTeam(dataset, game.teamId))) * FINANCE.renewalRaise);
  // 재계약은 지금 남은 기간보다 길어야 의미가 있다 (최대 5년)
  const years = Math.min(5, Math.max(contractYears(player, `${game.seed}:${game.seasonIndex}:renew`), seasonsLeft(game, contract) + 1));
  return { wage, years };
}

export function signContract(game, playerId, { wage, years }) {
  game.contracts[playerId] = { wage, until: game.seasonIndex + years - 1 };
}

// 계약 해지 위약금 (£M)
export function releaseCost(dataset, game, playerId) {
  const c = contractOf(dataset, game, playerId);
  return round1((c.wage * FINANCE.weeksPerSeason * seasonsLeft(game, c) * FINANCE.releaseCompensation) / 1000);
}

// ── 구단 재정 ─────────────────────────────────────────

// 시즌 시작: 모든 구단의 시즌 수입·주급 한도. 첫 시즌이면 시작 잔고도
export function initSeasonFinances(dataset, game, { firstSeason }) {
  game.finances = {};
  for (const league of dataset.leagues) {
    // 리그 안 전력 순위로 명성 배율
    const ranked = league.teamIds
      .map((id) => ({ id, ovr: topElevenOvr(squadOf(dataset, game, id)) }))
      .sort((a, b) => b.ovr - a.ovr);
    ranked.forEach(({ id }, i) => {
      const t = ranked.length > 1 ? 1 - i / (ranked.length - 1) : 1;
      const ratio = FINANCE.revenueRatio.min + (FINANCE.revenueRatio.max - FINANCE.revenueRatio.min) * t;
      const bill = wageBill(dataset, game, id);
      const revenue = round1(((bill * FINANCE.weeksPerSeason) / 1000) * ratio);
      const headroom = FINANCE.wageHeadroom.min + (FINANCE.wageHeadroom.max - FINANCE.wageHeadroom.min) * t;
      game.finances[id] = { revenue, wageBudget: Math.round(bill * headroom) };
      if (firstSeason) game.budgets[id] = round1(revenue * FINANCE.startingBalance);
    });
  }
  game.ledger = emptyLedger();
}

export const emptyLedger = () => ({ tv: 0, gate: 0, commercial: 0, prize: 0, transfersOut: 0, wages: 0, transfersIn: 0, compensation: 0 });

// 사용자 팀 장부 기록 (수입은 양수, 지출도 양수로 쌓고 화면에서 구분)
export function bookLedger(game, teamId, key, amount) {
  if (teamId === game.teamId) game.ledger[key] = round1((game.ledger[key] ?? 0) + amount);
}

export function wageRoom(dataset, game, teamId) {
  return (game.finances[teamId]?.wageBudget ?? 0) - wageBill(dataset, game, teamId);
}

// 한 주(사용자 라운드) 정산: 모든 구단 수입 + 주급 지출. 리그 라운드 수가 달라도 한 시즌 합계는 같다
export function applyWeekFinances(dataset, game) {
  const weeksThisRound = FINANCE.weeksPerSeason / game.totalRounds;
  for (const team of dataset.allTeams) {
    const f = game.finances[team.id];
    if (!f) continue;
    const income = f.revenue / game.totalRounds;
    const wages = (wageBill(dataset, game, team.id) * weeksThisRound) / 1000;
    game.budgets[team.id] = round1(game.budgets[team.id] + income - wages);
    if (team.id === game.teamId) {
      for (const [k, share] of Object.entries(FINANCE.revenueSplit)) bookLedger(game, team.id, k, income * share);
      bookLedger(game, team.id, 'wages', wages);
    }
  }
}

// 시즌 종료 상금: 리그 순위대로
export function awardSeasonPrizes(dataset, game) {
  for (const league of dataset.leagues) {
    const table = computeTable(league.teamIds, fixturesOf(game, league.id), league.rules);
    table.forEach((row, i) => {
      const f = game.finances[row.teamId];
      if (!f) return;
      const share = table.length > 1 ? 1 - i / (table.length - 1) : 1;
      const prize = round1(f.revenue * FINANCE.prizeShare * share);
      game.budgets[row.teamId] = round1(game.budgets[row.teamId] + prize);
      bookLedger(game, row.teamId, 'prize', prize);
    });
  }
}
