// 이적: 선수 찾기(영입 제안) · 받은 제안 · 우리 선수(판매·계약 해지) · 이적 기록(우리 팀 / 전체 소식)
import { overall } from '../../engine/ratings.js';
import { contractOf, releaseCost, seasonsLeft, wageRoom } from '../../market/finance.js';
import { acceptSellOffer, askingPrice, formatWage, makeOffer, offerTerms, releasePlayer, respondIncomingOffer, sellOffers, windowStatus } from '../../market/market.js';
import { formatMoney, playerValue } from '../../market/value.js';
import { availabilityOf, currentTeamId, squadOf } from '../../state/game.js';
import { RULES } from '../../state/rules.js';
import { teamBadge } from '../badge.js';
import { openConfirm, openPlayerModal, panel, segmented, statusChip } from '../components.js';
import { h } from '../dom.js';
import { attrClass } from '../format.js';
import { openModal, setDigits, showToast } from '../motion.js';

const TABS = [
  { id: 'search', label: '선수 찾기' },
  { id: 'incoming', label: '받은 제안' },
  { id: 'mine', label: '우리 선수' },
  { id: 'log', label: '이적 기록' },
];
const GROUPS = [
  { id: 'all', label: '전체' },
  { id: 'GK', label: 'GK' },
  { id: 'DF', label: '수비' },
  { id: 'MF', label: '미드' },
  { id: 'FW', label: '공격' },
];
const GROUP_OF = { GK: 'GK', CB: 'DF', LB: 'DF', RB: 'DF', DM: 'MF', CM: 'MF', AM: 'MF', LW: 'FW', RW: 'FW', ST: 'FW' };
const RESULT_LIMIT = 80;

// 화면을 떠났다 와도 필터 유지
const filters = { tab: 'search', group: 'all', league: 'all', query: '', affordable: false, freeOnly: false, logScope: 'mine' };

