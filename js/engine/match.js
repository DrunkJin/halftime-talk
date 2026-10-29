// 경기 시뮬레이션. DOM을 쓰지 않는 순수 로직이라 메인 스레드·Web Worker·Node 어디서나 돈다.
//
// 매 분: 점유 팀 결정 → 카드 → 공격 시도 → 슈팅 → 득점 → 부상 → 체력 소모 → (60분 이후) 체력 교체
//
// 사용법
//   const result = simulateMatch({ home, away, seed })        한 번에 90분
//   const m = createMatch({ ... }); playMinute(m); ...         1분씩 (실시간 중계, 하프타임 개입용)
//   getMatchResult(m)
//
// 팀 입력: { id, name, formation: '4-3-3' | slots: ['GK', ...], lineup: Player[11], bench?: Player[], condition?: { [id]: 0~100 },
//            autoSubs?: boolean, tactics?: { mentality, pressing, style }, autoTactics?: boolean, boost?: number }
//   lineup[i]가 i번째 슬롯에 선다. bench가 없으면 교체 없이 진행
//   autoSubs: false면 체력 교체를 하지 않는다 (사용자가 makeSubstitution으로 직접). 부상 교체는 항상 자동
//   autoTactics: true(기본)면 AI 감독처럼 경기 전 전력 차·60분 이후 스코어로 멘탈리티를 정한다. 사용자 팀은 false
//   boost: 사기 등 추가 레이팅 배율 (0.02 = +2%)
// 경기 옵션 knockout: { prior: { home, away } | null } — 토너먼트. prior는 앞선 1차전에서 이 경기 홈·원정 팀이 넣은 골.
//   90분 뒤 합계가 같으면 연장 30분, 그래도 같으면 승부차기. 결과의 winner로 진출 팀을 알 수 있다
import * as C from './config.js';
import { commentText, shotPhrase } from './commentary.js';
import { resolveSlots } from './formations.js';
import { autoSelectLineup } from './lineup.js';
import { computeTeamRatings, conditionFactor, positionFit, positionRating, weightedSkill } from './ratings.js';
import { createRng, randomSeed } from './rng.js';
import { aiIdentity, fitScale, matchupFactors, squadProfile } from './tactics.js';

const opponentOf = (side) => (side === 'home' ? 'away' : 'home');
const clamp = (v, [min, max]) => Math.min(max, Math.max(min, v));
const SHOT_TYPE_KEYS = Object.keys(C.SHOT_TYPES);

function checkTeamInput(team, side) {
  const slots = resolveSlots(team?.slots ?? team?.formation);
  if (slots.filter((p) => p === 'GK').length !== 1) throw new Error(`${side}: GK 슬롯은 정확히 1개여야 합니다`);
  if (!Array.isArray(team.lineup) || team.lineup.length !== slots.length) {
    throw new Error(`${side}: 선발 ${slots.length}명이 필요합니다`);
  }
  const ids = [...team.lineup, ...(team.bench ?? [])].map((p) => p.id);
  if (new Set(ids).size !== ids.length) throw new Error(`${side}: 선발·교체 명단에 중복 선수`);
}

// ── 팀 상태 ───────────────────────────────────────────

function initTeam(team, boost) {
  const slots = [...resolveSlots(team.slots ?? team.formation)];
  const condition = new Map();
  for (const p of [...team.lineup, ...(team.bench ?? [])]) condition.set(p.id, team.condition?.[p.id] ?? 100);
  const t = {
    id: team.id,
    name: team.name,
    formation: team.formation ?? null,
    slots,
    lineup: [...team.lineup],
    bench: [...(team.bench ?? [])],
    boost,
    condition,
    minutes: new Map(team.lineup.map((p) => [p.id, 0])),
    roster: new Map([...team.lineup, ...(team.bench ?? [])].map((p) => [p.id, p])), // 평점용: 교체로 나간 선수까지
    slotOf: new Map(), // 선수가 마지막으로 선 자리 (평점 가중치)
    yellow: new Set(),
    subsUsed: 0,
    autoSubs: team.autoSubs ?? true,
    tactics: { ...C.TACTICS.defaults, ...team.tactics },
    autoTactics: team.autoTactics ?? true,
    styleGiven: Boolean(team.tactics?.pressing || team.tactics?.style), // 압박·스타일을 정해 왔으면 AI 성향으로 덮지 않는다
    profile: null, // 선수 구성 프로필 (tactics.js)
    mx: null, // 상성 배율
    baseMentality: null, // AI가 경기 전에 정한 멘탈리티 (스코어 조정 후 돌아갈 값)
  };
  recalc(t);
  return t;
}

// 전술 지시 → 항목별 배율 (세 지시의 곱). 압박·스타일의 이득은 선수 구성 적합도만큼 커지거나 줄어든다
const GAIN_KEYS = new Set(['attack', 'midfield', 'defense', 'attempts', 'bigChance']);
function tacticFactors(tactics, profile) {
  const f = { attack: 1, midfield: 1, defense: 1, attempts: 1, bigChance: 1, drain: 1, cards: 1 };
  for (const kind of ['mentality', 'pressing', 'style']) {
    const opt = C.TACTICS[kind][tactics[kind]];
    const fit = fitScale(profile, kind, tactics[kind]);
    for (const key of Object.keys(f)) {
      const v = opt[key] ?? 1;
      f[key] *= GAIN_KEYS.has(key) && v > 1 ? 1 + (v - 1) * fit : v;
    }
  }
  return f;
}

// 두 팀 프로필(지금 경기장 선수)과 전술로 상성 배율을 다시 구하고 레이팅을 갱신한다
function refreshMatchups(state) {
  const { home, away } = state.teams;
  for (const t of [home, away]) t.profile = squadProfile(t.slots, t.lineup);
  [home.mx, away.mx] = matchupFactors(home, away);
  recalc(home);
  recalc(away);
}

