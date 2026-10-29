// 감독 인터뷰·팀 토크: 경기 상황을 판정해 질문과 답변 선택지를 만들고, 고른 답의 효과를 반영한다.
// 문구는 data/interviews/*.json, 라이벌은 data/rivalries.json, 효과 수치는 engine/config.js(MORALE)
import { MORALE } from '../engine/config.js';
import { createRng } from '../engine/rng.js';
import { adjustBoost } from '../engine/match.js';
import { computeTeamRatings, conditionFactor, overall } from '../engine/ratings.js';
import { computeTable } from '../league/table.js';
import { availabilityOf, fixturesOf, isSeasonOver, leagueOf, squadOf } from '../state/game.js';
import { addMorale, recentResults } from '../state/morale.js';
import { compOf, firstLegOf, leaguePhaseTable, stageName } from '../competitions/cups.js';
import { SITUATIONS, STANCES } from './situations.js';

const C = MORALE.context;

// ── 데이터 로딩 ───────────────────────────────────────

let mediaPromise = null;

// { pre, post, talk, rivalries: Map('a|b' → rivalry) }. 실패하면 null (인터뷰 없이 진행)
export function loadMedia(baseUrl = 'data/') {
  mediaPromise ??= (async () => {
    const get = async (path) => {
      const res = await fetch(`${baseUrl}${path}`);
      if (!res.ok) throw new Error(`${path}: ${res.status}`);
      return res.json();
    };
    const [pre, post, talk, rivalries] = await Promise.all([get('interviews/pre.json'), get('interviews/post.json'), get('interviews/talk.json'), get('rivalries.json')]);
    const map = new Map();
    for (const r of rivalries.rivalries) map.set(pairKey(...r.teams), r);
    return { pre, post, talk, rivalries: map };
  })().catch((e) => {
    console.warn('인터뷰 데이터를 불러오지 못했습니다', e);
    mediaPromise = null;
    return null;
  });
  return mediaPromise;
}

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
export const rivalryBetween = (media, a, b) => media?.rivalries.get(pairKey(a, b)) ?? null;
const derbyMult = (rivalry) => MORALE.derbyMultiplier[rivalry?.intensity ?? 0];

// ── 공통 ──────────────────────────────────────────────

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
const fieldAverage = (r) => (r.attack + r.midfield + r.defense) / 3;
const inputStrength = (input) => fieldAverage(computeTeamRatings(input.slots, input.lineup, (p) => conditionFactor(input.condition[p.id])));
const bestPlayer = (players) => players.filter(Boolean).reduce((a, b) => (overall(b) > overall(a) ? b : a), players.find(Boolean));

// 해당하는 상황 중 우선순위가 가장 높은 것. 가끔(30%) 다른 해당 상황을 골라 질문이 단조롭지 않게
function chooseSituation(kind, matched) {
  const ordered = Object.keys(SITUATIONS[kind]).filter((id) => matched.has(id));
  // 대륙 대회 상황이 있으면 그것을 우선한다 (리그 상황과 섞이지 않게)
  const cupFirst = ordered.find((id) => SITUATIONS[kind][id].cup);
  if (cupFirst) return cupFirst;
  if (ordered.length === 0) return 'generic';
  const others = ordered.slice(1).filter((id) => id !== 'generic');
  return others.length && Math.random() < 0.3 ? pick(others) : ordered[0];
}

// 상황 → { situation, question, answers: [{ stance, label, text }] }
function build(media, kind, situation, vars) {
  const s = media[kind].situations[situation];
  // 전용 답이 있는 질문은 그 답에서만 (질문과 답이 어긋나지 않게)
  const q = pick(s.questions);
  const pool = typeof q === 'string' ? s.answers : q.answers;
  const answers = Object.entries(STANCES[kind]).map(([stance, label]) => {
    const options = pool.filter((a) => a.stance === stance);
    return { stance, label, text: fill(pick(options).text, vars) };
  });
  return { kind, situation, question: fill(typeof q === 'string' ? q : q.text, vars), answers };
}

function tableOf(dataset, game) {
  const league = leagueOf(dataset, game);
  const rows = computeTable(league.teamIds, fixturesOf(game), league.rules);
  return { rows, size: rows.length, rankOf: (id) => rows.find((r) => r.teamId === id).position };
}

