// 대륙 대회 진행: 시즌 시작 때 추첨·일정, 주중 경기 처리, 리그 페이즈 순위, 토너먼트 대진.
// 상태는 game.cups = { season, schedule: [이벤트], comps: { [대회 id]: 대회 } }
//   이벤트: { key, stage, md | leg, afterRound, done } — 사용자 리그 afterRound 라운드를 마친 뒤 열린다
//   대회: { id, name, shortName, teamIds, pots, fixtures: [경기], ties: [대진], stats, winnerId }
//   경기: { id, comp, stage, md?, leg?, tieId?, homeId, awayId, neutral?, result? }
//   대진: { id, comp, stage, seedId, otherId, fixtureIds, winnerId }  seedId = 리그 페이즈 순위가 높은 팀
import { t } from '../i18n.js';
import { addRatings } from '../state/form.js';
import { HOME_ADVANTAGE } from '../engine/config.js';
import { simulateMatch } from '../engine/match.js';
import { overall } from '../engine/ratings.js';
import { createRng } from '../engine/rng.js';
import { computeTable } from '../league/table.js';
import { bookLedger } from '../market/finance.js';
import { applyConsequences, recoverCondition, squadOf, teamInput, tickCupAbsences } from '../state/game.js';
import { CUP } from './config.js';
import { drawLeaguePhase } from './draw.js';

const round1 = (v) => Math.round(v * 10) / 10;
const TABLE_RULES = { points: { win: 3, draw: 1, loss: 0 }, tiebreakers: ['points', 'goalDifference', 'goalsFor'] };

export const countryOf = (dataset, teamId) => {
  const t = dataset.teamById.get(teamId);
  return t.guest ? t.country : dataset.leagueById.get(t.leagueId).country;
};

// 팀 전력: 스쿼드 OVR 상위 11명 평균 (포트 배정용)
function strengthOf(dataset, game, teamId) {
  const top = squadOf(dataset, game, teamId).map(overall).sort((a, b) => b - a).slice(0, 11);
  return top.reduce((s, v) => s + v, 0) / Math.max(1, top.length);
}

// 사용자 리그가 바뀌면(새 시즌에 다른 리그 구단 부임) 주중 일정을 그 리그 라운드 수에 맞춰 다시 짠다 (진행 전에만)
export function rebuildCupSchedule(game) {
  if (game.cups && !game.cups.schedule.some((e) => e.done)) game.cups.schedule = buildSchedule(game.totalRounds);
}

function buildSchedule(totalRounds) {
  let prev = 0;
  return CUP.calendar.map((e) => {
    let after = Math.min(totalRounds - 1, Math.max(1, Math.round(e.at * totalRounds)));
    // 한 주에 주중 경기는 하나. 라운드가 모자라는 짧은 리그면 같은 주에 이어서 치른다 (시즌 뒤로 밀리지 않게)
    if (after <= prev) after = Math.min(totalRounds - 1, prev + 1);
    prev = after;
    return { ...e, key: e.stage === 'league' ? `md${e.md}` : `${e.stage}${e.leg}`, afterRound: after, done: false };
  });
}

function payPrize(game, teamId, amount) {
  if (game.budgets?.[teamId] == null || !amount) return; // 게스트 팀은 재정이 없다
  game.budgets[teamId] = round1(game.budgets[teamId] + amount);
  bookLedger(game, teamId, 'prize', amount);
}

