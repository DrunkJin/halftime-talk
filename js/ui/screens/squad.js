// 스쿼드: 피치 자유 배치 포메이션 + 선발 배치(드래그 또는 클릭 두 번) + 스쿼드 표 + 팀 레이팅 + 교체 명단
import { bestLeader, bestPenaltyTaker, bestSetPieceTaker, captainBoostOf, leadership } from '../../state/captain.js';
import { PENALTIES } from '../../engine/config.js';
import { isRequesting, levelOf, moodOf, promiseOf, rolesOf, shareOf } from '../../state/squadMood.js';
import { formAverage, formOf, ratingClass, seasonRating } from '../../state/form.js';
import { POSITIONS } from '../../data/schema.js';
import { FORMATION_CELLS, FORMATION_IDS, GK_ROW, GRID_COLUMNS, GRID_ROWS, formationName, positionOfCell } from '../../engine/formations.js';
import { autoSelectLineup } from '../../engine/lineup.js';
import { defaultRole, fitLabel, roleOf, rolesFor, slotMods } from '../../engine/roles.js';
import { computeTeamRatings, conditionFactor, overall, positionFit, positionRating } from '../../engine/ratings.js';
import { availabilityOf, conditionOf, fixLineup, leagueOf, lineupProblems, previewUserBench, squadOf, userRoles, userSlots } from '../../state/game.js';
import { condClass, conditionMeter, openPlayerModal, panel, ratingBar, segmented, statusChip, tooltipGroup } from '../components.js';
import { h } from '../dom.js';
import { ATTRIBUTE_LABELS, POSITION_NAMES, attrClass, fmt1, shortName } from '../format.js';
import { openModal, setDigits, showToast } from '../motion.js';

// 격자 칸 중심 좌표 (%). 위쪽이 상대 골문
const COL_X = [10, 30, 50, 70, 90];
const ROW_Y = [91, 75, 60, 46, 31, 14];

const ATTR_COLUMNS = ['pace', 'finishing', 'passing', 'dribbling', 'vision', 'tackling', 'heading', 'stamina', 'gkReflexes'];
const ATTR_SHORT = { pace: '속도', finishing: '결정', passing: '패스', dribbling: '드리블', vision: '시야', tackling: '태클', heading: '헤딩', stamina: '체력', gkReflexes: 'GK' };
const UNITS = [
  ['attack', '공격'],
  ['midfield', '중원'],
  ['defense', '수비'],
  ['goalkeeping', 'GK'],
];
const POS_ORDER = new Map(POSITIONS.map((p, i) => [p, i]));

const fitClass = (fit) => (fit >= 0.95 ? 'fit-good' : fit >= 0.8 ? 'fit-ok' : 'fit-bad');
const sameCells = (a, b) => a.length === b.length && a.every((c, i) => c[0] === b[i][0] && c[1] === b[i][1]);

