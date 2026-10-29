// AI 자동 선발: 슬롯마다 (포지션 능력 × 적합도 × 컨디션 배율) 합이 최대가 되도록 11명을 고른다.
// squad에는 출전 가능한 선수만 넘길 것 (부상·출장정지 제외는 호출하는 쪽 책임)
import { resolveSlots } from './formations.js';
import { computeTeamRatings, overall, positionFit, positionRating } from './ratings.js';
import { tx } from './text.js';

// formation: 포메이션 ID 또는 슬롯 배열. factorOf(player): 컨디션 배율
export function autoSelectLineup(squad, formation, factorOf = () => 1) {
  const slots = resolveSlots(formation);
  if (squad.length < slots.length) throw new Error(tx('engine.error.squadTooSmall', { have: squad.length, need: slots.length }));
  const slotScore = (player, pos) => positionRating(player, pos) * positionFit(player, pos) * factorOf(player);

  // 1) 탐욕 배정: 후보가 적은 슬롯(GK 등)부터 가장 잘 맞는 선수를 넣는다
  const naturalCount = (pos) => squad.filter((p) => p.position === pos || p.altPositions.includes(pos)).length;
  const order = slots.map((_, i) => i).sort((a, b) => naturalCount(slots[a]) - naturalCount(slots[b]));
  const lineup = new Array(slots.length);
  const used = new Set();
  for (const i of order) {
    let best = null;
    for (const p of squad) {
      if (used.has(p.id)) continue;
      if (!best || slotScore(p, slots[i]) > slotScore(best, slots[i])) best = p;
    }
    lineup[i] = best;
    used.add(best.id);
  }

  // 2) 개선: 슬롯끼리 맞바꾸거나 벤치 선수로 교체해 합이 늘면 반영, 더 이상 안 늘 때까지
  for (let improved = true, guard = 0; improved && guard < 20; guard++) {
    improved = false;
    for (let i = 0; i < slots.length; i++) {
      for (let j = i + 1; j < slots.length; j++) {
        const before = slotScore(lineup[i], slots[i]) + slotScore(lineup[j], slots[j]);
        const after = slotScore(lineup[j], slots[i]) + slotScore(lineup[i], slots[j]);
        if (after > before + 1e-9) {
          [lineup[i], lineup[j]] = [lineup[j], lineup[i]];
          improved = true;
        }
      }
      for (const p of squad) {
        if (used.has(p.id)) continue;
        if (slotScore(p, slots[i]) > slotScore(lineup[i], slots[i]) + 1e-9) {
          used.delete(lineup[i].id);
          used.add(p.id);
          lineup[i] = p;
          improved = true;
        }
      }
    }
  }
  return lineup;
}

const GROUP = { GK: 'GK', CB: 'DEF', LB: 'DEF', RB: 'DEF', DM: 'MID', CM: 'MID', AM: 'MID', LW: 'FWD', RW: 'FWD', ST: 'FWD' };

// 교체 명단: GK 1명 + 수비·미드·공격 각 2명을 먼저 채우고 나머지는 능력순
export function autoSelectBench(squad, lineup, size, factorOf = () => 1) {
  const starters = new Set(lineup.filter(Boolean).map((p) => p.id));
  const pool = squad
    .filter((p) => !starters.has(p.id))
    .sort((a, b) => overall(b) * factorOf(b) - overall(a) * factorOf(a));
  const bench = [];
  const take = (p) => {
    bench.push(p);
    pool.splice(pool.indexOf(p), 1);
  };
  for (const [group, count] of [['GK', 1], ['DEF', 2], ['MID', 2], ['FWD', 2]]) {
    for (const p of pool.filter((x) => GROUP[x.position] === group).slice(0, count)) {
      if (bench.length < size) take(p);
    }
  }
  // 나머지는 능력순. GK는 이미 1명 있으면 더 넣지 않는다 (필드 선수가 부족할 때만)
  const hasGk = () => bench.some((p) => p.position === 'GK');
  for (const p of [...pool]) {
    if (bench.length >= size) break;
    if (p.position === 'GK' && hasGk()) continue;
    take(p);
  }
  while (bench.length < size && pool.length > 0) take(pool[0]);
  return bench;
}

// AI 포메이션: 후보마다 최적 선발을 짜 보고 팀 레이팅(공격·중원·수비 평균)이 가장 높은 것
export function bestFormation(squad, candidates, factorOf = () => 1) {
  let best = null;
  for (const formation of candidates) {
    const lineup = autoSelectLineup(squad, formation, factorOf);
    const r = computeTeamRatings(formation, lineup, factorOf);
    const score = (r.attack + r.midfield + r.defense) / 3;
    if (!best || score > best.score) best = { formation, lineup, score };
  }
  return best;
}
