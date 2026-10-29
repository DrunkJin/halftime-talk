// 한 주(사용자 라운드) 진행 순서를 묶는다: 경기(모든 리그) → 재정 정산 → AI 이적·받은 제안 → 주중 대륙 대회 → 시즌 종료 상금.
// 메인 스레드와 Web Worker가 같은 함수를 쓴다.
import { simulateMatch } from '../engine/match.js';
import { aiTransferRound, expireIncomingOffers, generateIncomingOffers } from '../market/ai.js';
import { applyWeekFinances, awardSeasonPrizes, initSeasonFinances } from '../market/finance.js';
import { windowStatus } from '../market/market.js';
import { createCups, cupMatchInput, cupsOf, dueCupEvent, playCupEvent, userCupFixture } from '../competitions/cups.js';
import { noteSeasonExpectation, trackUserMatch } from './career.js';
import { autoPickLineup, completeRound, isSeasonOver, matchInput, newGame, userFixture, userSlots } from './game.js';
import { TACTICS } from '../engine/config.js';
import { recordSeason } from './history.js';
export { startNextSeason } from './newSeason.js';
import { settleMoraleAfterMatch } from './morale.js';
import { trainFamiliarity } from './familiarity.js';
import { applyTrainingWeek } from './training.js';
import { updateMoods } from './squadMood.js';
import { evaluateSeason, setObjective, updateBoardAfterMatch } from './board.js';
import { pushNews, weeklyNews } from './inbox.js';
import { aiIdentity, squadProfile } from '../engine/tactics.js';

export function createGame(dataset, teamId, options) {
  const game = newGame(dataset, teamId, options);
  // 처음 전술: 우리 선수 구성에 맞는 압박·공격 방식 (AI 팀이 고르는 방식과 같다)
  const lineup = game.lineup.map((id) => dataset.playerById.get(id));
  game.tactics = { ...TACTICS.defaults, ...aiIdentity(squadProfile(userSlots(game), lineup), 0) };
  game.contracts = {};
  game.incomingOffers = [];
  game.budgets = {};
  initSeasonFinances(dataset, game, { firstSeason: true });
  createCups(dataset, game);
  noteSeasonExpectation(dataset, game);
  setObjective(dataset, game);
  game.jobs = [{ seasonIndex: 1, round: 1, teamId, reason: 'start' }];
  pushNews(game, 'board.objective', { team: dataset.teamById.get(teamId).shortName, goal: game.board.objective.label, kind: game.board.objective.kind }, { important: true });
  return game;
}

// 사용자 팀이 안 나오는 주중 경기는 바로 진행한다. 사용자 경기가 있으면 거기서 멈춘다 (화면에서 직접 치른다)
// → 진행한 이벤트 목록
function playDueCupEvents(dataset, game) {
  const played = [];
  while (dueCupEvent(game) && !userCupFixture(game)) played.push(playCupEvent(dataset, game, null));
  return played;
}

// 사용자 팀의 주중 경기를 마친 뒤: 그 이벤트의 다른 경기 + 이어서 열릴 경기까지
// → { cups: 진행한 이벤트 목록 }
export function playCupWeek(dataset, game, userResult) {
  const mine = userCupFixture(game);
  trackUserMatch(dataset, game, mine, userResult, mine ? cupsOf(game)?.comps[mine.comp]?.name : null);
  const cups = [playCupEvent(dataset, game, userResult)].filter(Boolean);
  settleMoraleAfterMatch(game, mine?.id, userResult, mine?.homeId === game.teamId ? 'home' : 'away', { decay: false });
  if (mine) trainFamiliarity(game);
  const moods = mine ? updateMoods(dataset, game, userResult) : [];
  cups.push(...playDueCupEvents(dataset, game));
  return { cups, moods };
}

// → { others: 사용자 리그의 다른 경기 [{ fixture, result }], aiTransfers, newOffers }
export function playWeek(dataset, game, userResult) {
  const windowOpen = windowStatus(game).open; // 이번 라운드가 이적시장 기간인지 (진행 전 기준)
  const mine = userFixture(game);
  trackUserMatch(dataset, game, mine, userResult, dataset.leagueById.get(game.leagueId)?.name);
  const others = completeRound(dataset, game, userResult);
  const board = mine ? updateBoardAfterMatch(dataset, game, mine, userResult) : []; // 이사회 신뢰도
  settleMoraleAfterMatch(game, mine?.id, userResult, mine?.homeId === game.teamId ? 'home' : 'away');
  if (mine) trainFamiliarity(game);
  const moods = mine ? updateMoods(dataset, game, userResult) : []; // 출전 기대치·기분 (사용자 팀)
  applyWeekFinances(dataset, game);
  const training = applyTrainingWeek(dataset, game); // 경기 사이 한 주 훈련
  let aiTransfers = [];
  let newOffers = [];
  if (windowOpen) aiTransfers = aiTransferRound(dataset, game);
  // 받은 제안은 다음 라운드에도 시장이 열려 있어야 답할 수 있다. 시장이 닫히면 남은 제안도 사라진다
  if (windowStatus(game).open) {
    newOffers = generateIncomingOffers(dataset, game);
    expireIncomingOffers(game);
  } else {
    game.incomingOffers = [];
  }
  const cups = playDueCupEvents(dataset, game);
  if (isSeasonOver(game)) {
    awardSeasonPrizes(dataset, game);
    recordSeason(dataset, game);
    seasonEndNews(dataset, game, evaluateSeason(dataset, game)); // 이사회 평가 → 경질 또는 다른 구단 제안
    game.incomingOffers = [];
  }
  const week = { others, aiTransfers, newOffers, cups, training, moods, board };
  weeklyNews(dataset, game, week, mine, userResult);
  return week;
}

// 시즌 끝 이사회 소식: 평가, 경질 또는 제안
function seasonEndNews(dataset, game, ev) {
  if (!ev) return;
  const team = (id) => dataset.teamById.get(id)?.shortName ?? id;
  pushNews(game, `board.eval.${ev.verdict}`, { goal: ev.label, position: ev.position, target: ev.target, delta: ev.delta, confidence: Math.round(game.board.confidence) }, { important: true });
  if (game.board.sacked) pushNews(game, 'board.sacked', { team: team(game.teamId) }, { important: true });
  for (const id of game.board.offers ?? []) pushNews(game, 'board.offer', { club: team(id), league: dataset.leagueById.get(dataset.teamById.get(id).leagueId).name, id }, { important: true });
}

// 남은 시즌 자동 진행: 사용자 팀은 지금 선발에서 결장자·지친 선수를 바꾸고(로테이션),
// 전술은 수석코치처럼 AI가 정한다 (경기 전 전력 차·스코어). 받은 제안은 모두 거절
export function simulateRestOfSeason(dataset, game) {
  const autoPlay = (input, fixture) => {
    input[fixture.homeId === game.teamId ? 'home' : 'away'].autoTactics = true;
    return simulateMatch(input);
  };
  while (!isSeasonOver(game)) {
    if (game.board?.sacked) break; // 경질: 새 구단을 골라야 이어 갈 수 있다
    const cup = userCupFixture(game);
    if (cup) {
      autoPickLineup(dataset, game, 'cup');
      playCupWeek(dataset, game, autoPlay(cupMatchInput(dataset, game, cup), cup));
      continue;
    }
    autoPickLineup(dataset, game); // 매 경기 최선의 선발 (회복한 주전 복귀, 지친 선수 휴식)
    const f = userFixture(game);
    playWeek(dataset, game, f ? autoPlay(matchInput(dataset, game, f), f) : null);
    game.incomingOffers = [];
  }
}
