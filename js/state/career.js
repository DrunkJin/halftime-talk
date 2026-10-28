// 감독 커리어 기록·평가: 사용자 팀 경기마다 선수 통산·상대 전적·최대 승리·연승을 쌓고 (game.career),
// 시즌 전 예상 순위(game.seasonExpect)와 시즌 결산(game.history)을 모아 엔딩 화면용 평가를 만든다.
import { topElevenOvr } from '../market/value.js';
import { CAREER } from './careerConfig.js';
import { squadOf } from './game.js';
import { careerTotals } from './history.js';

const blank = () => ({ players: {}, opponents: {}, bestWin: null, worstLoss: null, streak: 0, bestStreak: null, matches: 0 });

// ── 시즌 전 예상 ──────────────────────────────────────

// 리그 안 전력 순위 (주전 11명 평균 OVR)
export function expectedRank(dataset, game) {
  const league = dataset.leagueById.get(game.leagueId);
  const ranked = league.teamIds.map((id) => [id, topElevenOvr(squadOf(dataset, game, id))]).sort((a, b) => b[1] - a[1]);
  return { seasonIndex: game.seasonIndex, rank: ranked.findIndex(([id]) => id === game.teamId) + 1, size: ranked.length };
}

export function noteSeasonExpectation(dataset, game) {
  game.seasonExpect = expectedRank(dataset, game);
}

// ── 경기 기록 ─────────────────────────────────────────

// 사용자 팀 경기 하나를 커리어 기록에 더한다. compName: 리그·대회 이름
export function trackUserMatch(dataset, game, fixture, result, compName) {
  if (!fixture || !result) return;
  const c = (game.career ??= blank());
  const side = fixture.homeId === game.teamId ? 'home' : 'away';
  const oppSide = side === 'home' ? 'away' : 'home';
  const oppId = fixture[`${oppSide}Id`];
  const gf = result.score[side];
  const ga = result.score[oppSide];
  const outcome = gf > ga ? 'w' : gf < ga ? 'l' : 'd';
  c.matches++;

  const mine = new Set(squadOf(dataset, game, game.teamId).map((p) => p.id));
  const entry = (id) => {
    const e = (c.players[id] ??= { name: dataset.playerById.get(id)?.name ?? id, apps: 0, goals: 0, assists: 0, from: game.seasonIndex, to: game.seasonIndex });
    e.to = game.seasonIndex;
    return e;
  };
  for (const [id, minutes] of Object.entries(result.playerMinutes ?? {})) if (minutes > 0 && mine.has(id)) entry(id).apps++;
  for (const g of result.goals) {
    if (g.team !== side) continue;
    entry(g.scorerId).goals++;
    if (g.assistId) entry(g.assistId).assists++;
  }

  const opp = (c.opponents[oppId] ??= { name: dataset.teamById.get(oppId)?.shortName ?? oppId, w: 0, d: 0, l: 0, gf: 0, ga: 0 });
  opp[outcome]++;
  opp.gf += gf;
  opp.ga += ga;

  const match = { season: game.season, seasonIndex: game.seasonIndex, opponent: opp.name, gf, ga, comp: compName, home: side === 'home' };
  const margin = gf - ga;
  if (margin > 0 && (!c.bestWin || margin > c.bestWin.gf - c.bestWin.ga || (margin === c.bestWin.gf - c.bestWin.ga && gf > c.bestWin.gf))) c.bestWin = match;
  if (margin < 0 && (!c.worstLoss || margin < c.worstLoss.gf - c.worstLoss.ga)) c.worstLoss = match;

  c.streak = outcome === 'w' ? c.streak + 1 : 0;
  if (c.streak >= 2 && (!c.bestStreak || c.streak > c.bestStreak.count)) c.bestStreak = { count: c.streak, season: game.season };
}

// ── 평가 ──────────────────────────────────────────────

const gradeOf = (score) => CAREER.grades.find(([min]) => score >= min)[1];
const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);

// 시즌 한 줄: 기대 대비 순위(+면 기대 이상)
function seasonLine(h) {
  const expected = h.mine.expected ?? null;
  return {
    seasonIndex: h.seasonIndex,
    season: h.season,
    teamName: h.teamName,
    leagueId: h.leagueId,
    leagueName: h.leagueName,
    position: h.mine.position,
    size: h.mine.leagueSize,
    points: h.mine.points,
    expected,
    over: expected ? expected - h.mine.position : 0,
    trophies: h.trophies,
    promoted: h.mine.promoted,
    relegated: h.mine.relegated,
    cup: h.mine.cup,
  };
}