// 최신 경기부터 같은 결과가 이어진 수 (pred: 결과 → 계속 셀지)
const runLength = (recent, pred) => {
  let n = 0;
  while (n < recent.length && pred(recent[n].outcome)) n++;
  return n;
};
const scoreText = (mine, theirs) => `${mine}-${theirs}`;

// ── 경기 전 기자회견 ──────────────────────────────────

// input: matchInput(dataset, game, fixture)
export function preInterview(media, dataset, game, fixture, input) {
  const mySide = fixture.homeId === game.teamId ? 'home' : 'away';
  const oppSide = mySide === 'home' ? 'away' : 'home';
  const oppId = fixture[`${oppSide}Id`];
  const team = dataset.teamById.get(game.teamId);
  const opp = dataset.teamById.get(oppId);
  const { size, rankOf } = tableOf(dataset, game);
  const rank = rankOf(game.teamId);
  const oppRank = rankOf(oppId);
  const progress = (game.round - 1) / game.totalRounds;
  const gap = inputStrength(input[mySide]) - inputStrength(input[oppSide]);
  const recent = recentResults(dataset, game, game.teamId);
  const rivalry = rivalryBetween(media, game.teamId, oppId);

  const vars = {
    team: team.shortName,
    opponent: opp.shortName,
    venue: mySide === 'home' ? '홈' : '원정',
    player: bestPlayer(input[mySide].lineup)?.name,
    oppPlayer: bestPlayer(input[oppSide].lineup)?.name,
    rank,
    oppRank,
    derby: rivalry?.name,
  };
  const matched = new Set(['generic']);
  if (game.round === game.totalRounds) matched.add('finalRound');
  if (game.round === 1) matched.add('seasonOpener');
  if (rivalry) matched.add('derby');
  if (progress >= C.lateSeason && rank <= C.titleRank) matched.add('titleRace');
  if (progress >= C.lateSeason && rank > size - C.relegationZone) matched.add('relegationBattle');
  if (game.round > 5 && rank <= C.topRank && oppRank <= C.topRank) matched.add('topClash');

  // 결장: 우리 스쿼드 OVR 상위 11명 중 출전 불가
  const top11 = squadOf(dataset, game, game.teamId).sort((a, b) => overall(b) - overall(a)).slice(0, 11);
  const out = top11.filter((p) => !availabilityOf(game, p.id).available);
  if (out.length >= C.injuryCrisis) {
    matched.add('injuryCrisis');
    vars.absentCount = out.length;
  }
  if (out.includes(top11[0])) {
    matched.add('keyPlayerOut');
    vars.absent = top11[0].name;
  }

  // 이번 시즌 앞선 맞대결에서 졌다면 설욕전
  const earlier = recent.find((r) => r.fixture.homeId === oppId || r.fixture.awayId === oppId);
  if (earlier?.outcome === 'L') matched.add('revenge');

  const wins = runLength(recent, (o) => o === 'W');
  const losses = runLength(recent, (o) => o === 'L');
  const noWin = runLength(recent, (o) => o !== 'W');
  const noLoss = runLength(recent, (o) => o !== 'L');
  if (losses >= C.streak) matched.add('loseStreak');
  else if (noWin >= C.longRun) matched.add('winless');
  if (wins >= C.streak) matched.add('winStreak');
  else if (noLoss >= C.longRun) matched.add('unbeaten');

  const last = recent[0];
  if (last && Math.abs(last.gf - last.ga) >= C.bigMargin) {
    matched.add(last.gf > last.ga ? 'afterBigWin' : 'afterBigLoss');
    const lastOppId = last.fixture.homeId === game.teamId ? last.fixture.awayId : last.fixture.homeId;
    vars.lastOpponent = dataset.teamById.get(lastOppId).shortName;
  }

  // 최근 영입한 선수가 선발
  const signing = (game.transfers ?? []).find(
    (t) => t.to === game.teamId && t.by === 'user' && t.season === game.seasonIndex && game.round - t.round <= C.newSigningRounds && game.lineup.includes(t.playerId),
  );
  if (signing) {
    matched.add('newSigning');
    vars.signing = dataset.playerById.get(signing.playerId).name;
  }

  if (gap <= -C.strengthGap) matched.add('underdog');
  else if (gap >= C.strengthGap) matched.add('heavyFavorite');
  else matched.add('evenMatch');

  // 상황마다 뜻이 다른 자리: 고른 상황에 맞춰 채운다
  const situation = chooseSituation('pre', matched);
  vars.lastScore = situation === 'revenge' ? scoreText(earlier.gf, earlier.ga) : last ? scoreText(last.gf, last.ga) : '';
  vars.streak = { winStreak: wins, loseStreak: losses, winless: noWin, unbeaten: noLoss }[situation] ?? Math.max(wins, losses, noWin, noLoss);
  return { ...build(media, 'pre', situation, vars), mult: derbyMult(rivalry), fixtureId: fixture.id };
}

