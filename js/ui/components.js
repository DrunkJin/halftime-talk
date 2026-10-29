// 여러 화면에서 쓰는 UI 조각
import { ATTRIBUTE_GROUPS, POSITIONS } from '../data/schema.js';
import { overall, positionFit, positionRating } from '../engine/ratings.js';
import { formatMoney, playerValue } from '../market/value.js';
import { availabilityOf, conditionOf, currentTeamId, loanOf } from '../state/game.js';
import { fitLabel, rolesFor } from '../engine/roles.js';
import { scoutedPotential } from '../state/newSeason.js';
import { formOf, ratingClass, seasonRating } from '../state/form.js';
import { canTalk, isRequesting, levelOf, moodOf, promiseOf, rolesOf, shareOf, talk } from '../state/squadMood.js';
import { MOOD } from '../state/moodConfig.js';
import { SCOUT, assignmentOf, ovrView, scoutSlotsLeft, sendScout } from '../state/scouting.js';
import { loadTalks, pickTalk } from '../media/talks.js';
import { teamBadge } from './badge.js';
import { h } from './dom.js';
import { getLang, t } from '../i18n.js';
import { ATTRIBUTE_GROUP_LABELS, ATTRIBUTE_LABELS, POSITION_NAMES, attrClass } from './format.js';
import { learnLevel, learnWord } from '../state/positions.js';
import { initTabs, initTooltipGroup, openModal, showToast } from './motion.js';

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
      bar.classList.toggle('is-none', !tab);
      if (tab) ctl.select(tab, animate);
      else bar.querySelectorAll('.t-tab').forEach((t) => t.setAttribute('aria-selected', 'false')); // 탭에 없는 화면 (편지함 등)
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
  return h('span', { class: `status-chip ${a.reason}`, title: t('components.status.title', { label: a.label, n: a.rounds }) }, t(a.reason === 'injury' ? 'components.status.injury' : 'components.status.ban', { n: a.rounds }));
}

export const condClass = (c) => (c >= 85 ? 'cond-good' : c >= 70 ? 'cond-ok' : 'cond-bad');

export function conditionMeter(c) {
  return h('span', { class: `cond ${condClass(c)}`, title: t('components.condition', { c }) }, h('span', { style: { width: `${c}%` } }));
}

export function ratingBar(value, { max = 100, min = 40 } = {}) {
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  return h('span', { class: 'bar' }, h('span', { class: 'bar-fill', style: { width: `${pct}%` } }));
}

// 주 포지션에서 능력치가 잘 맞는 역할 (없으면 줄을 그리지 않는다)
function suitedRoles(player) {
  const roles = rolesFor(player.position).filter((r) => fitLabel(player, player.position, r)?.cls === 'fit-good');
  if (!roles.length) return null;
  return h('p', { class: 'pm-roles' }, h('span', { class: 'muted' }, t('components.player.suitedRoles')), roles.map((r) => r.label).join(', '));
}

// 임대 중이면 원소속·임대 구단 한 줄
function loanLine(dataset, game, player) {
  const loan = game && loanOf(game, player.id);
  if (!loan) return null;
  const name = (id) => dataset.teamById.get(id)?.name ?? '';
  return h('p', { class: 'pm-loan' }, h('span', { class: 'loan-tag' }, t('components.loan.tag')), t('components.loan.line', { from: name(loan.from), to: name(loan.to) }));
}