// 주장·페널티 키커·세트피스 키커 지정 (비우면 자동: 리더십·페널티·크로스가 가장 좋은 선수)
function rolesPanel(ctx) {
  const { dataset, game } = ctx;
  const box = h('div', { class: 'roles-panel' });
  const draw = () => {
    const squad = squadOf(dataset, game, game.teamId).sort((a, b) => overall(b) - overall(a));
    const lineup = game.lineup.map((id) => dataset.playerById.get(id)).filter(Boolean);
    const autos = { captain: bestLeader(lineup), penaltyTaker: bestPenaltyTaker(lineup, PENALTIES.takerSkill), setPieceTaker: bestSetPieceTaker(lineup) };
    const rows = [
      { key: 'captain', label: '주장', note: (p) => `리더십 ${Math.round(leadership(p))} · 경기력 +${(captainBoostOf(p) * 100).toFixed(1)}%`, hint: '경기장에 있으면 팀 경기력이 오릅니다. 선발에서 빠지면 부주장이 절반 효과를 냅니다. 불만인 주장은 라커룸 분위기를 해칩니다.' },
      { key: 'penaltyTaker', label: '페널티 키커', note: (p) => `결정력 ${p.attributes.finishing} · 침착성 ${p.attributes.composure}`, hint: '경기 중 페널티킥과 승부차기 1번 키커입니다.' },
      { key: 'setPieceTaker', label: '세트피스 키커', note: (p) => `크로스 ${p.attributes.crossing}`, hint: '크로스가 좋을수록 헤더 찬스가 늘고, 헤더 골의 도움을 자주 기록합니다.' },
    ];
    box.replaceChildren(
      ...rows.map((r) => {
        const current = game[r.key] && dataset.playerById.get(game[r.key]);
        const shown = current ?? autos[r.key];
        const sel = h(
          'select',
          { class: 'select small', 'aria-label': r.label },
          h('option', { value: '' }, `자동${autos[r.key] ? ` (${autos[r.key].name})` : ''}`),
          squad.filter((p) => p.position !== 'GK' || r.key === 'captain').map((p) => h('option', { value: p.id, selected: game[r.key] === p.id || null }, `${p.position} ${p.name}`)),
        );
        sel.addEventListener('change', () => {
          if (sel.value) game[r.key] = sel.value;
          else delete game[r.key];
          ctx.persist();
          showToast(`${r.label}: ${sel.value ? dataset.playerById.get(sel.value).name : '자동'}`);
          draw();
        });
        return h('div', { class: 'role-row', title: r.hint }, h('span', { class: 'role-label' }, r.label), sel, h('span', { class: 'muted small-note' }, shown ? r.note(shown) : ''));
      }),
      h('p', { class: 'muted small-note' }, '지정한 선수가 경기장에 없으면 그 경기에서는 자동으로 다른 선수가 맡습니다.'),
    );
  };
  draw();
  return box;
}

// 기분 칩: 만족·보통·불만·이적 요청 (+ 출전 약속 중)
function moodChip(game, id, role) {
  const mood = moodOf(game, id);
  const level = levelOf(mood);
  const share = shareOf(game, id);
  const promise = promiseOf(game, id);
  const title = `${role?.label ?? ''} · 기대 출전 ${Math.round((role?.expect ?? 0) * 100)}%${share != null ? ` · 최근 ${Math.round(share * 100)}%` : ''}${promise ? ` · 출전 약속 (남은 ${promise.left}경기 중 ${promise.starts - promise.got}경기 선발)` : ''}`;
  return h('span', { class: `mood-chip mood-${isRequesting(game, id) ? 'request' : level.id}`, title }, isRequesting(game, id) ? '이적 요청' : level.label, promise ? ' · 약속' : '');
}

// 폼 칸: 최근 5경기 평균 (시즌 평균), 마우스를 올리면 경기별 평점
function formCell(game, id) {
  const avg = formAverage(game, id);
  const season = seasonRating(game, id);
  if (avg == null && season == null) return h('td', { class: 'num muted' }, '—');
  return h(
    'td',
    { class: 'num', title: `최근 ${formOf(game, id).join(' · ') || '—'}${season != null ? ` / 시즌 평균 ${season.toFixed(2)}` : ''}` },
    h('span', { class: `rt ${ratingClass(avg ?? season)}` }, (avg ?? season).toFixed(1)),
  );
}

