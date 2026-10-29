// 전술 계산: 선수 구성 프로필 → 전술 적합도, 두 팀 전술의 상성, AI 팀 전술 성향.
// 수치는 config.js (PROFILE · TACTIC_FIT · MATCHUPS · AI_IDENTITY). DOM 없음 — 엔진·화면이 같이 쓴다
import * as C from './config.js';
import { t as tr } from '../i18n.js';
import { weightedSkill } from './ratings.js';

export const PROFILE_KEYS = ['energy', 'technique', 'speed', 'backPace', 'aerial', 'shape'];
// 성향 이름 (읽을 때 사전에서: engine.profile.*)
export const PROFILE_LABELS = Object.defineProperties(
  {},
  Object.fromEntries(PROFILE_KEYS.map((k) => [k, { get: () => tr(`engine.profile.${k}`), enumerable: true }])),
);

// 성향마다: 어느 자리 선수의 어떤 능력치로 보는지
const PROFILE_SPEC = {
  energy: { slots: ['LB', 'RB', 'CB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'], skill: { stamina: 0.45, workRate: 0.45, pace: 0.1 } },
  technique: { slots: ['CB', 'DM', 'CM', 'LB', 'RB'], skill: { passing: 0.4, firstTouch: 0.3, composure: 0.3 } },
  speed: { slots: ['LW', 'RW', 'ST', 'AM'], skill: { pace: 0.7, agility: 0.15, dribbling: 0.15 } },
  backPace: { slots: ['CB', 'LB', 'RB'], skill: { pace: 0.8, agility: 0.2 } },
  aerial: { slots: ['LB', 'RB', 'LW', 'RW', 'ST', 'CB'], skill: { crossing: 0.5, heading: 0.5 } },
  shape: { slots: ['CB', 'LB', 'RB', 'DM'], skill: { positioning: 0.4, marking: 0.35, tackling: 0.25 } },
};

// 크로스·제공권은 측면은 크로스, 중앙(ST·CB)은 헤딩으로만 본다
const AERIAL_BY_SLOT = { LB: { crossing: 1 }, RB: { crossing: 1 }, LW: { crossing: 1 }, RW: { crossing: 1 }, ST: { heading: 1 }, CB: { heading: 1 } };

// 경기장 선수(slots[i]에 lineup[i]) → { energy, ..., ref } (ref = 여섯 성향 평균: 팀 자신의 수준)
export function squadProfile(slots, lineup) {
  const out = {};
  for (const key of PROFILE_KEYS) {
    const spec = PROFILE_SPEC[key];
    let sum = 0;
    let n = 0;
    lineup.forEach((p, i) => {
      if (!p || !spec.slots.includes(slots[i])) return;
      sum += weightedSkill(p.attributes, key === 'aerial' ? AERIAL_BY_SLOT[slots[i]] : spec.skill);
      n++;
    });
    out[key] = n ? sum / n : 50;
  }
  out.ref = PROFILE_KEYS.reduce((s, k) => s + out[k], 0) / PROFILE_KEYS.length;
  return out;
}

const clampUnits = (v) => Math.max(-C.PROFILE.maxUnits, Math.min(C.PROFILE.maxUnits, v));
// 팀 안에서 이 성향이 두드러지는 정도 (단위)
export const strengthOf = (profile, key) => clampUnits((profile[key] - profile.ref) / C.PROFILE.unit);
// 두 팀 사이 비교 (단위)
const edge = (a, b) => clampUnits((a - b) / C.PROFILE.unit);

// 지시 하나의 이득 배율에 곱할 적합도 (1 = 그대로)
export function fitScale(profile, kind, value) {
  const keys = C.TACTIC_FIT[kind]?.[value];
  if (!keys || !profile) return 1;
  const units = keys.reduce((s, k) => s + strengthOf(profile, k), 0) / keys.length;
  return Math.max(0, 1 + C.TACTIC_FIT.scale * units);
}

// 상성 배율: 두 팀(전술·프로필) → { home: {...}, away: {...} } (없는 항목은 1)
export function matchupFactors(a, b) {
  const fa = blank();
  const fb = blank();
  applyRules(a, b, fa, fb);
  applyRules(b, a, fb, fa);
  const [lo, hi] = C.MATCHUPS.limits;
  for (const f of [fa, fb]) for (const k of Object.keys(f)) f[k] = Math.max(lo, Math.min(hi, f[k]));
  return [fa, fb];
}

const blank = () => ({ attack: 1, midfield: 1, defense: 1, attempts: 1, bigChance: 1, header: 1 });

