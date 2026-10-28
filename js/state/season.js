// 한 주(사용자 라운드) 진행 순서를 묶는다: 경기(모든 리그) → 재정 정산 → AI 이적·받은 제안 → 주중 대륙 대회 → 시즌 종료 상금.
// 메인 스레드와 Web Worker가 같은 함수를 쓴다.
import { simulateMatch } from '../engine/match.js';
import { aiTransferRound, expireIncomingOffers, generateIncomingOffers } from '../market/ai.js';
import { applyWeekFinances, awardSeasonPrizes, initSeasonFinances } from '../market/finance.js';
import { windowStatus } from '../market/market.js';
import { createCups, cupMatchInput, dueCupEvent, playCupEvent, userCupFixture } from '../competitions/cups.js';
import { completeRound, fixLineup, isSeasonOver, matchInput, newGame, userFixture } from './game.js';
import { recordSeason } from './history.js';
export { startNextSeason } from './newSeason.js';
import { settleMoraleAfterMatch } from './morale.js';

export function createGame(dataset, teamId, options) {
  const game = newGame(dataset, teamId, options);
  game.contracts = {};
  game.incomingOffers = [];
  game.budgets = {};
  initSeasonFinances(dataset, game, { firstSeason: true });
  createCups(dataset, game);
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
  const cups = [playCupEvent(dataset, game, userResult)].filter(Boolean);
  settleMoraleAfterMatch(game, mine?.id, userResult, mine?.homeId === game.teamId ? 'home' : 'away', { decay: false });
  cups.push(...playDueCupEvents(dataset, game));
  return { cups };
}

// → { others: 사용자 리그의 다른 경기 [{ fixture, result }], aiTransfers, newOffers }
export function playWeek(dataset, game, userResult) {
  const windowOpen = windowStatus(game).open; // 이번 라운드가 이적시장 기간인지 (진행 전 기준)
  const mine = userFixture(game);
  const others = completeRound(dataset, game, userResult);
  settleMoraleAfterMatch(game, mine?.id, userResult, mine?.homeId === game.teamId ? 'home' : 'away');
  applyWeekFinances(dataset, game);
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
    game.incomingOffers = [];
  }
  return { others, aiTransfers, newOffers, cups };
}

// 남은 시즌 자동 진행: 사용자 팀은 지금 선발(결장자 자동 대체), 받은 제안은 모두 거절
export function simulateRestOfSeason(dataset, game) {
  while (!isSeasonOver(game)) {
    const cup = userCupFixture(game);
    if (cup) {
      fixLineup(dataset, game, 'cup');
      playCupWeek(dataset, game, simulateMatch(cupMatchInput(dataset, game, cup)));
      continue;
    }
    fixLineup(dataset, game);
    const f = userFixture(game);
    playWeek(dataset, game, f ? simulateMatch(matchInput(dataset, game, f)) : null);
    game.incomingOffers = [];
  }
}
