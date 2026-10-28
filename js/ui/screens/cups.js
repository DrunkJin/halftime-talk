// 대륙 대회(UCL·UEL): 리그 페이즈 순위표, 매치데이·단계별 결과, 토너먼트 대진, 득점 순위
import { CUP } from '../../competitions/config.js';
import { cupsOf, leaguePhaseTable, stageName, teamCupStatus } from '../../competitions/cups.js';
import { currentTeamId } from '../../state/game.js';
import { teamBadge } from '../badge.js';
import { panel, segmented, tooltipGroup } from '../components.js';
import { h } from '../dom.js';

let viewComp = null;
let view = 'table';
let viewRound = null; // 결과 탭에서 보고 있는 이벤트 key
let viewKey = null;

const VIEWS = [
  { id: 'table', label: '리그 페이즈' },
  { id: 'results', label: '경기' },
  { id: 'bracket', label: '토너먼트' },
  { id: 'scorers', label: '득점' },
];

const zoneOf = (pos) => (pos <= CUP.leaguePhase.direct ? 'zone-ucl' : pos <= CUP.leaguePhase.playoff ? 'zone-uel' : 'zone-rel');

function phaseTable(ctx, comp) {
  const { dataset, game } = ctx;
  const rows = leaguePhaseTable(comp);
  const th = (label, tip, cls = 'num') => h('th', { class: cls, 'data-tooltip': tip }, label);
  const table = h(
    'table',
    { class: 'data standings' },
    h('thead', {}, h('tr', {}, th('#', '순위'), h('th', {}, '팀'), th('경기', '경기 수'), th('승', '승'), th('무', '무'), th('패', '패'), th('득실', '득실차'), th('승점', '승점'), th('최근', '최근 경기 (오른쪽이 최신)', ''))),
    h(
      'tbody',
      {},
      rows.map((r) => {
        const team = dataset.teamById.get(r.teamId);
        return h(
          'tr',
          { class: `${zoneOf(r.position)}${r.teamId === game.teamId ? ' is-mine' : ''}` },
          h('td', { class: 'num pos' }, r.position),
          h('td', { class: 'team-cell' }, teamBadge(team, 18), h('span', {}, team.shortName), team.guest ? h('span', { class: 'guest-tag muted', title: '리그가 없는 대륙 대회 전용 팀' }, team.country) : null),
          h('td', { class: 'num' }, r.played),
          h('td', { class: 'num' }, r.won),
          h('td', { class: 'num' }, r.drawn),
          h('td', { class: 'num' }, r.lost),
          h('td', { class: 'num' }, r.goalDifference > 0 ? `+${r.goalDifference}` : r.goalDifference),
          h('td', { class: 'num pts' }, r.points),
          h('td', {}, h('span', { class: 'form' }, r.form.map((o) => h('span', { class: `form-${o}` }, { W: '승', D: '무', L: '패' }[o])))),
        );
      }),
    ),
  );
  const legend = h(
    'div',
    { class: 'legend muted' },
    h('span', { class: 'lg zone-ucl' }, `1~${CUP.leaguePhase.direct}위 16강 직행`),
    h('span', { class: 'lg zone-uel' }, `${CUP.leaguePhase.direct + 1}~${CUP.leaguePhase.playoff}위 플레이오프`),
    h('span', { class: 'lg zone-rel' }, '탈락'),
  );
  return h('div', {}, tooltipGroup('tt-block', h('div', { class: 'table-scroll' }, table)), legend);
}

function scoreText(f) {
  if (!f.result) return 'vs';
  const r = f.result;
  const extra = r.penalties ? ` (PK ${r.penalties.home}-${r.penalties.away})` : r.extraTime ? ' (연장)' : '';
  return `${r.score.home} - ${r.score.away}${extra}`;
}

function fixtureRows(ctx, fixtures) {
  const { dataset, game } = ctx;
  return h(
    'table',
    { class: 'data compact fixtures' },
    h(
      'tbody',
      {},
      fixtures.map((f) => {
        const home = dataset.teamById.get(f.homeId);
        const away = dataset.teamById.get(f.awayId);
        const mine = f.homeId === game.teamId || f.awayId === game.teamId;
        return h(
          'tr',
          { class: mine ? 'is-mine' : '' },
          h('td', { class: 'fx-home' }, home.shortName, ' ', teamBadge(home, 16)),
          h('td', { class: 'fx-score num' }, scoreText(f)),
          h('td', { class: 'fx-away' }, teamBadge(away, 16), ' ', away.shortName),
        );
      }),
    ),
  );
}

function results(ctx, comp, rerender) {
  const cups = cupsOf(ctx.game);
  const events = cups.schedule.filter((e) => comp.fixtures.some((f) => (e.stage === 'league' ? f.stage === 'league' && f.md === e.md : f.stage === e.stage && f.leg === e.leg)));
  const lastDone = [...events].reverse().find((e) => e.done) ?? events[0];
  if (!events.some((e) => e.key === viewRound)) viewRound = lastDone?.key;
  const select = h(
    'select',
    { class: 'select', 'aria-label': '경기 회차' },
    events.map((e) =>
      h('option', { value: e.key, selected: e.key === viewRound || null }, `${e.stage === 'league' ? `리그 페이즈 ${e.md}차전` : `${stageName(e.stage)}${e.stage === 'final' ? '' : ` ${e.leg}차전`}`} · ${e.afterRound}라운드 뒤${e.done ? '' : ' (예정)'}`),
    ),
  );
  select.addEventListener('change', () => {
    viewRound = select.value;
    rerender();
  });
  const ev = events.find((e) => e.key === viewRound);
  const fixtures = ev ? comp.fixtures.filter((f) => (ev.stage === 'league' ? f.stage === 'league' && f.md === ev.md : f.stage === ev.stage && f.leg === ev.leg)) : [];
  return h('div', {}, h('div', { class: 'filter-bar' }, select), fixtures.length ? fixtureRows(ctx, fixtures) : h('p', { class: 'empty muted' }, '아직 대진이 정해지지 않았습니다.'));
}

