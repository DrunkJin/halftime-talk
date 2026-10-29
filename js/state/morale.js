// 팀 사기: 최근 경기 흐름 + 사용자 팀은 인터뷰·팀 토크 보정. 수치는 engine/config.js(MORALE)
import { MORALE } from '../engine/config.js';
import { t } from '../i18n.js';
import { fixturesOf } from './game.js';
import { teamMoodPenalty } from './squadMood.js';

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// 팀의 최근 경기 결과 (최신 먼저): [{ fixture, outcome: 'W'|'D'|'L', gf, ga }]
export function recentResults(dataset, game, teamId, n = Infinity) {
  const leagueId = dataset.teamById.get(teamId).leagueId;
  const out = [];
  const list = fixturesOf(game, leagueId);
  for (let i = list.length - 1; i >= 0 && out.length < n; i--) {
    const f = list[i];
    if (!f.result || (f.homeId !== teamId && f.awayId !== teamId)) continue;
    const home = f.homeId === teamId;
    const gf = home ? f.result.score.home : f.result.score.away;
    const ga = home ? f.result.score.away : f.result.score.home;
    out.push({ fixture: f, outcome: gf > ga ? 'W' : gf < ga ? 'L' : 'D', gf, ga });
  }
  return out;
}

// 최근 흐름 → 사기 변화량
function formComponent(dataset, game, teamId) {
  const { matches, perPoint } = MORALE.form;
  const recent = recentResults(dataset, game, teamId, matches);
  if (recent.length === 0) return 0;
  const points = recent.reduce((s, r) => s + (r.outcome === 'W' ? 3 : r.outcome === 'D' ? 1 : 0), 0);
  // 치른 경기 수가 적으면 그만큼만 반영
  return (points - 1.5 * recent.length) * perPoint;
}

export const moraleAdjust = (game) => game.morale?.adjust ?? 0;

export function moraleOf(dataset, game, teamId) {
  // 사용자 팀: 인터뷰·팀 토크 보정, 출전 불만인 주전급만큼 감점
  const user = teamId === game.teamId ? moraleAdjust(game) - teamMoodPenalty(dataset, game) : 0;
  return Math.round(clamp(MORALE.neutral + formComponent(dataset, game, teamId) + user, 0, 100));
}

// 사기 → 경기 레이팅 배율 보정 (엔진 팀 입력의 boost)
export const moraleBoost = (morale) => ((morale - MORALE.neutral) / MORALE.neutral) * MORALE.maxBoost;

export function moraleLabel(morale) {
  if (morale >= 80) return t('state.morale.superb');
  if (morale >= 62) return t('state.morale.good');
  if (morale >= 40) return t('state.morale.okay');
  if (morale >= 22) return t('state.morale.poor');
  return t('state.morale.abysmal');
}

export function addMorale(game, delta) {
  const m = (game.morale ??= { adjust: 0 });
  m.adjust = clamp(m.adjust + delta, -MORALE.adjustLimit, MORALE.adjustLimit);
}

// 경기가 끝날 때: 보정을 줄이고(주말 리그만), 그 경기 전 기자회견 답의 결과 효과를 반영한다
export function settleMoraleAfterMatch(game, fixtureId, userResult, mySide, { decay = true } = {}) {
  const m = (game.morale ??= { adjust: 0 });
  if (decay) m.adjust *= MORALE.adjustDecay;
  const press = game.press;
  if (press && !press.skipped && fixtureId && press.fixtureId === fixtureId && userResult && !press.settled) {
    const [mine, theirs] = mySide === 'home' ? [userResult.score.home, userResult.score.away] : [userResult.score.away, userResult.score.home];
    const outcome = mine > theirs ? 'win' : mine < theirs ? 'loss' : 'draw';
    const delta = MORALE.pre[press.stance][outcome] * (press.mult ?? 1);
    addMorale(game, delta);
    press.settled = { outcome, delta };
  }
}
