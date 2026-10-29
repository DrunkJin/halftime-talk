// 전술 지시·포메이션 고르기 UI 조각 (경기 전 화면, 경기 중 감독 지시 창에서 같이 쓴다)
import { TACTICS } from '../engine/config.js';
import { FORMATION_CELLS, GRID_COLUMNS, GRID_ROWS } from '../engine/formations.js';
import { segmented } from './components.js';
import { h } from './dom.js';
import { t } from '../i18n.js';

const KINDS = [
  { kind: 'mentality', get label() { return t('tactics.kind.mentality'); } },
  { kind: 'pressing', get label() { return t('tactics.kind.pressing'); } },
  { kind: 'style', get label() { return t('tactics.kind.style'); } },
];

// 선택지 설명 (효과의 방향만, 수치는 engine/config.js). 문장은 data/i18n/*/tactics.json의 tactics.hint.{종류}.{선택지}
const hintText = (kind, id) => t(`tactics.hint.${kind}.${id}`);

export const tacticLabel = (kind, id) => TACTICS[kind][id].label;
export const tacticSummary = (tac) => KINDS.map(({ kind }) => tacticLabel(kind, tac[kind])).join(' · ');

// 전술 선택기. onChange(새 전술 객체)는 바꿀 때마다 호출
export function tacticsPicker(initial, onChange) {
  const value = { ...initial };
  const rows = KINDS.map(({ kind, label }) => {
    const hint = h('p', { class: 'tac-hint muted' }, hintText(kind, value[kind]));
    const items = Object.entries(TACTICS[kind]).map(([id, o]) => ({ id, label: o.label }));
    const seg = segmented(items, value[kind], (id) => {
      value[kind] = id;
      hint.textContent = hintText(kind, id);
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
