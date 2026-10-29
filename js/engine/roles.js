// 선수 역할·개별 지시. 수치는 config.js ROLES · INSTRUCTIONS
// 역할은 자리(슬롯)에 붙고, 개별 지시는 선수에게 붙는다 (그 경기 동안).
// slotMods가 둘을 합쳐 슬롯별 효과를 만들고, 엔진(match.js recalc)과 팀 레이팅(ratings.js)이 그 효과를 쓴다.
import { INSTRUCTIONS, ROLES } from './config.js';
import { positionRating, weightedSkill } from './ratings.js';

const clamp = (v, [min, max]) => Math.min(max, Math.max(min, v));
const UNITS = ['attack', 'midfield', 'defense'];
const SHOT_KEYS = ['open', 'long', 'header', 'big'];

export const rolesFor = (pos) => ROLES.byPosition[pos] ?? [];
export const defaultRole = (pos) => rolesFor(pos)[0] ?? null;
// 그 자리에 없는 역할 id면 기본 역할
export const roleOf = (pos, id) => rolesFor(pos).find((r) => r.id === id) ?? defaultRole(pos);

// 역할 능력 - 자리 능력 (기본 역할은 0)
export function roleGap(p, pos, role) {
  if (!p || !role?.skill) return 0;
  return weightedSkill(p.attributes, role.skill) - positionRating(p, pos);
}
export const roleFit = (p, pos, role) => clamp(1 + roleGap(p, pos, role) * ROLES.fitSlope, ROLES.fitRange);
// 화면용 적합도 단계 { label, cls } (기본 역할은 null)
export const fitLabel = (p, pos, role) => (role?.skill ? ROLES.fitLabels.find((l) => roleGap(p, pos, role) >= l.min) : null);

// AI 팀: 선수 능력이 뚜렷하게 맞는 역할만 (아니면 기본 역할)
export function aiRoleIds(slots, lineup) {
  return slots.map((pos, i) => {
    const p = lineup[i];
    let best = defaultRole(pos);
    let bestGap = ROLES.aiMinGain;
    for (const r of rolesFor(pos)) {
      const gap = roleGap(p, pos, r);
      if (r.skill && gap >= bestGap) [best, bestGap] = [r, gap];
    }
    return best?.id ?? null;
  });
}

const factor = (table, key) => table?.[key] ?? table?.all ?? 1;

// 슬롯별 효과: 역할 + 그 자리 선수의 개별 지시
// → [{ role, fit, unit: { attack, midfield, defense }, shoot: { open, ... }, assist: { ... }, drain, cards }]
export function slotMods(slots, lineup, roleIds = [], instructions = {}) {
  return slots.map((pos, i) => {
    const p = lineup[i];
    const role = roleOf(pos, roleIds?.[i]);
    const ins = (p && instructions?.[p.id]) || {};
    const parts = [role, ins.shooting && INSTRUCTIONS.shooting[ins.shooting], ins.runs && INSTRUCTIONS.runs[ins.runs]].filter(Boolean);
    const m = { role, fit: roleFit(p, pos, role), unit: {}, shoot: {}, assist: {}, drain: 1, cards: 1 };
    for (const u of UNITS) m.unit[u] = parts.reduce((s, x) => s + (x.unit?.[u] ?? 0), 0);
    for (const k of SHOT_KEYS) {
      m.shoot[k] = parts.reduce((s, x) => s * factor(x.shoot, k), 1);
      m.assist[k] = parts.reduce((s, x) => s * factor(x.assist, k), 1);
    }
    for (const x of parts) {
      m.drain *= x.drain ?? 1;
      m.cards *= x.cards ?? 1;
    }
    if (ins.mark) {
      m.drain *= INSTRUCTIONS.mark.drain;
      m.cards *= INSTRUCTIONS.mark.cards;
    }
    return m;
  });
}

// 팀 슈팅 종류 비중 배율 (역할의 mix 합)
export function roleMix(mods) {
  const mix = Object.fromEntries(SHOT_KEYS.map((k) => [k, 1]));
  for (const m of mods) for (const [k, v] of Object.entries(m.role?.mix ?? {})) mix[k] *= 1 + v;
  return mix;
}
