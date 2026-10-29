// 대륙 대회(UCL·UEL): 리그 페이즈 순위표, 매치데이·단계별 결과, 토너먼트 대진, 득점 순위
import { CUP } from '../../competitions/config.js';
import { cupsOf, leaguePhaseTable, stageName, teamCupStatus, compName } from '../../competitions/cups.js';
import { currentTeamId } from '../../state/game.js';
import { teamBadge } from '../badge.js';
import { panel, segmented, tooltipGroup } from '../components.js';
import { h } from '../dom.js';
import { t } from '../../i18n.js';

let viewComp = null;
let view = 'table';
let viewRound = null; // 결과 탭에서 보고 있는 이벤트 key
let viewKey = null;

// 탭 라벨은 렌더 때 사전에서
const VIEWS = ['table', 'results', 'bracket', 'scorers'].map((id) => ({
  id,
  get label() {
    return t(`cups.view.${id}`);
  },
}));

const zoneOf = (pos) => (pos <= CUP.leaguePhase.direct ? 'zone-ucl' : pos <= CUP.leaguePhase.playoff ? 'zone-uel' : 'zone-rel');

function phaseTable(ctx, comp) {
  const { dataset, game } = ctx;
  const rows = leaguePhaseTable(comp);
  const th = (label, tip, cls = 'num') => h('th', { class: cls, 'data-tooltip': tip }, label);
  const table = h(
    'table',
    { class: 'data standings' },
    h('thead', {}, h('tr', {}, th('#', t('cups.tip.pos')), h('th', {}, t('cups.th.team')), th(t('cups.th.played'), t('cups.tip.played')), th(t('cups.th.won'), t('cups.tip.won')), th(t('cups.th.drawn'), t('cups.tip.drawn')), th(t('cups.th.lost'), t('cups.tip.lost')), th(t('cups.th.gd'), t('cups.tip.gd')), th(t('cups.th.pts'), t('cups.tip.pts')), th(t('cups.th.form'), t('cups.tip.form'), ''))),
    h(
      'tbody',
      {},
      rows.map((r) => {
        const team = dataset.teamById.get(r.teamId);
        return h(
          'tr',
          { class: `${zoneOf(r.position)}${r.teamId === game.teamId ? ' is-mine' : ''}` },
          h('td', { class: 'num pos' }, r.position),
          h('td', { class: 'team-cell' }, teamBadge(team, 18), h('span', {}, team.shortName), team.guest ? h('span', { class: 'guest-tag muted', title: t('cups.guestTip') }, team.country) : null),
          h('td', { class: 'num' }, r.played),
          h('td', { class: 'num' }, r.won),
          h('td', { class: 'num' }, r.drawn),
          h('td', { class: 'num' }, r.lost),
          h('td', { class: 'num' }, r.goalDifference > 0 ? `+${r.goalDifference}` : r.goalDifference),
          h('td', { class: 'num pts' }, r.points),
          h('td', {}, h('span', { class: 'form' }, r.form.map((o) => h('span', { class: `form-${o}` }, t(`cups.form.${o}`))))),
        );
      }),
    ),
  );
  const legend = h(
    'div',
    { class: 'legend muted' },
    h('span', { class: 'lg zone-ucl' }, t('cups.legend.direct', { to: CUP.leaguePhase.direct })),
    h('span', { class: 'lg zone-uel' }, t('cups.legend.playoff', { from: CUP.leaguePhase.direct + 1, to: CUP.leaguePhase.playoff })),
    h('span', { class: 'lg zone-rel' }, t('cups.legend.out')),
  );
  return h('div', {}, tooltipGroup('tt-block', h('div', { class: 'table-scroll' }, table)), legend);
}

