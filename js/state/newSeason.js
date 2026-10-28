// 시즌 넘기기: 결산 → 대륙 대회 진출 팀 → 성장·노화 → 은퇴 → 계약 만료 → 승강 → 유스 → AI 보강 → 새 시즌 일정·재정·대륙 대회.
// 바뀐 선수·리그 정보는 game.world에 쌓이고 (state/world.js), 원본 데이터는 그대로 둔다.
import { CUP } from '../competitions/config.js';
import { countryOf, createCups } from '../competitions/cups.js';
import { ATTRIBUTE_KEYS } from '../data/schema.js';
import { overall } from '../engine/ratings.js';
import { createRng } from '../engine/rng.js';
import { generateFixtures, roundCount } from '../league/fixtures.js';
import { contractOf, demandedContract, initSeasonFinances, renewalTerms, signContract, wageRoom } from '../market/finance.js';
import { PROGRESSION, lookup } from '../progression/config.js';
import { currentTeamId, fixLineup, invalidateSquads, leagueTotalRounds, squadOf } from './game.js';
import { recordSeason } from './history.js';
import { packAttributes, worldDataset } from './world.js';

const P = PROGRESSION;
const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const randInt = (rng, [a, b]) => a + Math.floor(rng.next() * (b - a + 1));
const pick = (rng, list) => list[Math.floor(rng.next() * list.length)];

// '2026-27' → '2027-28', '2026' → '2027'
export function nextSeasonLabel(label) {
  const m = /^(\d{4})(?:-(\d{2}))?$/.exec(label ?? '');
  if (!m) return label;
  const y = Number(m[1]) + 1;
  return m[2] ? `${y}-${String((y + 1) % 100).padStart(2, '0')}` : String(y);
}

// ── 대륙 대회 진출 ────────────────────────────────────

// 지난 시즌 결산(rec)으로 다음 시즌 참가 팀: 전 시즌 우승팀 → 리그별 순위 자리 → 게스트 → 빈자리
function qualify(dataset, rec) {
  const Q = dataset.qualification;
  if (!Q || !dataset.competitions.length) return [];
  const table = (leagueId) => rec.leagues.find((l) => l.id === leagueId)?.table.map((r) => r.teamId) ?? [];
  const taken = new Set();
  const entrants = Object.fromEntries(dataset.competitions.map((c) => [c.id, []]));
  const size = Object.fromEntries(dataset.competitions.map((c) => [c.id, c.teamIds.length]));
  const countryCount = Object.fromEntries(Object.keys(entrants).map((c) => [c, {}]));
  const comps = Object.keys(entrants);
  const add = (comp, id) => {
    if (!id || taken.has(id) || !dataset.teamById.has(id)) return false;
    // 꽉 찼거나 같은 나라가 한도면 다음 대회로
    const country = countryOf(dataset, id);
    if (entrants[comp].length >= size[comp] || (countryCount[comp][country] ?? 0) >= CUP.leaguePhase.maxPerCountry) {
      const next = comps[comps.indexOf(comp) + 1];
      return next ? add(next, id) : false;
    }
    countryCount[comp][country] = (countryCount[comp][country] ?? 0) + 1;
    entrants[comp].push(id);
    taken.add(id);
    return true;
  };
  const top = Q.holdersTo ?? dataset.competitions[0].id;
  for (const c of rec.cups) add(top, c.winnerId);
  const cursor = {};
  const nextFrom = (leagueId) => {
    const t = table(leagueId);
    let i = cursor[leagueId] ?? 0;
    while (i < t.length && taken.has(t[i])) i++;
    cursor[leagueId] = i + 1;
    return t[i] ?? null;
  };
  for (const comp of Object.keys(entrants)) {
    for (const [leagueId, n] of Object.entries(Q.slots?.[comp] ?? {})) for (let k = 0; k < n; k++) add(comp, nextFrom(leagueId));
  }
  // 게스트 팀: 전력순으로 앞쪽 대회부터
  const strength = (id) => {
    const top11 = dataset.squads.get(id).map(overall).sort((a, b) => b - a).slice(0, 11);
    return top11.reduce((s, v) => s + v, 0) / Math.max(1, top11.length);
  };
  const guests = dataset.guestTeams.map((t) => t.id).sort((a, b) => strength(b) - strength(a));
  for (const [comp, n] of Object.entries(Q.guests ?? {})) for (let k = 0; k < n && guests.length; k++) add(comp, guests.shift());
  for (const id of guests) add(Object.keys(entrants).at(-1), id);
  // 빈자리: 리그 순서대로 돌아가며 다음 순위 팀
  for (const comp of Object.keys(entrants)) {
    for (let guard = 0; entrants[comp].length < size[comp] && guard < 500; guard++) add(comp, nextFrom(Q.order[guard % Q.order.length]));
  }
  return dataset.competitions.map((c) => ({ ...c, teamIds: entrants[c.id] }));
}

