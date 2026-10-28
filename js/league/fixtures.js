// 라운드 로빈 일정 생성 (circle method). rounds=2면 홈·원정을 바꿔 한 번 더.

export function generateFixtures(teamIds, rounds, rng) {
  // 시드로 팀 순서를 섞어 게임마다 일정이 달라지게
  const ids = [...teamIds];
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  if (ids.length % 2 === 1) ids.push(null); // 홀수 팀이면 휴식 슬롯

  const n = ids.length;
  const leg = [];
  let order = ids;
  for (let r = 0; r < n - 1; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) {
      const a = order[i];
      const b = order[n - 1 - i];
      if (!a || !b) continue;
      // 고정 팀(0번)은 라운드마다 홈·원정 교대, 나머지는 자리(i) 홀짝으로 고정.
      // 회전하면서 자리가 바뀌므로 대부분 팀이 홈·원정을 번갈아 치른다 (최대 연속 3경기)
      const aHome = i === 0 ? r % 2 === 0 : i % 2 === 1;
      pairs.push(aHome ? [a, b] : [b, a]);
    }
    leg.push(pairs);
    order = [order[0], order[n - 1], ...order.slice(1, n - 1)];
  }

  const fixtures = [];
  for (let l = 0; l < rounds; l++) {
    leg.forEach((pairs, r) => {
      const round = l * leg.length + r + 1;
      pairs.forEach(([home, away], k) => {
        const [h, a] = l % 2 === 0 ? [home, away] : [away, home];
        fixtures.push({ id: `r${round}-${k}`, round, homeId: h, awayId: a, result: null });
      });
    });
  }
  return fixtures;
}

export const roundCount = (fixtures) => fixtures.reduce((m, f) => Math.max(m, f.round), 0);