// 선수 상세 모달. ctx가 있으면 이적 후 소속·부상·컨디션·가치까지 보여준다
// 면담: 역할·출전 기대·기분, 선수의 첫마디와 선택지 4개 (같은 선수는 몇 라운드에 한 번)
function moodSection(dataset, game, player, ctx) {
  const box = h('section', { class: 'pm-mood' }, h('p', { class: 'muted' }, t('components.loading')));
  const draw = (talks, reply = null) => {
    const role = rolesOf(dataset, game).get(player.id);
    const mood = moodOf(game, player.id);
    const level = isRequesting(game, player.id) ? { id: 'request', label: t('components.mood.request') } : levelOf(mood);
    const share = shareOf(game, player.id);
    const promise = promiseOf(game, player.id);
    const vars = { name: player.name, role: role?.label ?? '' };
    const opening = pickTalk(talks?.opening?.[level.id], `${game.seed}:${player.id}:${game.seasonIndex}:${game.round}`, vars);
    const facts = h(
      'p',
      { class: 'pm-mood-facts' },
      h('span', { class: `mood-chip mood-${level.id}` }, level.label),
      t('components.mood.expect', { role: role?.label ?? '', pct: Math.round((role?.expect ?? 0) * 100) }),
      share != null ? t('components.mood.recent', { n: MOOD.window, pct: Math.round(share * 100) }) : t('components.mood.noRecord'),
      promise ? t('components.mood.promise', { left: promise.left, starts: Math.max(0, promise.starts - promise.got) }) : '',
    );
    const options = Object.entries(MOOD.talks).map(([id, opt]) => {
      const b = h('button', { class: 'btn small', type: 'button', disabled: !canTalk(game, player.id) || (id === 'promise' && promise) || (id === 'allowTransfer' && isRequesting(game, player.id) && game.squadMood.requests[player.id]?.allowed) || null }, opt.label);
      b.addEventListener('click', () => {
        const res = talk(dataset, game, player.id, id);
        ctx.persist();
        const key = !res.ok ? res.reason : id === 'compete' ? (res.delta >= 0 ? 'competeAccept' : 'competeHurt') : id;
        draw(talks, pickTalk(talks?.reply?.[key], `${game.seed}:${player.id}:${id}:${game.round}`, vars) || (res.ok ? '…' : t('components.mood.busy')));
        ctx.refreshTopbar?.();
      });
      return b;
    });
    box.replaceChildren(
      ...[
      h('h3', {}, t('components.mood.title')),
      facts,
      h('blockquote', { class: 'pm-quote' }, reply ?? opening),
      level.id === 'happy' && !reply ? h('p', { class: 'muted small-note' }, t('components.mood.happy')) : null,
      h('div', { class: 'btn-row' }, options),
      !canTalk(game, player.id) ? h('p', { class: 'muted small-note' }, t('components.mood.cooldown', { n: MOOD.cooldown })) : null,
      ].filter(Boolean),
    );
  };
  loadTalks().then((talks) => draw(talks));
  return box;
}

// 모르는 선수: 스카우트 파견 (보고서는 몇 라운드 뒤 편지함으로)
function scoutSection(dataset, game, player, ctx) {
  const box = h('section', { class: 'pm-scout' });
  const draw = () => {
    const a = assignmentOf(game, player.id);
    const b = h('button', { class: 'btn small primary', type: 'button', disabled: a || scoutSlotsLeft(game) <= 0 || null }, a ? t('components.scout.watching', { n: Math.max(0, a.readyRound - game.round) }) : t('components.scout.send'));
    b.addEventListener('click', () => {
      const r = sendScout(dataset, game, player);
      if (r.ok) {
        ctx.persist();
        showToast(t('components.scout.sent', { name: player.name, n: r.rounds }));
      }
      draw();
    });
    box.replaceChildren(
      h('p', {}, t('components.scout.unknown')),
      h('div', { class: 'btn-row' }, b, h('span', { class: 'muted small-note' }, t('components.scout.slots', { used: SCOUT.slots - scoutSlotsLeft(game), slots: SCOUT.slots }))),
    );
  };
  draw();
  return box;
}

// 최근 평점 (오래된 것부터)과 시즌 평균
function formLine(game, id) {
  const recent = formOf(game, id);
  const season = seasonRating(game, id);
  if (!recent.length && season == null) return null;
  return h(
    'span',
    { class: 'pm-form' },
    h('br'),
    t('components.form.recent'),
    recent.length ? recent.map((r) => h('span', { class: `rt ${ratingClass(r)}` }, r.toFixed(1))) : '—',
    season != null ? t('components.form.season', { avg: season.toFixed(2) }) : '',
  );
}

// 능력치 기준 안내 (data/leagues.json basis)
export function basisText(basis) {
  if (!basis) return '';
  const [y, m] = (basis.marketValues ?? '').split('-');
  const vars = { y, m: Number(m), stats: basis.statsPartial ? t('components.basis.partial', { range: basis.stats }) : basis.stats, date: basis.generated };
  return basis.marketValues ? t('components.basis.full', vars) : t('components.basis.short', vars);
}

// 포지션 전환으로 익히고 있는 자리 (숫자 대신 단계 말로)
function learnedLine(player) {
  const entries = Object.entries(player.posLearn ?? {}).filter(([, v]) => learnLevel(v) !== 'new').sort((a, b) => b[1] - a[1]);
  if (!entries.length) return null;
  return h('p', { class: 'pm-learned' }, h('span', { class: 'muted' }, t('components.player.learning')), entries.map(([pos, v], i) => [i ? ' · ' : ' ', h('b', {}, pos), ` ${learnWord(v)}`]));
}