const factorFor = (t) => (p) => conditionFactor(t.condition.get(p.id));
const subLimit = (state) => C.SUBSTITUTIONS.max + (state.extraTime ? C.EXTRA_TIME.extraSubs : 0);

// 토너먼트 합계 (앞선 경기 + 이번 경기). 일반 경기는 이번 경기 스코어
const aggregateOf = (state, side) => state.score[side] + (state.knockout?.prior[side] ?? 0);

// 선발·컨디션이 바뀌면 다시 계산하는 값들
function recalc(t) {
  const factorOf = factorFor(t);
  const base = computeTeamRatings(t.slots, t.lineup, factorOf);
  const mult = 1 + t.boost;
  const mx = t.mx ?? { attack: 1, midfield: 1, defense: 1, attempts: 1, bigChance: 1, header: 1 };
  const tf = tacticFactors(t.tactics, t.profile);
  tf.attempts *= mx.attempts;
  tf.bigChance *= mx.bigChance;
  tf.header = mx.header;
  t.tf = tf;
  t.baseRatings = base; // 전술·홈 어드밴티지 반영 전
  t.ratings = {
    attack: base.attack * mult * tf.attack * mx.attack,
    midfield: base.midfield * mult * tf.midfield * mx.midfield,
    defense: base.defense * mult * tf.defense * mx.defense,
    goalkeeping: base.goalkeeping,
  };

  const skillOf = (weights, i) => {
    const p = t.lineup[i];
    return p ? weightedSkill(p.attributes, weights) * positionFit(p, t.slots[i]) * factorOf(p) : 0;
  };
  const pickWeight = (slotWeights, skill, i) => (t.lineup[i] ? slotWeights[t.slots[i]] * (skill / C.SKILL_REF) ** C.PLAYER_PICK_SKILL_EXP : 0);

  t.shooterSkill = {};
  t.shooterWeights = {};
  t.assistWeights = {};
  for (const key of SHOT_TYPE_KEYS) {
    const type = C.SHOT_TYPES[key];
    t.shooterSkill[key] = t.slots.map((_, i) => skillOf(type.shooterSkill, i));
    t.shooterWeights[key] = t.slots.map((_, i) => pickWeight(C.SHOOTER_SLOT_WEIGHTS[key], t.shooterSkill[key][i], i));
    t.assistWeights[key] = t.slots.map((_, i) => pickWeight(C.ASSIST_SLOT_WEIGHTS[key], skillOf(type.assistSkill, i), i));
  }
  t.defenderWeights = t.slots.map((_, i) => pickWeight(C.UNIT_SLOT_WEIGHTS.defense, skillOf(C.UNIT_SKILL_WEIGHTS.defense, i), i));
  t.cardWeights = t.slots.map((pos, i) => {
    const p = t.lineup[i];
    if (!p) return 0;
    const booked = t.yellow.has(p.id) ? C.CARDS.bookedFactor : 1;
    return C.CARDS.slotWeights[pos] * (1 + C.CARDS.composureEffect * (C.SKILL_REF - p.attributes.composure)) * booked;
  });
  t.gk = t.lineup[t.slots.indexOf('GK')];
}

// 큰 전력 차 완화 (config RATIO_SOFTCAP): knee 바깥 구간을 slope 배로
function softRatio(r) {
  const { knee, slope } = C.RATIO_SOFTCAP;
  if (r > knee) return knee + (r - knee) * slope;
  if (r < 1 / knee) return 1 / (knee + (1 / r - knee) * slope);
  return r;
}

const emptyStats = () => ({ shots: 0, shotsOnTarget: 0, possessionMinutes: 0, xg: 0, yellow: 0, red: 0 });

// 선수 개인 기록 (평점용). 경기 결과를 바꾸지 않는다
function pstat(state, id) {
  let s = state.pstats.get(id);
  if (!s) state.pstats.set(id, (s = { shots: 0, onTarget: 0, goals: 0, assists: 0, tackles: 0, saves: 0, conceded: 0, yellow: 0, red: 0 }));
  return s;
}

// 선수 평점 (3.0~10.0): 6.0에서 골·도움·슈팅·수비·선방·실점·카드·팀 결과·기량으로 가감, 짧게 뛰면 6.0 쪽으로.
// 경기용 난수는 쓰지 않는다 (평점용 별도 난수) → 경기 결과·밸런스에 영향 없음. 수치는 config.js RATING
export function playerRatings(state) {
  const R = C.RATING;
  const rng = createRng(`${state.seed}:ratings`);
  const out = {};
  for (const side of ['home', 'away']) {
    const t = state.teams[side];
    const opp = opponentOf(side);
    const diff = aggregateOf(state, side) - aggregateOf(state, opp);
    const result = diff > 0 ? R.win : diff < 0 ? R.loss : 0;
    const conceded = state.score[opp];
    for (const [id, minutes] of [...t.minutes].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (!minutes) continue;
      const p = t.roster.get(id);
      if (!p) continue;
      const slot = t.slotOf.get(id) ?? p.position;
      const s = state.pstats.get(id) ?? pstat(state, id);
      const line = slot === 'GK' ? 'gk' : ['CB', 'LB', 'RB'].includes(slot) ? 'def' : slot === 'DM' ? 'dm' : 'other';
      let r = R.base;
      r += s.goals * R.goal + s.assists * R.assist + s.onTarget * R.onTarget + (s.shots - s.onTarget) * R.offTarget;
      r += s.tackles * R.tackle + s.saves * R.save;
      r -= s.conceded * (R.conceded[line] ?? 0);
      if (conceded === 0 && minutes >= R.cleanSheetMinutes) r += R.cleanSheet[line] ?? 0;
      r -= s.yellow * R.yellow + s.red * R.red;
      r += result * Math.min(1, minutes / C.MATCH_MINUTES);
      r += ((positionRating(p, slot) * positionFit(p, slot) - state.levelRef) / R.skillScale);
      r += (rng.next() * 2 - 1) * R.noise;
      r = R.base + (r - R.base) * Math.min(1, minutes / R.fullMinutes); // 짧게 뛴 선수는 6.0 쪽으로
      out[id] = Math.round(Math.max(R.min, Math.min(R.max, r)) * 10) / 10;
    }
  }
  return out;
}

