// 재정: 잔고·주급 한도·시즌 장부 · 계약(재계약) · 리그 구단 재정 비교
import { overall } from '../../engine/ratings.js';
import { contractOf, renewalTerms, seasonsLeft, wageBill } from '../../market/finance.js';
import { formatWage, renewContract } from '../../market/market.js';
import { formatMoney, playerValue } from '../../market/value.js';
import { loanOf, squadOf } from '../../state/game.js';
import { loansOut } from '../../market/loans.js';
import { teamBadge } from '../badge.js';
import { openConfirm, panel, ratingBar } from '../components.js';
import { h } from '../dom.js';
import { attrClass } from '../format.js';
import { setDigits, showToast } from '../motion.js';
import { t } from '../../i18n.js';

// 장부 항목 (이름은 finance.ledger.{키})
const INCOME = ['tv', 'gate', 'commercial', 'prize', 'transfersOut'];
const EXPENSE = ['wages', 'transfersIn', 'compensation'];

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
  const income = INCOME.reduce((s, k) => s + (ledger[k] ?? 0), 0);
  const expense = EXPENSE.reduce((s, k) => s + (ledger[k] ?? 0), 0);
  const balance = h('span', { class: 't-digit-group' });
  setDigits(balance, formatMoney(game.budgets[game.teamId]));

  const usage = Math.min(100, (bill / f.wageBudget) * 100);
  const summary = h(
    'div',
    { class: 'tr-summary' },
    h('div', { class: 'tr-stat' }, h('span', { class: 'muted' }, t('finance.balance')), h('b', { class: 'num big' }, balance)),
    h('div', { class: 'tr-stat' }, h('span', { class: 'muted' }, t('finance.revenue')), h('b', { class: 'num' }, formatMoney(f.revenue))),
    h(
      'div',
      { class: 'tr-stat wage-stat' },
      h('span', { class: 'muted' }, t('finance.wageBill')),
      h('b', { class: 'num' }, `${formatWage(bill)} / ${formatWage(f.wageBudget)}`),
      h('span', { class: `bar wage-bar${usage > 95 ? ' full' : ''}` }, h('span', { class: 'bar-fill', style: { width: `${usage}%` } })),
    ),
    h('div', { class: 'tr-stat' }, h('span', { class: 'muted' }, t('finance.profit')), h('b', { class: `num ${income - expense >= 0 ? 'pos' : 'neg'}` }, `${income - expense >= 0 ? '+' : '−'}${formatMoney(Math.abs(income - expense))}`)),
  );

  const ledgerRows = (items, sign) =>
    items.map((k) => h('tr', {}, h('td', {}, t(`finance.ledger.${k}`)), h('td', { class: `num ${sign}` }, formatMoney(ledger[k] ?? 0))));
  const ledgerTable = h(
    'table',
    { class: 'data compact ledger' },
    h(
      'tbody',
      {},
      h('tr', { class: 'divider' }, h('td', { colspan: 2 }, t('finance.income'))),
      ledgerRows(INCOME, 'pos'),
      h('tr', { class: 'sum' }, h('td', {}, t('finance.incomeTotal')), h('td', { class: 'num pos' }, formatMoney(income))),
      h('tr', { class: 'divider' }, h('td', { colspan: 2 }, t('finance.expense'))),
      ledgerRows(EXPENSE, 'neg'),
      h('tr', { class: 'sum' }, h('td', {}, t('finance.expenseTotal')), h('td', { class: 'num neg' }, formatMoney(expense))),
    ),
  );

  // 계약: 주급 높은 순, 계약이 곧 끝나는 선수 강조. 임대 보낸 선수도 우리 계약이라 함께 (임대 온 선수는 원소속 계약)
  const lent = loansOut(game).map((l) => dataset.playerById.get(l.playerId)).filter(Boolean);
  const squad = [...squadOf(dataset, game, game.teamId), ...lent].sort((a, b) => contractOf(dataset, game, b.id).wage - contractOf(dataset, game, a.id).wage);
  const contracts = h(
    'div',
    { class: 'table-scroll' },
    h(
      'table',
      { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, t('finance.th.player')), h('th', {}, t('finance.th.pos')), h('th', { class: 'num' }, t('finance.th.age')), h('th', { class: 'num' }, 'OVR'), h('th', { class: 'num' }, t('finance.th.value')), h('th', { class: 'num' }, t('finance.th.wage')), h('th', { class: 'num' }, t('finance.th.left')), h('th', {}))),
      h(
        'tbody',
        {},
        squad.map((p) => {
          const c = contractOf(dataset, game, p.id);
          const left = seasonsLeft(game, c);
          const loan = loanOf(game, p.id);
          const borrowed = loan?.to === game.teamId;
          const renew = h('button', { class: 'btn small ghost', type: 'button' }, t('finance.renew'));
          renew.addEventListener('click', () => {
            const terms = renewalTerms(dataset, game, p.id);
            openConfirm({
              title: t('finance.renewTitle', { name: p.name }),
              body: t('finance.renewBody', { wage: formatWage(terms.wage), years: terms.years, current: formatWage(c.wage), left: t('finance.yearsLeft', { n: left }) }),
              confirmLabel: t('finance.renew'),
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
            h('td', {}, p.name, loan ? h('span', { class: 'loan-tag' }, borrowed ? t('finance.loanIn', { code: dataset.teamById.get(loan.from)?.code ?? '' }) : t('finance.loanOut', { code: dataset.teamById.get(loan.to)?.code ?? '' })) : null),
            h('td', {}, h('span', { class: 'pos-tag' }, p.position)),
            h('td', { class: 'num' }, p.age),
            h('td', { class: `num ${attrClass(overall(p))}` }, overall(p)),
            h('td', { class: 'num' }, formatMoney(playerValue(p))),
            // 임대 선수는 우리가 내는 몫 (빌렸으면 wageShare, 보냈으면 나머지)
            h('td', { class: 'num', title: loan ? t('finance.fullWage', { wage: formatWage(c.wage) }) : '' }, formatWage(loan ? Math.round(c.wage * (borrowed ? loan.wageShare : 1 - loan.wageShare)) : c.wage)),
            h('td', { class: 'num' }, borrowed ? h('span', { class: 'muted' }, t('finance.returns')) : left <= 1 ? h('span', { class: 'status-chip suspension' }, t('finance.years', { n: left })) : t('finance.years', { n: left })),
            h('td', { class: 'num' }, borrowed ? null : renew),
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
    h('thead', {}, h('tr', {}, h('th', {}, t('finance.th.club')), h('th', { class: 'num' }, t('finance.balance')), h('th', {}, t('finance.th.seasonRevenue')))),
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
    panel(t('finance.title'), summary),
    h(
      'div',
      { class: 'finance-grid' },
      h('div', { class: 'finance-left' }, panel(t('finance.ledgerTitle'), ledgerTable), panel(t('finance.peersTitle', { league: league.name }), peers)),
      panel(t('finance.contracts'), contracts, { actions: h('span', { class: 'muted' }, t('finance.count', { n: squad.length })) }),
    ),
  ];
}
