// 스카우팅: 우리 선수·우리 리그·맞붙어 본 팀·스카우트한 선수만 능력치를 정확히 안다. 나머지는 OVR이 범위로 보인다.
// 스카우트는 동시에 slots명까지, 같은 나라는 roundsSame, 다른 나라는 roundsOther 라운드 뒤 보고서 (편지함)
// game.scouting = { known: { [선수 id]: 시즌 }, assignments: [{ id, readyRound, season }] }
import { overall } from '../engine/ratings.js';
import { createRng } from '../engine/rng.js';
import { currentTeamId, squadOf } from './game.js';
import { scoutedPotential } from './newSeason.js';

export const SCOUT = { width: 8, slots: 3, roundsSame: 1, roundsOther: 2 };

const stateOf = (game) => (game.scouting ??= { known: {}, assignments: [] });

// 능력치를 정확히 아는 선수인지
export function isKnown(dataset, game, p, teamId = currentTeamId(dataset, game, p.id)) {
  if (teamId === game.teamId) return true;
  if (game.scouting?.known?.[p.id] != null) return true;
  if (game.loans?.some((l) => l.playerId === p.id && l.from === game.teamId)) return true; // 우리가 임대 보낸 선수
  if (!teamId) {
    // 경쟁 입찰 중인 계약 만료 선수는 전 소속 기준 (우리 리그·맞붙어 본 팀이었으면 안다). 그 밖의 무소속은 스카우트해야 안다
    const from = game.freeAgency?.players?.[p.id]?.from;
    return from ? isKnown(dataset, game, p, from) : false;
  }
  if (dataset.teamById.get(teamId)?.leagueId === game.leagueId) return true;
  return Boolean(game.career?.opponents?.[teamId]); // 맞붙어 본 팀
}

// OVR 보기: { known, ovr, low, high } — 모르면 실제 값이 범위 안 어딘가 (선수마다 고정, 가운데가 아닐 수 있다)
export function ovrView(dataset, game, p) {
  const ovr = overall(p);
  if (isKnown(dataset, game, p)) return { known: true, ovr, low: ovr, high: ovr };
  const r = Math.floor(createRng(`${game.seed}:scout:${p.id}`).next() * (SCOUT.width + 1));
  const low = Math.max(1, ovr - r);
  return { known: false, ovr: null, low, high: low + SCOUT.width };
}

export const assignmentOf = (game, id) => game.scouting?.assignments?.find((a) => a.id === id) ?? null;
export const scoutSlotsLeft = (game) => SCOUT.slots - (game.scouting?.assignments?.length ?? 0);

// 스카우트 파견 → { ok, rounds?, reason? }
export function sendScout(dataset, game, p) {
  const s = stateOf(game);
  if (isKnown(dataset, game, p)) return { ok: false, reason: 'known' };
  if (assignmentOf(game, p.id)) return { ok: false, reason: 'assigned' };
  if (s.assignments.length >= SCOUT.slots) return { ok: false, reason: 'full' };
  const teamId = currentTeamId(dataset, game, p.id);
  const country = (id) => dataset.leagueById.get(dataset.teamById.get(id)?.leagueId)?.country;
  const rounds = teamId && country(teamId) === country(game.teamId) ? SCOUT.roundsSame : SCOUT.roundsOther;
  s.assignments.push({ id: p.id, readyRound: game.round + rounds, season: game.seasonIndex });
  return { ok: true, rounds };
}

// 스카우트 의견: 우리 주전 11명 평균과 비교, 젊고 잠재력이 크면 미래 자원
export function scoutVerdict(dataset, game, p) {
  const xi = squadOf(dataset, game, game.teamId).map(overall).sort((a, b) => b - a).slice(0, 11);
  const avg = xi.reduce((s, v) => s + v, 0) / Math.max(1, xi.length);
  const ovr = overall(p);
  const pot = scoutedPotential(game, p, ovr);
  if (ovr >= avg + 2) return 'starter';
  if (ovr >= avg - 3) return 'rotation';
  if (pot && pot.high >= avg) return 'future';
  return 'below';
}
export const VERDICT_LABELS = { starter: '즉시 주전감', rotation: '로테이션 보강', future: '미래 자원 (잠재력)', below: '우리 수준에 못 미침' };

// 라운드 진행 뒤: 다 된 스카우트 보고서 → [{ id, name, verdict }]
export function processScouting(dataset, game) {
  const s = game.scouting;
  if (!s?.assignments?.length) return [];
  const done = [];
  s.assignments = s.assignments.filter((a) => {
    if (a.season === game.seasonIndex && game.round < a.readyRound) return true;
    const p = dataset.playerById.get(a.id);
    if (p) {
      s.known[a.id] = game.seasonIndex;
      done.push({ id: a.id, name: p.name, verdict: scoutVerdict(dataset, game, p) });
    }
    return false;
  });
  return done;
}