export function createMatch({ home, away, homeAdvantage = C.HOME_ADVANTAGE, seed = randomSeed(), knockout = null }) {
  checkTeamInput(home, 'home');
  checkTeamInput(away, 'away');
  const state = {
    seed,
    minute: 0,
    finished: false,
    rng: createRng(seed),
    textRng: createRng(`${seed}:text`),
    teams: { home: initTeam(home, homeAdvantage + (home.boost ?? 0)), away: initTeam(away, away.boost ?? 0) },
    score: { home: 0, away: 0 },
    goals: [],
    cards: [],
    injuries: [],
    subs: [],
    commentary: [],
    stats: { home: emptyStats(), away: emptyStats() },
    pstats: new Map(),
    knockout: knockout ? { prior: knockout.prior ?? { home: 0, away: 0 } } : null,
    extraTime: false,
    penalties: null,
  };
  state.levelRef = levelReference(state.teams);
  for (const t of Object.values(state.teams)) t.profile = squadProfile(t.slots, t.lineup);
  for (const side of ['home', 'away']) aiPreMatchTactics(state, side);
  refreshMatchups(state);
  comment(state, 'kickoff', null, { home: home.name, away: away.name });
  return state;
}

const fieldAverage = (r) => (r.attack + r.midfield + r.defense) / 3;

// 두 팀 필드 레이팅 평균 (전술·홈 어드밴티지 제외)
function levelReference(teams) {
  const avg = (fieldAverage(teams.home.baseRatings) + fieldAverage(teams.away.baseRatings)) / 2;
  return C.SKILL_REF + (avg - C.SKILL_REF) * C.LEVEL_REF_WEIGHT;
}

// ── 전술 (AI 감독) ────────────────────────────────────

// 경기 전: 약팀은 수비적, 강팀은 공격적. 압박·스타일은 선수 구성에 맞는 팀 성향 (정해 온 팀은 그대로)
function aiPreMatchTactics(state, side) {
  const t = state.teams[side];
  if (!t.autoTactics) return;
  const gap = fieldAverage(t.baseRatings) - fieldAverage(state.teams[opponentOf(side)].baseRatings);
  const A = C.AI_TACTICS;
  t.baseMentality = gap <= -A.underdogGap ? 'defensive' : gap >= A.favoriteGap ? 'attacking' : 'balanced';
  t.tactics.mentality = t.baseMentality;
  if (!t.styleGiven) Object.assign(t.tactics, aiIdentity(t.profile, gap));
}

// 경기 중: 지고 있으면 공격적으로, 이기고 있으면 수비적으로, 비기면 경기 전 계획대로
function aiInGameTactics(state, side) {
  const t = state.teams[side];
  const A = C.AI_TACTICS;
  if (!t.autoTactics || state.minute < A.fromMinute) return;
  const diff = aggregateOf(state, side) - aggregateOf(state, opponentOf(side));
  let want = t.baseMentality;
  if (diff < 0) want = state.minute >= A.lateMinute ? A.trailingLate : A.trailing;
  else if (diff > 0) want = A.leading;
  if (want === t.tactics.mentality) return;
  t.tactics.mentality = want;
  refreshMatchups(state);
  comment(state, 'tactic', side, { change: C.TACTICS.mentality[want].label });
}

function scoreText(state) {
  const { home, away } = state.teams;
  return `[${home.name} ${state.score.home}-${state.score.away} ${away.name}]`;
}

function comment(state, type, side, vars, playerId) {
  const text = commentText(type, { team: side ? state.teams[side].name : '', ...vars }, state.textRng);
  state.commentary.push({ minute: state.minute, type, team: side, playerId: playerId ?? null, text });
  return state.commentary.at(-1);
}


// ── 교체 · 퇴장 ───────────────────────────────────────

// 벤치에서 slotIndex에 가장 잘 맞는 선수. minFit 미만은 제외
function bestFromBench(t, pos, minFit = 0) {
  let best = null;
  let bestScore = -1;
  for (const p of t.bench) {
    const fit = positionFit(p, pos);
    if (fit < minFit) continue;
    const score = positionRating(p, pos) * fit * conditionFactor(t.condition.get(p.id));
    if (score > bestScore) [best, bestScore] = [p, score];
  }
  return best;
}

// replaced: 이미 자리에서 빠진 선수 (부상) — 기록·중계용
function substitute(state, side, slotIndex, incoming, reason, replaced = null) {
  const t = state.teams[side];
  const outgoing = t.lineup[slotIndex] ?? replaced;
  t.bench.splice(t.bench.indexOf(incoming), 1);
  t.lineup[slotIndex] = incoming;
  t.minutes.set(incoming.id, 0);
  t.subsUsed++;
  state.subs.push({ minute: state.minute, team: side, outId: outgoing?.id ?? null, outName: outgoing?.name ?? null, inId: incoming.id, inName: incoming.name, reason });
  comment(state, reason === 'injury' ? 'subInjury' : 'sub', side, { in: incoming.name, out: outgoing?.name ?? '' }, incoming.id);
}

// 필드 선수가 장갑을 낀다: GK 능력이 가장 나은 필드 선수를 골문으로 옮기고 그 자리는 비운다
function outfielderToGoal(state, side, gkIndex) {
  const t = state.teams[side];
  let best = -1;
  t.lineup.forEach((p, i) => {
    if (p && i !== gkIndex && (best < 0 || p.attributes.gkReflexes > t.lineup[best].attributes.gkReflexes)) best = i;
  });
  if (best < 0) return;
  t.lineup[gkIndex] = t.lineup[best];
  t.lineup[best] = null;
  comment(state, 'outfieldGk', side, { player: t.lineup[gkIndex].name }, t.lineup[gkIndex].id);
}

