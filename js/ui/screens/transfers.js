// 이적: 선수 찾기(영입 제안·임대) · 받은 제안 · 우리 선수(판매·임대 보내기·계약 해지, 임대 현황) · 이적 기록(우리 팀 / 전체 소식)
import { SCOUT, assignmentOf, isKnown, ovrView, scoutSlotsLeft, sendScout } from '../../state/scouting.js';
import { overall } from '../../engine/ratings.js';
import { contractOf, releaseCost, seasonsLeft, wageRoom } from '../../market/finance.js';
import { acceptSellOffer, askingPrice, formatWage, makeOffer, offerTerms, releasePlayer, respondIncomingOffer, sellOffers, signedThisWindow, windowStatus } from '../../market/market.js';
import { LOAN } from '../../market/config.js';
import { isLoanable, loanIn, loanInTerms, loanOut, loanOutBlock, loanOutOffers, loanStats, loansIn, loansOut } from '../../market/loans.js';
import { formatMoney, playerValue } from '../../market/value.js';
import { freeAgentOutlook, pendingFreeAgent } from '../../market/freeAgency.js';
import { availabilityOf, currentTeamId, loanOf, squadOf } from '../../state/game.js';
import { RULES } from '../../state/rules.js';
import { teamBadge } from '../badge.js';
import { openConfirm, openPlayerModal, panel, segmented, statusChip } from '../components.js';
import { h } from '../dom.js';
import { isMatchInProgress } from './match.js';
import { attrClass } from '../format.js';
import { openModal, setDigits, showToast } from '../motion.js';
import { t } from '../../i18n.js';

// 탭·포지션 묶음 이름은 그릴 때 사전에서 (transfers.tab.{id}, transfers.group.{id})
const TABS = ['search', 'incoming', 'mine', 'log'].map((id) => ({ id, get label() { return t(`transfers.tab.${id}`); } }));
const GROUPS = ['all', 'GK', 'DF', 'MF', 'FW'].map((id) => ({ id, get label() { return t(`transfers.group.${id}`); } }));
const GROUP_OF = { GK: 'GK', CB: 'DF', LB: 'DF', RB: 'DF', DM: 'MF', CM: 'MF', AM: 'MF', LW: 'FW', RW: 'FW', ST: 'FW' };
const RESULT_LIMIT = 80;
const pct = (v) => `${Math.round(v * 100)}%`;

// 화면을 떠났다 와도 필터 유지
const filters = { tab: 'search', group: 'all', league: 'all', query: '', affordable: true, freeOnly: false, loanOnly: false, logScope: 'mine' };

