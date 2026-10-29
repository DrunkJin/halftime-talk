// 이적: 선수 찾기(영입 제안·임대) · 받은 제안 · 우리 선수(판매·임대 보내기·계약 해지, 임대 현황) · 이적 기록(우리 팀 / 전체 소식)
import { SCOUT, assignmentOf, isKnown, ovrView, scoutSlotsLeft, sendScout } from '../../state/scouting.js';
import { overall } from '../../engine/ratings.js';
import { contractOf, releaseCost, seasonsLeft, wageRoom } from '../../market/finance.js';
import { acceptSellOffer, askingPrice, formatWage, makeOffer, offerTerms, releasePlayer, respondIncomingOffer, sellOffers, windowStatus } from '../../market/market.js';
import { LOAN } from '../../market/config.js';
import { isLoanable, loanIn, loanInTerms, loanOut, loanOutBlock, loanOutOffers, loanStats, loansIn, loansOut } from '../../market/loans.js';
import { formatMoney, playerValue } from '../../market/value.js';
import { availabilityOf, currentTeamId, loanOf, squadOf } from '../../state/game.js';
import { RULES } from '../../state/rules.js';
import { teamBadge } from '../badge.js';
import { openConfirm, openPlayerModal, panel, segmented, statusChip } from '../components.js';
import { h } from '../dom.js';
import { isMatchInProgress } from './match.js';
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
const pct = (v) => `${Math.round(v * 100)}%`;

