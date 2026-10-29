// 기록: 시즌 결산(우리 팀 · 리그별 · 대륙 대회)과 커리어 종합표
import { stageName, compName } from '../../competitions/cups.js';
import { formatMoney } from '../../market/value.js';
import { isSeasonOver } from '../../state/game.js';
import { careerTotals } from '../../state/history.js';
import { teamBadge } from '../badge.js';
import { panel, segmented } from '../components.js';
import { h } from '../dom.js';
import { t } from '../../i18n.js';

let viewSeason = null;

const cupResultText = (cup) => {
  if (!cup) return t('history.cup.none');
  if (cup.status === 'winner') return t('history.cup.winner');
  if (cup.status === 'out') return cup.stage === 'final' ? t('history.cup.runnerUp') : t('history.cup.out', { stage: stageName(cup.stage) });
  return stageName(cup.stage);
};
// 시즌 기록에는 저장할 때 언어의 대회 이름이 남아 있다 → 지금 언어 이름으로
let compByName = new Map();
const cupShort = (name) => (compByName.has(name) ? compName(compByName.get(name)) : name).replace(/^UEFA\s*/, '');
const badge = (ctx, id, size = 18) => (ctx.dataset.teamById.has(id) ? teamBadge(ctx.dataset.teamById.get(id), size) : null);
const scorerText = (s) => (s ? t('history.scorer', { name: s.name, team: s.teamName, n: s.goals }) : '—');

function stat(label, value, sub) {
  return h('div', { class: 'tr-stat' }, h('span', { class: 'muted' }, label), h('b', {}, value), sub ? h('small', { class: 'muted' }, sub) : null);
}

// 한 시즌 결산
function seasonView(ctx, rec) {
  const m = rec.mine;
  const trophies = rec.trophies.length
    ? h('div', { class: 'trophy-row' }, rec.trophies.map((x) => h('span', { class: 'trophy' }, x.name)))
    : null;
  const mine = panel(
    `${rec.season} · ${rec.teamName}`,
    h(
      'div',
      {},
      trophies,
      h(
        'div',
        { class: 'tr-summary' },
        stat(t('history.stat.league'), t('history.position', { n: m.position }), t(m.promoted ? 'history.leagueLine.promoted' : m.relegated ? 'history.leagueLine.relegated' : 'history.leagueLine', { league: rec.leagueName, pts: m.points })),
        stat(t('history.stat.record'), t('history.wdl', { w: m.won, d: m.drawn, l: m.lost }), t('history.goals', { gf: m.goalsFor, ga: m.goalsAgainst })),
        stat(t('history.stat.cup'), m.cup ? t('history.cupResult', { cup: cupShort(m.cup.name), result: cupResultText(m.cup) }) : t('history.cup.none'), m.cup ? t('history.wdl', { w: m.cupRecord.won, d: m.cupRecord.drawn, l: m.cupRecord.lost }) : null),
        stat(t('history.stat.topScorer'), m.topScorer ? m.topScorer.name : '—', m.topScorer ? t('history.goalsAssists', { g: m.topScorer.goals, a: m.topScorer.assists }) : null),
        stat(t('history.stat.finance'), m.finance.balance != null ? formatMoney(m.finance.balance) : '—', t('history.incomeExpense', { income: formatMoney(m.finance.income), expense: formatMoney(m.finance.expense) })),
      ),
    ),
  );

  const leagues = panel(
    t('history.leagues.title'),
    h(
      'div',
      { class: 'table-scroll' },
      h(
        'table',
        { class: 'data compact history-table' },
        h('thead', {}, h('tr', {}, h('th', {}, t('history.th.league')), h('th', {}, t('history.th.champion')), h('th', {}, t('history.th.runnerUp')), h('th', {}, t('history.th.topScorer')), h('th', {}, t('history.th.upDown')))),
        h(
          'tbody',
          {},
          rec.leagues.map((l) =>
            h(
              'tr',
              { class: l.id === rec.leagueId ? 'is-mine' : '' },
              h('td', {}, l.name),
              h('td', {}, h('span', { class: 'team-cell' }, badge(ctx, l.championId), h('b', {}, l.championName))),
              h('td', {}, h('span', { class: 'team-cell' }, badge(ctx, l.runnerUpId), h('span', {}, l.runnerUpName))),
              h('td', {}, scorerText(l.topScorer)),
              h(
                'td',
                { class: 'muted' },
                [l.promoted.length ? t('history.promotedList', { teams: l.promoted.map((id) => ctx.dataset.teamById.get(id)?.shortName ?? id).join(', ') }) : '', l.relegated.length ? t('history.relegatedList', { teams: l.relegated.map((id) => ctx.dataset.teamById.get(id)?.shortName ?? id).join(', ') }) : '']
                  .filter(Boolean)
                  .join(' · ') || '—',
              ),
            ),
          ),
        ),
      ),
    ),
  );

  const cups = rec.cups.length
    ? panel(
        t('history.cups.title'),
        h(
          'div',
          { class: 'table-scroll' },
          h(
            'table',
            { class: 'data compact history-table' },
            h('thead', {}, h('tr', {}, h('th', {}, t('history.th.comp')), h('th', {}, t('history.th.champion')), h('th', {}, t('history.th.runnerUp')), h('th', {}, t('history.th.semis')), h('th', {}, t('history.th.topScorer')))),
            h(
              'tbody',
              {},
              rec.cups.map((c) =>
                h(
                  'tr',
                  {},
                  h('td', {}, cupShort(c.name)),
                  h('td', {}, h('span', { class: 'team-cell' }, badge(ctx, c.winnerId), h('b', {}, c.winnerName ?? '—'))),
                  h('td', {}, h('span', { class: 'team-cell' }, badge(ctx, c.runnerUpId), h('span', {}, c.runnerUpName ?? '—'))),
                  h('td', { class: 'muted' }, c.semifinalists.map((s) => s.name).join(', ') || '—'),
                  h('td', {}, scorerText(c.topScorer)),
                ),
              ),
            ),
          ),
        ),
      )
    : null;
  return [mine, cups, leagues].filter(Boolean);
}