// ── 성장·노화 ─────────────────────────────────────────

function potentialOf(w, p, ovr) {
  if (w.potential[p.id] == null) {
    const u = createRng(`pot:${p.id}`).next() ** P.potential.skew;
    w.potential[p.id] = Math.round(ovr + lookup(P.potential.headroom, p.age) * u);
  }
  return w.potential[p.id];
}

// 한 시즌 OVR 변화량
function ovrChange(p, ovr, potential, share, rng) {
  const noise = (scale) => (rng.next() * 2 - 1) * scale;
  const declineFrom = P.decline.from + (p.position === 'GK' ? P.decline.gkShift : 0);
  if (p.age <= 27) return Math.max(0, potential - ovr) * lookup(P.growth.rate, p.age) * (P.growth.playFloor + P.growth.playBonus * share) + noise(P.growth.noise);
  if (p.age < declineFrom) return noise(P.peakNoise);
  return -(P.decline.perYear + (p.age - declineFrom) * P.decline.accel) + noise(P.decline.noise);
}

function progressAttributes(p, delta, rng) {
  const out = {};
  for (const k of ATTRIBUTE_KEYS) {
    const gkAttr = k.startsWith('gk');
    // 필드 선수의 GK 능력치, GK의 필드 능력치 일부는 그대로 둔다 (의미 없는 변화 방지)
    const relevant = p.position === 'GK' ? gkAttr || ['composure', 'agility', 'strength', 'passing'].includes(k) : !gkAttr;
    let d = relevant ? delta : 0;
    if (d < 0 && P.physical.includes(k)) d *= 1 + P.physicalExtra;
    if (relevant) d += (rng.next() * 2 - 1) * P.attributeNoise;
    out[k] = clamp(Math.round(p.attributes[k] + d), 1, 100);
  }
  return out;
}

// ── 유스 ──────────────────────────────────────────────

const POSITION_TARGET = { GK: 3, CB: 4, LB: 2, RB: 2, DM: 2, CM: 4, AM: 2, LW: 2, RW: 2, ST: 3 };

function namePools(dataset) {
  const pools = new Map();
  for (const p of dataset.players) {
    const parts = p.name.split(' ');
    if (parts.length < 2) continue;
    if (!pools.has(p.nationality)) pools.set(p.nationality, { first: [], last: [] });
    const pool = pools.get(p.nationality);
    pool.first.push(parts[0]);
    pool.last.push(parts.slice(1).join(' '));
  }
  return pools;
}

function makeYouth(dataset, w, team, squad, nameOf, rng, idOf) {
  const Y = P.youth;
  // 가장 모자란 자리
  const count = Object.fromEntries(Object.keys(POSITION_TARGET).map((k) => [k, 0]));
  for (const p of squad) count[p.position]++;
  const need = Object.keys(POSITION_TARGET).sort((a, b) => POSITION_TARGET[b] - count[b] - (POSITION_TARGET[a] - count[a]) || rng.next() - 0.5)[0];
  count[need]++;
  const teamLevel = squad.map(overall).sort((a, b) => b - a).slice(0, 11).reduce((s, v, _, arr) => s + v / arr.length, 0);
  const target = clamp(Math.round(teamLevel - randInt(rng, Y.belowTeam)), 30, 80);
  // 같은 포지션 선수의 능력치 분포를 본떠 목표 OVR로 맞춘다
  const templates = dataset.players.filter((p) => p.position === need && Math.abs(overall(p) - target) <= 8);
  const tpl = pick(rng, templates.length ? templates : dataset.players.filter((p) => p.position === need));
  const factor = target / Math.max(1, overall(tpl));
  const attributes = Object.fromEntries(ATTRIBUTE_KEYS.map((k) => [k, clamp(Math.round(tpl.attributes[k] * factor + (rng.next() * 2 - 1) * 3), 1, 100)]));
  const country = team.guest ? team.country : dataset.leagueById.get(team.leagueId).country;
  const nationality = rng.next() < Y.homeNation && dataset.nationByCode.has(country) ? country : pick(rng, squad).nationality;
  const player = { id: idOf(), name: nameOf(nationality), age: randInt(rng, Y.age), nationality, position: need, altPositions: [], teamId: team.id, attributes };
  w.potential[player.id] = Math.round(overall(player) + Y.potentialAbove[0] + (Y.potentialAbove[1] - Y.potentialAbove[0]) * rng.next() ** Y.potentialSkew);
  return player;
}