export function render(ctx) {
  const { dataset, game } = ctx;
  const host = h('div', { class: 'transfers-screen' });
  const budgetDigits = h('span', { class: 't-digit-group' });
  const body = h('div');

  const teamName = (id) => (id ? dataset.teamById.get(id).shortName : t('transfers.freeAgent'));
  const leagueName = (id) => (id ? dataset.leagueById.get(dataset.teamById.get(id).leagueId).name : '');
  const teamCell = (id) => (id ? h('span', { class: 'team-cell' }, teamBadge(dataset.teamById.get(id), 16), h('span', {}, dataset.teamById.get(id).code)) : h('span', { class: 'muted' }, t('transfers.free')));

  function summary() {
    const w = windowStatus(game);
    const size = squadOf(dataset, game, game.teamId).length;
    setDigits(budgetDigits, formatMoney(game.budgets[game.teamId]));
    return h(
      'div',
      { class: 'tr-summary' },
      h('div', { class: 'tr-stat' }, h('span', { class: 'muted' }, t('transfers.balance')), h('b', { class: 'num big' }, budgetDigits)),
      h('div', { class: 'tr-stat' }, h('span', { class: 'muted' }, t('transfers.wageRoomLabel')), h('b', { class: 'num' }, formatWage(Math.max(0, wageRoom(dataset, game, game.teamId))))),
      h(
        'div',
        { class: 'tr-stat' },
        h('span', { class: 'muted' }, t('transfers.window')),
        w.open
          ? h('b', { class: 'window-open' }, t('transfers.windowOpen', { name: w.name, round: w.closesAfter }))
          : h('b', { class: 'muted' }, w.next ? t('transfers.windowNext', { name: w.next.name, round: w.next.from }) : t('transfers.windowNone')),
      ),
      h('div', { class: 'tr-stat' }, h('span', { class: 'muted' }, t('transfers.squad')), h('b', { class: 'num' }, t('transfers.players', { n: size })), h('small', { class: 'muted' }, t('transfers.squadRange', { min: RULES.squadMin, max: RULES.squadMax }))),
      w.open
        ? null
        : h(
            'div',
            { class: 'window-closed' },
            h('b', {}, t('transfers.closedTitle')),
            t('transfers.closedBody'),
          ),
    );
  }

  // 스카우트 전이면 범위로 (목록과 같은 값, 실제 OVR이 새지 않게)
  const ovrLabel = (p) => {
    const v = ovrView(dataset, game, p);
    return v.known ? v.ovr : `${v.low}~${v.high}`;
  };

  // ── 영입 제안 모달 ──────────────────────────────────
  function offerModal(player) {
    const from = currentTeamId(dataset, game, player.id);
    const { asking, contract, wageOk } = offerTerms(dataset, game, player.id);
    // 무소속: 이적료 대신 선수에게 주는 계약금. 계약 만료 스타는 다른 구단과 경쟁 입찰
    const fa = from ? null : freeAgentOutlook(dataset, game, player.id);
    const start = fa ? (fa.userBid ?? fa.hint[0]) : asking;
    const input = h('input', { type: 'number', class: 'money-input', min: '0', step: '0.5', value: String(start), 'aria-label': from ? t('transfers.offer.amountAria') : t('transfers.offer.feeAria') });
    const terms = h(
      'div',
      { class: `contract-terms${wageOk ? '' : ' bad'}` },
      h('span', {}, t('transfers.offer.wants'), h('b', {}, formatWage(contract.wage)), t('transfers.offer.years', { n: contract.years })),
      h('span', { class: 'muted' }, `${t('transfers.offer.wageRoom', { wage: formatWage(Math.max(0, wageRoom(dataset, game, game.teamId))) })}${wageOk ? '' : t('transfers.offer.overLimit')}`),
    );
    const clubs = fa ? fa.clubs.map((id) => dataset.teamById.get(id).shortName).join(', ') : '';
    const message = h(
      'p',
      { class: 'offer-msg muted' },
      from
        ? t('transfers.offer.clubAsk', { asking: formatMoney(asking), value: formatMoney(playerValue(player)) })
        : fa
          ? `${t('transfers.offer.contested', { clubs, round: fa.decideRound, low: formatMoney(fa.hint[0]), high: formatMoney(fa.hint[1]) })}${fa.userBid != null ? t('transfers.offer.ourBid', { bid: formatMoney(fa.userBid) }) : ''}`
          : t('transfers.offer.freeAsk', { asking: formatMoney(asking) }),
    );
    const submit = h('button', { class: 'btn primary', type: 'button' }, from ? t('transfers.offer.submit') : fa ? (fa.userBid != null ? t('transfers.offer.reviseBid') : t('transfers.offer.placeBid')) : t('transfers.offer.sign'));
    const cancel = h('button', { class: 'btn ghost', type: 'button' }, t('components.close'));
    const close = openModal(
      h(
        'div',
        { class: 'confirm-modal' },
        h('h2', {}, t(from ? 'transfers.offer.titleBid' : fa ? 'transfers.offer.titleContest' : 'transfers.offer.titleFree', { name: player.name })),
        h('p', { class: 'muted' }, `${teamName(from)}${from ? ` (${leagueName(from)})` : ''} · ${player.position} · ${t('transfers.age', { age: player.age })} · OVR ${ovrLabel(player)}`),
        h('label', { class: 'money-field' }, h('span', {}, '£'), input, h('span', {}, 'M')),
        terms,
        message,
        h('div', { class: 'confirm-actions' }, cancel, submit),
      ),
    );
    cancel.addEventListener('click', close);
    submit.addEventListener('click', () => {
      const amount = Math.round(Number(input.value) * 10) / 10;
      const res = makeOffer(dataset, game, player.id, amount);
      message.textContent = res.message;
      message.className = `offer-msg ${res.accepted || res.bid ? 'ok' : 'bad'}`;
      if (res.accepted || res.bid) {
        ctx.persist();
        ctx.refreshTopbar();
        showToast(res.message, { tone: 'goal' });
        close();
        fill();
      }
    });
    input.focus();
    input.select();
  }

  // ── 임대 영입 모달 ──────────────────────────────────
  function loanInModal(player) {
    const from = currentTeamId(dataset, game, player.id);
    const lt = loanInTerms(dataset, game, player);
    const intent = player.age <= LOAN.youngAge ? 'transfers.loanIn.intentYoung' : 'transfers.loanIn.intentWage';
    const message = h('p', { class: `offer-msg ${lt.ok ? 'muted' : 'bad'}` }, lt.ok ? t(intent, { team: teamName(from) }) : lt.reason);
    // 능력치를 모르는 선수는 우리 팀에서의 역할도 짐작할 수 없다
    const role = isKnown(dataset, game, player, from) ? lt.role : t('transfers.loanIn.roleUnknown');
    const submit = h('button', { class: 'btn primary', type: 'button', disabled: lt.ok ? null : true }, t('transfers.loanIn.submit'));
    const cancel = h('button', { class: 'btn ghost', type: 'button' }, t('components.close'));
    const close = openModal(
      h(
        'div',
        { class: 'confirm-modal' },
        h('h2', {}, t('transfers.loanIn.title', { name: player.name })),
        h('p', { class: 'muted' }, `${teamName(from)} (${leagueName(from)}) · ${player.position} · ${t('transfers.age', { age: player.age })}`),
        h(
          'dl',
          { class: 'loan-terms' },
          h('dt', {}, t('transfers.loanIn.duration')), h('dd', {}, t('transfers.loanIn.untilEnd')),
          h('dt', {}, t('transfers.loanIn.fee')), h('dd', { class: 'num' }, lt.fee > 0 ? formatMoney(lt.fee) : t('transfers.none')),
          h('dt', {}, t('transfers.loanIn.wageShare')), h('dd', { class: 'num' }, `${pct(lt.wageShare)} · ${formatWage(Math.round(lt.wage * lt.wageShare))}`, h('small', { class: 'muted' }, t('transfers.loanIn.fullWage', { wage: formatWage(lt.wage) }))),
          h('dt', {}, t('transfers.loanIn.role')), h('dd', {}, role),
        ),
        message,
        h('div', { class: 'confirm-actions' }, cancel, submit),
      ),
    );
    cancel.addEventListener('click', close);
    submit.addEventListener('click', () => {
      const res = loanIn(dataset, game, player.id);
      if (!res.ok) {
        message.textContent = res.message;
        message.className = 'offer-msg bad';
        return;
      }
      ctx.persist();
      ctx.refreshTopbar();
      showToast(res.message, { tone: 'goal' });
      close();
      fill();
    });
  }

  // ── 임대 보내기 모달 ────────────────────────────────
  function loanOutModal(player) {
    const block = loanOutBlock(dataset, game, player);
    const offers = block ? [] : loanOutOffers(dataset, game, player.id);
    const cancel = h('button', { class: 'btn ghost', type: 'button' }, t('components.close'));
    let close = null;
    const list = offers.length
      ? h(
          'table',
          { class: 'data compact' },
          h('thead', {}, h('tr', {}, h('th', {}, t('transfers.th.club')), h('th', {}, t('transfers.th.league')), h('th', {}, t('transfers.th.role')), h('th', { class: 'num' }, t('transfers.th.wageShare')), h('th', {}))),
          h(
            'tbody',
            {},
            offers.map((o) => {
              const accept = h('button', { class: 'btn small primary', type: 'button' }, t('transfers.loanOut.send'));
              accept.addEventListener('click', () => {
                const res = loanOut(dataset, game, player.id, o);
                showToast(res.message, { tone: res.ok ? '' : 'warn' });
                if (res.ok) {
                  ctx.persist();
                  ctx.refreshTopbar();
                  close();
                  fill();
                }
              });
              return h('tr', {}, h('td', {}, teamCell(o.teamId), ' ', teamName(o.teamId)), h('td', { class: 'muted' }, leagueName(o.teamId)), h('td', {}, o.role), h('td', { class: 'num' }, pct(o.wageShare)), h('td', { class: 'num' }, accept));
            }),
          ),
        )
      : h('p', { class: 'empty muted' }, block ?? t('transfers.loanOut.noClub'));
    close = openModal(
      h(
        'div',
        { class: 'confirm-modal' },
        h('h2', {}, t('transfers.loanOut.title', { name: player.name })),
        h('p', { class: 'muted' }, t('transfers.loanOut.note')),
        list,
        h('div', { class: 'confirm-actions' }, cancel),
      ),
    );
    cancel.addEventListener('click', close);
  }

  // ── 판매 모달 ───────────────────────────────────────
  function sellModal(player) {
    const offers = sellOffers(dataset, game, player.id);
    const cancel = h('button', { class: 'btn ghost', type: 'button' }, t('components.close'));
    let close = null;
    const list = offers.length
      ? h(
          'table',
          { class: 'data compact' },
          h(
            'tbody',
            {},
            offers.map((o) => {
              const accept = h('button', { class: 'btn small primary', type: 'button' }, t('transfers.accept'));
              accept.addEventListener('click', () => {
                const res = acceptSellOffer(dataset, game, player.id, o);
                showToast(res.message, { tone: res.ok ? 'goal' : 'warn' });
                if (res.ok) {
                  ctx.persist();
                  ctx.refreshTopbar();
                  close();
                  fill();
                }
              });
              return h('tr', {}, h('td', {}, teamCell(o.teamId)), h('td', {}, teamName(o.teamId)), h('td', { class: 'num pts' }, formatMoney(o.amount)), h('td', { class: 'num' }, accept));
            }),
          ),
        )
      : h('p', { class: 'empty muted' }, signedThisWindow(game, player.id) ? t('transfers.sell.justSigned') : t('transfers.sell.noInterest'));
    close = openModal(
      h(
        'div',
        { class: 'confirm-modal' },
        h('h2', {}, t('transfers.sell.title', { name: player.name })),
        h('p', { class: 'muted' }, t('transfers.sell.note', { value: formatMoney(playerValue(player)) })),
        list,
        h('div', { class: 'confirm-actions' }, cancel),
      ),
    );
    cancel.addEventListener('click', close);
  }

  // ── 탭 본문 ─────────────────────────────────────────
  function searchTab() {
    const open = windowStatus(game).open;
    const budget = game.budgets[game.teamId];
    // 이름 검색은 입력할 때마다 renderRows에서 거른다
    const rows = dataset.players
      .map((p) => ({ p, teamId: currentTeamId(dataset, game, p.id) }))
      .filter(({ p, teamId }) => teamId !== game.teamId && !dataset.isGuest(teamId) && !loanOf(game, p.id))
      .filter(({ teamId }) => filters.league === 'all' || (teamId && dataset.teamById.get(teamId).leagueId === filters.league))
      .filter(({ p }) => filters.group === 'all' || GROUP_OF[p.position] === filters.group)
      .filter(({ teamId }) => !filters.freeOnly || teamId === null)
      .filter(({ p, teamId }) => !filters.loanOnly || isLoanable(dataset, game, p, teamId))
      .map((r) => {
        const view = ovrView(dataset, game, r.p);
        // 모르는 선수는 보이는 범위의 가운데로 정렬 (실제 값이 새어 나가지 않게)
        return { ...r, view, ovr: view.known ? view.ovr : (view.low + view.high) / 2, asking: askingPrice(dataset, game, r.p) };
      })
      .filter((r) => !filters.affordable || r.asking <= budget)
      .sort((a, b) => b.ovr - a.ovr || a.asking - b.asking);

    const search = h('input', { type: 'search', class: 'search', placeholder: t('transfers.search.placeholder'), value: filters.query, 'aria-label': t('transfers.search.aria') });
    search.addEventListener('input', () => {
      filters.query = search.value;
      renderRows();
    });
    const check = (key, label) => {
      const box = h('input', { type: 'checkbox', checked: filters[key] || null });
      box.addEventListener('change', () => {
        filters[key] = box.checked;
        fill();
      });
      return h('label', { class: 'check' }, box, label);
    };
    const groups = segmented(GROUPS, filters.group, (id) => {
      filters.group = id;
      fill();
    }, { size: 'small' });
    // 리그 필터: 모든 리그 선수가 매물
    const leagueSelect = h(
      'select',
      { class: 'select', 'aria-label': t('transfers.th.league') },
      h('option', { value: 'all' }, t('transfers.search.allLeagues')),
      dataset.leagues.map((l) => h('option', { value: l.id, selected: filters.league === l.id || null }, l.name)),
    );
    leagueSelect.addEventListener('change', () => {
      filters.league = leagueSelect.value;
      fill();
    });

    // 스카우트 파견 버튼 (모르는 선수만)
    const scoutButton = (p) => {
      const a = assignmentOf(game, p.id);
      const b = h('button', { class: 'btn small ghost', type: 'button', disabled: a || scoutSlotsLeft(game) <= 0 || null, title: a ? '' : scoutSlotsLeft(game) <= 0 ? t('transfers.scout.max', { n: SCOUT.slots }) : '' }, a ? t('transfers.scout.watching', { n: Math.max(0, a.readyRound - game.round) }) : t('transfers.scout.button'));
      b.addEventListener('click', () => {
        const r = sendScout(dataset, game, p);
        if (!r.ok) return;
        ctx.persist();
        showToast(t('components.scout.sent', { name: p.name, n: r.rounds }));
        fill();
      });
      return b;
    };
    const scoutNote = h('span', { class: 'muted small-note' }, t('transfers.scout.note', { used: SCOUT.slots - scoutSlotsLeft(game), slots: SCOUT.slots }));

    const tbody = h('tbody');
    function renderRows() {
      const qq = filters.query.trim().toLowerCase();
      const shown = rows.filter(({ p }) => !qq || p.name.toLowerCase().includes(qq)).slice(0, RESULT_LIMIT);
      tbody.replaceChildren(
        ...shown.map(({ p, teamId, view, asking }) => {
          const contested = !teamId && pendingFreeAgent(game, p.id);
          const terms = offerTerms(dataset, game, p.id);
          const offer = h('button', { class: 'btn small', type: 'button', disabled: open ? null : true, title: open ? '' : t('transfers.windowClosed') }, teamId ? t('transfers.row.bid') : contested ? (contested.user ? t('transfers.row.bidding') : t('transfers.row.placeBid')) : t('transfers.row.sign'));
          offer.addEventListener('click', () => offerModal(p));
          // 임대: 원소속이 내줄 만한 선수만 버튼을 보인다
          let loan = null;
          if (teamId && isLoanable(dataset, game, p, teamId)) {
            // 조건이 안 맞으면(주급 한도 등) 흐리게 — 눌러서 이유와 조건은 볼 수 있다
            const lt = open ? loanInTerms(dataset, game, p) : null;
            loan = h('button', { class: `btn small ghost${lt && !lt.ok ? ' is-blocked' : ''}`, type: 'button', disabled: open ? null : true, title: !open ? t('transfers.windowClosed') : lt.ok ? t('transfers.row.loanTitle') : lt.reason }, t('transfers.loan'));
            loan.addEventListener('click', () => loanInModal(p));
          }
          const name = h('button', { class: 'link', type: 'button' }, p.name);
          name.addEventListener('click', () => openPlayerModal(dataset, p, ctx));
          return h(
            'tr',
            { class: asking > budget ? 'is-dim' : '' },
            h('td', {}, name),
            h('td', {}, teamCell(teamId)),
            h('td', {}, h('span', { class: 'pos-tag' }, p.position)),
            h('td', { class: 'num' }, p.age),
            h('td', { class: `num ovr ${view.known ? attrClass(view.ovr) : 'ovr-range'}`, title: view.known ? '' : t('transfers.row.scoutToSee') }, view.known ? view.ovr : `${view.low}~${view.high}`),
            h('td', { class: 'num' }, formatMoney(playerValue(p))),
            h(
              'td',
              { class: `num${asking > budget ? ' over-budget' : ''}`, title: teamId ? '' : t('transfers.row.feeTitle') },
              teamId ? formatMoney(asking) : contested ? t('transfers.row.contested') : t('transfers.row.signOn', { fee: formatMoney(asking) }),
              // 영입하면 줘야 할 주급 (제안 창을 열기 전에도 보이게). 주급 한도를 넘으면 빨강
              h('small', { class: `ask-wage${terms.wageOk ? '' : ' over-budget'}` }, t('transfers.row.wage', { wage: formatWage(terms.contract.wage) })),
            ),
            h('td', {}, statusChip(game, p.id)),
            h('td', { class: 'num row-actions' }, view.known ? null : scoutButton(p), loan, offer),
          );
        }),
      );
    }
    renderRows();

    return h(
      'div',
      {},
      h('div', { class: 'filter-bar' }, leagueSelect, groups.el, search, check('affordable', t('transfers.search.affordable')), check('freeOnly', t('transfers.search.freeOnly')), check('loanOnly', t('transfers.search.loanOnly')), h('span', { class: 'muted' }, t('transfers.search.count', { total: rows.length, shown: Math.min(RESULT_LIMIT, rows.length) })), filters.affordable ? null : h('span', { class: 'legend-over' }, t('transfers.legend.overBudget'))), // 예산 안만 보면 빨간 금액이 없다
      h('div', { class: 'scout-note' }, scoutNote),
      h(
        'div',
        { class: 'table-scroll' },
        h(
          'table',
          { class: 'data market-table' }, // 좁은 화면에서는 선수마다 카드 (css .market-table)
          h('thead', {}, h('tr', {}, h('th', {}, t('transfers.th.name')), h('th', {}, t('transfers.th.team')), h('th', {}, t('transfers.th.pos')), h('th', { class: 'num' }, t('transfers.th.age')), h('th', { class: 'num' }, 'OVR'), h('th', { class: 'num' }, t('transfers.th.value')), h('th', { class: 'num' }, t('transfers.th.asking')), h('th', {}, t('transfers.th.status')), h('th', {}))),
          tbody,
        ),
      ),
    );
  }

  function mineTab() {
    const open = windowStatus(game).open;
    const mine = squadOf(dataset, game, game.teamId).sort((a, b) => overall(b) - overall(a));
    const squadTable = h(
      'div',
      { class: 'table-scroll' },
      h(
        'table',
        { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', {}, t('transfers.th.name')), h('th', {}, t('transfers.th.pos')), h('th', { class: 'num' }, t('transfers.th.age')), h('th', { class: 'num' }, 'OVR'), h('th', { class: 'num' }, t('transfers.th.value')), h('th', { class: 'num' }, t('transfers.th.wage')), h('th', { class: 'num' }, t('transfers.th.contract')), h('th', { class: 'num' }, t('transfers.th.apps')), h('th', {}, t('transfers.th.status')), h('th', {}))),
        h(
          'tbody',
          {},
          mine.map((p) => {
            // 진행 중인 경기가 있으면 판매·해지를 막는다 (뛰고 있는 선수가 팀을 떠나지 않게)
            const playing = isMatchInProgress();
            const onLoan = loanOf(game, p.id); // 임대 온 선수: 판매·임대·해지 없음
            const sell = h('button', { class: 'btn small', type: 'button', disabled: open && !playing ? null : true, title: playing ? t('transfers.afterMatch') : open ? '' : t('transfers.windowClosed') }, t('transfers.mine.sell'));
            sell.addEventListener('click', () => sellModal(p));
            const lend = h('button', { class: 'btn small ghost', type: 'button', disabled: open && !playing ? null : true, title: playing ? t('transfers.afterMatch') : open ? t('transfers.mine.loanTitle') : t('transfers.windowClosed') }, t('transfers.loan'));
            lend.addEventListener('click', () => loanOutModal(p));
            const release = h('button', { class: 'btn small ghost', type: 'button', disabled: playing || null, title: playing ? t('transfers.afterMatch') : '' }, t('transfers.mine.release'));
            release.addEventListener('click', () =>
              openConfirm({
                title: t('transfers.mine.releaseTitle', { name: p.name }),
                body: t('transfers.mine.releaseBody', { cost: formatMoney(releaseCost(dataset, game, p.id)) }),
                confirmLabel: t('transfers.mine.release'),
                onConfirm: () => {
                  const res = releasePlayer(dataset, game, p.id);
                  showToast(res.message, { tone: res.ok ? '' : 'warn' });
                  if (res.ok) {
                    ctx.persist();
                    ctx.refreshTopbar();
                    fill();
                  }
                },
              }),
            );
            const ovr = overall(p);
            return h(
              'tr',
              {},
              h('td', {}, p.name, onLoan ? h('span', { class: 'loan-tag', title: t('transfers.mine.loanTagTitle', { team: teamName(onLoan.from), pct: pct(onLoan.wageShare) }) }, t('transfers.mine.loanTag', { code: dataset.teamById.get(onLoan.from)?.code ?? '' })) : null),
              h('td', {}, h('span', { class: 'pos-tag' }, p.position)),
              h('td', { class: 'num' }, p.age),
              h('td', { class: `num ovr ${attrClass(ovr)}` }, ovr),
              h('td', { class: 'num' }, formatMoney(playerValue(p))),
              // 임대 온 선수는 우리가 내는 몫만
              h('td', { class: 'num' }, formatWage(Math.round(contractOf(dataset, game, p.id).wage * (onLoan?.wageShare ?? 1)))),
              h('td', { class: 'num' }, onLoan ? t('transfers.loan') : t('transfers.years', { n: seasonsLeft(game, contractOf(dataset, game, p.id)) })),
              h('td', { class: 'num' }, game.playerStats[p.id]?.apps ?? 0),
              h('td', {}, statusChip(game, p.id)),
              h('td', { class: 'num actions' }, onLoan ? h('span', { class: 'muted' }, t('transfers.returns')) : [sell, lend, release]),
            );
          }),
        ),
      ),
    );
    return h('div', {}, squadTable, loanPanel());
  }

  // 임대 현황: 보낸 선수(임대 기간 기록)와 데려온 선수
  function loanPanel() {
    const out = loansOut(game);
    const inn = loansIn(game);
    const note = h('p', { class: 'muted small-note' }, t('transfers.loans.note', { out: out.length, maxOut: LOAN.maxOut, inn: inn.length, maxIn: LOAN.maxIn }));
    if (!out.length) return h('div', { class: 'loan-panel' }, h('h3', {}, t('transfers.loans.title')), note, h('p', { class: 'empty muted' }, t('transfers.loans.empty')));
    return h(
      'div',
      { class: 'loan-panel' },
      h('h3', {}, t('transfers.loans.title')),
      note,
      h(
        'div',
        { class: 'table-scroll' },
        h(
          'table',
          { class: 'data' },
          h('thead', {}, h('tr', {}, h('th', {}, t('transfers.th.name')), h('th', {}, t('transfers.th.pos')), h('th', { class: 'num' }, t('transfers.th.age')), h('th', { class: 'num' }, 'OVR'), h('th', {}, t('transfers.th.loanClub')), h('th', { class: 'num' }, t('transfers.th.apps')), h('th', { class: 'num' }, t('transfers.th.goals')), h('th', { class: 'num' }, t('transfers.th.theirShare')))),
          h(
            'tbody',
            {},
            out.map((l) => {
              const p = dataset.playerById.get(l.playerId);
              if (!p) return null;
              const s = loanStats(game, l);
              const name = h('button', { class: 'link', type: 'button' }, p.name);
              name.addEventListener('click', () => openPlayerModal(dataset, p, ctx));
              return h(
                'tr',
                {},
                h('td', {}, name),
                h('td', {}, h('span', { class: 'pos-tag' }, p.position)),
                h('td', { class: 'num' }, p.age),
                h('td', { class: `num ovr ${attrClass(overall(p))}` }, overall(p)),
                h('td', {}, teamCell(l.to), ' ', h('span', { class: 'muted' }, teamName(l.to))),
                h('td', { class: 'num' }, s.apps),
                h('td', { class: 'num' }, s.goals),
                h('td', { class: 'num' }, pct(l.wageShare)),
              );
            }).filter(Boolean),
          ),
        ),
      ),
    );
  }

  // 받은 제안: AI 구단이 우리 선수에게 건 제안 (유효 라운드 안에 답해야 함)
  function incomingTab() {
    const offers = game.incomingOffers ?? [];
    if (offers.length === 0) return h('p', { class: 'empty muted' }, t('transfers.incoming.empty'));
    return h(
      'table',
      { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, t('transfers.th.player')), h('th', { class: 'num' }, 'OVR'), h('th', {}, t('transfers.th.bidder')), h('th', {}, t('transfers.th.league')), h('th', { class: 'num' }, t('transfers.th.amount')), h('th', { class: 'num' }, t('transfers.th.value')), h('th', { class: 'num' }, t('transfers.th.expires')), h('th', {}))),
      h(
        'tbody',
        {},
        offers.map((o) => {
          const p = dataset.playerById.get(o.playerId);
          const accept = h('button', { class: 'btn small primary', type: 'button', disabled: isMatchInProgress() || null, title: isMatchInProgress() ? t('transfers.afterMatch') : '' }, t('transfers.accept'));
          const reject = h('button', { class: 'btn small ghost', type: 'button' }, t('transfers.reject'));
          const answer = (yes) => {
            const res = respondIncomingOffer(dataset, game, o.id, yes);
            showToast(res.message, { tone: res.ok && yes ? 'goal' : res.ok ? '' : 'warn' });
            ctx.persist();
            ctx.refreshTopbar();
            fill();
          };
          accept.addEventListener('click', () => answer(true));
          reject.addEventListener('click', () => answer(false));
          return h(
            'tr',
            {},
            h('td', {}, p.name),
            h('td', { class: `num ${attrClass(overall(p))}` }, overall(p)),
            h('td', {}, teamCell(o.teamId), ' ', teamName(o.teamId)),
            h('td', { class: 'muted' }, leagueName(o.teamId)),
            h('td', { class: 'num pts' }, formatMoney(o.amount)),
            h('td', { class: 'num' }, formatMoney(playerValue(p))),
            h('td', { class: 'num muted' }, `${o.expires}R`),
            h('td', { class: 'num actions' }, reject, accept),
          );
        }),
      ),
    );
  }

  function logTab() {
    const scope = segmented([{ id: 'mine', label: t('transfers.log.mine') }, { id: 'league', label: t('transfers.log.league') }, { id: 'all', label: t('transfers.log.all') }], filters.logScope, (id) => {
      filters.logScope = id;
      fill();
    }, { size: 'small' });
    const myLeague = new Set(dataset.leagueById.get(game.leagueId).teamIds);
    const list = [...game.transfers].reverse().filter((x) =>
      filters.logScope === 'all' ? true : filters.logScope === 'league' ? myLeague.has(x.from) || myLeague.has(x.to) : x.from === game.teamId || x.to === game.teamId,
    );
    return h(
      'div',
      {},
      h('div', { class: 'filter-bar' }, scope.el, h('span', { class: 'muted' }, t('transfers.log.count', { n: list.length }))),
      list.length === 0
        ? h('p', { class: 'empty muted' }, t('transfers.log.empty'))
        : h(
            'div',
            { class: 'table-scroll' },
            h(
              'table',
              { class: 'data' },
              h('thead', {}, h('tr', {}, h('th', { class: 'num' }, t('transfers.th.season')), h('th', { class: 'num' }, t('transfers.th.round')), h('th', {}, t('transfers.th.player')), h('th', {}, t('transfers.th.from')), h('th', {}, t('transfers.th.to')), h('th', { class: 'num' }, t('transfers.th.fee')))),
              h(
                'tbody',
                {},
                list.slice(0, 200).map((x) =>
                  h(
                    'tr',
                    { class: x.from === game.teamId || x.to === game.teamId ? 'is-mine' : '' },
                    h('td', { class: 'num muted' }, x.season ?? 1),
                    h('td', { class: 'num muted' }, x.round),
                    h('td', {}, dataset.playerById.get(x.playerId)?.name ?? t('transfers.log.retired')),
                    h('td', {}, teamCell(x.from)),
                    h('td', {}, teamCell(x.to)),
                    h('td', { class: 'num pts' }, x.by === 'loanEnd' ? t('transfers.log.loanEnd') : x.loan ? `${t('transfers.loan')}${x.fee > 0 ? ` · ${formatMoney(x.fee)}` : ''}` : x.fee > 0 ? (x.from ? formatMoney(x.fee) : t('transfers.log.freeFee', { fee: formatMoney(x.fee) })) : x.to ? t('transfers.log.free') : x.by === 'expiry' ? t('transfers.log.expired') : t('transfers.log.released')),
                  ),
                ),
              ),
            ),
          ),
    );
  }

  const summaryHost = h('div');
  function fill() {
    summaryHost.replaceChildren(summary());
    const tabBody = { search: searchTab, incoming: incomingTab, mine: mineTab, log: logTab }[filters.tab] ?? searchTab;
    body.replaceChildren(tabBody());
  }

  const tabs = segmented(TABS, filters.tab, (id) => {
    filters.tab = id;
    fill();
  });
  fill();
  host.append(panel(t('transfers.title'), summaryHost), panel(null, h('div', {}, h('div', { class: 'side-tabs' }, tabs.el), body)));
  return host;
}
