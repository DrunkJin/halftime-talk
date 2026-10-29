// 여러 화면에서 쓰는 UI 조각
import { ATTRIBUTE_GROUPS, POSITIONS } from '../data/schema.js';
import { overall, positionFit, positionRating } from '../engine/ratings.js';
import { formatMoney, playerValue } from '../market/value.js';
import { availabilityOf, conditionOf, currentTeamId } from '../state/game.js';
import { scoutedPotential } from '../state/newSeason.js';
import { formOf, ratingClass, seasonRating } from '../state/form.js';
import { teamBadge } from './badge.js';
import { h } from './dom.js';
import { ATTRIBUTE_GROUP_LABELS, ATTRIBUTE_LABELS, POSITION_NAMES, attrClass } from './format.js';
import { initTabs, initTooltipGroup, openModal } from './motion.js';

// 슬라이딩 탭. items: [{ id, label }]
export function segmented(items, selectedId, onSelect, { size = '' } = {}) {
  const bar = h(
    'div',
    { class: `t-tabs seg ${size}`, role: 'tablist' },
    h('span', { class: 't-tabs-pill', 'aria-hidden': 'true' }),
    items.map((it) =>
      h('button', { class: 't-tab', role: 'tab', type: 'button', 'aria-selected': String(it.id === selectedId), dataset: { id: it.id } }, it.label),
    ),
  );
  const ctl = initTabs(bar, (tab) => onSelect(tab.dataset.id));
  return {
    el: bar,
    select(id, animate = true) {
      const tab = bar.querySelector(`[data-id="${id}"]`);
      if (tab) ctl.select(tab, animate);
    },
  };
}

// children 안의 [data-tooltip] 요소에 공용 툴팁을 붙인다
export function tooltipGroup(className, ...children) {
  const group = h(
    'div',
    { class: `t-tt-group ${className}` },
    ...children,
    h('span', { class: 't-tt', role: 'tooltip', 'aria-hidden': 'true', 'data-show': 'false' }, h('span', { class: 't-tt-text' })),
  );
  initTooltipGroup(group);
  return group;
}

export function panel(title, body, { actions = null, className = '' } = {}) {
  return h(
    'section',
    { class: `panel ${className}` },
    title && h('header', { class: 'panel-head' }, h('h2', {}, title), actions),
    body,
  );
}

// 부상·출장정지 칩 (출전 가능하면 null)
export function statusChip(game, id) {
  const a = availabilityOf(game, id);
  if (a.available) return null;
  return h('span', { class: `status-chip ${a.reason}`, title: `${a.label} · ${a.rounds}경기 결장` }, a.reason === 'injury' ? `부상 ${a.rounds}` : `정지 ${a.rounds}`);
}

export const condClass = (c) => (c >= 85 ? 'cond-good' : c >= 70 ? 'cond-ok' : 'cond-bad');

export function conditionMeter(c) {
  return h('span', { class: `cond ${condClass(c)}`, title: `컨디션 ${c}%` }, h('span', { style: { width: `${c}%` } }));
}

export function ratingBar(value, { max = 100, min = 40 } = {}) {
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return h('span', { class: 'bar' }, h('span', { class: 'bar-fill', style: { width: `${pct}%` } }));
}

// 선수 상세 모달. ctx가 있으면 이적 후 소속·부상·컨디션·가치까지 보여준다
// 최근 평점 (오래된 것부터)과 시즌 평균
function formLine(game, id) {
  const recent = formOf(game, id);
  const season = seasonRating(game, id);
  if (!recent.length && season == null) return null;
  return h(
    'span',
    { class: 'pm-form' },
    h('br'),
    '최근 평점 ',
    recent.length ? recent.map((r) => h('span', { class: `rt ${ratingClass(r)}` }, r.toFixed(1))) : '—',
    season != null ? ` · 시즌 평균 ${season.toFixed(2)}` : '',
  );
}

// 능력치 기준 안내 (data/leagues.json basis)
export function basisText(basis) {
  if (!basis) return '';
  const [y, m] = (basis.marketValues ?? '').split('-');
  return `능력치 기준: ${basis.marketValues ? `${y}년 ${Number(m)}월 시장가치(트랜스퍼마르크트) · ` : ''}${basis.stats} 시즌 기록 · 데이터 ${basis.generated}`;
}