// 답을 고르면: 즉시 사기 보정 + 결과에 따른 효과는 라운드가 끝날 때 (state/morale.js)
export function answerPre(game, interview, stance) {
  const delta = MORALE.pre[stance].now * interview.mult;
  addMorale(game, delta);
  const answer = interview.answers.find((a) => a.stance === stance);
  game.press = { round: game.round, fixtureId: interview.fixtureId, stance, mult: interview.mult, situation: interview.situation, question: interview.question, text: answer.text };
  return { delta };
}

// ── 경기 후 인터뷰 ────────────────────────────────────

// result: getMatchResult (경기 직후). gap: 경기 전 전력 차 (우리 - 상대). game은 라운드 진행 후 상태
export function postInterview(media, dataset, game, fixture, result, gap) {
  const mySide = fixture.homeId === game.teamId ? 'home' : 'away';
  const oppSide = mySide === 'home' ? 'away' : 'home';
  const oppId = fixture[`${oppSide}Id`];
  const mine = result.score[mySide];
  const theirs = result.score[oppSide];
  const outcome = mine > theirs ? 'win' : mine < theirs ? 'loss' : 'draw';
  const rivalry = rivalryBetween(media, game.teamId, oppId);
  const { size, rankOf } = tableOf(dataset, game);
  const rank = rankOf(game.teamId);

  // 골 순서대로 스코어 흐름: 앞선 적·뒤진 적이 있는지, 마지막 골
  let m = 0;
  let t = 0;
  let led = false;
  let trailed = false;
  let decisive = null; // 마지막으로 스코어 관계(앞섬/동점/뒤짐)를 바꾼 골
  for (const g of [...result.goals].sort((a, b) => a.minute - b.minute)) {
    if (g.team === mySide) m++;
    else t++;
    if (m > t) led = true;
    if (m < t) trailed = true;
    decisive = g;
  }
  const scorers = new Map();
  for (const g of result.goals.filter((x) => x.team === mySide)) scorers.set(g.scorerName, (scorers.get(g.scorerName) ?? 0) + 1);
  const [topScorer, topGoals] = [...scorers].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  const late = decisive && decisive.minute >= C.lateGoalMinute;
  const xgDiff = result.stats[mySide].xg - result.stats[oppSide].xg;
  const recent = recentResults(dataset, game, game.teamId);

  const vars = {
    team: dataset.teamById.get(game.teamId).shortName,
    opponent: dataset.teamById.get(oppId).shortName,
    venue: mySide === 'home' ? '홈' : '원정',
    score: scoreText(mine, theirs),
    scorer: topScorer,
    minute: decisive?.minute,
    derby: rivalry?.name,
    rank,
    streak: runLength(recent, (o) => o === (outcome === 'win' ? 'W' : 'L')),
  };
  const matched = new Set();
  if (isSeasonOver(game)) {
    if (rank <= C.topRank) matched.add('seasonEndHigh');
    else if (rank > size - C.relegationZone) matched.add('seasonEndLow');
  }
  if (topGoals >= 3) matched.add('hatTrick');
  if (outcome === 'win' && trailed) matched.add('comebackWin');
  if (outcome === 'loss' && led) matched.add('collapse');
  if (late && outcome === 'win' && mine - theirs === 1 && decisive.team === mySide) matched.add('lateWinner');
  if (late && outcome === 'draw') matched.add(decisive.team === mySide ? 'lateEqualiserFor' : 'lateEqualiserAgainst');
  if (rivalry && outcome !== 'draw') matched.add(outcome === 'win' ? 'derbyWin' : 'derbyLoss');
  if (outcome === 'win' && gap <= -C.strengthGap) matched.add('upsetWin');
  if (outcome === 'loss' && gap >= C.strengthGap) matched.add('upsetLoss');
  const red = result.cards.find((c) => c.team === mySide && c.type === 'red');
  if (red) {
    matched.add('redCardUs');
    vars.redPlayer = red.playerName;
  }
  // 주전급(스쿼드 OVR 상위 11명)이 2경기 이상 빠지는 부상만 '악재'로 본다
  const top11 = new Set(squadOf(dataset, game, game.teamId).sort((x, y) => overall(y) - overall(x)).slice(0, 11).map((p) => p.id));
  const injury = result.injuries.find((i) => i.team === mySide && top11.has(i.playerId) && i.matchesOut >= 2);
  if (injury) {
    matched.add('injuryBlow');
    vars.injured = injury.playerName;
  }
  if (outcome === 'loss' && theirs - mine >= C.bigMargin) matched.add('heavyLoss');
  if (outcome === 'win' && mine - theirs >= C.bigMargin) matched.add('bigWin');
  if (outcome === 'loss' && xgDiff >= C.xgGap) matched.add('dominatedButLost');
  if (outcome === 'win' && -xgDiff >= C.xgGap) matched.add('luckyWin');
  if (result.cards.some((c) => c.team === oppSide && c.type === 'red')) matched.add('redCardThem');
  if (outcome === 'win' && vars.streak >= C.streak) matched.add('winStreak');
  if (outcome === 'loss' && vars.streak >= C.streak) matched.add('loseStreak');
  if (outcome === 'win' && theirs === 0) matched.add('cleanSheetWin');
  if (outcome === 'win') matched.add(mine - theirs === 1 ? 'narrowWin' : 'win');
  if (outcome === 'draw') matched.add(mine === 0 ? 'goallessDraw' : 'draw');
  if (outcome === 'loss') matched.add(theirs - mine === 1 ? 'narrowLoss' : 'loss');
  // 기본 상황이 하나는 꼭 있도록
  matched.add(outcome === 'win' ? 'win' : outcome === 'draw' ? (mine === 0 ? 'goallessDraw' : 'draw') : 'loss');

  return { ...build(media, 'post', chooseSituation('post', matched), vars), outcome, mult: derbyMult(rivalry), round: fixture.round };
}