// 시즌 시작: 대회마다 리그 페이즈 추첨, 참가 상금
// competitions: [{ id, name, shortName, teamIds }] — 기본은 데이터의 1시즌 참가 팀, 2시즌부터는 지난 시즌 순위로 정한 팀
export function createCups(dataset, game, competitions = dataset.competitions) {
  if (!competitions?.length) {
    game.cups = null;
    return;
  }
  const rng = createRng(`${game.seed}:cups:${game.seasonIndex}`);
  const comps = {};
  for (const c of competitions) {
    const teams = c.teamIds.map((id) => ({ id, country: countryOf(dataset, id), strength: strengthOf(dataset, game, id) }));
    const draw = drawLeaguePhase(teams, rng);
    comps[c.id] = {
      id: c.id,
      name: c.name,
      shortName: c.shortName,
      teamIds: [...c.teamIds],
      pots: draw.pots,
      fixtures: draw.fixtures.map((f, i) => ({ id: `${c.id}:md${f.md}:${i}`, comp: c.id, stage: 'league', md: f.md, homeId: f.homeId, awayId: f.awayId })),
      ties: [],
      stats: {}, // { [선수 id]: { goals, assists, apps } }
      winnerId: null,
    };
    for (const id of c.teamIds) payPrize(game, id, CUP.prizes[c.id]?.participation);
  }
  game.cups = { season: game.seasonIndex, schedule: buildSchedule(game.totalRounds), comps };
}

// ── 조회 ──────────────────────────────────────────────

export const cupsOf = (game) => (game.cups?.season === game.seasonIndex ? game.cups : null);

// 지금 열려야 하는 주중 경기 (사용자 리그 라운드를 마친 뒤)
export function dueCupEvent(game) {
  const cups = cupsOf(game);
  return cups?.schedule.find((e) => !e.done && e.afterRound <= game.round - 1) ?? null;
}

const matchesEvent = (f, ev) => (ev.stage === 'league' ? f.stage === 'league' && f.md === ev.md : f.stage === ev.stage && f.leg === ev.leg);

export function eventFixtures(game, ev) {
  return Object.values(cupsOf(game)?.comps ?? {}).flatMap((c) => c.fixtures.filter((f) => matchesEvent(f, ev)));
}

// 사용자 팀의 이번 주중 경기 (없으면 null)
export function userCupFixture(game) {
  const ev = dueCupEvent(game);
  if (!ev) return null;
  return eventFixtures(game, ev).find((f) => !f.result && (f.homeId === game.teamId || f.awayId === game.teamId)) ?? null;
}

export const compOf = (game, fixture) => cupsOf(game).comps[fixture.comp];
// 대회 이름: 세이브에는 만들 때 언어의 이름이 저장된다 → id로 지금 언어 이름을 찾는다
export function compName(comp) {
  const key = `state.comp.${comp?.id}`;
  const v = t(key);
  return v === key ? comp?.name ?? '' : v;
}
export const tieOf = (game, fixture) => (fixture.tieId ? compOf(game, fixture).ties.find((t) => t.id === fixture.tieId) : null);
export const stageName = (stage) => CUP.stageNames[stage];

// 같은 대진의 1차전 (2차전에서 합계 계산용)
export function firstLegOf(game, fixture) {
  const tie = tieOf(game, fixture);
  if (!tie || fixture.leg !== 2) return null;
  return compOf(game, fixture).fixtures.find((f) => f.id === tie.fixtureIds[0]) ?? null;
}

// 경기 입력. 2차전은 1차전 골을 합계로 넘기고, 결승은 중립 경기장 단판
export function cupMatchInput(dataset, game, fixture) {
  const input = {
    home: teamInput(dataset, game, fixture.homeId, 'cup'),
    away: teamInput(dataset, game, fixture.awayId, 'cup'),
    seed: `${game.seed}:cup:${game.seasonIndex}:${fixture.id}`,
  };
  if (fixture.stage === 'final') {
    input.knockout = { prior: { home: 0, away: 0 } };
    input.homeAdvantage = 0;
  } else if (fixture.leg === 2) {
    const first = firstLegOf(game, fixture);
    // 1차전 홈팀 = 이번 원정팀
    input.knockout = { prior: { home: first.result.score.away, away: first.result.score.home } };
  }
  input.homeAdvantage ??= HOME_ADVANTAGE;
  return input;
}

// 리그 페이즈 순위표 (computeTable 형식 + position)
export function leaguePhaseTable(comp) {
  return computeTable(
    comp.teamIds,
    comp.fixtures.filter((f) => f.stage === 'league').map((f) => ({ ...f, round: f.md })),
    TABLE_RULES,
  );
}

