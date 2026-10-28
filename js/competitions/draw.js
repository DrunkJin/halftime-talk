// 대륙 대회 리그 페이즈 추첨과 매치데이 배정.
// 규칙: 전력순 4개 포트, 팀마다 포트별 2팀(홈 1·원정 1)과 경기, 같은 나라끼리는 안 붙고 같은 나라 상대는 최대 2팀.
import { CUP } from './config.js';

const shuffled = (list, rng) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// teams: [{ id, country, strength }] (36팀) → { pots: [[id]], fixtures: [{ md, homeId, awayId }] }
export function drawLeaguePhase(teams, rng) {
  const L = CUP.leaguePhase;
  const sorted = [...teams].sort((a, b) => b.strength - a.strength);
  const potSize = sorted.length / L.pots;
  if (!Number.isInteger(potSize) || potSize % 1 !== 0) throw new Error(`리그 페이즈 팀 수 ${sorted.length}: 포트 ${L.pots}개로 나눌 수 없음`);
  const country = new Map(teams.map((t) => [t.id, t.country]));
  const pots = makePots(sorted, potSize, country).map((pot) => pot.map((t) => t.id));

  for (let attempt = 0; attempt < L.drawAttempts; attempt++) {
    const edges = drawEdges(pots, country, rng);
    if (!edges) continue;
    const days = scheduleMatchdays(edges, teams.length, rng);
    if (!days) continue;
    return { pots, fixtures: days.flatMap((day, i) => day.map(([homeId, awayId]) => ({ md: i + 1, homeId, awayId }))) };
  }
  throw new Error('리그 페이즈 추첨 실패 (조건을 만족하는 대진을 찾지 못함)');
}

// 전력순으로 포트를 나누되, 한 포트에 같은 나라가 maxPerPot을 넘으면 그 나라의 가장 약한 팀을
// 다음 포트들에서 가장 강한 다른 나라 팀과 바꾼다 (같은 나라끼리 못 붙으니 한 나라가 몰리면 대진이 불가능)
function makePots(sorted, potSize, country) {
  const L = CUP.leaguePhase;
  const pots = Array.from({ length: L.pots }, (_, i) => sorted.slice(i * potSize, (i + 1) * potSize));
  const count = (pot, c) => pot.filter((t) => country.get(t.id) === c).length;
  for (let i = 0; i < pots.length - 1; i++) {
    for (let guard = 0; guard < 50; guard++) {
      const over = pots[i].map((t) => country.get(t.id)).find((c) => count(pots[i], c) > L.maxPerPot);
      if (!over) break;
      const out = [...pots[i]].reverse().find((t) => country.get(t.id) === over);
      let swapped = false;
      for (let j = i + 1; j < pots.length && !swapped; j++) {
        const inc = pots[j].find((t) => country.get(t.id) !== over && count(pots[i], country.get(t.id)) < L.maxPerPot);
        if (!inc) continue;
        pots[i][pots[i].indexOf(out)] = inc;
        pots[j][pots[j].indexOf(inc)] = out;
        swapped = true;
      }
      if (!swapped) break;
    }
  }
  return pots;
}

