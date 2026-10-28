// 게임 상태. 세이브 대상이므로 선수·팀은 ID로만 들고, 데이터는 dataset에서 찾는다.
// data/는 바꾸지 않는다: 이적·부상·컨디션처럼 시즌 중 바뀌는 값은 전부 game.players에 둔다.
//
// 모든 리그가 동시에 진행된다. 사용자 리그가 한 라운드를 치를 때마다 다른 리그는
// 진행률(완료 라운드 / 전체 라운드)이 같아지도록 따라온다 → 라운드 수가 달라도 시즌은 같이 끝난다.
// 사용자 리그 경기는 기록 전체를, 다른 리그 경기는 스코어·득점자만 저장한다 (세이브 크기).
import { AI_FORMATION_CANDIDATES, FORMATIONS, FORMATION_CELLS, slotsFromCells } from '../engine/formations.js';
import { autoSelectBench, autoSelectLineup, bestFormation } from '../engine/lineup.js';
import { CUP } from '../competitions/config.js';
import { TACTICS } from '../engine/config.js';
import { simulateMatch } from '../engine/match.js';
import { conditionFactor, positionFit, positionRating } from '../engine/ratings.js';
import { createRng, randomSeed } from '../engine/rng.js';
import { generateFixtures, roundCount } from '../league/fixtures.js';
import { moraleBoost, moraleOf } from './morale.js';
import { RULES } from './rules.js';

export const SAVE_VERSION = 5;
export const DEFAULT_FORMATION = '4-3-3';
export const GAME_LENGTHS = [1, 3, 5]; // 시즌 수