// ── 진행 ──────────────────────────────────────────────

function recordCupResult(comp, fixture, r) {
  fixture.result = {
    score: { ...r.score },
    goals: r.goals.map(({ minute, team, scorerId, scorerName, assistId }) => ({ minute, team, scorerId, scorerName, assistId })),
    cards: r.cards.map(({ minute, team, playerId, type }) => ({ minute, team, playerId, type })),
    stats: r.stats,
    extraTime: r.extraTime,
    penalties: r.penalties ? { home: r.penalties.home, away: r.penalties.away } : null,
    winner: r.winner,
  };
  const stat = (id) => (comp.stats[id] ??= { goals: 0, assists: 0, apps: 0 });
  for (const [id, minutes] of Object.entries(r.playerMinutes)) if (minutes > 0) stat(id).apps++;
  for (const g of r.goals) {
    stat(g.scorerId).goals++;
    if (g.assistId) stat(g.assistId).assists++;
  }
}

// 이번 주중 경기 전부 진행. userResult: 사용자 경기 결과 (없으면 사용자 경기도 시뮬레이션)
// → { event, fixtureIds, newStage } 또는 null
export function playCupEvent(dataset, game, userResult = null) {
  const ev = dueCupEvent(game);
  if (!ev) return null;
  const fixtures = eventFixtures(game, ev).filter((f) => !f.result);
  const teams = new Set(fixtures.flatMap((f) => [f.homeId, f.awayId]));
  const playerIds = [...teams].flatMap((id) => squadOf(dataset, game, id).map((p) => p.id));
  // 리그와 같은 순서: 지금 상태(징계·부상 반영)로 모든 경기를 치른 뒤 → 기존 부상·징계 1경기 차감 → 새 징계 반영
  const results = fixtures.map((f) => {
    const mine = f.homeId === game.teamId || f.awayId === game.teamId;
    return mine && userResult ? userResult : simulateMatch(cupMatchInput(dataset, game, f));
  });
  tickCupAbsences(game, playerIds);
  fixtures.forEach((f, i) => {
    const r = results[i];
    const comp = cupsOf(game).comps[f.comp];
    recordCupResult(comp, f, r);
    addRatings(game, r, { keepForm: f.homeId === game.teamId || f.awayId === game.teamId });
    applyConsequences(game, r, 'cup');
    if (f.stage === 'league') {
      const prizes = CUP.prizes[comp.id] ?? {};
      const { home, away } = r.score;
      if (home === away) {
        payPrize(game, f.homeId, prizes.draw);
        payPrize(game, f.awayId, prizes.draw);
      } else {
        payPrize(game, home > away ? f.homeId : f.awayId, prizes.win);
      }
    }
  });
  // 주중 경기라 다음 주말까지 덜 회복한다
  recoverCondition(dataset, game, playerIds.filter((id) => game.players[id]), CUP.midweekRecovery);
  ev.done = true;
  const newStage = advanceStages(game, ev);
  return { event: ev, fixtureIds: fixtures.map((f) => f.id), newStage };
}