// 대진 (홈, 원정) 쌍 목록. 실패하면 null
export function drawEdges(pots, country, rng) {
  const L = CUP.leaguePhase;
  const opponents = new Map([...country.keys()].map((id) => [id, new Set()]));
  const countryCount = new Map([...country.keys()].map((id) => [id, new Map()]));
  const edges = [];
  const ok = (a, b) => {
    if (a === b || country.get(a) === country.get(b) || opponents.get(a).has(b)) return false;
    return (countryCount.get(a).get(country.get(b)) ?? 0) < L.maxSameCountry && (countryCount.get(b).get(country.get(a)) ?? 0) < L.maxSameCountry;
  };
  const link = (home, away, on) => {
    const d = on ? 1 : -1;
    for (const [x, y] of [[home, away], [away, home]]) {
      if (on) opponents.get(x).add(y);
      else opponents.get(x).delete(y);
      const c = countryCount.get(x);
      c.set(country.get(y), (c.get(country.get(y)) ?? 0) + d);
    }
  };

  // 포트 from의 팀마다 포트 to에서 상대 한 팀씩 (일대일). homeSide: from 팀이 홈인지
  function assign(from, to, homeSide, extra) {
    const order = shuffled(from, rng);
    const used = new Set();
    const picked = [];
    const step = (i) => {
      if (i === order.length) return true;
      const a = order[i];
      for (const b of shuffled(to, rng)) {
        if (used.has(b) || !ok(a, b) || !extra(a, b)) continue;
        const [home, away] = homeSide ? [a, b] : [b, a];
        used.add(b);
        link(home, away, true);
        picked.push([home, away]);
        if (step(i + 1)) return true;
        picked.pop();
        link(home, away, false);
        used.delete(b);
      }
      return false;
    };
    if (!step(0)) return null;
    return picked;
  }

  const pairs = [];
  for (let p = 0; p < pots.length; p++) for (let q = p; q < pots.length; q++) pairs.push([p, q]);
  for (const [p, q] of shuffled(pairs, rng)) {
    if (p === q) {
      // 같은 포트: 팀마다 홈 1·원정 1 → 포트 안에서 순환 (a 홈 vs D(a)), 자기 자신·맞교환 금지는 ok()가 막는다
      const got = assign(pots[p], pots[p], true, () => true);
      if (!got) return null;
      // 같은 포트에서는 각 팀이 원정도 정확히 한 번이어야 한다: assign이 to 쪽을 일대일로 고르므로 성립
      edges.push(...got);
    } else {
      const homes = assign(pots[p], pots[q], true, () => true);
      if (!homes) return null;
      edges.push(...homes);
      const aways = assign(pots[p], pots[q], false, () => true);
      if (!aways) return null;
      edges.push(...aways);
    }
  }
  return edges;
}

// 대진을 매치데이로 나눈다: 매치데이마다 모든 팀이 한 경기씩 (완전 매칭을 차례로 뽑는다). 실패하면 null
export function scheduleMatchdays(edges, teamCount, rng) {
  const L = CUP.leaguePhase;
  for (let attempt = 0; attempt < 30; attempt++) {
    let remaining = shuffled(edges, rng);
    const days = [];
    let failed = false;
    for (let d = 0; d < L.matches; d++) {
      const day = perfectMatching(remaining, teamCount);
      if (!day) {
        failed = true;
        break;
      }
      const taken = new Set(day);
      days.push(day);
      remaining = remaining.filter((e) => !taken.has(e));
    }
    if (!failed) return days;
  }
  return null;
}

function perfectMatching(edges, teamCount) {
  const byTeam = new Map();
  for (const e of edges) {
    for (const t of e) {
      if (!byTeam.has(t)) byTeam.set(t, []);
      byTeam.get(t).push(e);
    }
  }
  if (byTeam.size !== teamCount) return null;
  const matched = new Set();
  const chosen = [];
  let budget = 20000; // 탐색 한도 (넘으면 다른 순서로 다시)
  const step = () => {
    if (matched.size === teamCount) return true;
    if (--budget < 0) return false;
    // 남은 선택지가 가장 적은 팀부터
    let pick = null;
    let fewest = Infinity;
    for (const [t, list] of byTeam) {
      if (matched.has(t)) continue;
      const n = list.reduce((c, [a, b]) => c + (!matched.has(a) && !matched.has(b) ? 1 : 0), 0);
      if (n < fewest) [pick, fewest] = [t, n];
    }
    if (fewest === 0) return false;
    for (const e of byTeam.get(pick)) {
      const [a, b] = e;
      if (matched.has(a) || matched.has(b)) continue;
      matched.add(a);
      matched.add(b);
      chosen.push(e);
      if (step()) return true;
      chosen.pop();
      matched.delete(a);
      matched.delete(b);
    }
    return false;
  };
  return step() ? [...chosen] : null;
}