export function openPlayerModal(dataset, player, ctx = null) {
  const game = ctx?.game;
  const teamId = game ? currentTeamId(dataset, game, player.id) : player.teamId;
  const team = teamId ? dataset.teamById.get(teamId) : null;
  const nation = dataset.nationByCode.get(player.nationality);
  const avail = game ? availabilityOf(game, player.id) : null;
  const stats = game?.playerStats[player.id];
  const potential = game ? scoutedPotential(game, player, overall(player)) : null;
  const extra = game
    ? h(
        'p',
        { class: 'muted pm-extra' },
        `가치 ${formatMoney(playerValue(player))} · 컨디션 ${conditionOf(game, player.id)}%`,
        potential ? h('span', { class: 'pm-potential' }, ` · 잠재력 ${potential.low}~${potential.high}`) : '',
        formLine(game, player.id),
        stats ? ` · ${stats.apps ?? 0}경기 ${stats.goals}골 ${stats.assists}도움` : '',
        avail && !avail.available ? h('span', { class: `status-chip ${avail.reason}` }, `${avail.label} ${avail.rounds}경기`) : null,
      )
    : null;
  const close = h('button', { class: 'btn ghost icon', type: 'button', 'aria-label': '닫기' }, '✕');

  const groups = Object.entries(ATTRIBUTE_GROUPS).map(([group, keys]) =>
    h(
      'div',
      { class: 'attr-group' },
      h('h3', {}, ATTRIBUTE_GROUP_LABELS[group]),
      h(
        'table',
        { class: 'attr-table' },
        h('tbody', {}, keys.map((k) => h('tr', {}, h('td', {}, ATTRIBUTE_LABELS[k]), h('td', { class: `num ${attrClass(player.attributes[k])}` }, player.attributes[k])))),
      ),
    ),
  );

  const byPosition = POSITIONS.map((pos) => ({ pos, value: positionRating(player, pos) * positionFit(player, pos) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 4);

  const content = h(
    'div',
    { class: 'player-modal' },
    h(
      'header',
      { class: 'pm-head' },
      h('div', { class: 'pm-ovr' }, h('span', { class: 'pm-ovr-num' }, overall(player)), h('span', { class: 'pm-ovr-label' }, 'OVR')),
      h(
        'div',
        { class: 'pm-title' },
        h('h2', {}, player.name),
        h('p', {}, h('span', { class: 'pos-tag' }, player.position), ` ${POSITION_NAMES[player.position]}`, player.altPositions.length ? ` · 보조 ${player.altPositions.join(', ')}` : ''),
        h('p', { class: 'muted' }, team ? [teamBadge(team, 16), ` ${team.name} · `] : '무소속 · ', `${player.age}세 · ${nation?.nameKo ?? player.nationality}`),
        extra,
      ),
      close,
    ),
    h('div', { class: 'attr-groups' }, groups),
    h(
      'footer',
      { class: 'pm-foot' },
      h('span', { class: 'muted' }, '포지션별 능력'),
      byPosition.map(({ pos, value }) => h('span', { class: 'pos-score' }, h('b', {}, pos), ` ${Math.round(value)}`)),
    ),
    h(
      'p',
      { class: 'muted small-note pm-basis' },
      '잠재력은 23세 이하이면서 더 클 여지가 3 이상인 선수만 범위로 보입니다. ',
      basisText(dataset.basis),
    ),
  );
  const closeModal = openModal(content);
  close.addEventListener('click', closeModal);
}

// 확인 모달. onConfirm 후 닫힌다
export function openConfirm({ title, body, confirmLabel, onConfirm }) {
  const ok = h('button', { class: 'btn primary', type: 'button' }, confirmLabel);
  const cancel = h('button', { class: 'btn ghost', type: 'button' }, '취소');
  const closeModal = openModal(
    h('div', { class: 'confirm-modal' }, h('h2', {}, title), h('div', { class: 'confirm-body' }, body), h('div', { class: 'confirm-actions' }, cancel, ok)),
  );
  cancel.addEventListener('click', closeModal);
  let done = false; // Enter 연타 등으로 두 번 실행되지 않게
  ok.addEventListener('click', () => {
    if (done) return;
    done = true;
    closeModal();
    onConfirm();
  });
  ok.focus();
}