export function answerPost(game, interview, stance) {
  const effect = MORALE.post[stance];
  let delta = effect[interview.outcome];
  let backfired = false;
  // 결과 수치는 시드 난수로 (같은 세이브·같은 선택이면 같은 결과)
  const rng = createRng(`${game.seed}:post:${game.seasonIndex}:${interview.round}:${stance}`);
  if (effect.backfire && rng.chance(effect.backfire.chance)) {
    delta = effect.backfire.value;
    backfired = true;
  }
  delta *= interview.mult;
  addMorale(game, delta);
  game.lastPostInterview = { season: game.seasonIndex, round: interview.round, stance };
  return { delta, backfired };
}

// ── 하프타임 팀 토크 ──────────────────────────────────

// state: 진행 중인 경기 (createMatch). gap: 경기 전 전력 차 (우리 - 상대)
export function teamTalk(media, dataset, game, state, mySide, gap) {
  const oppSide = mySide === 'home' ? 'away' : 'home';
  const oppId = state.teams[oppSide].id;
  const mine = state.score[mySide];
  const theirs = state.score[oppSide];
  const diff = mine - theirs;
  const rivalry = rivalryBetween(media, game.teamId, oppId);
  const xgDiff = state.stats[mySide].xg - state.stats[oppSide].xg;
  const vars = {
    team: dataset.teamById.get(game.teamId).shortName,
    opponent: dataset.teamById.get(oppId).shortName,
    score: scoreText(mine, theirs),
    player: bestPlayer(state.teams[mySide].lineup)?.name,
    derby: rivalry?.name,
  };
  const matched = new Set();
  const red = state.cards.find((c) => c.team === mySide && c.type === 'red');
  if (red) {
    matched.add('redCardUs');
    vars.redPlayer = red.playerName;
  }
  if (state.cards.some((c) => c.team === oppSide && c.type === 'red')) matched.add('redCardThem');
  if (rivalry && diff < 0) matched.add('derbyTrailing');
  if (rivalry && diff > 0) matched.add('derbyLeading');
  if (gap >= C.strengthGap && diff < 0) matched.add('favoriteTrailing');
  if (gap <= -C.strengthGap && diff > 0) matched.add('underdogLeading');
  if (diff <= -2) matched.add('trailingHeavy');
  else if (diff === -1) matched.add('trailingNarrow');
  else if (diff >= 2) matched.add('leadingComfortably');
  else if (diff === 1) matched.add('leadingNarrow');
  else if (xgDiff >= C.xgGap * 0.8) matched.add('drawingGood');
  else if (xgDiff <= -C.xgGap * 0.8) matched.add('drawingPoor');
  else matched.add(mine === 0 ? 'goallessEven' : 'drawingEven');

  const group = diff > 0 ? 'leading' : diff < 0 ? 'trailing' : 'drawing';
  return { ...build(media, 'talk', chooseSituation('talk', matched), vars), group, mult: derbyMult(rivalry) };
}