// me 쪽 전술이 opp 상대로 만드는 효과를 me·opp 배율에 더한다
function applyRules(me, opp, mf, of) {
  const M = C.MATCHUPS;
  const t = me.tactics;
  const o = opp.tactics;

  // 역습
  const counterUnits = (t.pressing === 'low' ? 1 : 0) + (t.style === 'direct' ? 1 : 0);
  const exposure = (M.counter.exposure.mentality[o.mentality] ?? 0) + (M.counter.exposure.pressing[o.pressing] ?? 0);
  if (counterUnits && exposure) {
    const pace = Math.max(0, 1 + M.counter.paceWeight * edge(me.profile.speed, opp.profile.backPace));
    mf.bigChance *= 1 + M.counter.bigChance * counterUnits * exposure * pace;
    mf.attempts *= 1 + M.counter.attempts * counterUnits * exposure * pace;
  }

  // 압박 vs 빌드업
  const styleWeight = M.press.styleWeight[o.style] ?? 0;
  if (t.pressing === 'high' && styleWeight) {
    const e = edge(me.profile.energy, opp.profile.technique) * styleWeight;
    if (e > 0) {
      of.midfield *= 1 - M.press.oppMidfield * e;
      mf.bigChance *= 1 + M.press.bigChance * e;
    } else if (e < 0) {
      of.bigChance *= 1 + M.press.oppBigChanceIfBeaten * -e;
      mf.defense *= 1 - M.press.defenseIfBeaten * -e;
    }
  }

  // 수비 블록 vs 점유
  if (t.pressing === 'low' && o.style === 'short') {
    const s = Math.max(0, 1 + M.lowBlock.shapeWeight * strengthOf(me.profile, 'shape'));
    of.attempts *= 1 - M.lowBlock.oppAttempts * s;
    of.bigChance *= 1 - M.lowBlock.oppBigChance * s;
  }

  // 측면·직선 공격 vs 내려앉은 팀
  if (t.style === 'direct' && o.pressing === 'low') {
    const a = Math.max(0, 1 + M.crossing.aerialWeight * edge(me.profile.aerial, opp.profile.shape));
    mf.attempts *= 1 + M.crossing.attempts * a;
    mf.header *= 1 + M.crossing.header * a;
  }
}

// AI 팀의 압박·스타일: 선수 구성에서 가장 두드러진 쪽. gap = 우리 - 상대 필드 레이팅 평균
export function aiIdentity(profile, gap) {
  const A = C.AI_IDENTITY;
  const T = C.AI_TACTICS;
  const best = (kind, options) => {
    let pick = C.TACTICS.defaults[kind];
    let score = A.threshold;
    for (const value of options) {
      const keys = C.TACTIC_FIT[kind][value];
      const units = keys.reduce((s, k) => s + strengthOf(profile, k), 0) / keys.length;
      if (units > score) [pick, score] = [value, units];
    }
    return pick;
  };
  let pressing = best('pressing', ['high', 'low']);
  let style = best('style', ['short', 'direct']);
  if (gap >= T.favoriteGap && style === 'mixed') style = A.favoriteStyle;
  if (A.underdogPressing && gap <= -T.underdogGap && pressing === 'normal') pressing = A.underdogPressing;
  return { pressing, style };
}

// 화면용: me 쪽에서 본 상성·적합도 설명 → [{ good, text }]
export function matchupNotes(me, opp) {
  const M = C.MATCHUPS;
  const t = me.tactics;
  const o = opp.tactics;
  const notes = [];
  const exposureOf = (x) => (M.counter.exposure.mentality[x.mentality] ?? 0) + (M.counter.exposure.pressing[x.pressing] ?? 0);
  const counters = (x) => x.pressing === 'low' || x.style === 'direct';

  if (counters(t) && exposureOf(o)) {
    const faster = edge(me.profile.speed, opp.profile.backPace);
    const extra = faster > 0.3 ? tr('engine.note.counter.faster') : faster < -0.3 ? tr('engine.note.counter.slower') : '';
    notes.push({ good: true, text: tr(o.pressing === 'high' ? 'engine.note.counter.vsPress' : 'engine.note.counter.vsAttacking', { extra }) });
  }
  if (counters(o) && exposureOf(t)) notes.push({ good: false, text: tr(t.pressing === 'high' ? 'engine.note.oppCounter.press' : 'engine.note.oppCounter.attacking') });

  const pressNote = (x, y, mine) => {
    const w = M.press.styleWeight[y.tactics.style] ?? 0;
    if (x.tactics.pressing !== 'high' || !w) return;
    const e = edge(x.profile.energy, y.profile.technique) * w;
    if (Math.abs(e) < 0.15) return;
    const pressWins = e > 0;
    notes.push(
      mine
        ? { good: pressWins, text: tr(pressWins ? 'engine.note.press.wins' : 'engine.note.press.beaten') }
        : { good: !pressWins, text: tr(pressWins ? 'engine.note.oppPress.wins' : 'engine.note.oppPress.beaten') },
    );
  };
  pressNote(me, opp, true);
  pressNote(opp, me, false);

  if (t.pressing === 'low' && o.style === 'short') notes.push({ good: true, text: tr('engine.note.lowBlock') });
  if (o.pressing === 'low' && t.style === 'short') notes.push({ good: false, text: tr('engine.note.shortVsLowBlock') });
  if (t.style === 'direct' && o.pressing === 'low') notes.push({ good: true, text: tr('engine.note.crossing', { extra: edge(me.profile.aerial, opp.profile.shape) < -0.3 ? tr('engine.note.crossing.weak') : '' }) });
  if (o.style === 'direct' && t.pressing === 'low') notes.push({ good: false, text: tr('engine.note.oppCrossing') });

  // 우리 선수 구성과의 궁합
  for (const kind of ['pressing', 'style']) {
    const keys = C.TACTIC_FIT[kind][t[kind]];
    if (!keys) continue;
    const units = keys.reduce((s, k) => s + strengthOf(me.profile, k), 0) / keys.length;
    const what = keys.map((k) => PROFILE_LABELS[k]).join(tr('engine.note.fit.join'));
    const label = C.TACTICS[kind][t[kind]].label;
    if (units >= 0.4) notes.push({ good: true, text: tr('engine.note.fit.good', { label, what }) });
    else if (units <= -0.4) notes.push({ good: false, text: tr('engine.note.fit.bad', { label, what }) });
  }
  return notes;
}