// 부상으로 빈 슬롯: 교체 가능하면 벤치에서, 아니면 한 명 적게 (GK 자리는 반드시 채운다)
function fillInjuryVacancy(state, side, slotIndex, injured) {
  const t = state.teams[side];
  const pos = t.slots[slotIndex];
  if (t.subsUsed < subLimit(state)) {
    const incoming = pos === 'GK' ? t.bench.find((p) => p.position === 'GK') ?? null : bestFromBench(t, pos);
    if (incoming) return substitute(state, side, slotIndex, incoming, 'injury', injured);
  }
  if (pos === 'GK') return outfielderToGoal(state, side, slotIndex);
  comment(state, 'shortHanded', side, { count: t.lineup.filter(Boolean).length });
}

// GK 퇴장: 교체 가능하면 가장 약한 필드 선수를 빼고 벤치 GK 투입 (인원 감소는 필드에서)
function replaceSentOffGk(state, side, gkIndex) {
  const t = state.teams[side];
  const benchGk = t.bench.find((p) => p.position === 'GK');
  const outIndex = weakestOutfield(t);
  if (t.subsUsed < subLimit(state) && benchGk && outIndex >= 0) {
    substitute(state, side, outIndex, benchGk, 'gk');
    // substitute는 outIndex 슬롯에 넣었으므로 GK 슬롯으로 옮기고 원래 자리는 비운다
    t.lineup[gkIndex] = benchGk;
    t.lineup[outIndex] = null;
    return;
  }
  outfielderToGoal(state, side, gkIndex);
}

function weakestOutfield(t) {
  let worst = -1;
  let worstScore = Infinity;
  t.lineup.forEach((p, i) => {
    if (!p || t.slots[i] === 'GK') return;
    const score = positionRating(p, t.slots[i]) * positionFit(p, t.slots[i]);
    if (score < worstScore) [worst, worstScore] = [i, score];
  });
  return worst;
}

// ── 이벤트 ────────────────────────────────────────────

function resolveCards(state, side) {
  const { rng } = state;
  const t = state.teams[side];
  let kind = null;
  if (rng.chance(C.CARDS.redPerMinute * t.tf.cards)) kind = 'red';
  else if (rng.chance(C.CARDS.yellowPerMinute * t.tf.cards)) kind = 'yellow';
  if (!kind) return false;

  const i = rng.weightedIndex(t.cardWeights);
  if (i < 0) return false;
  const p = t.lineup[i];
  const secondYellow = kind === 'yellow' && t.yellow.has(p.id);
  pstat(state, p.id)[kind === 'yellow' && !secondYellow ? 'yellow' : 'red']++;
  if (kind === 'yellow' && !secondYellow) {
    t.yellow.add(p.id);
    t.cardWeights[i] *= C.CARDS.bookedFactor;
    state.stats[side].yellow++;
    state.cards.push({ minute: state.minute, team: side, playerId: p.id, playerName: p.name, type: 'yellow', secondYellow: false });
    comment(state, 'yellow', side, { player: p.name }, p.id);
    return true;
  }
  state.stats[side].red++;
  if (secondYellow) state.stats[side].yellow++;
  state.cards.push({ minute: state.minute, team: side, playerId: p.id, playerName: p.name, type: 'red', secondYellow });
  comment(state, secondYellow ? 'secondYellow' : 'red', side, { player: p.name }, p.id);
  t.lineup[i] = null;
  // 퇴장 자리는 교체로 메우지 않는다. GK만 예외 (필드 선수를 빼고 GK 투입)
  if (t.slots[i] === 'GK') replaceSentOffGk(state, side, i);
  recalc(t);
  return true;
}

function resolveInjuries(state, side) {
  const { rng } = state;
  const t = state.teams[side];
  let changed = false;
  t.lineup.forEach((p, i) => {
    if (!p) return;
    const ageMult = 1 + Math.max(0, p.age - C.INJURY.ageFrom) * C.INJURY.agePerYear;
    const fatigueMult = 1 + (C.INJURY.fatigueMultiplier * (100 - t.condition.get(p.id))) / 100;
    if (!rng.chance(C.INJURY.perMinute * ageMult * fatigueMult)) return;

    const type = C.INJURY.types[rng.weightedIndex(C.INJURY.types.map((x) => x.weight))];
    const matchesOut = type.min + Math.floor(rng.next() * (type.max - type.min + 1));
    state.injuries.push({ minute: state.minute, team: side, playerId: p.id, playerName: p.name, type: type.name, matchesOut });
    comment(state, 'injury', side, { player: p.name, injury: type.name }, p.id);
    t.lineup[i] = null;
    fillInjuryVacancy(state, side, i, p);
    changed = true;
  });
  if (changed) recalc(t);
}

function drainCondition(t, extraTime) {
  t.lineup.forEach((p, i) => {
    if (!p) return;
    t.slotOf.set(p.id, t.slots[i]);
    let drain = C.CONDITION.drainPerMinute * t.tf.drain * (extraTime ? C.EXTRA_TIME.drainFactor : 1) * (1 + C.CONDITION.staminaEffect * (C.SKILL_REF - p.attributes.stamina));
    if (t.slots[i] === 'GK') drain *= C.CONDITION.gkDrainFactor;
    t.condition.set(p.id, Math.max(C.CONDITION.min, t.condition.get(p.id) - drain));
    t.minutes.set(p.id, (t.minutes.get(p.id) ?? 0) + 1);
  });
}