const REACTIONS = {
  good: ['선수들의 눈빛이 달라졌습니다.', '라커룸에 기합 소리가 울립니다.', '선수들이 서로 어깨를 두드리며 나갑니다.'],
  neutral: ['선수들이 고개를 끄덕입니다.', '선수들이 조용히 축구화 끈을 다시 묶습니다.', '별다른 반응 없이 후반을 준비합니다.'],
  bad: ['몇몇 선수가 불만스러운 표정입니다.', '분위기가 오히려 가라앉았습니다.', '선수들이 서로 눈을 피합니다.'],
};

// 팀 토크 효과: 후반 레이팅 보정 + 사기 보정. → { delta, morale, tone, reaction }
export function answerTalk(game, state, mySide, talk, stance) {
  const T = MORALE.talk;
  const rng = createRng(`${state.seed}:talk:${state.minute}:${stance}`);
  const delta = T[stance][talk.group] + (rng.next() * 2 - 1) * T.noise;
  adjustBoost(state, mySide, delta);
  const morale = delta * T.moraleScale * talk.mult;
  addMorale(game, morale);
  const tone = delta >= T.goodAbove ? 'good' : delta < 0 ? 'bad' : 'neutral';
  return { delta, morale, tone, reaction: pick(REACTIONS[tone]) };
}

// ── 대륙 대회 ─────────────────────────────────────────
// 대륙 대회 경기 문맥: 대회 이름, 단계, 1차전 스코어, 리그 페이즈 순위
function cupContext(game, fixture, mySide) {
  const comp = compOf(game, fixture);
  const oppSide = mySide === 'home' ? 'away' : 'home';
  const ctx = { comp, competition: comp.name.replace(/^UEFA\s*/, ''), stage: stageName(fixture.stage), matchday: fixture.md };
  if (fixture.stage === 'league') {
    const row = leaguePhaseTable(comp).find((r) => r.teamId === fixture[`${mySide}Id`]);
    ctx.cupRank = row?.position;
  }
  const first = firstLegOf(game, fixture);
  if (first?.result) {
    // 1차전에서는 홈·원정이 반대
    ctx.firstMine = first.result.score[oppSide];
    ctx.firstTheirs = first.result.score[mySide];
    ctx.firstLeg = scoreText(ctx.firstMine, ctx.firstTheirs);
  }
  return ctx;
}

// 경기 전 기자회견 (대륙 대회)
export function preCupInterview(media, dataset, game, fixture, input) {
  const mySide = fixture.homeId === game.teamId ? 'home' : 'away';
  const oppSide = mySide === 'home' ? 'away' : 'home';
  const rivalry = rivalryBetween(media, game.teamId, fixture[`${oppSide}Id`]);
  const c = cupContext(game, fixture, mySide);
  const vars = {
    team: dataset.teamById.get(game.teamId).shortName,
    opponent: dataset.teamById.get(fixture[`${oppSide}Id`]).shortName,
    venue: mySide === 'home' ? '홈' : '원정',
    player: bestPlayer(input[mySide].lineup)?.name,
    oppPlayer: bestPlayer(input[oppSide].lineup)?.name,
    ...c,
  };
  let situation;
  if (fixture.stage === 'final') situation = 'cupFinal';
  else if (fixture.leg === 2) situation = c.firstMine < c.firstTheirs ? 'cupSecondLegBehind' : c.firstMine > c.firstTheirs ? 'cupSecondLegAhead' : 'cupSecondLegLevel';
  else if (fixture.stage !== 'league') situation = 'cupFirstLeg';
  else if (fixture.md === 1) situation = 'cupOpener';
  else if (fixture.md >= 7 && [[5, 12], [20, 28]].some(([a, b]) => c.cupRank >= a && c.cupRank <= b)) situation = 'cupLeaguePhaseDecider';
  else situation = 'cupNight';
  return { ...build(media, 'pre', situation, vars), mult: derbyMult(rivalry), fixtureId: fixture.id };
}