// 커리어 종합표: 시즌별 한 줄 + 합계 + 역대 우승팀
function careerView(ctx, history, finished) {
  const tot = careerTotals(history);
  const total = tot.won + tot.drawn + tot.lost;
  const summary = h(
    'div',
    { class: 'tr-summary' },
    stat(t('history.stat.seasons'), t('history.seasonCount', { n: tot.seasons })),
    stat(t('history.stat.overall'), t('history.wdl', { w: tot.won, d: tot.drawn, l: tot.lost }), total ? t('history.winRate', { pct: Math.round((tot.won / total) * 100) }) : null),
    stat(t('history.stat.trophies'), t('history.trophyCount', { n: tot.trophies.length }), tot.trophies.map((x) => `${x.season} ${cupShort(x.name)}`).join(', ') || null),
    stat(t('history.stat.best'), tot.bestFinish ? t('history.position', { n: tot.bestFinish.position }) : '—', tot.bestFinish ? `${tot.bestFinish.season} ${tot.bestFinish.leagueName}` : null),
  );
  const perSeason = h(
    'table',
    { class: 'data compact history-table' },
    h('thead', {}, h('tr', {}, h('th', {}, t('history.th.season')), h('th', {}, t('history.th.team')), h('th', {}, t('history.th.league')), h('th', { class: 'num' }, t('history.th.pos')), h('th', { class: 'num' }, t('history.th.pts')), h('th', {}, t('history.th.cup')), h('th', {}, t('history.th.trophies')), h('th', {}, t('history.th.teamTopScorer')))),
    h(
      'tbody',
      {},
      history.map((r) =>
        h(
          'tr',
          {},
          h('td', {}, r.season),
          h('td', {}, h('span', { class: 'team-cell' }, badge(ctx, r.teamId), h('span', {}, r.teamName))),
          h('td', {}, r.leagueName),
          h('td', { class: 'num pts' }, t('history.position', { n: r.mine.position })),
          h('td', { class: 'num' }, r.mine.points),
          h('td', {}, r.mine.cup ? t('history.cupResult', { cup: cupShort(r.mine.cup.name), result: cupResultText(r.mine.cup) }) : '—'),
          h('td', {}, r.trophies.map((x) => cupShort(x.name)).join(', ') || '—'),
          h('td', {}, r.mine.topScorer ? t('history.scorerShort', { name: r.mine.topScorer.name, n: r.mine.topScorer.goals }) : '—'),
        ),
      ),
    ),
  );
  // 역대 우승: 우리 리그 + 대륙 대회
  const cupIds = [...new Set(history.flatMap((r) => r.cups.map((c) => c.id)))];
  const roll = h(
    'table',
    { class: 'data compact history-table' },
    h('thead', {}, h('tr', {}, h('th', {}, t('history.th.season')), h('th', {}, t('history.th.leagueChampion')), ...cupIds.map((id) => h('th', {}, cupShort(history.flatMap((r) => r.cups).find((c) => c.id === id).name))))),
    h(
      'tbody',
      {},
      history.map((r) => {
        const myLeague = r.leagues.find((l) => l.id === r.leagueId);
        return h(
          'tr',
          {},
          h('td', {}, r.season),
          h('td', {}, h('span', { class: 'team-cell' }, badge(ctx, myLeague.championId), h('span', {}, `${myLeague.championName}`), h('small', { class: 'muted' }, ` ${r.leagueName}`))),
          ...cupIds.map((id) => {
            const c = r.cups.find((x) => x.id === id);
            return h('td', {}, h('span', { class: 'team-cell' }, c ? badge(ctx, c.winnerId) : null, h('span', {}, c?.winnerName ?? '—')));
          }),
        );
      }),
    ),
  );
  // 커리어 엔딩 화면 (끝났으면 주 버튼, 진행 중이면 지금까지 정리)
  const ending = h('button', { class: `btn small ${finished ? 'primary' : 'ghost'}`, type: 'button' }, finished ? t('history.ending.view') : t('history.ending.preview'));
  ending.addEventListener('click', () => ctx.navigate('career'));
  return panel(
    finished ? t('history.career.final') : t('history.career.ongoing'),
    h('div', { class: 'career' }, summary, h('h3', {}, t('history.career.perSeason')), h('div', { class: 'table-scroll' }, perSeason), h('h3', {}, t('history.career.roll')), h('div', { class: 'table-scroll' }, roll)),
    { className: finished ? 'career-final' : '', actions: ending },
  );
}