// 지친 선수 교체 (한 번에 최대 2명)
function fatigueSubs(state, side) {
  const t = state.teams[side];
  const S = C.SUBSTITUTIONS;
  const max = subLimit(state);
  const limit = state.minute < S.reserveUntil ? max - 1 : max;
  let made = 0;
  while (t.subsUsed < limit && made < 2) {
    let tired = -1;
    t.lineup.forEach((p, i) => {
      if (!p || t.slots[i] === 'GK') return;
      const c = t.condition.get(p.id);
      if (c < S.fatigueThreshold && (tired < 0 || c < t.condition.get(t.lineup[tired].id))) tired = i;
    });
    if (tired < 0) break;
    const incoming = bestFromBench(t, t.slots[tired], S.minFit);
    if (!incoming) break;
    substitute(state, side, tired, incoming, 'fatigue');
    made++;
  }
  if (made > 0) recalc(t);
}

// 슈팅 종류 비중 배율: 결정적 찬스는 압도할수록·전술로, 헤더는 상성(크로스 vs 내려앉기)으로
const shotTypeFactor = (t, k, ratio) => (k === 'big' ? ratio ** C.BIG_CHANCE_EXP * t.tf.bigChance : k === 'header' ? t.tf.header : 1);

function resolveShot(state, side, ratio) {
  const { rng } = state;
  const att = state.teams[side];
  const def = state.teams[opponentOf(side)];
  const stats = state.stats[side];

  // 슈팅 종류: 상대를 압도할수록 결정적 찬스(big) 비중이 커진다
  const typeWeights = SHOT_TYPE_KEYS.map((k) => C.SHOT_TYPES[k].weight * shotTypeFactor(att, k, ratio));
  const typeKey = SHOT_TYPE_KEYS[rng.weightedIndex(typeWeights)];
  const type = C.SHOT_TYPES[typeKey];

  const si = rng.weightedIndex(att.shooterWeights[typeKey]);
  if (si < 0) return;
  const shooter = att.lineup[si];
  pstat(state, shooter.id).shots++;
  const skillDiff = att.shooterSkill[typeKey][si] - state.levelRef;
  const gkDiff = def.ratings.goalkeeping - state.levelRef;

  const pOnTarget = clamp(type.onTarget * (1 + C.ON_TARGET_SKILL_SLOPE * skillDiff), C.PROB_LIMITS.onTarget);
  // 기준 능력이면 pOnTarget × pGoal = type.xg 가 되도록
  const pGoal = clamp(
    ((type.xg / type.onTarget) * (1 + C.GOAL_SKILL_SLOPE * skillDiff)) / (1 + C.GK_SKILL_SLOPE * gkDiff),
    C.PROB_LIMITS.goalIfOnTarget,
  );

  stats.shots++;
  stats.xg += pOnTarget * pGoal;
  const shot = shotPhrase(typeKey, shooter.name);

  if (!rng.chance(pOnTarget)) {
    // 빗나간 슈팅의 세부 묘사는 중계용이므로 textRng 사용
    const r = state.textRng.next();
    const kind = r < C.MISS_BREAKDOWN.woodwork ? 'woodwork' : r < C.MISS_BREAKDOWN.woodwork + C.MISS_BREAKDOWN.blocked ? 'blocked' : 'miss';
    comment(state, kind, side, { shot }, shooter.id);
    return;
  }
  stats.shotsOnTarget++;
  pstat(state, shooter.id).onTarget++;

  if (!rng.chance(pGoal)) {
    if (def.gk) pstat(state, def.gk.id).saves++;
    comment(state, 'saved', side, { shot, gk: def.gk?.name ?? '골키퍼' }, shooter.id);
    return;
  }

  state.score[side]++;
  pstat(state, shooter.id).goals++;
  for (const p of def.lineup) if (p) pstat(state, p.id).conceded++;
  let assister = null;
  if (rng.chance(type.assistChance)) {
    const weights = att.assistWeights[typeKey].map((w, i) => (i === si ? 0 : w));
    const ai = rng.weightedIndex(weights);
    if (ai >= 0) assister = att.lineup[ai];
    if (assister) pstat(state, assister.id).assists++;
  }
  state.goals.push({
    minute: state.minute,
    team: side,
    scorerId: shooter.id,
    scorerName: shooter.name,
    assistId: assister?.id ?? null,
    assistName: assister?.name ?? null,
    shotType: typeKey,
  });
  const line = comment(state, 'goal', side, { shot }, shooter.id);
  line.text += `${assister ? ` (도움: ${assister.name})` : ''} ${scoreText(state)}`;
}