// 칭호: 위에서부터 처음 맞는 것
function pickTitle(seasons, t) {
  const T = CAREER.title;
  const avgOver = seasons.length ? sum(seasons, (s) => s.over) / seasons.length : 0;
  const leagueTitles = t.trophies.filter((x) => x.kind === 'league').length;
  const ucl = t.trophies.filter((x) => x.id === 'ucl').length;
  const doubles = seasons.filter((s) => s.trophies.some((x) => x.kind === 'league') && s.trophies.some((x) => x.kind === 'cup')).length;
  const miracle = seasons.some((s) => s.trophies.length && s.expected && s.expected >= T.miracleExpectedRank);
  const promotions = seasons.filter((s) => s.promoted).length;
  const relegations = seasons.filter((s) => s.relegated).length;
  const first = seasons[0];
  const last = seasons.at(-1);
  // 재건: 같은 리그에서 순위를 크게 끌어올렸고, 마지막 시즌은 기대 이상
  const rebuilt = first && last && first.leagueId === last.leagueId && first.position - last.position >= T.rebuild && last.over >= 0;
  const startedLow = first?.expected && first.expected >= first.size * T.firefighterQuarter;
  const rules = [
    ['double', doubles > 0],
    ['europe', ucl > 0],
    ['dynasty', leagueTitles >= 2],
    ['miracle', miracle],
    ['champion', leagueTitles > 0 || t.trophies.length > 0],
    ['climber', promotions > 0 && relegations === 0],
    ['underachiever', avgOver <= T.underachieve && relegations === 0],
    ['rebuilder', rebuilt],
    ['overachiever', avgOver >= T.overachieve],
    ['firefighter', startedLow && relegations === 0],
    ['fallen', relegations > 0],
    ['steady', Math.abs(avgOver) < T.steady],
  ];
  return rules.find(([, ok]) => ok)?.[0] ?? 'journeyman';
}

// 엔딩 화면용 평가. rivalryOf(a, b) → { name } | null (선택)
export function careerReview(game, { rivalryOf = () => null } = {}) {
  const history = game.history ?? [];
  const career = game.career ?? blank();
  const seasons = history.map(seasonLine);
  const totals = careerTotals(history);
  const S = CAREER.score;
  const played = totals.won + totals.drawn + totals.lost;
  const winRate = played ? totals.won / played : 0;
  const perf = seasons.length ? sum(seasons, (s) => (s.over / s.size) * 100) / seasons.length : 0;
  const count = (f) => totals.trophies.filter(f).length;
  const leagueTitles = count((x) => x.kind === 'league');
  const ucl = count((x) => x.id === 'ucl');
  const uel = count((x) => x.id === 'uel');
  const promotions = seasons.filter((s) => s.promoted).length;
  const relegations = seasons.filter((s) => s.relegated).length;
  const raw =
    S.base + perf * S.perfWeight + leagueTitles * S.leagueTitle + ucl * S.ucl + uel * S.uel + promotions * S.promotion + relegations * S.relegation + (winRate - S.winRateRef) * S.winRateWeight;
  const score = Math.round(Math.max(0, Math.min(100, raw)));

  // 최고의 시즌: 기대 대비 + 트로피 + 승격
  const seasonScore = (s) => (s.over / s.size) * 100 + s.trophies.length * 30 + (s.promoted ? 15 : 0) - (s.relegated ? 20 : 0);
  const bestSeason = seasons.length ? seasons.reduce((a, b) => (seasonScore(b) > seasonScore(a) ? b : a)) : null;

  const players = Object.entries(career.players).map(([id, p]) => ({ id, ...p }));
  const by = (key) => players.filter((p) => p[key] > 0).sort((a, b) => b[key] - a[key] || b.apps - a.apps)[0] ?? null;
  // 기록이 없는 예전 세이브: 시즌별 팀 득점왕 합으로
  let topScorer = by('goals');
  if (!topScorer) {
    const agg = {};
    for (const h of history) {
      const s = h.mine.topScorer;
      if (s) (agg[s.name] ??= { name: s.name, goals: 0, assists: 0, apps: null }).goals += s.goals;
    }
    topScorer = Object.values(agg).sort((a, b) => b.goals - a.goals)[0] ?? null;
  }
  const mostApps = by('apps');
  const assistKing = by('assists');

  // 최고의 영입: 사용자가 데려온 선수 중 기여(출전 + 골×3 + 도움×2)가 가장 큰
  const signed = (game.transfers ?? []).filter((t) => t.by === 'user' && t.to === game.teamId);
  const bestSigning =
    signed
      .map((t) => ({ ...t, p: career.players[t.playerId] }))
      .filter((x) => x.p && x.p.apps >= 5)
      .map((x) => ({ name: x.p.name, fee: x.fee, apps: x.p.apps, goals: x.p.goals, assists: x.p.assists, value: x.p.apps + x.p.goals * 3 + x.p.assists * 2 }))
      .sort((a, b) => b.value - a.value)[0] ?? null;

  const rivals = Object.entries(career.opponents)
    .map(([id, o]) => ({ ...o, rivalry: rivalryOf(game.teamId, id) }))
    .filter((o) => o.rivalry)
    .sort((a, b) => b.w + b.d + b.l - (a.w + a.d + a.l));

  const titleId = pickTitle(seasons, totals);
  return {
    teamName: history.at(-1)?.teamName ?? '',
    seasons,
    totals: { ...totals, played, winRate, goalsFor: sum(history, (h) => h.mine.goalsFor), goalsAgainst: sum(history, (h) => h.mine.goalsAgainst) },
    perf,
    avgOver: seasons.length ? sum(seasons, (s) => s.over) / seasons.length : 0,
    score,
    grade: gradeOf(score),
    titleId,
    counts: { leagueTitles, ucl, uel, promotions, relegations },
    bestSeason,
    topScorer,
    mostApps,
    assistKing,
    bestSigning,
    bestWin: career.bestWin,
    worstLoss: career.worstLoss,
    bestStreak: career.bestStreak,
    rivals,
  };
}