// 시즌이 끝났고 다음 시즌이 남아 있으면: 다음 시즌 준비(경기 탭)로 가는 길
function nextSeasonCta(ctx) {
  const { game } = ctx;
  if (!isSeasonOver(game) || game.seasonIndex >= game.years) return null;
  const go = h('button', { class: 'btn primary', type: 'button' }, t('history.next.button'));
  go.addEventListener('click', () => ctx.navigate('match'));
  return h('div', { class: 'next-cta' }, h('span', {}, t('history.next.body', { done: game.seasonIndex, next: game.seasonIndex + 1 })), go);
}

export function render(ctx) {
  compByName = new Map(ctx.dataset.competitions.flatMap((c) => [[c.nameKo, c], [c.nameEn, c]]));
  const { game } = ctx;
  const history = game.history ?? [];
  if (!history.length) return panel(t('history.title'), h('p', { class: 'empty muted' }, t('history.empty')));
  if (!history.some((r) => r.seasonIndex === viewSeason)) viewSeason = history.at(-1).seasonIndex;
  const finished = history.length >= game.years && history.at(-1).seasonIndex === game.seasonIndex;
  const host = h('div', { class: 'history-screen' });
  const fill = () => {
    const rec = history.find((r) => r.seasonIndex === viewSeason);
    const tabs = segmented(history.map((r) => ({ id: String(r.seasonIndex), label: t('history.seasonTab', { i: r.seasonIndex, year: r.season }) })), String(viewSeason), (id) => {
      viewSeason = Number(id);
      fill();
    });
    host.replaceChildren(...[nextSeasonCta(ctx), careerView(ctx, history, finished), h('div', { class: 'cups-head' }, h('b', {}, t('history.review')), tabs.el), ...seasonView(ctx, rec)].filter(Boolean));
  };
  fill();
  return host;
}
