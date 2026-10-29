// 일정: 우리 팀 시즌 전체 경기 (리그 라운드 + 주중 대륙 대회), 다음 5경기 난이도, 이적시장 기간
import { cupsOf, stageName, teamCupStatus } from '../../competitions/cups.js';
import { computeTable } from '../../league/table.js';
import { transferWindows } from '../../market/market.js';
import { topElevenOvr } from '../../market/value.js';
import { fixturesOf, isSeasonOver, leagueOf, squadOf } from '../../state/game.js';
import { teamBadge } from '../badge.js';
import { panel } from '../components.js';
import { h } from '../dom.js';

// 상대 전력: 주전 11명 평균 OVR 차이로 강·비슷·약
const DIFF = { hard: 3, easy: -3 };
const levelOf = (gap) => (gap >= DIFF.hard ? { id: 'hard', label: '강' } : gap <= DIFF.easy ? { id: 'easy', label: '약' } : { id: 'even', label: '비슷' });

// 우리 팀 경기를 시간순으로: [{ kind: 'league'|'cup', round, fixture, comp?, label }]
function buildSchedule(game) {
  const mine = (f) => f.homeId === game.teamId || f.awayId === game.teamId;
  const league = fixturesOf(game).filter(mine);
  const byRound = new Map(league.map((f) => [f.round, f]));
  const cups = cupsOf(game);
  const cupRows = [];
  for (const ev of cups?.schedule ?? []) {
    for (const comp of Object.values(cups.comps)) {
      for (const f of comp.fixtures) {
        const same = ev.stage === 'league' ? f.stage === 'league' && f.md === ev.md : f.stage === ev.stage && f.leg === ev.leg;
        if (same && mine(f)) cupRows.push({ kind: 'cup', round: ev.afterRound, fixture: f, comp, label: f.stage === 'league' ? `${comp.name} ${f.md}차전` : `${comp.name} ${stageName(f.stage)}${f.stage === 'final' ? '' : ` ${f.leg}차전`}` });
      }
    }
  }
  const rows = [];
  for (let r = 1; r <= game.totalRounds; r++) {
    rows.push(byRound.has(r) ? { kind: 'league', round: r, fixture: byRound.get(r), label: `${r}라운드` } : { kind: 'bye', round: r, label: `${r}라운드` });
    rows.push(...cupRows.filter((c) => c.round === r));
  }
  return rows;
}

