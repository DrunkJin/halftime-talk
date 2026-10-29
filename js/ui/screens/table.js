// 순위표 + 득점·도움 순위 + 라운드 결과
import { computeTable } from '../../league/table.js';
import { currentTeamId, fixturesOf, leagueTotalRounds } from '../../state/game.js';
import { teamBadge } from '../badge.js';
import { panel, segmented, tooltipGroup } from '../components.js';
import { h } from '../dom.js';
import { t } from '../../i18n.js';

// 탭 라벨은 렌더 때 사전에서
const SIDE_TABS = ['goals', 'assists', 'results'].map((id) => ({
  id,
  get label() {
    return t(`table.side.${id}`);
  },
}));
let sideTab = 'goals';
let viewLeagueId = null; // 보고 있는 리그 (기본: 내 리그)
let viewKey = null; // 다른 게임·새 시즌이면 내 리그로 되돌린다

// 순위 구간 표시 (EPL 기준: 1~4 챔피언스리그, 5 유로파, 18~20 강등)
function zoneOf(position, total) {
  if (position <= 4) return 'zone-ucl';
  if (position === 5) return 'zone-uel';
  if (position > total - 3) return 'zone-rel';
  return '';
}

// 승강 구간: 데이터의 promotion/relegation 정보로 (없으면 EPL식 표시만)
function zoneOf2(league, position, total) {
  if (league.promotion && position <= league.promotion.spots) return 'zone-ucl';
  if (league.relegation && position > total - league.relegation.spots) return 'zone-rel';
  if (league.level === 1) return zoneOf(position, total);
  return '';
}

function standings(ctx, league) {
  const { dataset, game } = ctx;
  const rows = computeTable(league.teamIds, fixturesOf(game, league.id), league.rules);
  const th = (label, tip, cls = 'num') => h('th', { class: cls, 'data-tooltip': tip }, label);
  const table = h(
    'table',
    { class: 'data standings' },
    h(
      'thead',
      {},
      h(
        'tr',
        {},
        th('#', t('table.tip.pos')),
        h('th', {}, t('table.th.team')),
        th(t('table.th.played'), t('table.tip.played')),
        th(t('table.th.won'), t('table.tip.won')),
        th(t('table.th.drawn'), t('table.tip.drawn')),
        th(t('table.th.lost'), t('table.tip.lost')),
        th(t('table.th.gf'), t('table.tip.gf')),
        th(t('table.th.ga'), t('table.tip.ga')),
        th(t('table.th.gd'), t('table.tip.gd')),
        th(t('table.th.pts'), t('table.tip.pts')),
        th(t('table.th.form'), t('table.tip.form'), ''),
      ),
    ),
    h(
      'tbody',
      {},
      rows.map((r) => {
        const team = dataset.teamById.get(r.teamId);
        return h(
          'tr',
          { class: `${zoneOf2(league, r.position, rows.length)}${r.teamId === game.teamId ? ' is-mine' : ''}` },
          h('td', { class: 'num pos' }, r.position),
          h('td', { class: 'team-cell' }, teamBadge(team, 18), h('span', {}, team.shortName)),
          h('td', { class: 'num' }, r.played),
          h('td', { class: 'num' }, r.won),
          h('td', { class: 'num' }, r.drawn),
          h('td', { class: 'num' }, r.lost),
          h('td', { class: 'num' }, r.goalsFor),
          h('td', { class: 'num' }, r.goalsAgainst),
          h('td', { class: 'num' }, r.goalDifference > 0 ? `+${r.goalDifference}` : r.goalDifference),
          h('td', { class: 'num pts' }, r.points),
          h('td', {}, h('span', { class: 'form' }, r.form.map((o) => h('span', { class: `form-${o}` }, t(`table.form.${o}`))))),
        );
      }),
    ),
  );
  return tooltipGroup('tt-block', h('div', { class: 'table-scroll' }, table));
}

