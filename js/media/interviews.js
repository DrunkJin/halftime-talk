// 감독 인터뷰·팀 토크: 경기 상황을 판정해 질문과 답변 선택지를 만들고, 고른 답의 효과를 반영한다.
// 문구는 data/interviews/*.json, 라이벌은 data/rivalries.json, 효과 수치는 engine/config.js(MORALE)
import { contentBase, josa, t, tList, getLang } from '../i18n.js';
import { HALF_TIME_MINUTE, MORALE } from '../engine/config.js';
import { createRng } from '../engine/rng.js';
import { adjustBoost } from '../engine/match.js';
import { computeTeamRatings, conditionFactor, overall } from '../engine/ratings.js';
import { computeTable } from '../league/table.js';
import { availabilityOf, fixturesOf, isSeasonOver, leagueOf, squadOf } from '../state/game.js';
import { addMorale, recentResults } from '../state/morale.js';
import { compOf, firstLegOf, leaguePhaseTable, stageName, compName } from '../competitions/cups.js';
import { SITUATIONS, STANCES } from './situations.js';

const C = MORALE.context;

// ── 데이터 로딩 ───────────────────────────────────────

let mediaPromise = null;

// { pre, post, talk, rivalries: Map('a|b' → rivalry) }. 실패하면 null (인터뷰 없이 진행)
export function loadMedia(baseUrl = 'data/') {
  mediaPromise ??= (async () => {
    // 문구는 언어별 경로, 라이벌 표(이름은 name/nameEn)는 공통
    const get = async (path, base = contentBase(baseUrl)) => {
      const res = await fetch(`${base}${path}`);
      if (!res.ok) throw new Error(`${path}: ${res.status}`);
      return res.json();
    };
    const [pre, post, talk, rivalries] = await Promise.all([get('interviews/pre.json'), get('interviews/post.json'), get('interviews/talk.json'), get('rivalries.json', baseUrl)]);
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
// 더비 이름: 한국어는 name, 다른 언어는 nameEn (data/rivalries.json)
export const rivalryName = (rivalry) => (rivalry ? (getLang() === 'ko' ? rivalry.name : rivalry.nameEn ?? rivalry.name) : undefined);
const derbyMult = (rivalry) => MORALE.derbyMultiplier[rivalry?.intensity ?? 0];

// ── 공통 ──────────────────────────────────────────────

const pick = (list) => list[Math.floor(Math.random() * list.length)];
// 채운 뒤 조사도 고른다 (예: {score}(이)라는 → 3-1이라는)
const fill = (text, vars) => josa(text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? '')));
const fieldAverage = (r) => (r.attack + r.midfield + r.defense) / 3;
const inputStrength = (input) => fieldAverage(computeTeamRatings(input.slots, input.lineup, (p) => conditionFactor(input.condition[p.id])));
const bestPlayer = (players) => players.filter(Boolean).reduce((a, b) => (overall(b) > overall(a) ? b : a), players.find(Boolean));

// 경기 후 '극적인 상황': 이 경기의 이야기 그 자체라 무작위로 다른 질문에 밀리지 않는다
const DRAMA = new Set(['seasonEndHigh', 'seasonEndLow', 'hatTrick', 'derbyWin', 'derbyLoss', 'comebackWin', 'collapse', 'lateWinner', 'lateEqualiserFor', 'lateEqualiserAgainst']);

// 해당하는 상황 중 우선순위가 가장 높은 것. 가끔(30%) 다른 해당 상황을 골라 질문이 단조롭지 않게 (극적인 상황은 제외)
function chooseSituation(kind, matched) {
  const ordered = Object.keys(SITUATIONS[kind]).filter((id) => matched.has(id));
  // 대륙 대회 상황이 있으면 그것을 우선한다 (리그 상황과 섞이지 않게)
  const cupFirst = ordered.find((id) => SITUATIONS[kind][id].cup);
  if (cupFirst) return cupFirst;
  if (ordered.length === 0) return 'generic';
  if (DRAMA.has(ordered[0])) return ordered[0];
  const others = ordered.slice(1).filter((id) => id !== 'generic');
  return others.length && Math.random() < 0.3 ? pick(others) : ordered[0];
}

// 상황 → { situation, question, answers: [{ stance, label, text }] }
// facts: 이 경기에서 사실인 것들(Set). 질문·답에 when이 있으면 그 사실이 모두 맞을 때만 쓴다
// (예: '한 골로는 부족했다'는 when: 'singleGoal' — 2-2 무승부에 나오지 않게)
const fits = (item, facts) => !item.when || [].concat(item.when).every((f) => facts.has(f));
function build(media, kind, situation, vars, matchFacts = new Set()) {
  const s = media[kind].situations[situation];
  const facts = new Set(matchFacts);
  if (Math.random() < C.weatherChance) facts.add('weather'); // 날씨 핑계는 몇 경기에 한 번만
  // 전용 답이 있는 질문은 그 답에서만 (질문과 답이 어긋나지 않게)
  const askable = s.questions.filter((x) => typeof x === 'string' || fits(x, facts));
  const q = pick(askable.length ? askable : s.questions.filter((x) => typeof x === 'string' || !x.when));
  const pool = typeof q === 'string' ? s.answers : q.answers;
  // 이 경기 사실과 맞는 답이 하나도 없는 성향은 빠진다 (사실과 어긋나는 답을 억지로 내지 않게)
  const all = Object.entries(STANCES[kind])
    .map(([stance, label]) => {
      const fitting = pool.filter((a) => a.stance === stance && fits(a, facts));
      return fitting.length ? { stance, label, text: fill(pick(fitting).text, vars) } : null;
    })
    .filter(Boolean);
  // 보이는 답은 4개: 성향 하나를 빼서 경기마다 조합이 달라진다 (매번 같은 5지선다는 금방 지친다)
  const drop = all.length > 4 ? pick(all) : null;
  const answers = all.filter((a) => a !== drop);
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
    venue: t(mySide === 'home' ? 'media.venue.home' : 'media.venue.away'),
    player: bestPlayer(input[mySide].lineup)?.name,
    oppPlayer: bestPlayer(input[oppSide].lineup)?.name,
    rank,
    oppRank,
    derby: rivalryName(rivalry),
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

  const story = goalStory(result.goals, mySide, outcome);
  const { led, trailed, decisive, topScorer, topGoals, late } = story;
  const xgDiff = result.stats[mySide].xg - result.stats[oppSide].xg;
  const recent = recentResults(dataset, game, game.teamId);

  const vars = {
    team: dataset.teamById.get(game.teamId).shortName,
    opponent: dataset.teamById.get(oppId).shortName,
    venue: t(mySide === 'home' ? 'media.venue.home' : 'media.venue.away'),
    score: scoreText(mine, theirs),
    scorer: topScorer, // 아래에서 상황에 따라 결승골 득점자로 바꾼다
    minute: decisive?.minute,
    derby: rivalryName(rivalry),
    rank,
    streak: runLength(recent, (o) => o === (outcome === 'win' ? 'W' : 'L')),
  };
  const matched = new Set();
  if (isSeasonOver(game)) {
    if (rank <= C.topRank) matched.add('seasonEndHigh');
    else if (rank > size - C.relegationZone) matched.add('seasonEndLow');
  }
  for (const id of dramaOf(story, outcome, mine, theirs, mySide)) matched.add(id);
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

  // 해트트릭은 이 경기의 주인공이라 시즌 끝·대륙 대회 상황이 아니면 늘 그 이야기를 묻는다
  let situation = chooseSituation('post', matched);
  if (matched.has('hatTrick') && !/^seasonEnd|^cup/.test(situation)) situation = 'hatTrick';
  vars.scorer = scorerFor(situation, story, mySide);
  const facts = matchFacts(story, outcome, mine, theirs, game);
  return { ...build(media, 'post', situation, vars, facts), outcome, mult: derbyMult(rivalry), round: fixture.round };
}

// 승부를 정한 골: 이긴 쪽은 진 쪽 최종 득점 + 1번째 골(그 뒤로 리드를 놓치지 않은 골), 무승부는 마지막 골(동점골)
export function decidingGoal(goals, mySide, outcome) {
  const sorted = [...goals].sort((a, b) => a.minute - b.minute);
  if (outcome === 'draw') return sorted.at(-1) ?? null;
  const winSide = outcome === 'win' ? mySide : mySide === 'home' ? 'away' : 'home';
  const loserGoals = sorted.filter((g) => g.team !== winSide).length;
  return sorted.filter((g) => g.team === winSide)[loserGoals] ?? null;
}

// 골 순서로 본 이 경기의 이야기: 앞선 적·뒤진 적, 결승골·동점골, 마지막으로 리드를 잡은 골, 최다 득점자
// drawType: 무승부일 때 'caughtUp'(앞서다 따라잡힘) · 'cameBack'(뒤지다 따라붙음) · null(0-0)
export function goalStory(goals, mySide, outcome) {
  const sorted = [...goals].sort((a, b) => a.minute - b.minute);
  let m = 0;
  let o = 0;
  let led = false;
  let trailed = false;
  let leadGoal = null; // 마지막으로 어느 한쪽을 앞서게 만든 골
  for (const g of sorted) {
    if (g.team === mySide) m++;
    else o++;
    if (m > o) led = true;
    if (m < o) trailed = true;
    if (m !== o && Math.abs(m - o) === 1 && (g.team === mySide ? m > o : o > m)) leadGoal = g;
  }
  const scorers = new Map();
  for (const g of sorted.filter((x) => x.team === mySide)) scorers.set(g.scorerName, (scorers.get(g.scorerName) ?? 0) + 1);
  const [topScorer, topGoals] = [...scorers].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];
  const decisive = decidingGoal(sorted, mySide, outcome);
  const drawType = outcome !== 'draw' || !leadGoal ? null : leadGoal.team === mySide ? 'caughtUp' : 'cameBack';
  // 전반·후반 골 득실 (우리 - 상대). 연장은 후반 쪽으로 친다
  const half = { first: 0, second: 0 };
  for (const g of sorted) half[g.minute <= HALF_TIME_MINUTE ? 'first' : 'second'] += g.team === mySide ? 1 : -1;
  return { led, trailed, decisive, leadGoal, drawType, half, topScorer, topGoals, late: Boolean(decisive && decisive.minute >= C.lateGoalMinute) };
}