// ── 시즌 넘기기 ───────────────────────────────────────

// 이번 시즌 끝에 계약이 끝나는 우리 팀 선수 (결산 화면에서 재계약 여부를 고른다)
export function expiringContracts(dataset, game) {
  return squadOf(dataset, game, game.teamId).filter((p) => contractOf(dataset, game, p.id).until <= game.seasonIndex);
}

// AI 재계약 규칙: 팀 내 순위·나이로 판단 (rng 없이 쓰면 확률 없이 기준만)
function aiWouldRenew(p, rank, rng) {
  const C = P.contracts;
  const keep = (rank < C.keepTop && p.age + 1 < C.maxAge) || (p.age <= C.youngAge && rank < C.youngKeepTop);
  return keep && (!rng || rng.next() < C.renewChance);
}

// 결산 화면 기본 선택: AI 규칙으로 재계약할 만한 선수
export function suggestedRenewals(dataset, game) {
  const ranked = squadOf(dataset, game, game.teamId).sort((a, b) => overall(b) - overall(a));
  const rank = new Map(ranked.map((p, i) => [p.id, i]));
  return expiringContracts(dataset, game).filter((p) => aiWouldRenew(p, rank.get(p.id))).map((p) => p.id);
}

// base: 원본 데이터. renew: 재계약할 우리 팀 선수 id 목록 (null이면 AI 규칙으로 — 자동 진행)
// → { summary } (화면 안내용)
export function startNextSeason(base, game, { renew = null } = {}) {
  const ds0 = worldDataset(base, game);
  const rng = createRng(`${game.seed}:newseason:${game.seasonIndex}`);
  if (!game.history?.some((h) => h.seasonIndex === game.seasonIndex)) recordSeason(ds0, game);
  const rec = game.history.find((h) => h.seasonIndex === game.seasonIndex);
  const w = (game.world ??= {
    version: 0,
    leagueTeams: Object.fromEntries(ds0.leagues.map((l) => [l.id, [...l.teamIds]])),
    seasons: {},
    players: {},
    youth: [],
    retired: [],
    potential: {},
  });
  const summary = { retired: [], left: [], youth: [], signed: [], promoted: [], relegated: [], cup: null, newLeague: null };
  const mine = (id) => currentTeamId(ds0, game, id) === game.teamId;
  const isGuest = (id) => ds0.isGuest(currentTeamId(ds0, game, id));

  // 1) 기본 계약을 세이브에 고정 (나이·소속이 바뀌어도 계약 기간이 흔들리지 않게)
  for (const p of ds0.players) if (!game.contracts[p.id] && currentTeamId(ds0, game, p.id) && !isGuest(p.id)) game.contracts[p.id] = contractOf(ds0, game, p.id);

  // 2) 대륙 대회 진출 (지난 시즌 순위 기준)
  const competitions = qualify(ds0, rec);

  // 3) 성장·노화 (+1살) · 은퇴
  const rounds = Object.fromEntries(ds0.leagues.map((l) => [l.id, leagueTotalRounds(game, l.id)]));
  const retired = new Set();
  for (const p of ds0.players) {
    const ovr = overall(p);
    const teamId = currentTeamId(ds0, game, p.id);
    const leagueId = teamId ? ds0.teamById.get(teamId).leagueId : null;
    const share = Math.min(1, (game.playerStats[p.id]?.apps ?? 0) / Math.max(1, rounds[leagueId] ?? 34));
    const delta = ovrChange(p, ovr, potentialOf(w, p, ovr), share, rng);
    const age = p.age + 1;
    w.players[p.id] = packAttributes(age, progressAttributes(p, delta, rng));
    const R = P.retire;
    const from = R.from + (p.position === 'GK' ? R.gkShift : 0);
    let chance = age >= R.hardAge ? 1 : age >= from ? R.base + (age - from) * R.perYear : 0;
    if (!teamId) chance = Math.max(chance, age >= R.freeAgentFrom ? R.freeAgentChance : R.youngFreeAgentChance);
    if (rng.next() < chance) {
      retired.add(p.id);
      if (teamId === game.teamId) summary.retired.push(p.name);
    }
  }
  for (const id of retired) {
    w.retired.push(id);
    delete game.players[id];
    delete game.contracts[id];
  }
  // 은퇴한 선수는 선발·교체 명단·받은 제안에서도 뺀다 (선발 빈자리는 새 시즌 시작 때 fixLineup이 채운다)
  game.bench = (game.bench ?? []).filter((id) => !retired.has(id));
  game.incomingOffers = (game.incomingOffers ?? []).filter((o) => !retired.has(o.playerId));
  invalidateSquads(game);

  // 4) 계약 만료: 우리 팀은 재계약하지 않은 선수가 떠나고, AI 팀은 주전급을 대부분 재계약
  const renewSet = renew ? new Set(renew) : null;
  const rankInTeam = new Map();
  for (const team of ds0.allTeams) {
    squadOf(ds0, game, team.id)
      .sort((a, b) => overall(b) - overall(a))
      .forEach((p, i) => rankInTeam.set(p.id, i));
  }
  for (const [id, c] of Object.entries(game.contracts)) {
    if (c.until > game.seasonIndex || retired.has(id)) continue;
    const p = ds0.playerById.get(id);
    const teamId = p && currentTeamId(ds0, game, id);
    if (!teamId) continue;
    const keep = teamId === game.teamId && renewSet ? renewSet.has(id) : aiWouldRenew(p, rankInTeam.get(id), rng);
    if (keep) {
      // 우리 팀은 재정 화면과 같은 재계약 조건, AI는 주급 10% 인상에 1~3년
      const terms = teamId === game.teamId ? renewalTerms(ds0, game, id) : { wage: Math.round(c.wage * 1.1), years: randInt(rng, [1, 3]) };
      game.contracts[id] = { wage: terms.wage, until: game.seasonIndex + terms.years };
      continue;
    }
    if (teamId === game.teamId) {
      summary.left.push(p.name);
      game.transfers.push({ round: game.round, season: game.seasonIndex, playerId: id, from: teamId, to: null, fee: 0, by: 'expiry' });
    }
    (game.players[id] ??= {}).teamId = null;
    delete game.contracts[id];
  }

  invalidateSquads(game);

  // 5) 승강 (데이터에 승강 정보가 있는 리그만)
  const tableOf = (leagueId) => rec.leagues.find((l) => l.id === leagueId)?.table.map((r) => r.teamId) ?? [];
  for (const league of ds0.leagues) {
    if (!league.relegation) continue;
    const lower = league.relegation.league;
    const spots = league.relegation.spots;
    const down = tableOf(league.id).slice(-spots);
    const up = tableOf(lower).slice(0, spots);
    w.leagueTeams[league.id] = [...w.leagueTeams[league.id].filter((id) => !down.includes(id)), ...up];
    w.leagueTeams[lower] = [...w.leagueTeams[lower].filter((id) => !up.includes(id)), ...down];
    if (down.includes(game.teamId)) summary.relegated.push(game.teamId);
    if (up.includes(game.teamId)) summary.promoted.push(game.teamId);
  }

  // 6) 유스: 팀마다 2~3명
  const pools = namePools(ds0);
  const anyPool = pools.get(ds0.players[0].nationality);
  const nameOf = (nat) => {
    const pool = pools.get(nat)?.first.length > 10 ? pools.get(nat) : anyPool;
    return `${pick(rng, pool.first)} ${pick(rng, pool.last)}`;
  };
  let seq = 0;
  const idOf = () => `yt${game.seasonIndex + 1}-${++seq}`;
  for (const team of [...ds0.allTeams, ...ds0.guestTeams]) {
    const squad = squadOf(ds0, game, team.id).filter((p) => !retired.has(p.id));
    const minWage = Math.max(1, Math.min(...squad.map((p) => game.contracts[p.id]?.wage ?? Infinity).filter(Number.isFinite), 20));
    for (let k = randInt(rng, P.youth.perTeam); k > 0; k--) {
      const y = makeYouth(ds0, w, team, squad, nameOf, rng, idOf);
      squad.push(y);
      w.youth.push(y);
      w.players[y.id] = packAttributes(y.age, y.attributes);
      if (!team.guest) game.contracts[y.id] = { wage: minWage, until: game.seasonIndex + P.youth.contractYears };
      if (team.id === game.teamId) summary.youth.push(`${y.name} (${y.position}, ${y.age}세)`);
    }
  }

  // 7) 새 시즌 표기 → 파생 데이터 다시 만들기
  for (const l of ds0.leagues) w.seasons[l.id] = nextSeasonLabel(l.season);
  w.version++;
  game.seasonIndex += 1;
  const ds1 = worldDataset(base, game);

  // 8) 보강: 인원이 모자란 팀은 무소속 선수로 채운다 (우리 팀은 최소 인원까지만, 알림)
  const free = squadOf(ds1, game, null)
    .filter((p) => p.age < P.aiFill.maxAge)
    .sort((a, b) => overall(b) - overall(a));
  const F = P.aiFill;
  for (const team of [...ds1.allTeams, ...ds1.guestTeams].sort(() => rng.next() - 0.5)) {
    const user = team.id === game.teamId;
    let size = squadOf(ds1, game, team.id).length;
    const goal = user ? F.mustSquad : F.minSquad;
    for (let i = 0; size < goal && i < free.length; i++) {
      const p = free[i];
      if (!p) continue;
      const contract = demandedContract(ds1, game, p, team.id);
      if (team.guest) {
        // 게스트 팀은 재정이 없어 주급 확인 없이 채운다 (계약도 두지 않는다)
        (game.players[p.id] ??= {}).teamId = team.id;
        free[i] = null;
        size++;
        continue;
      }
      // 최소 인원도 안 되면 주급 한도를 넘어서라도 가장 싼 선수 쪽으로
      if (size >= F.mustSquad && contract.wage > wageRoom(ds1, game, team.id)) continue;
      if (size < F.mustSquad && contract.wage > Math.max(wageRoom(ds1, game, team.id), 0) && free.slice(i + 1).some((q) => q && demandedContract(ds1, game, q, team.id).wage < contract.wage * 0.5)) continue;
      (game.players[p.id] ??= {}).teamId = team.id;
      signContract(game, p.id, contract);
      free[i] = null;
      size++;
      if (user) summary.signed.push(p.name);
    }
  }

  invalidateSquads(game);

  // 9) 새 시즌 상태
  game.leagueId = ds1.teamById.get(game.teamId).leagueId;
  if (game.leagueId !== rec.leagueId) summary.newLeague = ds1.leagueById.get(game.leagueId).name;
  game.season = ds1.leagueById.get(game.leagueId).season;
  game.fixtures = {};
  for (const l of ds1.leagues) {
    game.fixtures[l.id] = generateFixtures(l.teamIds, l.rules.rounds, createRng(`${game.seed}:${game.seasonIndex}:${l.id}`)).map((f) => ({ ...f, id: `${l.id}:${f.id}` }));
  }
  game.totalRounds = roundCount(game.fixtures[game.leagueId]);
  game.round = 1;
  game.leagueRounds = Object.fromEntries(ds1.leagues.map((l) => [l.id, 0]));
  game.playerStats = {};
  for (const s of Object.values(game.players)) {
    delete s.condition;
    delete s.suspension;
    delete s.yellows;
    delete s.cupSuspension;
    delete s.cupYellows;
    if (s.injury && (s.injury.matchesOut -= 6) <= 0) delete s.injury; // 비시즌 동안 회복
  }
  game.morale = { adjust: 0 };
  game.press = null;
  game.lastPostInterview = null;
  game.incomingOffers = [];
  game.aiFormations = {};
  const squadIds = new Set(squadOf(ds1, game, game.teamId).map((p) => p.id));
  game.bench = (game.bench ?? []).filter((id) => squadIds.has(id));
  fixLineup(ds1, game);
  initSeasonFinances(ds1, game, { firstSeason: false });
  createCups(ds1, game, competitions.length ? competitions : undefined);
  const myCup = competitions.find((c) => c.teamIds.includes(game.teamId));
  summary.cup = myCup?.name ?? null;
  return { summary };
}
