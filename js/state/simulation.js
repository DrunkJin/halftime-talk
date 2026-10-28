// 라운드 진행을 Web Worker로 보낸다. Worker를 못 쓰는 환경이면 메인 스레드에서 같은 함수를 돌린다.
// 결과는 진행이 반영된 새 game 객체 — 호출한 쪽이 ctx.game을 바꿔 끼워야 한다.
import { playCupWeek, playWeek, simulateRestOfSeason } from './season.js';

let worker = null;
let workerBroken = false;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('../worker/season.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      if (data.ok) p.resolve(data);
      else p.reject(new Error(data.error));
    };
    worker.onerror = (e) => {
      console.warn('시뮬레이션 Worker 오류 — 메인 스레드로 전환', e.message);
      workerBroken = true;
      worker = null;
      for (const p of pending.values()) p.reject(new Error('worker-failed'));
      pending.clear();
    };
    return worker;
  } catch (err) {
    console.warn('Web Worker를 쓸 수 없어 메인 스레드에서 진행합니다', err);
    workerBroken = true;
    return null;
  }
}

function postToWorker(type, game, userResult) {
  const w = getWorker();
  if (!w) return Promise.reject(new Error('worker-failed'));
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, type, dataUrl: new URL('data/', document.baseURI).href, game, userResult });
  });
}

// 메인 스레드 대체 실행: 원본을 건드리지 않도록 사본에서
function runLocally(type, dataset, game, userResult) {
  const copy = structuredClone(game);
  if (type === 'simulateRest') {
    simulateRestOfSeason(dataset, copy);
    return { game: copy, otherFixtureIds: null, aiTransfers: [], newOffers: [], cups: [] };
  }
  if (type === 'cupWeek') {
    const week = playCupWeek(dataset, copy, userResult);
    return { game: copy, otherFixtureIds: null, aiTransfers: [], newOffers: [], cups: week.cups };
  }
  const week = playWeek(dataset, copy, userResult);
  return { game: copy, otherFixtureIds: week.others.map((r) => r.fixture.id), aiTransfers: week.aiTransfers, newOffers: week.newOffers, cups: week.cups };
}

async function run(type, dataset, game, userResult = null) {
  try {
    return await postToWorker(type, game, userResult);
  } catch (err) {
    if (err.message !== 'worker-failed') throw err;
    return runLocally(type, dataset, game, userResult);
  }
}

// → { game, otherFixtureIds, aiTransfers, newOffers, cups }
export const advanceRound = (dataset, game, userResult) => run('completeRound', dataset, game, userResult);
// 사용자 팀의 주중 대륙 대회 경기 결과 반영 → { game, cups }
export const advanceCup = (dataset, game, userResult) => run('cupWeek', dataset, game, userResult);
export const simulateRest = (dataset, game) => run('simulateRest', dataset, game);