// 골 흐름에서 나오는 극적인 상황 (리그·대륙 대회 공통)
function dramaOf(story, outcome, mine, theirs, mySide) {
  const out = [];
  if (story.topGoals >= 3) out.push('hatTrick');
  if (outcome === 'win' && story.trailed) out.push('comebackWin');
  if (outcome === 'loss' && story.led) out.push('collapse');
  if (story.late && outcome === 'win' && mine - theirs === 1 && story.decisive.team === mySide) out.push('lateWinner');
  if (story.late && outcome === 'draw') out.push(story.decisive.team === mySide ? 'lateEqualiserFor' : 'lateEqualiserAgainst');
  return out;
}

// 질문·답의 when 조건에 쓰는 이 경기의 사실
function matchFacts(story, outcome, mine, theirs, game) {
  const f = new Set();
  if (mine === 1) f.add('singleGoal');
  f.add(theirs > 0 ? 'conceded' : 'cleanSheet');
  if (outcome === 'win' && story.decisive && !story.late) f.add('heldLead'); // 결승골 뒤로 오래 지킨 승리
  if (story.drawType) f.add(story.drawType);
  if (!(game.seasonIndex === 1 && game.round <= 2)) f.add('notFirstMatch'); // 라운드 진행 뒤라 첫 경기면 round가 2
  if (!story.trailed) f.add('neverTrailed');
  // 하프타임 이야기·'후반이 나빴다'·'전반이 나빴다'는 전반·후반 골 득실이 그 말과 맞을 때만
  if (story.half.first < 0) f.add('htTrail');
  if (story.half.second < story.half.first) f.add('secondHalfWorse');
  if (story.half.first < story.half.second) f.add('firstHalfWorse');
  return f;
}

