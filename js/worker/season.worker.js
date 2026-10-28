// 무거운 진행(모든 리그 라운드 진행, 시즌 끝까지 시뮬레이션)을 메인 스레드 밖에서 돌린다.
// 메시지: { id, type: 'completeRound' | 'cupWeek' | 'simulateRest', dataUrl, game, userResult? }
// 응답:   { id, ok, game, otherFixtureIds?, aiTransfers?, newOffers?, cups?, error? } — game은 진행이 반영된 새 사본
import { loadDataset } from '../data/loader.js';
import { playCupWeek, playWeek, simulateRestOfSeason } from '../state/season.js';

let datasetPromise = null;

self.onmessage = async ({ data }) => {
  const { id, type, dataUrl, game, userResult } = data;
  try {
    datasetPromise ??= loadDataset(dataUrl);
    const dataset = await datasetPromise;
    let week = null;
    if (type === 'completeRound') {
      week = playWeek(dataset, game, userResult);
    } else if (type === 'cupWeek') {
      week = playCupWeek(dataset, game, userResult);
    } else if (type === 'simulateRest') {
      simulateRestOfSeason(dataset, game);
    } else {
      throw new Error(`알 수 없는 작업: ${type}`);
    }
    self.postMessage({
      id,
      ok: true,
      game,
      otherFixtureIds: week?.others?.map((r) => r.fixture.id) ?? null,
      aiTransfers: week?.aiTransfers ?? [],
      newOffers: week?.newOffers ?? [],
      cups: week?.cups ?? [],
    });
  } catch (err) {
    datasetPromise = null;
    self.postMessage({ id, ok: false, error: String(err?.stack ?? err) });
  }
};