export function playMinute(state) {
  if (state.finished) return state;
  state.minute++;
  const { rng, teams } = state;
  aiInGameTactics(state, 'home');
  aiInGameTactics(state, 'away');

  // 1) 점유: 중원 레이팅 비교
  const mh = teams.home.ratings.midfield ** C.POSSESSION_EXP;
  const ma = teams.away.ratings.midfield ** C.POSSESSION_EXP;
  const side = rng.chance(mh / (mh + ma)) ? 'home' : 'away';
  const defSide = opponentOf(side);
  state.stats[side].possessionMinutes++;

  // 2) 카드: 수비하는 팀
  let event = resolveCards(state, defSide);

  // 3) 공격 시도: 공격 레이팅 vs 상대 수비 레이팅
  const ratio = softRatio(teams[side].ratings.attack / teams[defSide].ratings.defense);
  const pAttack = Math.min(C.ATTACK_PROB_MAX, C.ATTACK_BASE * ratio ** C.ATTACK_EXP * teams[side].tf.attempts);
  if (rng.chance(pAttack)) {
    event = true;
    // 슈팅까지 가는지, 수비에 막히는지
    if (rng.chance(C.SHOT_AFTER_ATTACK)) {
      resolveShot(state, side, ratio);
    } else {
      const def = teams[defSide];
      const di = rng.weightedIndex(def.defenderWeights);
      if (di >= 0) {
        pstat(state, def.lineup[di].id).tackles++;
        comment(state, 'attackStopped', side, { defender: def.lineup[di].name }, def.lineup[di].id);
      }
    }
  }

  // 4) 부상 · 체력
  for (const s of ['home', 'away']) {
    const before = state.commentary.length;
    resolveInjuries(state, s);
    if (state.commentary.length > before) event = true;
    drainCondition(teams[s], state.extraTime);
  }
  if (state.minute % C.CONDITION.recalcEvery === 0) refreshMatchups(state); // 컨디션·교체로 바뀐 프로필까지

  // 5) 체력 교체
  const S = C.SUBSTITUTIONS;
  const regularCheck = state.minute >= S.fatigueFrom && state.minute <= S.fatigueUntil && (state.minute - S.fatigueFrom) % S.fatigueCheckEvery === 0;
  if (regularCheck || (state.extraTime && C.EXTRA_TIME.fatigueCheckMinutes.includes(state.minute))) {
    for (const s of ['home', 'away']) {
      if (!teams[s].autoSubs) continue;
      const before = state.commentary.length;
      fatigueSubs(state, s);
      if (state.commentary.length > before) event = true;
    }
  }

  if (!event && state.textRng.chance(C.QUIET_MINUTE_COMMENT)) comment(state, 'quiet', side, {});

  if (state.minute === C.HALF_TIME_MINUTE) comment(state, 'halftime', null, { score: scoreText(state) });
  if (state.minute === C.EXTRA_TIME.halfMinute && state.extraTime) comment(state, 'etHalftime', null, { score: scoreText(state) });
  const level = state.knockout && aggregateOf(state, 'home') === aggregateOf(state, 'away');
  if (state.minute === C.MATCH_MINUTES && level) {
    // 토너먼트 합계 동점 → 연장
    state.extraTime = true;
    comment(state, 'extraTimeStart', null, { score: scoreText(state) });
  } else if (state.minute === C.MATCH_MINUTES + C.EXTRA_TIME.minutes && level) {
    comment(state, 'extraTimeEnd', null, { score: scoreText(state) });
    penaltyShootout(state);
    finish(state);
  } else if (state.minute >= C.MATCH_MINUTES && !(state.extraTime && state.minute < C.MATCH_MINUTES + C.EXTRA_TIME.minutes)) {
    finish(state);
  }
  return state;
}

function finish(state) {
  state.finished = true;
  const pens = state.penalties ? ` (승부차기 ${state.penalties.home}-${state.penalties.away})` : '';
  comment(state, 'fulltime', null, { score: `${scoreText(state)}${state.extraTime ? ' (연장)' : ''}${pens}` });
}

// 진출 팀: 합계 → 승부차기 (토너먼트가 아니면 null)
function knockoutWinner(state) {
  if (!state.knockout || !state.finished) return null;
  const h = aggregateOf(state, 'home');
  const a = aggregateOf(state, 'away');
  if (h !== a) return h > a ? 'home' : 'away';
  return state.penalties ? (state.penalties.home > state.penalties.away ? 'home' : 'away') : null;
}

// ── 승부차기 ──────────────────────────────────────────

function penaltyShootout(state) {
  const P = C.PENALTIES;
  const { rng } = state;
  const takers = {};
  for (const side of ['home', 'away']) {
    // 경기장에 남은 선수를 키커 능력순으로 (GK는 마지막)
    const t = state.teams[side];
    takers[side] = t.lineup
      .filter(Boolean)
      .sort((a, b) => (a === t.gk) - (b === t.gk) || weightedSkill(b.attributes, P.takerSkill) - weightedSkill(a.attributes, P.takerSkill));
  }
  const pen = { home: 0, away: 0, kicks: [] };
  state.penalties = pen;
  comment(state, 'penaltiesStart', null, {});
  const order = ['home', 'away'];
  for (let round = 0; ; round++) {
    for (const side of order) {
      const opp = opponentOf(side);
      const taker = takers[side][round % takers[side].length];
      const gk = state.teams[opp].gk;
      const skill = weightedSkill(taker.attributes, P.takerSkill) - state.levelRef;
      const gkSkill = gk ? weightedSkill(gk.attributes, P.gkSkill) - state.levelRef : -20;
      const p = clamp(P.base + P.takerSlope * skill - P.gkSlope * gkSkill, P.limits);
      const scored = rng.chance(p);
      if (scored) pen[side]++;
      pen.kicks.push({ team: side, playerId: taker.id, playerName: taker.name, scored });
      comment(state, scored ? 'penScored' : state.textRng.chance(0.6) ? 'penSaved' : 'penMissed', side, { player: taker.name, gk: gk?.name ?? '골키퍼', tally: `${pen.home}-${pen.away}` }, taker.id);
      // 5번씩 차기 전이라도 남은 키커로 따라잡을 수 없으면 끝
      if (round < P.rounds) {
        const kicked = (s) => pen.kicks.filter((k) => k.team === s).length;
        const left = (s) => P.rounds - kicked(s);
        if (pen.home + left('home') < pen.away || pen.away + left('away') < pen.home) return;
      }
    }
    if (round >= P.rounds - 1 && pen.home !== pen.away) return;
  }
}

// 직접 교체: slotIndex 자리 선수를 벤치의 playerId로. → { ok, message }
export function makeSubstitution(state, side, slotIndex, playerId) {
  const t = state.teams[side];
  if (state.finished) return { ok: false, message: '경기가 끝났습니다.' };
  if (t.subsUsed >= subLimit(state)) return { ok: false, message: `교체는 ${subLimit(state)}명까지입니다.` };
  if (!t.lineup[slotIndex]) return { ok: false, message: '빈 자리는 교체할 수 없습니다 (퇴장).' };
  const incoming = t.bench.find((p) => p.id === playerId);
  if (!incoming) return { ok: false, message: '교체 명단에 없는 선수입니다.' };
  const outName = t.lineup[slotIndex].name;
  substitute(state, side, slotIndex, incoming, 'manual');
  recalc(t);
  return { ok: true, message: `${incoming.name} 투입, ${outName} 아웃` };
}