// 화면을 떠났다 와도 필터 유지
const filters = { tab: 'search', group: 'all', league: 'all', query: '', affordable: false, freeOnly: false, loanOnly: false, logScope: 'mine' };

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

  // ── 임대 영입 모달 ──────────────────────────────────
  function loanInModal(player) {
    const from = currentTeamId(dataset, game, player.id);
    const t = loanInTerms(dataset, game, player);
    const intent = player.age <= LOAN.youngAge ? '성장을 위해 꾸준한 출전 시간을 원합니다' : '벤치에 있는 선수의 주급 부담을 덜고 싶어 합니다';
    const message = h('p', { class: `offer-msg ${t.ok ? 'muted' : 'bad'}` }, t.ok ? `${teamName(from)}은(는) ${intent}. 시즌이 끝나면 돌아갑니다.` : t.reason);
    // 능력치를 모르는 선수는 우리 팀에서의 역할도 짐작할 수 없다
    const role = isKnown(dataset, game, player, from) ? t.role : '스카우트해야 알 수 있습니다';
    const submit = h('button', { class: 'btn primary', type: 'button', disabled: t.ok ? null : true }, '임대 영입');
    const cancel = h('button', { class: 'btn ghost', type: 'button' }, '닫기');
    const close = openModal(
      h(
        'div',
        { class: 'confirm-modal' },
        h('h2', {}, `${player.name} 임대 영입`),
        h('p', { class: 'muted' }, `${teamName(from)} (${leagueName(from)}) · ${player.position} · ${player.age}세`),
        h(
          'dl',
          { class: 'loan-terms' },
          h('dt', {}, '기간'), h('dd', {}, '이번 시즌 끝까지'),
          h('dt', {}, '임대료'), h('dd', { class: 'num' }, t.fee > 0 ? formatMoney(t.fee) : '없음'),
          h('dt', {}, '주급 부담'), h('dd', { class: 'num' }, `${pct(t.wageShare)} · ${formatWage(Math.round(t.wage * t.wageShare))}`, h('small', { class: 'muted' }, ` (전체 ${formatWage(t.wage)})`)),
          h('dt', {}, '우리 팀 예상 역할'), h('dd', {}, role),
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
    const cancel = h('button', { class: 'btn ghost', type: 'button' }, '닫기');
    let close = null;
    const list = offers.length
      ? h(
          'table',
          { class: 'data compact' },
          h('thead', {}, h('tr', {}, h('th', {}, '구단'), h('th', {}, '리그'), h('th', {}, '예상 역할'), h('th', { class: 'num' }, '주급 부담'), h('th', {}))),
          h(
            'tbody',
            {},
            offers.map((o) => {
              const accept = h('button', { class: 'btn small primary', type: 'button' }, '보내기');
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
      : h('p', { class: 'empty muted' }, block ?? '이 선수를 주전으로 쓸 만한 구단이 없습니다.');
    close = openModal(
      h(
        'div',
        { class: 'confirm-modal' },
        h('h2', {}, `${player.name} 임대 보내기`),
        h('p', { class: 'muted' }, `이번 시즌 끝까지 · 받는 구단이 주급 일부를 냅니다 · 임대 가서 뛴 경기만큼 성장합니다`),
        list,
        h('div', { class: 'confirm-actions' }, cancel),
      ),
    );
    cancel.addEventListener('click', close);
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

    // 스카우트 파견 버튼 (모르는 선수만)
    const scoutButton = (p) => {
      const a = assignmentOf(game, p.id);
      const b = h('button', { class: 'btn small ghost', type: 'button', disabled: a || scoutSlotsLeft(game) <= 0 || null, title: a ? '' : scoutSlotsLeft(game) <= 0 ? `스카우트는 동시에 ${SCOUT.slots}명까지` : '' }, a ? `관찰 중 (${Math.max(0, a.readyRound - game.round)}R)` : '스카우트');
      b.addEventListener('click', () => {
        const r = sendScout(dataset, game, p);
        if (!r.ok) return;
        ctx.persist();
        showToast(`${p.name}에게 스카우트를 보냈습니다 — ${r.rounds}라운드 뒤 보고서 (편지함)`);
        fill();
      });
      return b;
    };
    const scoutNote = h('span', { class: 'muted small-note' }, `스카우트 ${SCOUT.slots - scoutSlotsLeft(game)}/${SCOUT.slots}명 파견 중 · 우리 리그·맞붙어 본 팀·스카우트한 선수만 정확한 능력치가 보입니다`);

    const tbody = h('tbody');
    function renderRows() {
      const qq = filters.query.trim().toLowerCase();
      const shown = rows.filter(({ p }) => !qq || p.name.toLowerCase().includes(qq)).slice(0, RESULT_LIMIT);
      tbody.replaceChildren(
        ...shown.map(({ p, teamId, view, asking }) => {
          const offer = h('button', { class: 'btn small', type: 'button', disabled: open ? null : true, title: open ? '' : '이적시장이 닫혀 있습니다' }, teamId ? '제안' : '영입');
          offer.addEventListener('click', () => offerModal(p));
          // 임대: 원소속이 내줄 만한 선수만 버튼을 보인다
          let loan = null;
          if (teamId && isLoanable(dataset, game, p, teamId)) {
            loan = h('button', { class: 'btn small ghost', type: 'button', disabled: open ? null : true, title: open ? '시즌 끝까지 임대' : '이적시장이 닫혀 있습니다' }, '임대');
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
            h('td', { class: `num ovr ${view.known ? attrClass(view.ovr) : 'ovr-range'}`, title: view.known ? '' : '스카우트하면 정확한 능력치를 볼 수 있습니다' }, view.known ? view.ovr : `${view.low}~${view.high}`),
            h('td', { class: 'num' }, formatMoney(playerValue(p))),
            h('td', { class: 'num' }, teamId ? formatMoney(asking) : '—'),
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
      h('div', { class: 'filter-bar' }, leagueSelect, groups.el, search, check('affordable', '예산 안에서'), check('freeOnly', '무소속만'), check('loanOnly', '임대 가능만'), h('span', { class: 'muted' }, `${rows.length}명 중 OVR 상위 ${Math.min(RESULT_LIMIT, rows.length)}명`)),
      h('div', { class: 'scout-note' }, scoutNote),
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
    const squadTable = h(
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
            // 진행 중인 경기가 있으면 판매·해지를 막는다 (뛰고 있는 선수가 팀을 떠나지 않게)
            const playing = isMatchInProgress();
            const onLoan = loanOf(game, p.id); // 임대 온 선수: 판매·임대·해지 없음
            const sell = h('button', { class: 'btn small', type: 'button', disabled: open && !playing ? null : true, title: playing ? '경기가 끝난 뒤 할 수 있습니다' : open ? '' : '이적시장이 닫혀 있습니다' }, '판매');
            sell.addEventListener('click', () => sellModal(p));
            const lend = h('button', { class: 'btn small ghost', type: 'button', disabled: open && !playing ? null : true, title: playing ? '경기가 끝난 뒤 할 수 있습니다' : open ? '시즌 끝까지 다른 구단에서 뛰게 합니다' : '이적시장이 닫혀 있습니다' }, '임대');
            lend.addEventListener('click', () => loanOutModal(p));
            const release = h('button', { class: 'btn small ghost', type: 'button', disabled: playing || null, title: playing ? '경기가 끝난 뒤 할 수 있습니다' : '' }, '계약 해지');
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
              h('td', {}, p.name, onLoan ? h('span', { class: 'loan-tag', title: `${teamName(onLoan.from)}에서 임대 · 주급 ${pct(onLoan.wageShare)} 부담` }, `임대 · ${dataset.teamById.get(onLoan.from)?.code ?? ''}`) : null),
              h('td', {}, h('span', { class: 'pos-tag' }, p.position)),
              h('td', { class: 'num' }, p.age),
              h('td', { class: `num ovr ${attrClass(ovr)}` }, ovr),
              h('td', { class: 'num' }, formatMoney(playerValue(p))),
              // 임대 온 선수는 우리가 내는 몫만
              h('td', { class: 'num' }, formatWage(Math.round(contractOf(dataset, game, p.id).wage * (onLoan?.wageShare ?? 1)))),
              h('td', { class: 'num' }, onLoan ? '임대' : `${seasonsLeft(game, contractOf(dataset, game, p.id))}년`),
              h('td', { class: 'num' }, game.playerStats[p.id]?.apps ?? 0),
              h('td', {}, statusChip(game, p.id)),
              h('td', { class: 'num actions' }, onLoan ? h('span', { class: 'muted' }, '시즌 끝 복귀') : [sell, lend, release]),
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
    const note = h('p', { class: 'muted small-note' }, `임대는 시즌 끝까지입니다 · 보낸 선수 ${out.length}/${LOAN.maxOut}명, 데려온 선수 ${inn.length}/${LOAN.maxIn}명 · 임대 간 선수는 뛴 경기만큼 성장합니다`);
    if (!out.length) return h('div', { class: 'loan-panel' }, h('h3', {}, '임대 보낸 선수'), note, h('p', { class: 'empty muted' }, '임대 보낸 선수가 없습니다. 출전 기회가 적은 어린 선수를 보내 보세요.'));
    return h(
      'div',
      { class: 'loan-panel' },
      h('h3', {}, '임대 보낸 선수'),
      note,
      h(
        'div',
        { class: 'table-scroll' },
        h(
          'table',
          { class: 'data' },
          h('thead', {}, h('tr', {}, h('th', {}, '이름'), h('th', {}, '포지션'), h('th', { class: 'num' }, '나이'), h('th', { class: 'num' }, 'OVR'), h('th', {}, '임대 구단'), h('th', { class: 'num' }, '출전'), h('th', { class: 'num' }, '골'), h('th', { class: 'num' }, '상대 주급 부담'))),
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
          const accept = h('button', { class: 'btn small primary', type: 'button', disabled: isMatchInProgress() || null, title: isMatchInProgress() ? '경기가 끝난 뒤 할 수 있습니다' : '' }, '수락');
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
                    h('td', {}, dataset.playerById.get(t.playerId)?.name ?? '(은퇴)'),
                    h('td', {}, teamCell(t.from)),
                    h('td', {}, teamCell(t.to)),
                    h('td', { class: 'num pts' }, t.by === 'loanEnd' ? '임대 복귀' : t.loan ? `임대${t.fee > 0 ? ` · ${formatMoney(t.fee)}` : ''}` : t.fee > 0 ? formatMoney(t.fee) : t.to ? '자유' : t.by === 'expiry' ? '계약 만료' : '해지'),
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
