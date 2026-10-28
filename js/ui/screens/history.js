// 기록: 시즌 결산(우리 팀 · 리그별 · 대륙 대회)과 커리어 종합표
import { stageName } from '../../competitions/cups.js';
import { formatMoney } from '../../market/value.js';
import { isSeasonOver } from '../../state/game.js';
import { careerTotals } from '../../state/history.js';
import { teamBadge } from '../badge.js';
import { panel, segmented } from '../components.js';
import { h } from '../dom.js';

let viewSeason = null;

const cupResultText = (cup) => {
  if (!cup) return '참가 안 함';
  if (cup.status === 'winner') return '우승';
  if (cup.status === 'out') return cup.stage === 'final' ? '준우승' : `${stageName(cup.stage)} 탈락`;
  return stageName(cup.stage);
};
const cupShort = (name) => name.replace(/^UEFA\s*/, '');
const badge = (ctx, id, size = 18) => (ctx.dataset.teamById.has(id) ? teamBadge(ctx.dataset.teamById.get(id), size) : null);
const scorerText = (s) => (s ? `${s.name} (${s.teamName}) ${s.goals}골` : '—');

function stat(label, value, sub) {
  return h('div', { class: 'tr-stat' }, h('span', { class: 'muted' }, label), h('b', {}, value), sub ? h('small', { class: 'muted' }, sub) : null);
}

