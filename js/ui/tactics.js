// 전술 지시·포메이션 고르기 UI 조각 (경기 전 화면, 경기 중 감독 지시 창에서 같이 쓴다)
import { TACTICS } from '../engine/config.js';
import { FORMATION_CELLS, GRID_COLUMNS, GRID_ROWS } from '../engine/formations.js';
import { segmented } from './components.js';
import { h } from './dom.js';

const KINDS = [
  { kind: 'mentality', label: '멘탈리티' },
  { kind: 'pressing', label: '압박' },
  { kind: 'style', label: '공격 방식' },
];

// 선택지 설명 (효과의 방향만, 수치는 engine/config.js)
const HINTS = {
  mentality: {
    veryDefensive: '라인을 깊게 내리고 버팁니다. 실점은 크게 줄지만 공격이 거의 없습니다.',
    defensive: '수비에 무게를 둡니다. 약팀이 강팀을 상대할 때 좋습니다.',
    balanced: '공격과 수비의 균형을 맞춥니다.',
    attacking: '더 많은 선수가 공격에 가담합니다. 골도, 실점도 늘어납니다.',
    veryAttacking: '모든 것을 걸고 골을 노립니다. 뒷공간이 크게 열립니다.',
  },
  pressing: {
    low: '내려앉아 공간을 지웁니다. 체력과 카드가 줄지만 공을 덜 가집니다.',
    normal: '평소대로 압박합니다.',
    high: '높은 위치에서 공을 뺏습니다. 결정적 찬스가 늘지만 빨리 지치고 카드가 늘어납니다.',
  },
  style: {
    short: '짧은 패스로 점유하며 질 좋은 찬스를 만듭니다. 슈팅 수는 줄어듭니다.',
    mixed: '상황에 맞게 섞어 씁니다.',
    direct: '빠르게 전방으로 보냅니다. 슈팅은 많아지지만 점유를 내줍니다.',
  },
};

export const tacticLabel = (kind, id) => TACTICS[kind][id].label;
export const tacticSummary = (t) => KINDS.map(({ kind }) => tacticLabel(kind, t[kind])).join(' · ');

// 전술 선택기. onChange(새 전술 객체)는 바꿀 때마다 호출
export function tacticsPicker(initial, onChange) {
  const value = { ...initial };
  const rows = KINDS.map(({ kind, label }) => {
    const hint = h('p', { class: 'tac-hint muted' }, HINTS[kind][value[kind]]);
    const items = Object.entries(TACTICS[kind]).map(([id, o]) => ({ id, label: o.label }));
    const seg = segmented(items, value[kind], (id) => {
      value[kind] = id;
      hint.textContent = HINTS[kind][id];
      onChange({ ...value });
    }, { size: 'small' });
    return h('div', { class: 'tac-row' }, h('span', { class: 'tac-label' }, label), h('div', { class: 'tac-control' }, seg.el, hint));
  });
  return h('div', { class: 'tactics-picker' }, rows);
}

// 포메이션 미니 피치 (공격이 위)
export function miniPitch(cells, { size = 'small' } = {}) {
  const pitch = h('div', { class: `mini-pitch ${size}`, style: { '--cols': GRID_COLUMNS, '--rows': GRID_ROWS } });
  for (const [col, row] of cells) {
    pitch.append(h('span', { class: `mp-dot${row === 0 ? ' gk' : ''}`, style: { gridColumn: col + 1, gridRow: GRID_ROWS - row } }));
  }
  return pitch;
}

// 포메이션 카드 목록. options: [{ id, label, cells }], onSelect(id)
export function formationPicker(options, selectedId, onSelect) {
  const cards = options.map((o) => {
    const card = h('button', { type: 'button', class: `formation-card${o.id === selectedId ? ' is-selected' : ''}`, 'aria-pressed': String(o.id === selectedId) }, miniPitch(o.cells), h('span', {}, o.label));
    card.addEventListener('click', () => {
      cards.forEach((c) => {
        c.classList.toggle('is-selected', c === card);
        c.setAttribute('aria-pressed', String(c === card));
      });
      onSelect(o.id);
    });
    return card;
  });
  return h('div', { class: 'formation-cards' }, cards);
}

export const presetFormationOptions = () => Object.entries(FORMATION_CELLS).map(([id, cells]) => ({ id, label: id, cells }));