// 전술 지시 변경: partial = { mentality?, pressing?, style? } → { ok, message }
export function setTactics(state, side, partial) {
  const t = state.teams[side];
  if (state.finished) return { ok: false, message: '경기가 끝났습니다.' };
  const changes = [];
  for (const [kind, value] of Object.entries(partial)) {
    if (!C.TACTICS[kind]?.[value]) return { ok: false, message: `알 수 없는 전술: ${kind}=${value}` };
    if (t.tactics[kind] === value) continue;
    t.tactics[kind] = value;
    changes.push(C.TACTICS[kind][value].label);
  }
  if (changes.length === 0) return { ok: true, message: '바뀐 지시가 없습니다.' };
  refreshMatchups(state);
  comment(state, 'tactic', side, { change: changes.join(', ') });
  return { ok: true, message: `전술 변경: ${changes.join(', ')}` };
}

// 경기 중 포메이션 변경: 지금 뛰는 선수를 새 자리에 가장 잘 맞게 다시 배치한다.
// 퇴장으로 빈 자리 수는 그대로 (가장 덜 아까운 자리를 비운다). → { ok, message }
export function changeFormation(state, side, formationOrSlots) {
  const t = state.teams[side];
  if (state.finished) return { ok: false, message: '경기가 끝났습니다.' };
  const slots = [...resolveSlots(formationOrSlots)];
  if (slots.length !== t.slots.length || slots.filter((p) => p === 'GK').length !== 1) return { ok: false, message: '포메이션 형식이 맞지 않습니다.' };
  const gkSlot = slots.indexOf('GK');
  const gk = t.lineup[t.slots.indexOf('GK')];
  const field = t.lineup.filter((p, i) => p && i !== t.slots.indexOf('GK'));
  // 빈 자리는 능력 0인 가상 선수로 채워 배치한 뒤 다시 비운다
  const empty = slots.length - 1 - field.length;
  const zero = Object.fromEntries(Object.keys((gk ?? field[0]).attributes).map((k) => [k, 0]));
  const dummies = Array.from({ length: empty }, (_, i) => ({ id: `__empty${i}`, position: 'CB', altPositions: [], attributes: zero }));
  const fieldSlots = slots.filter((_, i) => i !== gkSlot);
  const placed = autoSelectLineup([...field, ...dummies], fieldSlots, factorFor(t));
  const lineup = [];
  let k = 0;
  slots.forEach((_, i) => {
    if (i === gkSlot) lineup.push(gk ?? null);
    else {
      const p = placed[k++];
      lineup.push(p.id.startsWith('__empty') ? null : p);
    }
  });
  t.slots = slots;
  t.lineup = lineup;
  t.formation = typeof formationOrSlots === 'string' ? formationOrSlots : null;
  refreshMatchups(state);
  const name = t.formation ?? formationOrSlots.join('-');
  comment(state, 'formation', side, { formation: name });
  return { ok: true, message: `포메이션 변경: ${name}` };
}

// 화면용: 경기 중 팀 상태 (선발·벤치·컨디션·남은 교체)
export function teamSnapshot(state, side) {
  const t = state.teams[side];
  return {
    slots: t.slots,
    lineup: t.lineup,
    bench: t.bench,
    condition: (id) => Math.round(t.condition.get(id) ?? 100),
    subsLeft: subLimit(state) - t.subsUsed,
    autoSubs: t.autoSubs,
    tactics: { ...t.tactics },
    formation: t.formation,
    ratings: { ...t.ratings },
  };
}

// 팀 토크 등으로 남은 경기 레이팅 배율을 더한다 (0.02 = +2%)
export function adjustBoost(state, side, delta) {
  const t = state.teams[side];
  t.boost += delta;
  recalc(t);
}

export function setAutoSubs(state, side, on) {
  state.teams[side].autoSubs = on;
}

export function getMatchResult(state) {
  const total = state.stats.home.possessionMinutes + state.stats.away.possessionMinutes || 1;
  const homePossession = Math.round((100 * state.stats.home.possessionMinutes) / total);
  const statsOf = (side, possession) => ({
    shots: state.stats[side].shots,
    shotsOnTarget: state.stats[side].shotsOnTarget,
    possession,
    xg: Math.round(state.stats[side].xg * 100) / 100,
    yellow: state.stats[side].yellow,
    red: state.stats[side].red,
  });
  const teamInfo = (side) => {
    const t = state.teams[side];
    return {
      id: t.id,
      name: t.name,
      formation: t.formation,
      ratings: t.ratings,
      onPitch: t.lineup.map((p) => p?.id ?? null),
      subsUsed: t.subsUsed,
    };
  };
  // 뛴 선수의 출전 시간과 경기 후 컨디션
  const playerMinutes = {};
  const conditionAfter = {};
  for (const side of ['home', 'away']) {
    const t = state.teams[side];
    for (const [id, minutes] of t.minutes) {
      playerMinutes[id] = minutes;
      conditionAfter[id] = Math.round(t.condition.get(id));
    }
  }
  // 선수 평점과 경기 최우수 선수 (같은 평점이면 이긴 팀 쪽)
  const ratings = playerRatings(state);
  let potm = null;
  for (const side of ['home', 'away']) {
    const winBonus = aggregateOf(state, side) >= aggregateOf(state, opponentOf(side)) ? 0.05 : 0;
    for (const [id, p] of state.teams[side].roster) {
      if (ratings[id] == null) continue;
      if (!potm || ratings[id] + winBonus > potm.score) potm = { id, name: p.name, team: side, rating: ratings[id], score: ratings[id] + winBonus };
    }
  }
  if (potm) delete potm.score;
  return {
    seed: state.seed,
    finished: state.finished,
    score: { ...state.score },
    goals: state.goals.map((g) => ({ ...g })),
    cards: state.cards.map((c) => ({ ...c })),
    injuries: state.injuries.map((i) => ({ ...i })),
    subs: state.subs.map((s) => ({ ...s })),
    commentary: state.commentary.map((c) => ({ ...c })),
    stats: { home: statsOf('home', homePossession), away: statsOf('away', 100 - homePossession) },
    teams: { home: teamInfo('home'), away: teamInfo('away') },
    playerMinutes,
    conditionAfter,
    extraTime: state.extraTime,
    penalties: state.penalties ? { home: state.penalties.home, away: state.penalties.away, kicks: state.penalties.kicks.map((k) => ({ ...k })) } : null,
    ratings,
    potm,
    winner: knockoutWinner(state),
    aggregate: state.knockout ? { home: aggregateOf(state, 'home'), away: aggregateOf(state, 'away') } : null,
  };
}