export function render(ctx) {
  const { dataset, game } = ctx;
  const host = h('div', { class: 'transfers-screen' });
  const budgetDigits = h('span', { class: 't-digit-group' });
  const body = h('div');

  const teamName = (id) => (id ? dataset.teamById.get(id).shortName : '무소속');
  const leagueName = (id) => (id ? dataset.leagueById.get(dataset.teamById.get(id).leagueId).name : '');
  const teamCell = (id) => (id ? h('span', { class: 'team-cell' }, teamBadge(dataset.teamById.get(id), 16), h('span', {}, dataset.teamById.get(id).code)) : h('span', { class: 'muted' }, '무소속'));

  function summary() {
    const w = windowStatus(game);
    const size = squadOf(dataset, game, game.teamId).length;
    setDigits(budgetDigits, formatMoney(game.budgets[game.teamId]));
    return h(
      'div',
      { class: 'tr-summary' },
      h('div', { class: 'tr-stat' }, h('span', { class: 'muted' }, '잔고'), h('b', { class: 'num big' }, budgetDigits)),
      h('div', { class: 'tr-stat' }, h('span', { class: 'muted' }, '주급 여유'), h('b', { class: 'num' }, formatWage(Math.max(0, wageRoom(dataset, game, game.teamId))))),
      h(
        'div',
        { class: 'tr-stat' },
        h('span', { class: 'muted' }, '이적시장'),
        w.open
          ? h('b', { class: 'window-open' }, `${w.name} · ${w.closesAfter}라운드까지`)
          : h('b', { class: 'muted' }, w.next ? `닫힘 · ${w.next.name}은 ${w.next.from}라운드부터` : '시즌 내 남은 이적시장 없음'),
      ),
      h('div', { class: 'tr-stat' }, h('span', { class: 'muted' }, '스쿼드'), h('b', { class: 'num' }, `${size}명`), h('small', { class: 'muted' }, `${RULES.squadMin}~${RULES.squadMax}명`)),
      w.open
        ? null
        : h(
            'div',
            { class: 'window-closed' },
            h('b', {}, '이적시장이 닫혀 있습니다.'),
            ' 영입·판매·제안은 이적시장 기간에만 할 수 있습니다. 지금은 선수 살펴보기, 재계약, 계약 해지만 가능합니다.',
          ),
    );
  }

  // ── 영입 제안 모달 ──────────────────────────────────
  function offerModal(player) {
    const from = currentTeamId(dataset, game, player.id);
    const { asking, contract, wageOk } = offerTerms(dataset, game, player.id);
    const input = h('input', { type: 'number', class: 'money-input', min: '0', step: '0.5', value: String(asking), 'aria-label': '제안 금액 (백만 파운드)' });
    const terms = h(
      'div',
      { class: `contract-terms${wageOk ? '' : ' bad'}` },
      h('span', {}, '선수 요구: ', h('b', {}, formatWage(contract.wage)), ` · ${contract.years}년 계약`),
      h('span', { class: 'muted' }, `주급 여유 ${formatWage(Math.max(0, wageRoom(dataset, game, game.teamId)))}${wageOk ? '' : ' — 한도 초과'}`),
    );
    const message = h('p', { class: 'offer-msg muted' }, from ? `구단 예상 요구액 약 ${formatMoney(asking)} · 가치 ${formatMoney(playerValue(player))}` : '무소속: 이적료 없이 영입할 수 있습니다.');
    const submit = h('button', { class: 'btn primary', type: 'button' }, from ? '제안하기' : '영입하기');
    const cancel = h('button', { class: 'btn ghost', type: 'button' }, '닫기');
    const close = openModal(
      h(
        'div',
        { class: 'confirm-modal' },
        h('h2', {}, `${player.name} 영입 제안`),
        h('p', { class: 'muted' }, `${teamName(from)}${from ? ` (${leagueName(from)})` : ''} · ${player.position} · ${player.age}세 · OVR ${overall(player)}`),
        h('label', { class: 'money-field' }, h('span', {}, '£'), input, h('span', {}, 'M')),
        terms,
        message,
        h('div', { class: 'confirm-actions' }, cancel, submit),
      ),
    );
    cancel.addEventListener('click', close);
    submit.addEventListener('click', () => {
      const amount = from ? Math.round(Number(input.value) * 10) / 10 : 0;
      const res = makeOffer(dataset, game, player.id, amount);
      message.textContent = res.message;
      message.className = `offer-msg ${res.accepted ? 'ok' : 'bad'}`;
      if (res.accepted) {
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

  // ── 판매 모달 ───────────────────────────────────────
  function sellModal(player) {
    const offers = sellOffers(dataset, game, player.id);
    const cancel = h('button', { class: 'btn ghost', type: 'button' }, '닫기');
    let close = null;
    const list = offers.length
      ? h(
          'table',
          { class: 'data compact' },
          h(
            'tbody',
            {},
            offers.map((o) => {
              const accept = h('button', { class: 'btn small primary', type: 'button' }, '수락');
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
      : h('p', { class: 'empty muted' }, '이 선수에게 관심 있는 구단이 없습니다.');
    close = openModal(
      h(
        'div',
        { class: 'confirm-modal' },
        h('h2', {}, `${player.name} 판매`),
        h('p', { class: 'muted' }, `가치 ${formatMoney(playerValue(player))} · 이번 라운드에 들어온 제안`),
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
      .filter(({ teamId }) => teamId !== game.teamId)
      .filter(({ teamId }) => filters.league === 'all' || (teamId && dataset.teamById.get(teamId).leagueId === filters.league))
      .filter(({ p }) => filters.group === 'all' || GROUP_OF[p.position] === filters.group)
      .filter(({ teamId }) => !filters.freeOnly || teamId === null)
      .map((r) => ({ ...r, ovr: overall(r.p), asking: askingPrice(dataset, game, r.p) }))
      .filter((r) => !filters.affordable || r.asking <= budget)
      .sort((a, b) => b.ovr - a.ovr || a.asking - b.asking);

    const search = h('input', { type: 'search', class: 'search', placeholder: '선수 이름', value: filters.query, 'aria-label': '선수 이름 검색' });
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
      { class: 'select', 'aria-label': '리그' },
      h('option', { value: 'all' }, '모든 리그'),
      dataset.leagues.map((l) => h('option', { value: l.id, selected: filters.league === l.id || null }, l.name)),
    );
    leagueSelect.addEventListener('change', () => {
      filters.league = leagueSelect.value;
      fill();
    });

    const tbody = h('tbody');
    function renderRows() {
      const qq = filters.query.trim().toLowerCase();
      const shown = rows.filter(({ p }) => !qq || p.name.toLowerCase().includes(qq)).slice(0, RESULT_LIMIT);
      tbody.replaceChildren(
        ...shown.map(({ p, teamId, ovr, asking }) => {
          const offer = h('button', { class: 'btn small', type: 'button', disabled: open ? null : true, title: open ? '' : '이적시장이 닫혀 있습니다' }, teamId ? '제안' : '영입');
          offer.addEventListener('click', () => offerModal(p));
          const name = h('button', { class: 'link', type: 'button' }, p.name);
          name.addEventListener('click', () => openPlayerModal(dataset, p, ctx));
          return h(
            'tr',
            { class: asking > budget ? 'is-dim' : '' },
            h('td', {}, name),
            h('td', {}, teamCell(teamId)),
            h('td', {}, h('span', { class: 'pos-tag' }, p.position)),
            h('td', { class: 'num' }, p.age),
            h('td', { class: `num ovr ${attrClass(ovr)}` }, ovr),
            h('td', { class: 'num' }, formatMoney(playerValue(p))),
            h('td', { class: 'num' }, teamId ? formatMoney(asking) : '—'),
            h('td', {}, statusChip(game, p.id)),
            h('td', { class: 'num' }, offer),
          );
        }),
      );
    }
    renderRows();

    return h(
      'div',
      {},
      h('div', { class: 'filter-bar' }, leagueSelect, groups.el, search, check('affordable', '예산 안에서'), check('freeOnly', '무소속만'), h('span', { class: 'muted' }, `${rows.length}명 중 OVR 상위 ${Math.min(RESULT_LIMIT, rows.length)}명`)),
      h(
        'div',
        { class: 'table-scroll' },
        h(
          'table',
          { class: 'data' },
          h('thead', {}, h('tr', {}, h('th', {}, '이름'), h('th', {}, '소속'), h('th', {}, '포지션'), h('th', { class: 'num' }, '나이'), h('th', { class: 'num' }, 'OVR'), h('th', { class: 'num' }, '가치'), h('th', { class: 'num' }, '요구액'), h('th', {}, '상태'), h('th', {}))),
          tbody,
        ),
      ),
    );
  }

  function mineTab() {
    const open = windowStatus(game).open;
    const mine = squadOf(dataset, game, game.teamId).sort((a, b) => overall(b) - overall(a));
    return h(
      'div',
      { class: 'table-scroll' },
      h(
        'table',
        { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', {}, '이름'), h('th', {}, '포지션'), h('th', { class: 'num' }, '나이'), h('th', { class: 'num' }, 'OVR'), h('th', { class: 'num' }, '가치'), h('th', { class: 'num' }, '주급'), h('th', { class: 'num' }, '계약'), h('th', { class: 'num' }, '출전'), h('th', {}, '상태'), h('th', {}))),
        h(
          'tbody',
          {},
          mine.map((p) => {
            const sell = h('button', { class: 'btn small', type: 'button', disabled: open ? null : true, title: open ? '' : '이적시장이 닫혀 있습니다' }, '판매');
            sell.addEventListener('click', () => sellModal(p));
            const release = h('button', { class: 'btn small ghost', type: 'button' }, '계약 해지');
            release.addEventListener('click', () =>
              openConfirm({
                title: `${p.name} 계약 해지`,
                body: `위약금 ${formatMoney(releaseCost(dataset, game, p.id))}을 내고 무소속으로 풀어줍니다. 다른 구단이 데려갈 수 있습니다.`,
                confirmLabel: '계약 해지',
                onConfirm: () => {
                  const res = releasePlayer(dataset, game, p.id);
                  showToast(res.message, { tone: res.ok ? '' : 'warn' });
                  if (res.ok) {
                    ctx.persist();
                    fill();
                  }
                },
              }),
            );
            const ovr = overall(p);
            return h(
              'tr',
              {},
              h('td', {}, p.name),
              h('td', {}, h('span', { class: 'pos-tag' }, p.position)),
              h('td', { class: 'num' }, p.age),
              h('td', { class: `num ovr ${attrClass(ovr)}` }, ovr),
              h('td', { class: 'num' }, formatMoney(playerValue(p))),
              h('td', { class: 'num' }, formatWage(contractOf(dataset, game, p.id).wage)),
              h('td', { class: 'num' }, `${seasonsLeft(game, contractOf(dataset, game, p.id))}년`),
              h('td', { class: 'num' }, game.playerStats[p.id]?.apps ?? 0),
              h('td', {}, statusChip(game, p.id)),
              h('td', { class: 'num actions' }, sell, release),
            );
          }),
        ),
      ),
    );
  }

  // 받은 제안: AI 구단이 우리 선수에게 건 제안 (유효 라운드 안에 답해야 함)
  function incomingTab() {
    const offers = game.incomingOffers ?? [];
    if (offers.length === 0) return h('p', { class: 'empty muted' }, '받은 제안이 없습니다. 이적시장 기간에 주전급 선수에게 제안이 들어옵니다.');
    return h(
      'table',
      { class: 'data' },
      h('thead', {}, h('tr', {}, h('th', {}, '선수'), h('th', { class: 'num' }, 'OVR'), h('th', {}, '제안 구단'), h('th', {}, '리그'), h('th', { class: 'num' }, '금액'), h('th', { class: 'num' }, '가치'), h('th', { class: 'num' }, '마감'), h('th', {}))),
      h(
        'tbody',
        {},
        offers.map((o) => {
          const p = dataset.playerById.get(o.playerId);
          const accept = h('button', { class: 'btn small primary', type: 'button' }, '수락');
          const reject = h('button', { class: 'btn small ghost', type: 'button' }, '거절');
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
    const scope = segmented([{ id: 'mine', label: '우리 팀' }, { id: 'league', label: '우리 리그' }, { id: 'all', label: '전체 소식' }], filters.logScope, (id) => {
      filters.logScope = id;
      fill();
    }, { size: 'small' });
    const myLeague = new Set(dataset.leagueById.get(game.leagueId).teamIds);
    const list = [...game.transfers].reverse().filter((t) =>
      filters.logScope === 'all' ? true : filters.logScope === 'league' ? myLeague.has(t.from) || myLeague.has(t.to) : t.from === game.teamId || t.to === game.teamId,
    );
    return h(
      'div',
      {},
      h('div', { class: 'filter-bar' }, scope.el, h('span', { class: 'muted' }, `${list.length}건`)),
      list.length === 0
        ? h('p', { class: 'empty muted' }, '아직 이적이 없습니다.')
        : h(
            'div',
            { class: 'table-scroll' },
            h(
              'table',
              { class: 'data' },
              h('thead', {}, h('tr', {}, h('th', { class: 'num' }, '시즌'), h('th', { class: 'num' }, '라운드'), h('th', {}, '선수'), h('th', {}, '이전 소속'), h('th', {}, '새 소속'), h('th', { class: 'num' }, '이적료'))),
              h(
                'tbody',
                {},
                list.slice(0, 200).map((t) =>
                  h(
                    'tr',
                    { class: t.from === game.teamId || t.to === game.teamId ? 'is-mine' : '' },
                    h('td', { class: 'num muted' }, t.season ?? 1),
                    h('td', { class: 'num muted' }, t.round),
                    h('td', {}, dataset.playerById.get(t.playerId).name),
                    h('td', {}, teamCell(t.from)),
                    h('td', {}, teamCell(t.to)),
                    h('td', { class: 'num pts' }, t.fee > 0 ? formatMoney(t.fee) : t.to ? '자유' : '해지'),
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
  host.append(panel('이적', summaryHost), panel(null, h('div', {}, h('div', { class: 'side-tabs' }, tabs.el), body)));
  return host;
}