function leaders(ctx, key, league) {
  const { dataset, game } = ctx;
  const inLeague = new Set(league.teamIds);
  const list = Object.entries(game.playerStats)
    .map(([id, s]) => ({ player: dataset.playerById.get(id), ...s }))
    .filter((x) => x.player && x[key] > 0 && inLeague.has(currentTeamId(dataset, game, x.player.id)))
    .sort((a, b) => b[key] - a[key] || b[key === 'goals' ? 'assists' : 'goals'] - a[key === 'goals' ? 'assists' : 'goals'])
    .slice(0, 15);
  if (list.length === 0) return h('p', { class: 'empty muted' }, t('table.leaders.empty'));
  return h(
    'table',
    { class: 'data compact' },
    h('thead', {}, h('tr', {}, h('th', { class: 'num' }, '#'), h('th', {}, t('table.th.player')), h('th', {}, t('table.th.team')), h('th', { class: 'num' }, key === 'goals' ? t('table.th.goals') : t('table.th.assists')))),
    h(
      'tbody',
      {},
      list.map((x, i) => {
        // 이적했으면 지금 소속으로 표시
        const teamId = currentTeamId(dataset, game, x.player.id);
        const team = teamId ? dataset.teamById.get(teamId) : null;
        return h(
          'tr',
          { class: teamId === game.teamId ? 'is-mine' : '' },
          h('td', { class: 'num muted' }, i + 1),
          h('td', {}, x.player.name),
          h('td', { class: 'team-cell' }, team ? [teamBadge(team, 16), h('span', {}, team.code)] : h('span', { class: 'muted' }, t('table.freeAgent'))),
          h('td', { class: 'num pts' }, x[key]),
        );
      }),
    ),
  );
}

function lastRound(ctx, league) {
  const { dataset, game } = ctx;
  const round = game.leagueRounds[league.id];
  const fixtures = fixturesOf(game, league.id).filter((f) => f.round === round && f.result);
  if (fixtures.length === 0) return h('p', { class: 'empty muted' }, t('table.results.empty'));
  return h(
    'div',
    {},
    h('p', { class: 'sub-head muted' }, t('table.results.round', { round })),
    h(
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
            h('td', { class: 'fx-score num' }, `${f.result.score.home} - ${f.result.score.away}`),
            h('td', { class: 'fx-away' }, teamBadge(away, 16), ' ', away.shortName),
          );
        }),
      ),
    ),
  );
}

export function render(ctx) {
  const { dataset, game } = ctx;
  const key = `${game.seed}:${game.slot}:${game.seasonIndex}`;
  if (key !== viewKey) [viewKey, viewLeagueId] = [key, null];
  viewLeagueId = viewLeagueId && dataset.leagueById.has(viewLeagueId) ? viewLeagueId : game.leagueId;
  const host = h('div', { class: 'table-screen' });

  const fill = () => {
    const league = dataset.leagueById.get(viewLeagueId);
    const sideBody = h('div', { class: 'side-body' });
    const fillSide = () => sideBody.replaceChildren(sideTab === 'results' ? lastRound(ctx, league) : leaders(ctx, sideTab, league));
    fillSide();
    const tabs = segmented(SIDE_TABS, sideTab, (id) => {
      sideTab = id;
      fillSide();
    }, { size: 'small' });

    // 리그 선택: 모든 리그가 함께 진행되므로 다른 리그 순위도 볼 수 있다
    const select = h(
      'select',
      { class: 'select', 'aria-label': t('table.leagueSelect') },
      dataset.leagues.map((l) => h('option', { value: l.id, selected: l.id === viewLeagueId || null }, l.id === game.leagueId ? t('table.myLeague', { name: l.name }) : l.name)),
    );
    select.addEventListener('change', () => {
      viewLeagueId = select.value;
      fill();
    });

    const legend = h(
      'div',
      { class: 'legend muted' },
      league.promotion ? h('span', { class: 'lg zone-ucl' }, t('table.legend.promotion')) : league.level === 1 ? h('span', { class: 'lg zone-ucl' }, t('table.legend.top')) : null,
      league.level === 1 && !league.relegation ? h('span', { class: 'lg zone-uel' }, t('table.legend.fifth')) : null,
      league.relegation || league.level === 1 ? h('span', { class: 'lg zone-rel' }, t('table.legend.relegation')) : null,
    );
    const done = game.leagueRounds[league.id];
    host.replaceChildren(
      panel(`${league.name} ${league.season}`, h('div', {}, standings(ctx, league), legend), {
        actions: h('div', { class: 'head-actions' }, select, h('span', { class: 'muted' }, t('table.roundsDone', { done, total: leagueTotalRounds(game, league.id) }))),
      }),
      panel(null, h('div', {}, h('div', { class: 'side-tabs' }, tabs.el), sideBody), { className: 'side-panel' }),
    );
  };
  fill();
  return host;
}