function bracket(ctx, comp) {
  const { dataset, game } = ctx;
  const stages = ['playoff', 'r16', 'qf', 'sf', 'final'];
  if (!comp.ties.length) return h('p', { class: 'empty muted' }, `토너먼트 대진은 리그 페이즈 ${CUP.leaguePhase.matches}차전이 끝나면 정해집니다.`);
  return h(
    'div',
    { class: 'bracket' },
    stages.map((st) => {
      const ties = comp.ties.filter((t) => t.stage === st);
      if (!ties.length) return null;
      return h(
        'div',
        { class: 'bracket-col' },
        h('h3', {}, stageName(st)),
        ties.map((t) => {
          const legs = t.fixtureIds.map((id) => comp.fixtures.find((f) => f.id === id));
          // 합계: 대진 두 팀 기준
          const goals = (teamId) => legs.reduce((s, f) => s + (f.result ? (f.homeId === teamId ? f.result.score.home : f.result.score.away) : 0), 0);
          const played = legs.some((f) => f.result);
          const last = legs.at(-1).result;
          const row = (teamId) =>
            h(
              'div',
              { class: `tie-team${t.winnerId === teamId ? ' won' : t.winnerId ? ' lost' : ''}${teamId === game.teamId ? ' is-mine' : ''}` },
              teamBadge(dataset.teamById.get(teamId), 16),
              h('span', { class: 'tie-name' }, dataset.teamById.get(teamId).shortName),
              h('b', { class: 'num' }, played ? goals(teamId) : ''),
            );
          const note = last?.penalties ? `PK ${last.penalties.home}-${last.penalties.away}` : last?.extraTime ? '연장' : '';
          return h('div', { class: 'tie' }, row(t.seedId), row(t.otherId), note ? h('small', { class: 'muted' }, note) : null);
        }),
      );
    }),
  );
}

function scorers(ctx, comp) {
  const { dataset } = ctx;
  const list = Object.entries(comp.stats)
    .map(([id, s]) => ({ player: dataset.playerById.get(id), ...s }))
    .filter((x) => x.player && x.goals > 0)
    .sort((a, b) => b.goals - a.goals || b.assists - a.assists)
    .slice(0, 20);
  if (!list.length) return h('p', { class: 'empty muted' }, '아직 기록이 없습니다.');
  return h(
    'table',
    { class: 'data compact' },
    h('thead', {}, h('tr', {}, h('th', { class: 'num' }, '#'), h('th', {}, '선수'), h('th', {}, '팀'), h('th', { class: 'num' }, '골'), h('th', { class: 'num' }, '도움'))),
    h(
      'tbody',
      {},
      list.map((x, i) => {
        const team = dataset.teamById.get(currentTeamId(dataset, ctx.game, x.player.id) ?? x.player.teamId);
        return h('tr', {}, h('td', { class: 'num' }, i + 1), h('td', {}, x.player.name), h('td', { class: 'team-cell' }, teamBadge(team, 16), h('span', {}, team.code)), h('td', { class: 'num pts' }, x.goals), h('td', { class: 'num' }, x.assists));
      }),
    ),
  );
}

export function render(ctx) {
  const { dataset, game } = ctx;
  const host = h('div', { class: 'cups-screen' });
  const cups = cupsOf(game);
  if (!cups) return panel('대륙 대회', h('p', { class: 'empty muted' }, '이번 시즌에는 대륙 대회가 없습니다.'));
  const comps = Object.values(cups.comps);
  // 기본: 우리 팀이 나가는 대회 (다른 게임·새 시즌이면 다시 고른다)
  const key = `${game.seed}:${game.slot}:${game.seasonIndex}`;
  if (key !== viewKey) [viewKey, viewComp, viewRound] = [key, null, null];
  viewComp = cups.comps[viewComp] ? viewComp : (teamCupStatus(game, game.teamId)?.comp.id ?? comps[0].id);

  const fill = () => {
    const comp = cups.comps[viewComp];
    const body = h('div', {});
    const fillBody = () =>
      body.replaceChildren(view === 'table' ? phaseTable(ctx, comp) : view === 'results' ? results(ctx, comp, fillBody) : view === 'bracket' ? bracket(ctx, comp) : scorers(ctx, comp));
    fillBody();
    const compTabs = segmented(comps.map((c) => ({ id: c.id, label: c.name })), viewComp, (id) => {
      viewComp = id;
      fill();
    });
    const viewTabs = segmented(VIEWS, view, (id) => {
      view = id;
      fillBody();
    }, { size: 'small' });
    const status = teamCupStatus(game, game.teamId);
    const mine = status?.comp.id === comp.id
      ? h('span', { class: 'muted' }, status.status === 'winner' ? '우승!' : status.status === 'out' ? `${stageName(status.stage)}에서 탈락` : `${stageName(status.stage)} 진행 중`)
      : null;
    const champion = comp.winnerId ? h('div', { class: 'cup-champion' }, teamBadge(dataset.teamById.get(comp.winnerId), 28), h('b', {}, `${dataset.teamById.get(comp.winnerId).name} 우승`)) : null;
    host.replaceChildren(
      ...[h('div', { class: 'cups-head' }, compTabs.el, mine), champion].filter(Boolean),
      panel(`${comp.name} ${game.season}`, h('div', {}, h('div', { class: 'side-tabs' }, viewTabs.el), body)),
    );
  };
  fill();
  return host;
}
