// 재정: 잔고·주급 한도·시즌 장부 · 계약(재계약) · 리그 구단 재정 비교
import { overall } from '../../engine/ratings.js';
import { contractOf, renewalTerms, seasonsLeft, wageBill } from '../../market/finance.js';
import { formatWage, renewContract } from '../../market/market.js';
import { formatMoney, playerValue } from '../../market/value.js';
import { squadOf } from '../../state/game.js';
import { teamBadge } from '../badge.js';
import { openConfirm, panel, ratingBar } from '../components.js';
import { h } from '../dom.js';
import { attrClass } from '../format.js';
import { setDigits, showToast } from '../motion.js';

const INCOME = [
  ['tv', '중계권'],
  ['gate', '입장 수입'],
  ['commercial', '상업 수입'],
  ['prize', '시즌 상금'],
  ['transfersOut', '선수 판매'],
];
const EXPENSE = [
  ['wages', '주급'],
  ['transfersIn', '선수 영입'],
  ['compensation', '계약 해지 위약금'],
];

export function render(ctx) {
  const host = h('div', { class: 'finance-screen' });
  const fill = () => host.replaceChildren(...build(ctx, fill));
  fill();
  return host;
}

function build(ctx, refresh) {
  const { dataset, game } = ctx;
  const f = game.finances[game.teamId];
  const ledger = game.ledger;
  const bill = wageBill(dataset, game, game.teamId);
  const income = INCOME.reduce((s, [k]) => s + (ledger[k] ?? 0), 0);
  const expense = EXPENSE.reduce((s, [k]) => s + (ledger[k] ?? 0), 0);
  const balance = h('span', { class: 't-digit-group' });
  setDigits(balance, formatMoney(game.budgets[game.teamId]));

  const usage = Math.min(100, (bill / f.wageBudget) * 100);
  const summary = h(
    'div',
    { class: 'tr-summary' },
    h('div', { class: 'tr-stat' }, h('span', { class: 'muted' }, '잔고'), h('b', { class: 'num big' }, balance)),
    h('div', { class: 'tr-stat' }, h('span', { class: 'muted' }, '시즌 예상 수입'), h('b', { class: 'num' }, formatMoney(f.revenue))),
    h(
      'div',
      { class: 'tr-stat wage-stat' },
      h('span', { class: 'muted' }, '주급 총액 / 한도'),
      h('b', { class: 'num' }, `${formatWage(bill)} / ${formatWage(f.wageBudget)}`),
      h('span', { class: `bar wage-bar${usage > 95 ? ' full' : ''}` }, h('span', { class: 'bar-fill', style: { width: `${usage}%` } })),
    ),
    h('div', { class: 'tr-stat' }, h('span', { class: 'muted' }, '이번 시즌 손익'), h('b', { class: `num ${income - expense >= 0 ? 'pos' : 'neg'}` }, `${income - expense >= 0 ? '+' : '−'}${formatMoney(Math.abs(income - expense))}`)),
  );

  const ledgerRows = (items, sign) =>
    items.map(([k, label]) => h('tr', {}, h('td', {}, label), h('td', { class: `num ${sign}` }, formatMoney(ledger[k] ?? 0))));
  const ledgerTable = h(
    'table',
    { class: 'data compact ledger' },
    h(
      'tbody',
      {},
      h('tr', { class: 'divider' }, h('td', { colspan: 2 }, '수입')),
      ledgerRows(INCOME, 'pos'),
      h('tr', { class: 'sum' }, h('td', {}, '수입 합계'), h('td', { class: 'num pos' }, formatMoney(income))),
      h('tr', { class: 'divider' }, h('td', { colspan: 2 }, '지출')),
      ledgerRows(EXPENSE, 'neg'),
      h('tr', { class: 'sum' }, h('td', {}, '지출 합계'), h('td', { class: 'num neg' }, formatMoney(expense))),
    ),
  );

  // 계약: 주급 높은 순, 계약이 곧 끝나는 선수 강조
  const squad = squadOf(dataset, game, game.teamId).sort((a, b) => contractOf(dataset, game, b.id).wage - contractOf(dataset, game, a.id).wage);
  const contracts = h(
    'div',
    { class: 'table-scroll' },
    h(
      'table',
      { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, '선수'), h('th', {}, '포지션'), h('th', { class: 'num' }, '나이'), h('th', { class: 'num' }, 'OVR'), h('th', { class: 'num' }, '가치'), h('th', { class: 'num' }, '주급'), h('th', { class: 'num' }, '남은 계약'), h('th', {}))),
      h(
        'tbody',
        {},
        squad.map((p) => {
          const c = contractOf(dataset, game, p.id);
          const left = seasonsLeft(game, c);
          const renew = h('button', { class: 'btn small ghost', type: 'button' }, '재계약');
          renew.addEventListener('click', () => {
            const terms = renewalTerms(dataset, game, p.id);
            openConfirm({
              title: `${p.name} 재계약`,
              body: `선수 요구: ${formatWage(terms.wage)} · ${terms.years}년 (지금 ${formatWage(c.wage)}, ${left}년 남음)`,
              confirmLabel: '재계약',
              onConfirm: () => {
                const res = renewContract(dataset, game, p.id);
                showToast(res.message, { tone: res.ok ? 'goal' : 'warn' });
                if (res.ok) {
                  ctx.persist();
                  refresh();
                }
              },
            });
          });
          return h(
            'tr',
            { class: left <= 1 ? 'is-expiring' : '' },
            h('td', {}, p.name),
            h('td', {}, h('span', { class: 'pos-tag' }, p.position)),
            h('td', { class: 'num' }, p.age),
            h('td', { class: `num ${attrClass(overall(p))}` }, overall(p)),
            h('td', { class: 'num' }, formatMoney(playerValue(p))),
            h('td', { class: 'num' }, formatWage(c.wage)),
            h('td', { class: 'num' }, left <= 1 ? h('span', { class: 'status-chip suspension' }, `${left}년`) : `${left}년`),
            h('td', { class: 'num' }, renew),
          );
        }),
      ),
    ),
  );

  // 같은 리그 구단 재정
  const league = dataset.leagueById.get(game.leagueId);
  const maxRevenue = Math.max(...league.teamIds.map((id) => game.finances[id]?.revenue ?? 0));
  const peers = h(
    'table',
    { class: 'data compact' },
    h('thead', {}, h('tr', {}, h('th', {}, '구단'), h('th', { class: 'num' }, '잔고'), h('th', {}, '시즌 수입'))),
    h(
      'tbody',
      {},
      [...league.teamIds]
        .sort((a, b) => (game.finances[b]?.revenue ?? 0) - (game.finances[a]?.revenue ?? 0))
        .map((id) => {
          const team = dataset.teamById.get(id);
          const rev = game.finances[id]?.revenue ?? 0;
          return h(
            'tr',
            { class: id === game.teamId ? 'is-mine' : '' },
            h('td', { class: 'team-cell' }, teamBadge(team, 16), h('span', {}, team.shortName)),
            h('td', { class: 'num' }, formatMoney(game.budgets[id] ?? 0)),
            h('td', { class: 'rev-cell' }, ratingBar(rev, { min: 0, max: maxRevenue }), h('span', { class: 'num' }, formatMoney(rev))),
          );
        }),
    ),
  );

  return [
    panel('재정', summary),
    h(
      'div',
      { class: 'finance-grid' },
      h('div', { class: 'finance-left' }, panel('이번 시즌 장부', ledgerTable), panel(`${league.name} 구단 재정`, peers)),
      panel('계약', contracts, { actions: h('span', { class: 'muted' }, `${squad.length}명`) }),
    ),
  ];
}
