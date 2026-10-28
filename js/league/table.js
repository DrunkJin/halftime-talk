// 순위표. 동률 기준은 league.json rules.tiebreakers 순서대로 적용한다.

function emptyRow(teamId) {
  return { teamId, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, goalDifference: 0, points: 0, form: [] };
}

// 두 팀 맞대결 승점 차 (a 기준)
function headToHead(a, b, fixtures, points) {
  let diff = 0;
  for (const f of fixtures) {
    if (!f.result) continue;
    const { home, away } = f.result.score;
    if (f.homeId === a && f.awayId === b) diff += home > away ? points.win : home < away ? -points.win : 0;
    if (f.homeId === b && f.awayId === a) diff += away > home ? points.win : away < home ? -points.win : 0;
  }
  return diff;
}

export function computeTable(teamIds, fixtures, rules) {
  const rows = new Map(teamIds.map((id) => [id, emptyRow(id)]));
  const played = fixtures.filter((f) => f.result).sort((x, y) => x.round - y.round);
  for (const f of played) {
    const { home: hg, away: ag } = f.result.score;
    const h = rows.get(f.homeId);
    const a = rows.get(f.awayId);
    for (const [row, gf, ga] of [[h, hg, ag], [a, ag, hg]]) {
      row.played++;
      row.goalsFor += gf;
      row.goalsAgainst += ga;
      const outcome = gf > ga ? 'W' : gf < ga ? 'L' : 'D';
      if (outcome === 'W') row.won++;
      else if (outcome === 'D') row.drawn++;
      else row.lost++;
      row.points += outcome === 'W' ? rules.points.win : outcome === 'D' ? rules.points.draw : rules.points.loss;
      row.form.push(outcome);
    }
  }

  const compare = (x, y) => {
    for (const key of rules.tiebreakers) {
      const d = key === 'headToHead' ? -headToHead(x.teamId, y.teamId, played, rules.points) : y[key] - x[key];
      if (d !== 0) return d;
    }
    return x.teamId.localeCompare(y.teamId);
  };

  return [...rows.values()]
    .map((r) => ({ ...r, goalDifference: r.goalsFor - r.goalsAgainst, form: r.form.slice(-5) }))
    .sort(compare)
    .map((r, i) => ({ ...r, position: i + 1 }));
}