// 데이터를 교체하면 기존 세이브와 맞지 않을 수 있으므로 지문을 남긴다
export function dataFingerprint(dataset) {
  let h = 2166136261;
  for (const p of dataset.players) for (const ch of p.id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  for (const l of dataset.leagues) for (const ch of l.id + l.season) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return `${dataset.leagues.length}:${dataset.players.length}:${(h >>> 0).toString(36)}`;
}

export function newGame(dataset, teamId, { seed = randomSeed(), years = 1, slot = 1 } = {}) {
  const leagueId = dataset.teamById.get(teamId).leagueId;
  const league = dataset.leagueById.get(leagueId);
  const fixtures = {};
  for (const l of dataset.leagues) {
    fixtures[l.id] = generateFixtures(l.teamIds, l.rules.rounds, createRng(`${seed}:${l.id}`)).map((f) => ({ ...f, id: `${l.id}:${f.id}` }));
  }
  // 사용자 팀도 스쿼드에 가장 잘 맞는 포메이션으로 시작
  const startFormation = bestFormation(dataset.squads.get(teamId), Object.keys(FORMATION_CELLS)).formation ?? DEFAULT_FORMATION;
  const cells = FORMATION_CELLS[startFormation].map((c) => [...c]);
  return {
    version: SAVE_VERSION,
    dataVersion: dataFingerprint(dataset),
    seed,
    slot,
    years,
    seasonIndex: 1,
    teamId,
    leagueId,
    season: league.season,
    round: 1, // 사용자 리그의 다음 라운드
    totalRounds: roundCount(fixtures[leagueId]),
    leagueRounds: Object.fromEntries(dataset.leagues.map((l) => [l.id, 0])), // 리그별 완료 라운드
    formation: { cells },
    lineup: autoSelectLineup(dataset.squads.get(teamId), slotsFromCells(cells)).map((p) => p.id),
    bench: [], // 사용자가 고른 교체 명단 (모자라면 경기 때 자동으로 채움)
    settings: { autoSubs: true, pauseAtHalfTime: true },
    aiFormations: {}, // { [teamId]: 포메이션 } — 이적이 생기면 그 팀만 다시 계산
    fixtures, // { [leagueId]: Fixture[] }
    playerStats: {}, // { [playerId]: { goals, assists, apps } }
    players: {}, // { [playerId]: { teamId?, condition?, injury?: { type, matchesOut }, suspension?, yellows? } }
    transfers: [], // { round, season, playerId, from, to, fee, by }
    // 재정·계약·받은 제안은 season.js의 createGame이 채운다 (market/finance.js)
  };
}

export const leagueOf = (dataset, game, leagueId = game.leagueId) => dataset.leagueById.get(leagueId);
export const fixturesOf = (game, leagueId = game.leagueId) => game.fixtures[leagueId] ?? [];
export const leagueTotalRounds = (game, leagueId) => roundCount(fixturesOf(game, leagueId));

// ── 선수 상태 ─────────────────────────────────────────

const stateOf = (game, id) => game.players[id] ?? {};
const mutableStateOf = (game, id) => (game.players[id] ??= {});

export function currentTeamId(dataset, game, playerId) {
  const s = stateOf(game, playerId);
  // 은퇴 등으로 데이터에서 사라진 선수는 소속 없음
  return 'teamId' in s ? s.teamId : dataset.playerById.get(playerId)?.teamId ?? null;
}

// 현재 소속별 선수 목록. 선수가 만 명 넘게 있어 매번 거르면 느리므로 이적이 생길 때만 다시 만든다
const squadIndexCache = new WeakMap();
function squadIndex(dataset, game) {
  const cached = squadIndexCache.get(game);
  if (cached && cached.dataset === dataset && cached.version === game.transfers.length) return cached.index;
  const index = new Map();
  for (const p of dataset.players) {
    const teamId = currentTeamId(dataset, game, p.id);
    if (!index.has(teamId)) index.set(teamId, []);
    index.get(teamId).push(p);
  }
  squadIndexCache.set(game, { dataset, version: game.transfers.length, index });
  return index;
}

// 이적 기록 없이 소속을 한꺼번에 바꿨을 때 (시즌 넘기기) 캐시를 버린다
export function invalidateSquads(game) {
  squadIndexCache.delete(game);
}

// 반환 배열은 캐시이므로 정렬 등으로 바꾸려면 복사해서 쓸 것
export function squadOf(dataset, game, teamId) {
  return [...(squadIndex(dataset, game).get(teamId) ?? [])];
}

export const freeAgents = (dataset, game) => squadOf(dataset, game, null);

export const conditionOf = (game, id) => stateOf(game, id).condition ?? 100;

// { available, reason: 'injury' | 'suspension' | null, rounds, label }
// scope: 'league' | 'cup' — 부상은 공유, 출장정지는 대회별 (대륙 대회 징계는 cupSuspension)
export function availabilityOf(game, id, scope = 'league') {
  const s = stateOf(game, id);
  if (s.injury) return { available: false, reason: 'injury', rounds: s.injury.matchesOut, label: s.injury.type };
  const ban = scope === 'cup' ? s.cupSuspension : s.suspension;
  if (ban) return { available: false, reason: 'suspension', rounds: ban, label: scope === 'cup' ? '대륙 대회 출장정지' : '출장정지' };
  return { available: true, reason: null, rounds: 0, label: '' };
}

const isAvailable = (game, p, scope = 'league') => availabilityOf(game, p.id, scope).available;
const factorOf = (game) => (p) => conditionFactor(conditionOf(game, p.id));

// ── 사용자 선발 ───────────────────────────────────────

export const userSlots = (game) => slotsFromCells(game.formation.cells);

// 선발에 있으면 안 되는 선수 (부상·출장정지·이적으로 팀을 떠남)
export function lineupProblems(dataset, game, scope = 'league') {
  return game.lineup
    .map((id, slot) => ({ id, slot }))
    .filter(({ id }) => currentTeamId(dataset, game, id) !== game.teamId || !availabilityOf(game, id, scope).available);
}

// 문제 있는 슬롯만 출전 가능한 선수 중 가장 잘 맞는 선수로 채운다
export function fixLineup(dataset, game, scope = 'league') {
  const problems = lineupProblems(dataset, game, scope);
  if (problems.length === 0) return 0;
  const slots = userSlots(game);
  const keep = new Set(game.lineup.filter((_, i) => !problems.some((p) => p.slot === i)));
  const pool = squadOf(dataset, game, game.teamId).filter((p) => isAvailable(game, p, scope) && !keep.has(p.id));
  // 출전 가능한 선수가 모자라면 (부상자가 아주 많을 때) 결장자라도 같은 팀 선수로 채운다
  if (pool.length < problems.length) {
    for (const p of squadOf(dataset, game, game.teamId)) if (!keep.has(p.id) && !pool.includes(p)) pool.push(p);
  }
  for (const { slot } of problems) {
    if (!pool.length) break;
    const [best] = autoSelectLineup(pool, [slots[slot]], factorOf(game));
    game.lineup[slot] = best.id;
    pool.splice(pool.indexOf(best), 1);
  }
  return problems.length;
}

// 지친 선수 자동 휴식: 컨디션이 RULES.rotateBelow 미만인 선발을, 같은 자리에서 (컨디션 반영) 더 잘할 후보로 바꾼다.
// 사용자가 짠 선발은 최대한 그대로 둔다. → 바뀐 내용 [{ slot, out, in }]
export function rotateTired(dataset, game, scope = 'league') {
  const slots = userSlots(game);
  const factor = factorOf(game);
  const starters = new Set(game.lineup);
  const pool = squadOf(dataset, game, game.teamId).filter((p) => isAvailable(game, p, scope) && !starters.has(p.id));
  const score = (p, pos) => positionRating(p, pos) * positionFit(p, pos) * factor(p);
  const changes = [];
  game.lineup.forEach((id, i) => {
    if (conditionOf(game, id) >= RULES.rotateBelow) return;
    const current = dataset.playerById.get(id);
    let best = null;
    for (const p of pool) if (score(p, slots[i]) > score(current, slots[i]) && (!best || score(p, slots[i]) > score(best, slots[i]))) best = p;
    if (!best) return;
    game.lineup[i] = best.id;
    pool.splice(pool.indexOf(best), 1, current);
    changes.push({ slot: slots[i], out: current.name, in: best.name });
  });
  if (changes.length) {
    const ids = new Set(game.lineup);
    game.bench = (game.bench ?? []).filter((id) => !ids.has(id));
  }
  return changes;
}

// ── 경기 입력 ─────────────────────────────────────────

// AI 팀 포메이션: 전체 스쿼드로 후보 포메이션을 비교해 가장 강한 것 (캐시)
export function aiFormationOf(dataset, game, teamId) {
  game.aiFormations ??= {};
  if (!game.aiFormations[teamId]) {
    const squad = squadOf(dataset, game, teamId);
    game.aiFormations[teamId] = squad.length >= 11 ? bestFormation(squad, AI_FORMATION_CANDIDATES).formation : '4-3-3';
  }
  return game.aiFormations[teamId];
}

export const settingsOf = (game) => ({ autoSubs: true, pauseAtHalfTime: true, autoRotate: true, ...game.settings });
export const tacticsOf = (game) => ({ ...TACTICS.defaults, ...game.tactics });

// 사용자 교체 명단: 고른 선수 중 출전 가능한 선수 + 모자란 자리는 자동
function userBench(dataset, game, available, lineup, size, factor) {
  const starters = new Set(lineup.map((p) => p.id));
  const pool = new Set(available.map((p) => p.id));
  const chosen = (game.bench ?? []).filter((id) => pool.has(id) && !starters.has(id)).slice(0, size).map((id) => dataset.playerById.get(id));
  const rest = autoSelectBench(available.filter((p) => !chosen.includes(p)), lineup, size - chosen.length, factor);
  return [...chosen, ...rest];
}

const DEFAULT_BENCH = 9; // 리그가 없는 게스트 팀

export function teamInput(dataset, game, teamId, scope = 'league') {
  const team = dataset.teamById.get(teamId);
  const squad = squadOf(dataset, game, teamId);
  const healthy = squad.filter((p) => isAvailable(game, p, scope));
  // 부상·징계로 11명이 안 되면 결장자까지 써서라도 경기는 치른다
  const available = healthy.length >= 11 ? healthy : squad;
  const factor = factorOf(game);
  const benchSize = dataset.leagueById.get(team.leagueId)?.rules.matchday.benchSize ?? DEFAULT_BENCH;
  const mine = teamId === game.teamId;
  let slots;
  let lineup;
  let bench;
  let formation = null;
  if (mine) {
    slots = userSlots(game);
    lineup = game.lineup.map((id) => dataset.playerById.get(id));
    bench = userBench(dataset, game, available, lineup, benchSize, factor);
  } else {
    formation = aiFormationOf(dataset, game, teamId);
    slots = FORMATIONS[formation];
    lineup = autoSelectLineup(available, slots, factor);
    bench = autoSelectBench(available, lineup, benchSize, factor);
  }
  const condition = Object.fromEntries([...lineup, ...bench].map((p) => [p.id, conditionOf(game, p.id)]));
  const autoSubs = mine ? settingsOf(game).autoSubs : true;
  // 사용자 팀은 직접 고른 전술, AI 팀은 엔진이 경기 전력·스코어로 정한다
  const tactics = mine ? tacticsOf(game) : undefined;
  // 사기: 최근 흐름(모든 팀) + 인터뷰·팀 토크(사용자 팀)
  const boost = moraleBoost(moraleOf(dataset, game, teamId));
  return { id: teamId, name: team.shortName, slots, formation, lineup, bench, condition, autoSubs, tactics, autoTactics: !mine, boost };
}

// 스쿼드 화면용: 지금 경기를 하면 쓰일 교체 명단
export function previewUserBench(dataset, game, scope = 'league') {
  const squad = squadOf(dataset, game, game.teamId).filter((p) => isAvailable(game, p, scope));
  const lineup = game.lineup.map((id) => dataset.playerById.get(id));
  const size = dataset.leagueById.get(game.leagueId).rules.matchday.benchSize;
  return userBench(dataset, game, squad, lineup, size, factorOf(game));
}

export function matchInput(dataset, game, fixture) {
  return {
    home: teamInput(dataset, game, fixture.homeId),
    away: teamInput(dataset, game, fixture.awayId),
    seed: `${game.seed}:${game.seasonIndex}:${fixture.id}`,
  };
}

// ── 라운드 진행 ───────────────────────────────────────

export const roundFixtures = (game, round = game.round, leagueId = game.leagueId) => fixturesOf(game, leagueId).filter((f) => f.round === round);

export const userFixture = (game, round = game.round) =>
  roundFixtures(game, round).find((f) => f.homeId === game.teamId || f.awayId === game.teamId) ?? null;

export const isSeasonOver = (game) => game.round > game.totalRounds;

function recordResult(game, fixture, result, full) {
  fixture.result = full
    ? {
        score: { ...result.score },
        goals: result.goals.map(({ minute, team, scorerId, assistId }) => ({ minute, team, scorerId, assistId })),
        cards: result.cards.map(({ minute, team, playerId, type, secondYellow }) => ({ minute, team, playerId, type, secondYellow })),
        injuries: result.injuries.map(({ minute, team, playerId, type, matchesOut }) => ({ minute, team, playerId, type, matchesOut })),
        stats: result.stats,
      }
    : { score: { ...result.score }, goals: result.goals.map(({ team, scorerId, assistId }) => ({ team, scorerId, assistId })) };
  const stat = (id) => (game.playerStats[id] ??= { goals: 0, assists: 0, apps: 0 });
  for (const id of Object.keys(result.playerMinutes)) {
    if (result.playerMinutes[id] > 0) stat(id).apps++;
  }
  for (const g of result.goals) {
    stat(g.scorerId).goals++;
    if (g.assistId) stat(g.assistId).assists++;
  }
}

// 이번 라운드 결과로 생긴 부상·징계·컨디션 반영
// 경기 결과 → 컨디션·부상·징계. scope 'cup'이면 카드 징계를 대륙 대회 쪽에 쌓는다
export function applyConsequences(game, result, scope = 'league') {
  for (const [id, c] of Object.entries(result.conditionAfter)) mutableStateOf(game, id).condition = c;
  for (const inj of result.injuries) mutableStateOf(game, inj.playerId).injury = { type: inj.type, matchesOut: inj.matchesOut };
  for (const card of result.cards) {
    const s = mutableStateOf(game, card.playerId);
    if (scope === 'cup') {
      const K = CUP.cards;
      if (card.type === 'yellow') {
        s.cupYellows = (s.cupYellows ?? 0) + 1;
        if (s.cupYellows % K.yellowBanEvery === 0) s.cupSuspension = (s.cupSuspension ?? 0) + K.yellowBanMatches;
      } else {
        s.cupSuspension = (s.cupSuspension ?? 0) + (card.secondYellow ? K.secondYellowBan : K.redBan);
      }
      continue;
    }
    if (card.type === 'yellow') {
      s.yellows = (s.yellows ?? 0) + 1;
      if (s.yellows % RULES.yellowBanEvery === 0) s.suspension = (s.suspension ?? 0) + RULES.yellowBanMatches;
    } else {
      s.suspension = (s.suspension ?? 0) + (card.secondYellow ? RULES.secondYellowBan : RULES.straightRedBan);
    }
  }
}

// 한 주(사용자 라운드)가 지나면 기존 부상·징계 1경기 차감
function tickAbsences(game) {
  for (const s of Object.values(game.players)) {
    if (s.injury && --s.injury.matchesOut <= 0) delete s.injury;
    if (s.suspension && --s.suspension <= 0) delete s.suspension;
  }
}

// 다음 라운드까지 컨디션 회복 (나이 많을수록 덜 회복). ids를 주면 그 선수만, factor로 회복량 조절 (주중 경기)
export function recoverCondition(dataset, game, ids = null, factor = 1) {
  for (const id of ids ?? Object.keys(game.players)) {
    const s = game.players[id];
    if (s?.condition != null) {
      const age = dataset.playerById.get(id).age;
      const recovery = Math.max(RULES.minRecovery, RULES.conditionRecovery - Math.max(0, age - RULES.recoveryAgeFrom) * RULES.recoveryAgePenalty);
      s.condition = Math.min(100, s.condition + recovery * factor);
      if (s.condition >= 100) delete s.condition;
    }
  }
}

// 대륙 대회 경기를 치른 팀 선수: 부상·대륙 대회 징계 1경기 차감
export function tickCupAbsences(game, ids) {
  for (const id of ids) {
    const s = game.players[id];
    if (!s) continue;
    if (s.injury && --s.injury.matchesOut <= 0) delete s.injury;
    if (s.cupSuspension && --s.cupSuspension <= 0) delete s.cupSuspension;
  }
}

// 다른 리그가 이번 주까지 치러야 할 라운드 (사용자 리그 진행률에 맞춘다)
function otherLeagueTargets(game) {
  const done = game.round; // 이번 라운드를 마친 뒤 기준
  const targets = {};
  for (const leagueId of Object.keys(game.fixtures)) {
    if (leagueId === game.leagueId) continue;
    const total = leagueTotalRounds(game, leagueId);
    targets[leagueId] = Math.min(total, Math.floor((done * total) / game.totalRounds));
  }
  return targets;
}

// 사용자 경기 결과(userResult, 휴식 라운드면 null)와 나머지 경기를 기록하고 다음 라운드로.
// 반환: 사용자 리그의 다른 경기들 [{ fixture, result }]
export function completeRound(dataset, game, userResult) {
  const mine = userFixture(game);
  const results = roundFixtures(game).map((f) => ({ fixture: f, result: f === mine ? userResult : simulateMatch(matchInput(dataset, game, f)), full: true }));
  for (const [leagueId, target] of Object.entries(otherLeagueTargets(game))) {
    for (let r = game.leagueRounds[leagueId] + 1; r <= target; r++) {
      for (const f of roundFixtures(game, r, leagueId)) results.push({ fixture: f, result: simulateMatch(matchInput(dataset, game, f)), full: false });
    }
    game.leagueRounds[leagueId] = Math.max(game.leagueRounds[leagueId], target);
  }
  // 이번 주에 못 뛴 선수의 부상·징계를 먼저 차감하고, 이번 경기에서 생긴 것을 더한다
  tickAbsences(game);
  for (const { fixture, result, full } of results) {
    recordResult(game, fixture, result, full);
    applyConsequences(game, result);
  }
  recoverCondition(dataset, game);
  game.leagueRounds[game.leagueId] = game.round;
  game.round++;
  return results.filter((r) => r.full && r.fixture !== mine);
}