// 경기 후 인터뷰 (대륙 대회). game은 진행 후 상태
export function postCupInterview(media, dataset, game, fixture, result, gap) {
  const mySide = fixture.homeId === game.teamId ? 'home' : 'away';
  const oppSide = mySide === 'home' ? 'away' : 'home';
  const mine = result.score[mySide];
  const theirs = result.score[oppSide];
  const outcome = mine > theirs ? 'win' : mine < theirs ? 'loss' : 'draw';
  const c = cupContext(game, fixture, mySide);
  const scorers = new Map();
  for (const g of result.goals.filter((x) => x.team === mySide)) scorers.set(g.scorerName, (scorers.get(g.scorerName) ?? 0) + 1);
  const scorer = [...scorers].sort((a, b) => b[1] - a[1])[0]?.[0];
  const vars = {
    team: dataset.teamById.get(game.teamId).shortName,
    opponent: dataset.teamById.get(fixture[`${oppSide}Id`]).shortName,
    venue: mySide === 'home' ? '홈' : '원정',
    score: scoreText(mine, theirs),
    scorer,
    ...c,
  };
  if (result.aggregate) vars.aggregate = scoreText(result.aggregate[mySide], result.aggregate[oppSide]);
  const won = result.winner === mySide;
  let situation;
  if (fixture.stage === 'final') situation = won ? 'cupWonTrophy' : 'cupLostFinal';
  else if (fixture.leg === 2) situation = result.penalties ? (won ? 'cupPenaltyWin' : 'cupPenaltyLoss') : won ? 'cupAdvanced' : 'cupEliminated';
  else if (fixture.stage !== 'league') situation = 'cupFirstLegResult';
  else if (fixture.md === 8) {
    const row = leaguePhaseTable(c.comp).find((r) => r.teamId === game.teamId);
    vars.cupRank = row.position;
    situation = row.position <= 24 ? 'cupLeaguePhaseQualified' : 'cupLeaguePhaseOut';
  } else if (Math.random() < 0.5) {
    situation = 'cupNightResult';
  } else {
    // 리그 페이즈 일반 경기는 리그 결과 상황 문구도 섞어 쓴다
    const diff = mine - theirs;
    situation = diff >= 3 ? 'bigWin' : diff === 1 ? 'narrowWin' : diff > 0 ? 'win' : diff === 0 ? (mine === 0 ? 'goallessDraw' : 'draw') : diff === -1 ? 'narrowLoss' : diff <= -3 ? 'heavyLoss' : 'loss';
  }
  const rivalry = rivalryBetween(media, game.teamId, fixture[`${oppSide}Id`]);
  return { ...build(media, 'post', situation, vars), outcome, mult: derbyMult(rivalry), round: `cup:${fixture.id}` };
}

// 하프타임·연장 직전 팀 토크 (대륙 대회). moment: 'half' | 'extraTime'
export function cupTeamTalk(media, dataset, game, state, mySide, gap, fixture, moment) {
  const base = teamTalk(media, dataset, game, state, mySide, gap);
  const oppSide = mySide === 'home' ? 'away' : 'home';
  const c = cupContext(game, fixture, mySide);
  const prior = state.knockout?.prior ?? { home: 0, away: 0 };
  const aggMine = state.score[mySide] + prior[mySide];
  const aggTheirs = state.score[oppSide] + prior[oppSide];
  const vars = {
    team: dataset.teamById.get(game.teamId).shortName,
    opponent: dataset.teamById.get(state.teams[oppSide].id).shortName,
    score: scoreText(state.score[mySide], state.score[oppSide]),
    player: bestPlayer(state.teams[mySide].lineup)?.name,
    aggregate: scoreText(aggMine, aggTheirs),
    ...c,
  };
  let situation = null;
  if (moment === 'extraTime') situation = 'cupExtraTime';
  else if (fixture.stage === 'final') situation = 'cupFinalHalftime';
  else if (fixture.leg === 2 && aggMine < aggTheirs) situation = 'cupSecondLegChasing';
  else if (fixture.leg === 2 && aggMine > aggTheirs) situation = 'cupSecondLegProtecting';
  if (!situation) return base; // 리그 페이즈·1차전은 일반 하프타임 상황
  const diff = aggMine - aggTheirs;
  return { ...build(media, 'talk', situation, vars), group: diff > 0 ? 'leading' : diff < 0 ? 'trailing' : 'drawing', mult: base.mult };
}