export function openPlayerModal(dataset, player, ctx = null) {
  const game = ctx?.game;
  const teamId = game ? currentTeamId(dataset, game, player.id) : player.teamId;
  const team = teamId ? dataset.teamById.get(teamId) : null;
  const nation = dataset.nationByCode.get(player.nationality);
  const avail = game ? availabilityOf(game, player.id) : null;
  const stats = game?.playerStats[player.id];
  // 스카우팅: 모르는 선수는 OVR 범위만, 세부 능력치·잠재력·포지션별 능력은 가린다
  const view = game ? ovrView(dataset, game, player) : { known: true, ovr: overall(player) };
  const hidden = !view.known;
  const potential = game && !hidden ? scoutedPotential(game, player, overall(player)) : null;
  const extra = game
    ? h(
        'p',
        { class: 'muted pm-extra' },
        t('components.player.valueCond', { value: formatMoney(playerValue(player)), cond: conditionOf(game, player.id) }),
        potential ? h('span', { class: 'pm-potential' }, t('components.player.potential', { low: potential.low, high: potential.high })) : '',
        formLine(game, player.id),
        stats ? t('components.player.stats', { apps: stats.apps ?? 0, goals: stats.goals, assists: stats.assists }) : '',
        avail && !avail.available ? h('span', { class: `status-chip ${avail.reason}` }, t('components.player.out', { label: avail.label, n: avail.rounds })) : null,
      )
    : null;
  const close = h('button', { class: 'btn ghost icon', type: 'button', 'aria-label': t('components.close') }, '✕');

  const groups = Object.entries(ATTRIBUTE_GROUPS).map(([group, keys]) =>
    h(
      'div',
      { class: 'attr-group' },
      h('h3', {}, ATTRIBUTE_GROUP_LABELS[group]),
      h(
        'table',
        { class: 'attr-table' },
        h('tbody', {}, keys.map((k) => h('tr', {}, h('td', {}, ATTRIBUTE_LABELS[k]), hidden ? h('td', { class: 'num muted' }, '?') : h('td', { class: `num ${attrClass(player.attributes[k])}` }, player.attributes[k])))),
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
      h('div', { class: `pm-ovr${hidden ? ' is-range' : ''}` }, h('span', { class: 'pm-ovr-num' }, hidden ? `${view.low}~${view.high}` : overall(player)), h('span', { class: 'pm-ovr-label' }, 'OVR')),
      h(
        'div',
        { class: 'pm-title' },
        h('h2', {}, player.name),
        h('p', {}, h('span', { class: 'pos-tag' }, player.position), ` ${POSITION_NAMES[player.position]}`, player.altPositions.length ? t('components.player.alt', { alts: player.altPositions.join(', ') }) : ''),
        h('p', { class: 'muted' }, team ? [teamBadge(team, 16), ` ${team.name} · `] : t('components.player.free'), t('components.player.ageNation', { age: player.age, nation: (getLang() === 'ko' ? nation?.nameKo : nation?.name) ?? player.nationality })),
        loanLine(dataset, game, player),
        learnedLine(player),
        extra,
      ),
      close,
    ),
    game && ctx && teamId === game.teamId ? moodSection(dataset, game, player, ctx) : null,
    hidden && ctx ? scoutSection(dataset, game, player, ctx) : null,
    h('div', { class: 'attr-groups' }, groups),
    h(
      'footer',
      { class: 'pm-foot' },
      h('span', { class: 'muted' }, t('components.player.byPosition')),
      hidden ? h('span', { class: 'muted' }, t('components.player.scoutToSee')) : byPosition.map(({ pos, value }) => h('span', { class: 'pos-score' }, h('b', {}, pos), ` ${Math.round(value)}`)),
    ),
    hidden ? null : suitedRoles(player),
    h(
      'p',
      { class: 'muted small-note pm-basis' },
      t('components.player.potentialNote'),
      basisText(dataset.basis),
    ),
  );
  const closeModal = openModal(content);
  close.addEventListener('click', closeModal);
}

// 확인 모달. onConfirm 후 닫힌다
export function openConfirm({ title, body, confirmLabel, onConfirm }) {
  const ok = h('button', { class: 'btn primary', type: 'button' }, confirmLabel);
  const cancel = h('button', { class: 'btn ghost', type: 'button' }, t('components.cancel'));
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