export function render(ctx) {
  const { dataset, game } = ctx;
  const byId = dataset.playerById;
  const squad = () => squadOf(dataset, game, game.teamId);
  const factorOf = (p) => conditionFactor(conditionOf(game, p.id));

  // 클릭 두 번 배치용 선택 상태, 드래그 중인 대상
  let selection = null; // { kind: 'player', id } | { kind: 'slot', index }
  let dragging = null;

  const pitchEl = h('div', { class: 'pitch' });
  const tableHost = h('div', { class: 'table-host' });
  const warnHost = h('div');
  const benchHost = h('div');
  const formationHead = h('div', { class: 'head-actions' });
  const ratingRows = {};
  const ratingList = h(
    'div',
    { class: 'unit-ratings' },
    UNITS.map(([key, label]) => {
      const digits = h('span', { class: 't-digit-group' });
      const bar = ratingBar(0, { min: 55, max: 90 });
      ratingRows[key] = { digits, bar };
      return h('div', { class: 'unit-row' }, h('span', { class: 'muted' }, label), bar, h('b', { class: 'num' }, digits));
    }),
  );
  const xiOvr = h('span', { class: 't-digit-group' });

  const lineupPlayers = () => game.lineup.map((id) => byId.get(id));

  // ── 배치 규칙 ───────────────────────────────────────
  function canPlay(id) {
    const a = availabilityOf(game, id);
    if (a.available) return true;
    showToast(`${byId.get(id).name}: ${a.label} (${a.rounds}경기 결장)`, { tone: 'warn' });
    return false;
  }

  function assignPlayerToSlot(playerId, slotIndex) {
    const from = game.lineup.indexOf(playerId);
    if (from === slotIndex) return refresh();
    if (from < 0 && !canPlay(playerId)) return refresh();
    if (from >= 0) [game.lineup[from], game.lineup[slotIndex]] = [game.lineup[slotIndex], game.lineup[from]];
    else game.lineup[slotIndex] = playerId;
    game.bench = (game.bench ?? []).filter((id) => id !== playerId); // 선발로 올리면 교체 명단에서 뺀다
    changed([slotIndex, from].filter((i) => i >= 0));
  }

  // 교체 명단 넣기·빼기 (선발 선수·결장자는 못 넣음)
  const benchSize = () => leagueOf(dataset, game).rules.matchday.benchSize;
  function toggleBench(id) {
    const bench = game.bench ?? [];
    if (bench.includes(id)) {
      game.bench = bench.filter((x) => x !== id);
      return changed();
    }
    if (game.lineup.includes(id)) return showToast('선발 선수는 교체 명단에 넣을 수 없습니다.', { tone: 'warn' });
    if (!canPlay(id)) return;
    if (bench.length >= benchSize()) return showToast(`교체 명단은 ${benchSize()}명까지입니다. 먼저 한 명을 빼세요.`, { tone: 'warn' });
    game.bench = [...bench, id];
    changed();
  }

  // 역할: 자리(슬롯)에 붙는다. 처음 바꿀 때 코치진 추천 전체를 세이브에 고정
  const roleAt = (i) => roleOf(userSlots(game)[i], userRoles(dataset, game)[i]);
  function setRoleAt(i, roleId) {
    game.roles = [...userRoles(dataset, game)];
    game.roles[i] = roleId;
    changed([i]);
  }

  // 슬롯을 빈 칸으로 옮긴다 → 그 칸의 포지션이 슬롯 포지션이 된다
  function moveSlotToCell(slotIndex, cell) {
    if (game.formation.cells[slotIndex][1] === GK_ROW) {
      showToast('골키퍼 자리는 옮길 수 없습니다. 선수끼리 바꾸세요.', { tone: 'warn' });
      return refresh();
    }
    game.formation.cells[slotIndex] = cell;
    changed([slotIndex]);
  }

  function applyPreset(id) {
    const cells = FORMATION_CELLS[id].map((c) => [...c]);
    if (sameCells(cells, game.formation.cells)) return;
    // 지금 선발 11명을 유지한 채 새 포메이션 슬롯에 다시 배치
    const prevRoles = new Map(game.lineup.map((id, i) => [id, { pos: userSlots(game)[i], role: userRoles(dataset, game)[i] }]));
    game.lineup = autoSelectLineup(lineupPlayers(), cells.map(positionOfCell), factorOf).map((p) => p.id);
    game.formation.cells = cells;
    if (game.roles) game.roles = game.lineup.map((id, i) => (prevRoles.get(id)?.pos === userSlots(game)[i] ? prevRoles.get(id).role : null));
    changed(game.lineup.map((_, i) => i));
  }

  function onSlotClick(i) {
    if (selection?.kind === 'player') return assignPlayerToSlot(selection.id, i);
    if (selection?.kind === 'slot' && selection.index !== i) return assignPlayerToSlot(game.lineup[selection.index], i);
    if (selection?.kind === 'slot') {
      selection = null;
      renderPitch();
      return renderTable();
    }
    openSlotPicker(i);
  }

  // 피치 위 선수를 누르면: 이 자리에 대신 넣을 선수 고르기 (후보 · 다른 선발과 맞바꾸기 · 포메이션 위치 옮기기)
  function openSlotPicker(i) {
    const pos = userSlots(game)[i];
    const current = byId.get(game.lineup[i]);
    const valueAt = (p) => Math.round(positionRating(p, pos) * positionFit(p, pos) * conditionFactor(conditionOf(game, p.id)));
    const inBench = new Set(game.bench ?? []);
    const row = (p, extra) => {
      const avail = availabilityOf(game, p.id);
      const fit = positionFit(p, pos);
      const btn = h(
        'button',
        { type: 'button', class: `pick-row${avail.available ? '' : ' is-unavailable'}` },
        h('span', { class: 'pos-tag' }, p.position),
        h('span', { class: 'pick-name' }, p.name, extra ? h('small', { class: 'muted' }, ` ${extra}`) : null, inBench.has(p.id) ? h('small', { class: 'bench-mark' }, ' 교체 명단') : null),
        h('span', { class: 'pick-status' }, avail.available ? conditionMeter(conditionOf(game, p.id)) : statusChip(game, p.id)),
        h('span', { class: `pick-value num ${attrClass(valueAt(p))}`, title: `${pos} 자리 능력 (적합도 ${Math.round(fit * 100)}%)` }, valueAt(p), fit < 1 ? h('small', { class: 'muted' }, ` ${Math.round(fit * 100)}%`) : null),
      );
      return btn;
    };
    const subs = squad()
      .filter((p) => !game.lineup.includes(p.id))
      .sort((a, b) => availabilityOf(game, b.id).available - availabilityOf(game, a.id).available || valueAt(b) - valueAt(a));
    const others = game.lineup.map((id, j) => ({ p: byId.get(id), j })).filter(({ j }) => j !== i);
    let close = null;
    const choose = (id) => {
      close();
      assignPlayerToSlot(id, i);
      showToast(`${pos}: ${current.name} → ${byId.get(id).name}`);
    };
    const subRows = subs.map((p) => {
      const r = row(p);
      r.addEventListener('click', () => choose(p.id));
      return r;
    });
    const swapRows = others.map(({ p, j }) => {
      const r = row(p, `(지금 ${userSlots(game)[j]})`);
      r.addEventListener('click', () => choose(p.id));
      return r;
    });
    const info = h('button', { type: 'button', class: 'btn small ghost' }, '선수 정보');
    info.addEventListener('click', () => {
      close();
      openPlayerModal(dataset, current, ctx);
    });
    const move = pos === 'GK' ? null : h('button', { type: 'button', class: 'btn small ghost' }, '포메이션에서 위치 옮기기');
    move?.addEventListener('click', () => {
      close();
      selection = { kind: 'slot', index: i };
      renderPitch();
      renderTable();
      showToast('옮길 빈 칸을 누르세요 (다시 누르면 취소)');
    });
    const cancel = h('button', { type: 'button', class: 'btn ghost' }, '닫기');
    // 역할: 누르면 바로 바뀐다. 적합도는 지금 이 자리 선수 기준 (숫자 없이 단계로)
    const roleHost = h('div', { class: 'role-picker' });
    const renderRoles = () => {
      const now = roleAt(i);
      const buttons = rolesFor(pos).map((r) => {
        const fl = fitLabel(current, pos, r);
        const b = h('button', { type: 'button', class: `role-btn${r.id === now?.id ? ' is-active' : ''}`, 'aria-pressed': String(r.id === now?.id) }, h('span', {}, r.label), fl ? h('small', { class: `role-fit ${fl.cls}` }, fl.label) : h('small', { class: 'role-fit muted' }, '기본'));
        b.addEventListener('click', () => {
          setRoleAt(i, r.id);
          renderRoles();
        });
        return b;
      });
      roleHost.replaceChildren(h('div', { class: 'role-list' }, buttons), h('p', { class: 'role-desc muted small-note' }, now?.desc ?? ''));
    };
    renderRoles();
    close = openModal(
      h(
        'div',
        { class: 'confirm-modal slot-picker' },
        h('h2', {}, `${pos} ${current.name}`),
        rolesFor(pos).length > 1 ? [h('h3', {}, '역할'), roleHost] : null,
        h('h3', {}, '대신 넣을 선수'),
        h('p', { class: 'muted small-note' }, `오른쪽 숫자는 ${pos} 자리에서 낼 능력(컨디션 반영)입니다. 누르면 바로 바뀌고, 빠진 선수는 후보로 내려갑니다.`),
        h('h4', { class: 'muted' }, `후보 ${subs.length}명`),
        h('div', { class: 'pick-list' }, subRows),
        h('details', { class: 'pick-swap' }, h('summary', {}, '선발끼리 자리 바꾸기'), h('div', { class: 'pick-list' }, swapRows)),
        h('div', { class: 'confirm-actions' }, info, move, cancel),
      ),
    );
    cancel.addEventListener('click', close);
  }

  function onCellClick(cell) {
    if (selection?.kind === 'slot') moveSlotToCell(selection.index, cell);
  }

  function onRowClick(id) {
    if (selection?.kind === 'slot') return assignPlayerToSlot(id, selection.index);
    selection = selection?.kind === 'player' && selection.id === id ? null : { kind: 'player', id };
    renderPitch();
    renderTable();
  }

  // ── 드래그 ──────────────────────────────────────────
  function dropTarget(el, onDrop) {
    el.addEventListener('dragover', (e) => {
      if (!dragging) return;
      e.preventDefault();
      el.classList.add('is-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('is-over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('is-over');
      const d = dragging;
      dragging = null;
      pitchEl.classList.remove('is-arranging');
      if (d) onDrop(d);
    });
  }

  function dragSource(el, payload) {
    el.setAttribute('draggable', 'true');
    el.addEventListener('dragstart', (e) => {
      dragging = payload;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', JSON.stringify(payload));
      el.classList.add('is-dragging');
      // 슬롯을 끄는 동안 빈 칸 가이드 표시
      if (payload.kind === 'slot') pitchEl.classList.add('is-arranging');
    });
    el.addEventListener('dragend', () => {
      dragging = null;
      el.classList.remove('is-dragging');
      pitchEl.classList.remove('is-arranging');
    });
  }

  // ── 렌더 ────────────────────────────────────────────
  function renderFormationHead() {
    const cells = game.formation.cells;
    const preset = FORMATION_IDS.find((id) => sameCells(FORMATION_CELLS[id], cells));
    const items = FORMATION_IDS.map((id) => ({ id, label: id }));
    if (!preset) items.push({ id: 'custom', label: formationName(cells) });
    const tabs = segmented(items, preset ?? 'custom', (id) => id !== 'custom' && applyPreset(id), { size: 'small' });
    const auto = h('button', { class: 'btn small', type: 'button' }, '자동 선발');
    auto.addEventListener('click', () => {
      const available = squad().filter((p) => availabilityOf(game, p.id).available);
      game.lineup = autoSelectLineup(available, userSlots(game), factorOf).map((p) => p.id);
      changed(game.lineup.map((_, i) => i));
      showToast('출전 가능한 가장 강한 선발로 바꿨습니다');
    });
    formationHead.replaceChildren(tabs.el, auto);
  }

  function renderPitch(flash = []) {
    const cells = game.formation.cells;
    const occupied = new Set(cells.map(([c, r]) => `${c},${r}`));
    const arranging = selection?.kind === 'slot' && cells[selection.index][1] !== GK_ROW;

    // 빈 칸: 슬롯을 끌거나 슬롯을 선택했을 때만 보인다
    const targets = [];
    for (let row = 1; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLUMNS; col++) {
        if (occupied.has(`${col},${row}`)) continue;
        const cell = h('button', { type: 'button', class: 'cell-target', style: { left: `${COL_X[col]}%`, top: `${ROW_Y[row]}%` }, tabindex: arranging ? '0' : '-1', 'aria-label': `${positionOfCell([col, row])} 자리로 이동` }, positionOfCell([col, row]));
        cell.addEventListener('click', () => onCellClick([col, row]));
        dropTarget(cell, (d) => (d.kind === 'slot' ? moveSlotToCell(d.index, [col, row]) : showToast('빈 칸에는 피치 위 선수를 옮겨 놓으세요', { tone: 'warn' })));
        targets.push(cell);
      }
    }

    const slots = userSlots(game);
    const chips = slots.map((pos, i) => {
      const p = byId.get(game.lineup[i]);
      const fit = positionFit(p, pos);
      const cond = conditionOf(game, p.id);
      const value = Math.round(positionRating(p, pos) * fit * conditionFactor(cond));
      const avail = availabilityOf(game, p.id);
      const selected = (selection?.kind === 'slot' && selection.index === i) || (selection?.kind === 'player' && selection.id === p.id);
      const [col, row] = cells[i];
      const chip = h(
        'button',
        {
          type: 'button',
          class: `slot ${fitClass(fit)}${selected ? ' is-selected' : ''}${flash.includes(i) ? ' is-flash' : ''}${avail.available ? '' : ' is-unavailable'}`,
          style: { left: `${COL_X[col]}%`, top: `${ROW_Y[row]}%` },
          title: `${POSITION_NAMES[pos]} · ${roleAt(i)?.label ?? ''} · ${p.name} · 컨디션 ${cond}%${fit < 1 ? ` · 적합도 ${Math.round(fit * 100)}%` : ''}${avail.available ? '' : ` · ${avail.label}`}`,
        },
        h('span', { class: 'slot-pos' }, pos),
        h('span', { class: `slot-ovr ${attrClass(value)}` }, value),
        h('span', { class: 'slot-name' }, shortName(p.name)),
        roleAt(i)?.short ? h('span', { class: 'slot-role' }, roleAt(i).short) : null,
        h('span', { class: `slot-cond ${condClass(cond)}` }, h('span', { style: { width: `${cond}%` } })),
        avail.available ? null : h('span', { class: `slot-flag ${avail.reason}` }, avail.reason === 'injury' ? '+' : '!'),
      );
      chip.addEventListener('click', () => onSlotClick(i));
      dragSource(chip, { kind: 'slot', index: i });
      dropTarget(chip, (d) => (d.kind === 'slot' ? assignPlayerToSlot(game.lineup[d.index], i) : assignPlayerToSlot(d.id, i)));
      return chip;
    });
    pitchEl.classList.toggle('is-arranging', arranging);
    pitchEl.replaceChildren(h('div', { class: 'pitch-lines' }), ...targets, ...chips);
  }

  function renderTable() {
    const slots = userSlots(game);
    const slotOf = new Map(game.lineup.map((id, i) => [id, i]));
    const starters = game.lineup.map((id) => byId.get(id));
    const bench = squad()
      .filter((p) => !slotOf.has(p.id))
      .sort((a, b) => POS_ORDER.get(a.position) - POS_ORDER.get(b.position) || overall(b) - overall(a));

    const head = h(
      'tr',
      {},
      h('th', { 'data-tooltip': '선발 슬롯' }, '슬롯'),
      h('th', { 'data-tooltip': '교체 명단 (누르면 넣기·빼기)' }, '교체'),
      h('th', {}, '포지션'),
      h('th', {}, '이름'),
      h('th', { 'data-tooltip': '부상·출장정지 (남은 경기)' }, '상태'),
      h('th', { 'data-tooltip': '출전 시간 만족도 (선수를 눌러 면담)' }, '기분'),
      h('th', { 'data-tooltip': '컨디션: 경기를 뛰면 떨어지고 라운드마다 회복' }, '컨디션'),
      h('th', { class: 'num' }, '나이'),
      h('th', {}, '국적'),
      h('th', { class: 'num', 'data-tooltip': '종합 능력치 (주 포지션 기준)' }, 'OVR'),
      h('th', { class: 'num', 'data-tooltip': '최근 5경기 평균 평점 (시즌 평균)' }, '폼'),
      ATTR_COLUMNS.map((k) => h('th', { class: 'num', 'data-tooltip': ATTRIBUTE_LABELS[k] }, ATTR_SHORT[k])),
    );

    const roles = rolesOf(dataset, game);
    const row = (p, isStarter) => {
      const slotIndex = slotOf.get(p.id);
      const selected = selection?.kind === 'player' && selection.id === p.id;
      const avail = availabilityOf(game, p.id);
      const cond = conditionOf(game, p.id);
      const nameButton = h('button', { class: 'link', type: 'button' }, p.name);
      nameButton.addEventListener('click', (e) => {
        e.stopPropagation();
        openPlayerModal(dataset, p, ctx);
      });
      const tr = h(
        'tr',
        { class: `${isStarter ? 'is-starter' : 'is-bench'}${selected ? ' is-selected' : ''}${avail.available ? '' : ' is-unavailable'}` },
        h('td', {}, isStarter ? h('span', { class: 'slot-tag' }, slots[slotIndex]) : h('span', { class: 'muted' }, '—')),
        h('td', {}, isStarter ? null : benchToggle(p.id)),
        h('td', {}, h('span', { class: 'pos-tag' }, p.position), p.altPositions.length ? h('span', { class: 'alt muted' }, ` ${p.altPositions.join(' ')}`) : ''),
        h('td', { class: 'name-cell' }, nameButton),
        h('td', {}, statusChip(game, p.id)),
        h('td', {}, moodChip(game, p.id, roles.get(p.id))),
        h('td', {}, conditionMeter(cond)),
        h('td', { class: 'num' }, p.age),
        h('td', { title: dataset.nationByCode.get(p.nationality)?.nameKo }, p.nationality),
        h('td', { class: `num ovr ${attrClass(overall(p))}` }, overall(p)),
        formCell(game, p.id),
        ATTR_COLUMNS.map((k) => h('td', { class: `num ${attrClass(p.attributes[k])}` }, p.attributes[k])),
      );
      tr.addEventListener('click', () => onRowClick(p.id));
      // 키보드로도 선수를 고른다 (Tab으로 줄에 와서 Enter·Space). 안쪽 이름 버튼은 선수 창을 연다
      tr.tabIndex = 0;
      tr.setAttribute('aria-label', `${p.name} ${isStarter ? `선발 ${slots[slotIndex]}` : '후보'} — Enter로 선택`);
      tr.addEventListener('keydown', (e) => {
        if (e.target !== tr || (e.key !== 'Enter' && e.key !== ' ')) return;
        e.preventDefault();
        onRowClick(p.id);
        tableHost.querySelector(`tr[data-pid="${p.id}"]`)?.focus(); // 표를 다시 그려도 포커스는 그 줄에
      });
      tr.dataset.pid = p.id;
      dragSource(tr, { kind: 'player', id: p.id });
      // 슬롯 칩을 표의 선수 위에 놓으면 그 선수가 그 슬롯으로
      dropTarget(tr, (d) => d.kind === 'slot' && assignPlayerToSlot(p.id, d.index));
      return tr;
    };

    const table = h(
      'table',
      { class: 'data squad-table' },
      h('thead', {}, head),
      h('tbody', {}, starters.map((p) => row(p, true)), h('tr', { class: 'divider' }, h('td', { colspan: 11 + ATTR_COLUMNS.length }, `교체 · 후보 ${bench.length}명`)), bench.map((p) => row(p, false))),
    );
    tableHost.replaceChildren(tooltipGroup('tt-block', h('div', { class: 'table-scroll' }, table)));
  }

  function renderWarnings() {
    const problems = lineupProblems(dataset, game);
    if (problems.length === 0) return warnHost.replaceChildren();
    const fix = h('button', { class: 'btn small primary', type: 'button' }, '자동으로 대체');
    fix.addEventListener('click', () => {
      const n = fixLineup(dataset, game);
      changed(problems.map((p) => p.slot));
      showToast(`${n}명을 출전 가능한 선수로 바꿨습니다`);
    });
    warnHost.replaceChildren(
      h('div', { class: 'warn-banner' }, h('span', {}, h('b', {}, `선발에 출전할 수 없는 선수 ${problems.length}명`), ' — 경기 전에 바꿔야 합니다.'), fix),
    );
  }

  function benchToggle(id) {
    const on = (game.bench ?? []).includes(id);
    const btn = h('button', { type: 'button', class: `bench-toggle${on ? ' on' : ''}`, 'aria-pressed': String(on), title: on ? '교체 명단에서 빼기' : '교체 명단에 넣기' }, on ? '●' : '○');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleBench(id);
    });
    return btn;
  }

  // 교체 명단: 직접 고른 선수(●) + 경기 때 자동으로 채울 선수(자동)
  function renderBench() {
    const chosen = new Set(game.bench ?? []);
    const preview = previewUserBench(dataset, game);
    const autoAll = h('button', { class: 'btn small ghost', type: 'button' }, '자동 구성으로 고정');
    autoAll.addEventListener('click', () => {
      game.bench = preview.map((p) => p.id);
      changed();
    });
    const clear = h('button', { class: 'btn small ghost', type: 'button' }, '비우기');
    clear.addEventListener('click', () => {
      game.bench = [];
      changed();
    });
    const list = h(
      'table',
      { class: 'data compact bench-list' },
      h(
        'tbody',
        {},
        preview.map((p) => {
          const mine = chosen.has(p.id);
          const remove = mine ? h('button', { class: 'link', type: 'button', 'aria-label': `${p.name} 빼기` }, '✕') : h('span', { class: 'muted auto-tag' }, '자동');
          if (mine) remove.addEventListener('click', () => toggleBench(p.id));
          return h(
            'tr',
            { class: mine ? 'is-chosen' : '' },
            h('td', {}, h('span', { class: 'pos-tag' }, p.position)),
            h('td', {}, p.name),
            h('td', {}, conditionMeter(conditionOf(game, p.id))),
            h('td', { class: `num ${attrClass(overall(p))}` }, overall(p)),
            h('td', { class: 'num' }, remove),
          );
        }),
      ),
    );
    const host = h('div', { class: 'bench-drop' }, list, h('div', { class: 'btn-row bench-actions' }, h('span', { class: 'muted' }, `직접 ${chosen.size}/${benchSize()}명 · 나머지 자동`), autoAll, clear));
    // 표의 선수를 끌어다 놓으면 명단에 추가
    dropTarget(host, (d) => d.kind === 'player' && !(game.bench ?? []).includes(d.id) && toggleBench(d.id));
    benchHost.replaceChildren(host);
  }

  function updateRatings() {
    const r = computeTeamRatings(userSlots(game), lineupPlayers(), factorOf, slotMods(userSlots(game), lineupPlayers(), userRoles(dataset, game)));
    for (const [key] of UNITS) {
      setDigits(ratingRows[key].digits, fmt1(r[key]));
      const pct = Math.max(0, Math.min(100, ((r[key] - 55) / 35) * 100));
      ratingRows[key].bar.firstChild.style.width = `${pct}%`;
    }
    setDigits(xiOvr, fmt1(lineupPlayers().reduce((s, p) => s + overall(p), 0) / game.lineup.length));
  }

  function refresh(flash = []) {
    selection = null;
    renderFormationHead();
    renderWarnings();
    renderPitch(flash);
    renderTable();
    renderBench();
    updateRatings();
  }

  function changed(flash) {
    refresh(flash);
    ctx.persist();
  }

  refresh();

  const hint = h(
    'p',
    { class: 'hint muted' },
    '피치 위 선수를 누르면 대신 넣을 선수를 고를 수 있습니다 (선발끼리 자리 바꾸기·포메이션 위치 옮기기도 같은 창에서). PC에서는 표의 선수를 피치로 끌어 놓아도 됩니다. 이름을 누르면 상세 능력치.',
  );

  return h(
    'div',
    { class: 'squad-screen' },
    h(
      'div',
      { class: 'squad-left' },
      panel('포메이션', h('div', { class: 'pitch-wrap' }, pitchEl), { actions: formationHead }),
      panel('팀 레이팅', h('div', { class: 'ratings-body' }, ratingList, h('div', { class: 'xi-ovr' }, h('span', { class: 'muted' }, '선발 평균 OVR'), h('b', { class: 'num' }, xiOvr)))),
      panel('교체 명단', benchHost),
      panel('주장·전담 키커', rolesPanel(ctx)),
    ),
    h('div', { class: 'squad-right' }, warnHost, panel('스쿼드', h('div', {}, hint, tableHost), { actions: h('span', { class: 'muted' }, `${squad().length}명`) })),
  );
}