// 단계가 끝났으면 다음 단계 대진을 만든다. → 새로 시작된 단계 이름 또는 null
function advanceStages(game, ev) {
  const cups = cupsOf(game);
  let started = null;
  for (const comp of Object.values(cups.comps)) {
    if (ev.stage === 'league' && ev.md === CUP.leaguePhase.matches) {
      const table = leaguePhaseTable(comp);
      comp.finalTable = table.map((r) => r.teamId);
      const pos = (i) => table[i].teamId;
      // 플레이오프: 9위 vs 24위, 10위 vs 23위 … (2차전은 상위 팀 홈)
      for (let i = 0; i < 8; i++) addTie(game, comp, 'playoff', pos(CUP.leaguePhase.direct + i), pos(CUP.leaguePhase.playoff - 1 - i));
      started = 'playoff';
    } else if (ev.leg === 2 || ev.stage === 'final') {
      const ties = comp.ties.filter((t) => t.stage === ev.stage);
      for (const t of ties) t.winnerId = tieWinner(comp, t);
      const winners = ties.map((t) => t.winnerId);
      const seedPos = (id) => comp.finalTable.indexOf(id);
      const byRank = (a, b) => (seedPos(a) <= seedPos(b) ? [a, b] : [b, a]);
      if (ev.stage === 'playoff') {
        // 16강: 1위 vs (16·17위 대진 승자), 2위 vs (15·18위 승자) … 8위 vs (9·24위 승자)
        for (let i = 0; i < 8; i++) addTie(game, comp, 'r16', comp.finalTable[i], winners[7 - i]);
        started = 'r16';
      } else if (ev.stage === 'r16') {
        for (const [a, b] of [[0, 7], [1, 6], [2, 5], [3, 4]]) addTie(game, comp, 'qf', ...byRank(winners[a], winners[b]));
        started = 'qf';
      } else if (ev.stage === 'qf') {
        for (const [a, b] of [[0, 3], [1, 2]]) addTie(game, comp, 'sf', ...byRank(winners[a], winners[b]));
        started = 'sf';
      } else if (ev.stage === 'sf') {
        addTie(game, comp, 'final', ...byRank(winners[0], winners[1]));
        started = 'final';
      } else if (ev.stage === 'final') {
        comp.winnerId = winners[0];
        payPrize(game, comp.winnerId, CUP.prizes[comp.id]?.winner);
      }
    }
  }
  return started;
}

// 대진 추가: 1차전은 순위가 낮은 팀 홈, 2차전은 높은 팀 홈. 결승은 단판 (중립)
function addTie(game, comp, stage, seedId, otherId) {
  const id = `${comp.id}:${stage}:${comp.ties.filter((t) => t.stage === stage).length}`;
  const legs =
    stage === 'final'
      ? [{ id: `${id}:1`, comp: comp.id, stage, leg: 1, tieId: id, homeId: seedId, awayId: otherId, neutral: true }]
      : [
          { id: `${id}:1`, comp: comp.id, stage, leg: 1, tieId: id, homeId: otherId, awayId: seedId },
          { id: `${id}:2`, comp: comp.id, stage, leg: 2, tieId: id, homeId: seedId, awayId: otherId },
        ];
  comp.fixtures.push(...legs);
  comp.ties.push({ id, comp: comp.id, stage, seedId, otherId, fixtureIds: legs.map((f) => f.id), winnerId: null });
  const prize = CUP.prizes[comp.id]?.[stage];
  payPrize(game, seedId, prize);
  payPrize(game, otherId, prize);
}

function tieWinner(comp, tie) {
  const last = comp.fixtures.find((f) => f.id === tie.fixtureIds.at(-1));
  return last.result.winner === 'home' ? last.homeId : last.awayId;
}

// 팀이 이 대회에서 어디까지 갔는지: { comp, status: 'alive' | 'out' | 'winner', stage }
export function teamCupStatus(game, teamId) {
  for (const comp of Object.values(cupsOf(game)?.comps ?? {})) {
    if (!comp.teamIds.includes(teamId)) continue;
    if (comp.winnerId === teamId) return { comp, status: 'winner', stage: 'final' };
    const ties = comp.ties.filter((t) => t.seedId === teamId || t.otherId === teamId);
    const last = ties.at(-1);
    if (last) return { comp, status: last.winnerId && last.winnerId !== teamId ? 'out' : 'alive', stage: last.stage };
    // 리그 페이즈가 끝났고 대진이 없으면: 1~8위는 16강 직행(대기), 그 아래는 탈락
    if (comp.finalTable) {
      const direct = comp.finalTable.indexOf(teamId) < CUP.leaguePhase.direct;
      return { comp, status: direct ? 'alive' : 'out', stage: direct ? 'r16' : 'league' };
    }
    return { comp, status: 'alive', stage: 'league' };
  }
  return null;
}
