// 사용자 팀 선수의 출전 기대치와 기분: 역할(스쿼드 OVR 순위)마다 기대 출전 비율이 있고, 최근 경기 출전이 모자라면 기분이 떨어진다.
// 불만인 주전급은 팀 사기를 깎고, 바닥나면 이적을 요청한다. 면담으로 달랠 수 있다. 수치는 moodConfig.js
import { overall } from '../engine/ratings.js';
import { addMorale } from './morale.js';
import { squadOf } from './game.js';
import { MOOD as M } from './moodConfig.js';

const clamp = (v) => Math.max(0, Math.min(100, v));
const state = (game) => (game.squadMood ??= { mood: {}, window: {}, promises: {}, requests: {}, talked: {} });

// 역할: Map(선수 id → { id, label, expect, rank })
export function rolesOf(dataset, game) {
  const squad = squadOf(dataset, game, game.teamId).sort((a, b) => overall(b) - overall(a));
  const roles = new Map();
  squad.forEach((p, i) => {
    const rank = i + 1;
    let role = M.roles.find((r) => rank <= r.untilRank);
    if (rank > M.roles[1].untilRank && p.age <= M.prospect.maxAge) role = { id: 'prospect', ...M.prospect };
    roles.set(p.id, { ...role, rank });
  });
  return roles;
}

export const moodOf = (game, id) => state(game).mood[id] ?? M.start;
export const levelOf = (mood) => M.levels.find((l) => mood >= l.min);

// 다른 일(포지션 전환 등)로 기분을 바꾼다
export function nudgeMood(game, id, delta) {
  const s = state(game);
  s.mood[id] = clamp(moodOf(game, id) + delta);
}
export const isRequesting = (game, id) => Boolean(game.squadMood?.requests?.[id]);
export const promiseOf = (game, id) => game.squadMood?.promises?.[id] ?? null;

// 최근 출전 비율 (기록이 3경기 미만이면 null)
export function shareOf(game, id) {
  const w = state(game).window[id] ?? [];
  return w.length >= 3 ? w.reduce((s, v) => s + v, 0) / w.length : null;
}

// 사용자 팀 경기 하나가 끝난 뒤. → 알릴 일 [{ kind: 'unhappy'|'request'|'promiseKept'|'promiseBroken', id, name }]
export function updateMoods(dataset, game, result) {
  if (!result?.playerMinutes) return [];
  const s = state(game);
  const roles = rolesOf(dataset, game);
  const events = [];
  for (const p of squadOf(dataset, game, game.teamId)) {
    if (game.players[p.id]?.injury) continue; // 다친 동안은 따지지 않는다
    const minutes = result.playerMinutes[p.id] ?? 0;
    const v = minutes >= M.startMinutes ? 1 : minutes > 0 ? 0.5 : 0;
    const w = (s.window[p.id] ??= []);
    w.push(v);
    if (w.length > M.window) w.shift();

    const before = moodOf(game, p.id);
    let mood = before;
    const share = shareOf(game, p.id);
    if (share != null) {
      const raw = share - roles.get(p.id).expect;
      const gap = raw < 0 ? Math.min(0, raw + M.tolerance) : raw;
      mood += gap * M.perGap * (gap < 0 ? M.shortWeight : 1);
      if (gap >= 0) mood += (M.start - mood) * M.drift;
    }
    // 출전 약속
    const pr = s.promises[p.id];
    if (pr) {
      pr.left--;
      if (v === 1) pr.got++;
      if (pr.got >= pr.starts) {
        mood += M.talks.promise.kept;
        delete s.promises[p.id];
        events.push({ kind: 'promiseKept', id: p.id, name: p.name });
      } else if (pr.left <= 0) {
        mood += M.talks.promise.broken;
        addMorale(game, M.talks.promise.brokenTeam);
        delete s.promises[p.id];
        events.push({ kind: 'promiseBroken', id: p.id, name: p.name });
      }
    }
    mood = clamp(mood);
    s.mood[p.id] = Math.round(mood * 10) / 10;
    const was = levelOf(before).id;
    const now = levelOf(mood).id;
    if (now === 'request' && !s.requests[p.id]) {
      s.requests[p.id] = { season: game.seasonIndex, round: game.round };
      events.push({ kind: 'request', id: p.id, name: p.name });
    } else if (now === 'unhappy' && was !== 'unhappy' && was !== 'request') {
      events.push({ kind: 'unhappy', id: p.id, name: p.name });
    }
    if (mood >= M.levels[1].min && s.requests[p.id] && !s.requests[p.id].allowed) delete s.requests[p.id]; // 허락한 이적은 팔릴 때까지 그대로
  }
  return events;
}

// 불만인 주전급이 팀 사기에서 깎는 양 (양수)
export function teamMoodPenalty(dataset, game) {
  const s = game.squadMood;
  if (!s) return 0;
  let total = 0;
  for (const [id, role] of rolesOf(dataset, game)) {
    if (role.rank > M.roles[1].untilRank) continue;
    const mood = moodOf(game, id);
    if (mood < M.teamPenaltyFrom) total += (M.teamPenaltyFrom - mood) / 10;
  }
  // 지정 주장이 불만이면 라커룸 분위기가 더 가라앉는다
  if (game.captain && moodOf(game, game.captain) < M.teamPenaltyFrom) total += M.captainUnhappy;
  return Math.min(M.maxTeamPenalty, total);
}

// 면담: option = 'promise' | 'compete' | 'reassure' | 'allowTransfer' → { ok, delta, reason? }
export function canTalk(game, id) {
  const last = state(game).talked[id];
  return !last || last.season !== game.seasonIndex || game.round - last.round >= M.cooldown;
}

export function talk(dataset, game, id, option) {
  const s = state(game);
  if (!canTalk(game, id)) return { ok: false, reason: 'cooldown' };
  const T = M.talks;
  const role = rolesOf(dataset, game).get(id);
  let delta = 0;
  if (option === 'promise') {
    if (s.promises[id]) return { ok: false, reason: 'promised' };
    s.promises[id] = { starts: T.promise.starts, left: T.promise.within, got: 0 };
    delta = T.promise.mood;
  } else if (option === 'compete') {
    delta = role && role.expect < 0.4 ? T.compete.moodLowRole : T.compete.moodHighRole;
  } else if (option === 'reassure') {
    delta = T.reassure.mood;
  } else if (option === 'allowTransfer') {
    s.requests[id] = { season: game.seasonIndex, round: game.round, allowed: true };
    delta = T.allowTransfer.mood;
    if (role && role.rank <= M.roles[1].untilRank) addMorale(game, T.allowTransfer.teamPenaltyKey);
  } else {
    return { ok: false, reason: 'unknown' };
  }
  s.mood[id] = clamp(moodOf(game, id) + delta);
  s.talked[id] = { season: game.seasonIndex, round: game.round };
  return { ok: true, delta };
}

// 새 시즌: 출전 기록·약속·요청을 비우고 기분은 처음 쪽으로 반쯤 돌아온다
export function resetMoodsForNewSeason(game) {
  const s = game.squadMood;
  if (!s) return;
  for (const id of Object.keys(s.mood)) s.mood[id] = Math.round(((s.mood[id] + M.start) / 2) * 10) / 10;
  s.window = {};
  s.promises = {};
  s.requests = {};
  s.talked = {};
}