// ── 경기 전 분석 ───────────────────────────────────────
// 킥오프 시점 레이팅으로 두 팀의 90분 기대 득점을 계산한다 (경기 중 변화·교체 제외, 엔진과 같은 공식)
function expectedGoals(state, side) {
  const att = state.teams[side];
  const def = state.teams[opponentOf(side)];
  const mh = att.ratings.midfield ** C.POSSESSION_EXP;
  const md = def.ratings.midfield ** C.POSSESSION_EXP;
  const ratio = softRatio(att.ratings.attack / def.ratings.defense);
  const pAttack = Math.min(C.ATTACK_PROB_MAX, C.ATTACK_BASE * ratio ** C.ATTACK_EXP * att.tf.attempts);
  const weights = SHOT_TYPE_KEYS.map((k) => C.SHOT_TYPES[k].weight * shotTypeFactor(att, k, ratio));
  const total = weights.reduce((s, w) => s + w, 0);
  const gkDiff = def.ratings.goalkeeping - state.levelRef;
  // 슈팅 한 번의 득점 확률: resolveShot과 같게 슈터 선택 비중 × (유효슈팅 × 득점 전환)
  let xgPerShot = 0;
  SHOT_TYPE_KEYS.forEach((k, ti) => {
    const type = C.SHOT_TYPES[k];
    const w = att.shooterWeights[k];
    const wSum = w.reduce((s, v) => s + v, 0);
    if (!wSum) return;
    let pk = 0;
    w.forEach((wi, i) => {
      if (!wi) return;
      const skillDiff = att.shooterSkill[k][i] - state.levelRef;
      const pOn = clamp(type.onTarget * (1 + C.ON_TARGET_SKILL_SLOPE * skillDiff), C.PROB_LIMITS.onTarget);
      const pGoal = clamp(((type.xg / type.onTarget) * (1 + C.GOAL_SKILL_SLOPE * skillDiff)) / (1 + C.GK_SKILL_SLOPE * gkDiff), C.PROB_LIMITS.goalIfOnTarget);
      pk += (wi / wSum) * pOn * pGoal;
    });
    xgPerShot += (weights[ti] / total) * pk;
  });
  return (mh / (mh + md)) * pAttack * C.SHOT_AFTER_ATTACK * xgPerShot * C.MATCH_MINUTES;
}

// 푸아송 근사로 기대 승점 (side 기준)
function expectedPoints(lambdaFor, lambdaAgainst) {
  const pois = (l) => {
    const p = [Math.exp(-l)];
    for (let k = 1; k <= 10; k++) p.push((p[k - 1] * l) / k);
    return p;
  };
  const a = pois(lambdaFor);
  const b = pois(lambdaAgainst);
  let win = 0;
  let draw = 0;
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) (i > j ? (win += a[i] * b[j]) : i === j ? (draw += a[i] * b[j]) : 0);
  return { win, draw, loss: 1 - win - draw, points: 3 * win + draw };
}

const PREVIEW_LATE_MINUTE = 75; // 후반 상태를 볼 시점 (교체 전, 체력이 떨어진 때)

// 경기 입력 → 양 팀 전술(AI 성향 포함)·프로필·기대 득점, side 기준 기대 승점
export function previewMatch(input, side = 'home') {
  const state = createMatch({ ...input, seed: 'preview' });
  const early = { home: expectedGoals(state, 'home'), away: expectedGoals(state, 'away') };
  const ratings = { home: { ...state.teams.home.ratings }, away: { ...state.teams.away.ratings } };
  // 후반: 지친 정도(압박·체력에 따라 다르다)를 반영한 레이팅으로 한 번 더 — 두 구간 평균
  for (const t of Object.values(state.teams)) {
    t.lineup.forEach((p, i) => {
      if (!p) return;
      let drain = C.CONDITION.drainPerMinute * t.tf.drain * (1 + C.CONDITION.staminaEffect * (C.SKILL_REF - p.attributes.stamina));
      if (t.slots[i] === 'GK') drain *= C.CONDITION.gkDrainFactor;
      t.condition.set(p.id, Math.max(C.CONDITION.min, t.condition.get(p.id) - drain * PREVIEW_LATE_MINUTE));
    });
  }
  refreshMatchups(state);
  const xg = (s) => (early[s] + expectedGoals(state, s)) / 2;
  const team = (s) => ({ tactics: { ...state.teams[s].tactics }, profile: state.teams[s].profile, xg: xg(s), ratings: ratings[s] });
  const home = team('home');
  const away = team('away');
  const mine = side === 'home' ? home : away;
  const opp = side === 'home' ? away : home;
  return { home, away, outlook: expectedPoints(mine.xg, opp.xg) };
}

export function simulateMatch(input) {
  const state = createMatch(input);
  while (!state.finished) playMinute(state);
  return getMatchResult(state);
}