export function render(ctx) {
  const { dataset, game } = ctx;
  const league = leagueOf(dataset, game);
  const table = computeTable(league.teamIds, fixturesOf(game), league.rules);
  // 시즌 초반(우리가 3경기 미만)은 순위 대신 전력 순위
  const earlyDays = (table.find((r) => r.teamId === game.teamId)?.played ?? 0) < 3;
  const posOf = new Map(table.map((r) => [r.teamId, r.position]));
  const strength = new Map();
  const ovrOf = (id) => {
    if (!strength.has(id)) strength.set(id, topElevenOvr(squadOf(dataset, game, id)));
    return strength.get(id);
  };
  const myOvr = ovrOf(game.teamId);
  const strengthRank = (id) => [...league.teamIds].sort((a, b) => ovrOf(b) - ovrOf(a)).indexOf(id) + 1;
  const rows = buildSchedule(game);
  const windows = transferWindows(game);
  const windowAt = (round) => windows.find((w) => round >= w.from && round <= w.to);
  const done = (row) => Boolean(row.fixture?.result);
  // 다음 경기: 아직 결과가 없는 첫 경기 (주중 경기는 그 라운드를 마친 뒤)
  const nextIndex = rows.findIndex((row) => row.kind !== 'bye' && !done(row));

  const opponentOf = (f) => (f.homeId === game.teamId ? f.awayId : f.homeId);
  const resultOf = (f) => {
    const home = f.homeId === game.teamId;
    const gf = home ? f.result.score.home : f.result.score.away;
    const ga = home ? f.result.score.away : f.result.score.home;
    return { gf, ga, outcome: gf > ga ? 'W' : gf < ga ? 'L' : 'D' };
  };
  const oppInfo = (row) => {
    const id = opponentOf(row.fixture);
    const team = dataset.teamById.get(id);
    const inLeague = posOf.has(id);
    const where = inLeague ? (earlyDays ? `전력 ${strengthRank(id)}위` : `${posOf.get(id)}위`) : dataset.leagueById.get(team?.leagueId)?.name ?? team?.country ?? '';
    return { id, team, where, level: levelOf(ovrOf(id) - myOvr) };
  };

  // ── 다음 5경기 ──
  const upcoming = rows.filter((row, i) => i >= nextIndex && nextIndex >= 0 && row.kind !== 'bye' && !done(row)).slice(0, 5);
  const hardCount = upcoming.filter((row) => oppInfo(row).level.id === 'hard').length;
  const next5 = upcoming.length
    ? panel(
        '다음 5경기',
        h(
          'div',
          { class: 'sch-next' },
          h(
            'ol',
            { class: 'sch-next-list' },
            upcoming.map((row) => {
              const o = oppInfo(row);
              const home = row.fixture.homeId === game.teamId;
              return h(
                'li',
                { class: `sch-next-item lv-${o.level.id}` },
                h('span', { class: 'sch-when muted' }, row.kind === 'cup' ? '주중' : row.label),
                teamBadge(o.team, 32),
                h('b', {}, o.team.shortName),
                h('span', { class: 'muted' }, `${home ? '홈' : '원정'} · ${o.where}`),
                h('span', { class: `sch-level lv-${o.level.id}` }, o.level.label),
              );
            }),
          ),
          h('p', { class: 'muted small-note' }, hardCount >= 3 ? `강팀 ${hardCount}경기가 몰려 있습니다. 로테이션과 훈련 강도(회복)를 미리 조절하세요.` : hardCount ? `강팀 ${hardCount}경기. 그 전 주에 '경기 준비' 훈련을 고려해 보세요.` : '비교적 수월한 일정입니다. 강도 높은 훈련으로 선수를 키울 기회입니다.'),
        ),
      )
    : null;

  // ── 시즌 전체 ──
  const body = rows.map((row, i) => {
    const win = windowAt(row.round);
    const winStart = row.kind !== 'cup' && win && win.from === row.round;
    const marker = winStart ? h('tr', { class: 'sch-window' }, h('td', { colspan: 6 }, `${win.name} (${win.from}~${win.to}라운드)`)) : null;
    if (row.kind === 'bye') return [marker, h('tr', { class: 'sch-bye' }, h('td', {}, row.label), h('td', { colspan: 5, class: 'muted' }, '경기 없음'))];
    const o = oppInfo(row);
    const home = row.fixture.homeId === game.teamId;
    const res = done(row) ? resultOf(row.fixture) : null;
    const isNext = i === nextIndex;
    return [
      marker,
      h(
        'tr',
        { class: `${row.kind === 'cup' ? 'sch-cup' : ''}${isNext ? ' is-next' : ''}${res ? ' is-done' : ''}` },
        h('td', { class: 'sch-round' }, row.kind === 'cup' ? h('span', { class: 'muted' }, '주중') : row.label),
        h('td', { class: 'sch-comp' }, row.kind === 'cup' ? row.label : league.name),
        h('td', { class: 'muted' }, home ? '홈' : '원정'),
        h('td', {}, h('span', { class: 'team-cell' }, teamBadge(o.team, 20), h('span', {}, o.team.shortName), h('span', { class: 'muted sch-where' }, o.where))),
        h('td', {}, h('span', { class: `sch-level lv-${o.level.id}` }, o.level.label)),
        h('td', { class: 'num' }, res ? h('span', { class: `sch-res r-${res.outcome}` }, `${res.outcome === 'W' ? '승' : res.outcome === 'D' ? '무' : '패'} ${res.gf}-${res.ga}`) : isNext ? h('b', { class: 'sch-next-tag' }, '다음 경기') : '—'),
      ),
    ];
  });
  const status = teamCupStatus(game, game.teamId);
  const cupNote = status?.status === 'alive' ? h('p', { class: 'muted small-note sch-note' }, `${status.comp.name}: 다음 단계 대진은 추첨이 끝나면 일정에 나타납니다.`) : null;
  const played = rows.filter(done).length;
  const total = rows.filter((r) => r.kind !== 'bye').length;
  const full = panel(
    `${league.name} ${game.season} · ${isSeasonOver(game) ? '시즌 종료' : `${played}/${total}경기`}`,
    h(
      'div',
      {},
      h('div', { class: 'table-scroll' }, h('table', { class: 'data compact sch-table' }, h('thead', {}, h('tr', {}, h('th', {}, '주차'), h('th', {}, '대회'), h('th', {}, '장소'), h('th', {}, '상대'), h('th', {}, '전력'), h('th', { class: 'num' }, '결과'))), h('tbody', {}, body))),
      cupNote,
      h('p', { class: 'muted small-note sch-note' }, `전력: 상대 주전 11명 평균이 우리보다 ${DIFF.hard} 이상 높으면 강, ${-DIFF.easy} 이상 낮으면 약.`),
    ),
  );

  return h('div', { class: 'schedule-screen' }, next5, full);
}