// 한 시즌 결산
function seasonView(ctx, rec) {
  const m = rec.mine;
  const trophies = rec.trophies.length
    ? h('div', { class: 'trophy-row' }, rec.trophies.map((t) => h('span', { class: 'trophy' }, '🏆 ', t.name)))
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
        stat('리그', `${m.position}위`, `${rec.leagueName} · 승점 ${m.points}${m.promoted ? ' · 승격' : m.relegated ? ' · 강등' : ''}`),
        stat('리그 전적', `${m.won}승 ${m.drawn}무 ${m.lost}패`, `득 ${m.goalsFor} · 실 ${m.goalsAgainst}`),
        stat('대륙 대회', m.cup ? `${cupShort(m.cup.name)} ${cupResultText(m.cup)}` : '참가 안 함', m.cup ? `${m.cupRecord.won}승 ${m.cupRecord.drawn}무 ${m.cupRecord.lost}패` : null),
        stat('팀 득점왕', m.topScorer ? m.topScorer.name : '—', m.topScorer ? `${m.topScorer.goals}골 ${m.topScorer.assists}도움` : null),
        stat('시즌 재정', m.finance.balance != null ? formatMoney(m.finance.balance) : '—', `수입 ${formatMoney(m.finance.income)} · 지출 ${formatMoney(m.finance.expense)}`),
      ),
    ),
  );

  const leagues = panel(
    '리그별 결과',
    h(
      'div',
      { class: 'table-scroll' },
      h(
        'table',
        { class: 'data compact history-table' },
        h('thead', {}, h('tr', {}, h('th', {}, '리그'), h('th', {}, '우승'), h('th', {}, '준우승'), h('th', {}, '득점왕'), h('th', {}, '승격·강등'))),
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
                [l.promoted.length ? `승격 ${l.promoted.map((id) => ctx.dataset.teamById.get(id)?.shortName ?? id).join(', ')}` : '', l.relegated.length ? `강등 ${l.relegated.map((id) => ctx.dataset.teamById.get(id)?.shortName ?? id).join(', ')}` : '']
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
        '대륙 대회',
        h(
          'div',
          { class: 'table-scroll' },
          h(
            'table',
            { class: 'data compact history-table' },
            h('thead', {}, h('tr', {}, h('th', {}, '대회'), h('th', {}, '우승'), h('th', {}, '준우승'), h('th', {}, '4강'), h('th', {}, '득점왕'))),
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
  const t = careerTotals(history);
  const total = t.won + t.drawn + t.lost;
  const summary = h(
    'div',
    { class: 'tr-summary' },
    stat('시즌', `${t.seasons}시즌`),
    stat('통산 전적', `${t.won}승 ${t.drawn}무 ${t.lost}패`, total ? `승률 ${Math.round((t.won / total) * 100)}%` : null),
    stat('트로피', `${t.trophies.length}개`, t.trophies.map((x) => `${x.season} ${cupShort(x.name)}`).join(', ') || null),
    stat('최고 순위', t.bestFinish ? `${t.bestFinish.position}위` : '—', t.bestFinish ? `${t.bestFinish.season} ${t.bestFinish.leagueName}` : null),
  );
  const perSeason = h(
    'table',
    { class: 'data compact history-table' },
    h('thead', {}, h('tr', {}, h('th', {}, '시즌'), h('th', {}, '팀'), h('th', {}, '리그'), h('th', { class: 'num' }, '순위'), h('th', { class: 'num' }, '승점'), h('th', {}, '대륙 대회'), h('th', {}, '트로피'), h('th', {}, '팀 득점왕'))),
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
          h('td', { class: 'num pts' }, `${r.mine.position}위`),
          h('td', { class: 'num' }, r.mine.points),
          h('td', {}, r.mine.cup ? `${cupShort(r.mine.cup.name)} ${cupResultText(r.mine.cup)}` : '—'),
          h('td', {}, r.trophies.map((x) => cupShort(x.name)).join(', ') || '—'),
          h('td', {}, r.mine.topScorer ? `${r.mine.topScorer.name} ${r.mine.topScorer.goals}골` : '—'),
        ),
      ),
    ),
  );
  // 역대 우승: 우리 리그 + 대륙 대회
  const cupIds = [...new Set(history.flatMap((r) => r.cups.map((c) => c.id)))];
  const roll = h(
    'table',
    { class: 'data compact history-table' },
    h('thead', {}, h('tr', {}, h('th', {}, '시즌'), h('th', {}, '리그 우승'), ...cupIds.map((id) => h('th', {}, cupShort(history.flatMap((r) => r.cups).find((c) => c.id === id).name))))),
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
  return panel(
    finished ? '커리어 종합' : '커리어 (진행 중)',
    h('div', { class: 'career' }, summary, h('h3', {}, '시즌별 기록'), h('div', { class: 'table-scroll' }, perSeason), h('h3', {}, '역대 우승'), h('div', { class: 'table-scroll' }, roll)),
    { className: finished ? 'career-final' : '' },
  );
}

// 시즌이 끝났고 다음 시즌이 남아 있으면: 다음 시즌 준비(경기 탭)로 가는 길
function nextSeasonCta(ctx) {
  const { game } = ctx;
  if (!isSeasonOver(game) || game.seasonIndex >= game.years) return null;
  const go = h('button', { class: 'btn primary', type: 'button' }, '다음 시즌 준비');
  go.addEventListener('click', () => ctx.navigate('match'));
  return h('div', { class: 'next-cta' }, h('span', {}, `${game.seasonIndex}시즌이 끝났습니다. 재계약할 선수를 고르고 ${game.seasonIndex + 1}시즌을 시작하세요.`), go);
}

export function render(ctx) {
  const { game } = ctx;
  const history = game.history ?? [];
  if (!history.length) return panel('기록', h('p', { class: 'empty muted' }, '시즌이 끝나면 결산 기록이 여기에 쌓입니다.'));
  if (!history.some((r) => r.seasonIndex === viewSeason)) viewSeason = history.at(-1).seasonIndex;
  const finished = history.length >= game.years && history.at(-1).seasonIndex === game.seasonIndex;
  const host = h('div', { class: 'history-screen' });
  const fill = () => {
    const rec = history.find((r) => r.seasonIndex === viewSeason);
    const tabs = segmented(history.map((r) => ({ id: String(r.seasonIndex), label: `${r.seasonIndex}시즌 ${r.season}` })), String(viewSeason), (id) => {
      viewSeason = Number(id);
      fill();
    });
    host.replaceChildren(nextSeasonCta(ctx), careerView(ctx, history, finished), h('div', { class: 'cups-head' }, h('b', {}, '시즌 결산'), tabs.el), ...seasonView(ctx, rec));
  };
  fill();
  return host;
}