function scoreText(f) {
  if (!f.result) return 'vs';
  const r = f.result;
  const extra = r.penalties ? t('cups.score.pens', { home: r.penalties.home, away: r.penalties.away }) : r.extraTime ? t('cups.score.aet') : '';
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
    { class: 'select', 'aria-label': t('cups.roundSelect') },
    events.map((e) =>
      h('option', { value: e.key, selected: e.key === viewRound || null }, t(e.done ? 'cups.event.done' : 'cups.event.upcoming', { name: e.stage === 'league' ? t('cups.event.md', { md: e.md }) : e.stage === 'final' ? stageName(e.stage) : t('cups.event.leg', { stage: stageName(e.stage), leg: e.leg }), round: e.afterRound })),
    ),
  );
  select.addEventListener('change', () => {
    viewRound = select.value;
    rerender();
  });
  const ev = events.find((e) => e.key === viewRound);
  const fixtures = ev ? comp.fixtures.filter((f) => (ev.stage === 'league' ? f.stage === 'league' && f.md === ev.md : f.stage === ev.stage && f.leg === ev.leg)) : [];
  return h('div', {}, h('div', { class: 'filter-bar' }, select), fixtures.length ? fixtureRows(ctx, fixtures) : h('p', { class: 'empty muted' }, t('cups.results.empty')));
}

function bracket(ctx, comp) {
  const { dataset, game } = ctx;
  const stages = ['playoff', 'r16', 'qf', 'sf', 'final'];
  if (!comp.ties.length) return h('p', { class: 'empty muted' }, t('cups.bracket.empty', { n: CUP.leaguePhase.matches }));
  return h(
    'div',
    { class: 'bracket' },
    stages.map((st) => {
      const ties = comp.ties.filter((tie) => tie.stage === st);
      if (!ties.length) return null;
      return h(
        'div',
        { class: 'bracket-col' },
        h('h3', {}, stageName(st)),
        ties.map((tie) => {
          const legs = tie.fixtureIds.map((id) => comp.fixtures.find((f) => f.id === id));
          // 합계: 대진 두 팀 기준
          const goals = (teamId) => legs.reduce((s, f) => s + (f.result ? (f.homeId === teamId ? f.result.score.home : f.result.score.away) : 0), 0);
          const played = legs.some((f) => f.result);
          const last = legs.at(-1).result;
          const row = (teamId) =>
            h(
              'div',
              { class: `tie-team${tie.winnerId === teamId ? ' won' : tie.winnerId ? ' lost' : ''}${teamId === game.teamId ? ' is-mine' : ''}` },
              teamBadge(dataset.teamById.get(teamId), 16),
              h('span', { class: 'tie-name' }, dataset.teamById.get(teamId).shortName),
              h('b', { class: 'num' }, played ? goals(teamId) : ''),
            );
          const note = last?.penalties ? t('cups.tie.pens', { home: last.penalties.home, away: last.penalties.away }) : last?.extraTime ? t('cups.tie.aet') : '';
          return h('div', { class: 'tie' }, row(tie.seedId), row(tie.otherId), note ? h('small', { class: 'muted' }, note) : null);
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
  if (!list.length) return h('p', { class: 'empty muted' }, t('cups.scorers.empty'));
  return h(
    'table',
    { class: 'data compact' },
    h('thead', {}, h('tr', {}, h('th', { class: 'num' }, '#'), h('th', {}, t('cups.th.player')), h('th', {}, t('cups.th.team')), h('th', { class: 'num' }, t('cups.th.goals')), h('th', { class: 'num' }, t('cups.th.assists')))),
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
  if (!cups) return panel(t('cups.title'), h('p', { class: 'empty muted' }, t('cups.none')));
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
      ? h('span', { class: 'muted' }, status.status === 'winner' ? t('cups.status.winner') : status.status === 'out' ? t('cups.status.out', { stage: stageName(status.stage) }) : t('cups.status.alive', { stage: stageName(status.stage) }))
      : null;
    const champion = comp.winnerId ? h('div', { class: 'cup-champion' }, teamBadge(dataset.teamById.get(comp.winnerId), 28), h('b', {}, t('cups.champion', { team: dataset.teamById.get(comp.winnerId).name }))) : null;
    host.replaceChildren(
      ...[h('div', { class: 'cups-head' }, compTabs.el, mine), champion].filter(Boolean),
      panel(`${compName(comp)} ${game.season}`, h('div', {}, h('div', { class: 'side-tabs' }, viewTabs.el), body)),
    );
  };
  fill();
  return host;
}