// 질문의 {scorer}는 상황마다 뜻이 다르다 (data/interviews/post.json 질문 문장 기준)
// - '결승골·동점골' 그 자체를 말하는 상황: 그 골을 넣은 선수
// - '주역·해결사'를 말하는 상황: 두 골 이상 넣은 선수가 있으면 그 선수, 없으면 결승골 주인
// - 무승부: 앞서다 따라잡혔으면 리드를 잡은 골, 따라붙었으면 동점골의 주인
// - 그 밖(해트트릭·대승·일반 승리): 가장 많이 넣은 선수
const GOAL_SITUATIONS = new Set(['narrowWin', 'lateWinner', 'cleanSheetWin', 'luckyWin', 'lateEqualiserFor']);
const HERO_SITUATIONS = new Set(['comebackWin', 'derbyWin', 'upsetWin', 'winStreak', 'cupWonTrophy']);
export function scorerFor(situation, story, mySide) {
  const ours = (g) => (g?.team === mySide ? g.scorerName : null);
  const decider = ours(story.decisive);
  if (situation === 'draw') return (story.drawType === 'caughtUp' ? ours(story.leadGoal) : decider) ?? story.topScorer;
  if (GOAL_SITUATIONS.has(situation)) return decider ?? story.topScorer;
  if (HERO_SITUATIONS.has(situation)) return story.topGoals >= 2 ? story.topScorer : (decider ?? story.topScorer);
  return story.topScorer;
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
  const shots = { mine: state.stats[mySide].shots, theirs: state.stats[oppSide].shots };
  const vars = {
    team: dataset.teamById.get(game.teamId).shortName,
    opponent: dataset.teamById.get(oppId).shortName,
    score: scoreText(mine, theirs),
    player: bestPlayer(state.teams[mySide].lineup)?.name,
    derby: rivalryName(rivalry),
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
  // 비기는 중 '잘했다/힘들었다'는 xG와 슈팅 수가 같은 쪽을 가리킬 때만 (슈팅에서 앞섰는데 '힘든 전반'이라 하지 않게)
  else if (xgDiff >= C.xgGap * 0.8 && shots.mine >= shots.theirs) matched.add('drawingGood');
  else if (xgDiff <= -C.xgGap * 0.8 && shots.theirs >= shots.mine) matched.add('drawingPoor');
  else matched.add(mine === 0 ? 'goallessEven' : 'drawingEven');

  const group = diff > 0 ? 'leading' : diff < 0 ? 'trailing' : 'drawing';
  // '실수 하나 없이 깔끔했어' 같은 말은 실점이 없을 때만
  return { ...build(media, 'talk', chooseSituation('talk', matched), vars, new Set(theirs === 0 ? ['cleanSheet'] : [])), group, mult: derbyMult(rivalry) };
}

// 팀 토크 뒤 선수단 반응 (사전 media.reaction.{good|neutral|bad} 문장 목록)
const reactionsOf = (tone) => tList(`media.reaction.${tone}`);

// 팀 토크 효과: 후반 레이팅 보정 + 사기 보정. → { delta, morale, tone, reaction }
export function answerTalk(game, state, mySide, talk, stance) {
  const T = MORALE.talk;
  const rng = createRng(`${state.seed}:talk:${state.minute}:${stance}`);
  const delta = T[stance][talk.group] + (rng.next() * 2 - 1) * T.noise;
  adjustBoost(state, mySide, delta);
  const morale = delta * T.moraleScale * talk.mult;
  addMorale(game, morale);
  const tone = delta >= T.goodAbove ? 'good' : delta < 0 ? 'bad' : 'neutral';
  return { delta, morale, tone, reaction: pick(reactionsOf(tone)) ?? '' };
}

// ── 대륙 대회 ─────────────────────────────────────────
// 대륙 대회 경기 문맥: 대회 이름, 단계, 1차전 스코어, 리그 페이즈 순위
function cupContext(game, fixture, mySide) {
  const comp = compOf(game, fixture);
  const oppSide = mySide === 'home' ? 'away' : 'home';
  const ctx = { comp, competition: compName(comp).replace(/^UEFA\s*/, ''), stage: stageName(fixture.stage), matchday: fixture.md };
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
    venue: t(mySide === 'home' ? 'media.venue.home' : 'media.venue.away'),
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
  const story = goalStory(result.goals, mySide, outcome);
  const vars = {
    team: dataset.teamById.get(game.teamId).shortName,
    opponent: dataset.teamById.get(fixture[`${oppSide}Id`]).shortName,
    venue: t(mySide === 'home' ? 'media.venue.home' : 'media.venue.away'),
    score: scoreText(mine, theirs),
    scorer: story.topScorer,
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
  // 결승·2차전(진출이 걸린 경기)이 아니면 극적인 골 흐름(해트트릭·역전·극장골)이 대회 일반 질문보다 먼저
  const drama = fixture.stage === 'final' || fixture.leg === 2 ? [] : dramaOf(story, outcome, mine, theirs, mySide);
  if (drama.length) situation = drama[0];
  vars.minute = story.decisive?.minute;
  vars.scorer = scorerFor(situation, story, mySide);
  const rivalry = rivalryBetween(media, game.teamId, fixture[`${oppSide}Id`]);
  return { ...build(media, 'post', situation, vars, matchFacts(story, outcome, mine, theirs, game)), outcome, mult: derbyMult(rivalry), round: `cup:${fixture.id}` };
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
  return { ...build(media, 'talk', situation, vars, new Set(state.score[oppSide] === 0 ? ['cleanSheet'] : [])), group: diff > 0 ? 'leading' : diff < 0 ? 'trailing' : 'drawing', mult: base.mult };
}
