// 시즌 결산 기록: 시즌이 끝날 때 game.history에 한 시즌씩 쌓는다 (결산 화면·커리어 종합표용).
// 선수·팀 이름도 함께 저장해 두어, 은퇴·데이터 변경 뒤에도 기록을 그대로 읽을 수 있게 한다.
import { cupsOf, teamCupStatus } from '../competitions/cups.js';
import { computeTable } from '../league/table.js';
import { expectedRank } from './career.js';
import { currentTeamId, fixturesOf } from './game.js';

const teamName = (dataset, id) => dataset.teamById.get(id)?.shortName ?? id;

// 득점 1위 (동률이면 도움 많은 선수). inTeams: 이 팀들 소속만
function topScorer(dataset, game, stats, inTeams) {
  let best = null;
  for (const [id, s] of Object.entries(stats)) {
    if (!s.goals) continue;
    const teamId = currentTeamId(dataset, game, id);
    if (inTeams && !inTeams.has(teamId)) continue;
    if (!best || s.goals > best.goals || (s.goals === best.goals && s.assists > best.assists)) {
      best = { playerId: id, name: dataset.playerById.get(id)?.name ?? id, teamId, teamName: teamName(dataset, teamId), goals: s.goals, assists: s.assists };
    }
  }
  return best;
}

// 대륙 대회에서 우리 팀 승·무·패
function cupRecord(game) {
  const r = { won: 0, drawn: 0, lost: 0 };
  for (const comp of Object.values(cupsOf(game)?.comps ?? {})) {
    for (const f of comp.fixtures) {
      if (!f.result || (f.homeId !== game.teamId && f.awayId !== game.teamId)) continue;
      const mine = f.homeId === game.teamId ? f.result.score.home : f.result.score.away;
      const theirs = f.homeId === game.teamId ? f.result.score.away : f.result.score.home;
      r[mine > theirs ? 'won' : mine < theirs ? 'lost' : 'drawn']++;
    }
  }
  return r;
}

export function recordSeason(dataset, game) {
  game.history ??= [];
  if (game.history.some((h) => h.seasonIndex === game.seasonIndex)) return;

  const leagues = dataset.leagues.map((league) => {
    const table = computeTable(league.teamIds, fixturesOf(game, league.id), league.rules);
    const ids = table.map((r) => r.teamId);
    return {
      id: league.id,
      name: league.name,
      championId: ids[0],
      championName: teamName(dataset, ids[0]),
      runnerUpId: ids[1],
      runnerUpName: teamName(dataset, ids[1]),
      topScorer: topScorer(dataset, game, game.playerStats, new Set(league.teamIds)),
      promoted: league.promotion ? ids.slice(0, league.promotion.spots) : [],
      relegated: league.relegation ? ids.slice(-league.relegation.spots) : [],
      table: table.map((r) => ({ teamId: r.teamId, points: r.points })),
    };
  });

  const cups = Object.values(cupsOf(game)?.comps ?? {}).map((comp) => {
    const final = comp.ties.find((t) => t.stage === 'final');
    const semis = comp.ties.filter((t) => t.stage === 'sf').flatMap((t) => [t.seedId, t.otherId]);
    const runnerUp = final ? (final.winnerId === final.seedId ? final.otherId : final.seedId) : null;
    return {
      id: comp.id,
      name: comp.name,
      winnerId: comp.winnerId,
      winnerName: comp.winnerId ? teamName(dataset, comp.winnerId) : null,
      runnerUpId: runnerUp,
      runnerUpName: runnerUp ? teamName(dataset, runnerUp) : null,
      semifinalists: semis.map((id) => ({ id, name: teamName(dataset, id) })),
      topScorer: topScorer(dataset, game, comp.stats, null),
    };
  });

  const myLeague = leagues.find((l) => l.id === game.leagueId);
  const league = dataset.leagueById.get(game.leagueId);
  const myRow = computeTable(league.teamIds, fixturesOf(game), league.rules).find((r) => r.teamId === game.teamId);
  const squadIds = new Set([game.teamId]);
  const status = teamCupStatus(game, game.teamId);
  const trophies = [];
  if (myLeague.championId === game.teamId) trophies.push({ kind: 'league', id: league.id, name: league.name });
  for (const c of cups) if (c.winnerId === game.teamId) trophies.push({ kind: 'cup', id: c.id, name: c.name });
  const ledger = game.ledger ?? {};
  const income = ['tv', 'gate', 'commercial', 'prize', 'transfersOut'].reduce((s, k) => s + (ledger[k] ?? 0), 0);
  const expense = ['wages', 'transfersIn', 'compensation'].reduce((s, k) => s + (ledger[k] ?? 0), 0);

  game.history.push({
    seasonIndex: game.seasonIndex,
    season: league.season,
    teamId: game.teamId,
    teamName: teamName(dataset, game.teamId),
    leagueId: game.leagueId,
    leagueName: league.name,
    mine: {
      position: myRow.position,
      leagueSize: league.teamIds.length,
      played: myRow.played,
      won: myRow.won,
      drawn: myRow.drawn,
      lost: myRow.lost,
      goalsFor: myRow.goalsFor,
      goalsAgainst: myRow.goalsAgainst,
      points: myRow.points,
      cup: status ? { id: status.comp.id, name: status.comp.name, status: status.status, stage: status.stage } : null,
      cupRecord: cupRecord(game),
      topScorer: topScorer(dataset, game, game.playerStats, squadIds),
      // 시즌 전 예상 순위 (예전 세이브는 시즌 끝 전력으로 대신)
      expected: game.seasonExpect?.seasonIndex === game.seasonIndex ? game.seasonExpect.rank : expectedRank(dataset, game).rank,
      promoted: myLeague.promoted.includes(game.teamId),
      relegated: myLeague.relegated.includes(game.teamId),
      finance: { income: Math.round(income * 10) / 10, expense: Math.round(expense * 10) / 10, balance: game.budgets?.[game.teamId] ?? null },
    },
    trophies,
    leagues,
    cups,
  });
}

// 커리어 합계: 시즌 기록을 모두 더한다
export function careerTotals(history) {
  const t = { seasons: history.length, won: 0, drawn: 0, lost: 0, trophies: [], bestFinish: null };
  for (const h of history) {
    t.won += h.mine.won + h.mine.cupRecord.won;
    t.drawn += h.mine.drawn + h.mine.cupRecord.drawn;
    t.lost += h.mine.lost + h.mine.cupRecord.lost;
    t.trophies.push(...h.trophies.map((x) => ({ ...x, season: h.season })));
    if (!t.bestFinish || h.mine.position < t.bestFinish.position) t.bestFinish = { position: h.mine.position, season: h.season, leagueName: h.leagueName };
  }
  return t;
}
