// 이사회 (사용자 팀): 시즌 목표·신뢰도, 경질, 다른 구단의 제안과 부임. 수치는 boardConfig.js, 문구는 data/board.json
//
// game.board = { confidence, objective: { target, kind, label, size }, alerts: { warn, ultimatum, praise },
//                sacked: { offers, midSeason } | null, offers: [teamId] | null, seasonEval, pendingMove }
// game.jobs = [{ seasonIndex, round, teamId, reason: 'start'|'sacked'|'offer' }]
import { rebuildCupSchedule } from '../competitions/cups.js';
import { FORMATION_CELLS } from '../engine/formations.js';
import { autoSelectLineup, bestFormation } from '../engine/lineup.js';
import { createRng } from '../engine/rng.js';
import { aiIdentity, squadProfile } from '../engine/tactics.js';
import { TACTICS } from '../engine/config.js';
import { computeTable } from '../league/table.js';
import { topElevenOvr } from '../market/value.js';
import { BOARD as B } from './boardConfig.js';
import { noteSeasonExpectation } from './career.js';
import { fixturesOf, leagueTotalRounds, squadOf, userSlots } from './game.js';

const clamp = (v) => Math.max(0, Math.min(100, v));
export const boardOf = (game) => (game.board ??= { confidence: B.start, objective: null, alerts: {}, sacked: null, offers: null, seasonEval: null, pendingMove: null });

// 시즌 목표: 시즌 전 전력 순위 + slack (강등권 위까지)
export function setObjective(dataset, game) {
  const board = boardOf(game);
  const league = dataset.leagueById.get(game.leagueId);
  const size = league.teamIds.length;
  const exp = game.seasonExpect?.seasonIndex === game.seasonIndex ? game.seasonExpect.rank : Math.ceil(size / 2);
  const safe = size - (league.relegation?.spots ?? B.defaultRelegationSpots);
  const target = Math.max(1, Math.min(safe, exp + B.slack - (exp === 1 ? 1 : 0)));
  const rule = B.labels.find((l) => (l.maxTarget != null ? target <= l.maxTarget : target / size <= l.maxShare)) ?? B.labels.at(-1);
  board.objective = { target, kind: rule.kind, label: rule.label.replace('{target}', target), size, expected: exp, seasonIndex: game.seasonIndex };
  board.alerts = {};
  board.seasonEval = null;
  board.offers = null;
  return board.objective;
}

const levelOf = (c) => (c >= 80 ? '굳건함' : c >= 60 ? '좋음' : c >= 40 ? '보통' : c >= 20 ? '불안' : '위기');
export const confidenceLabel = (game) => levelOf(boardOf(game).confidence);

function positionOf(dataset, game) {
  const league = dataset.leagueById.get(game.leagueId);
  return computeTable(league.teamIds, fixturesOf(game), league.rules).find((r) => r.teamId === game.teamId)?.position ?? null;
}

// 리그 경기 뒤 (playWeek, 라운드 진행 후). → 알림 [{ kind: 'warn'|'ultimatum'|'praise'|'sacked' }]
export function updateBoardAfterMatch(dataset, game, fixture, result) {
  const board = boardOf(game);
  if (!board.objective || board.sacked) return [];
  const events = [];
  const side = fixture && result ? (fixture.homeId === game.teamId ? 'home' : 'away') : null;
  let delta = 0;
  if (side) {
    const gf = result.score[side];
    const ga = result.score[side === 'home' ? 'away' : 'home'];
    delta += B.result[gf > ga ? 'W' : gf < ga ? 'L' : 'D'];
  }
  const progress = (game.round - 1) / game.totalRounds;
  if (game.round - 1 >= B.positionFromRound) {
    const pos = positionOf(dataset, game);
    if (pos) delta += ((board.objective.target - pos) / board.objective.size) * B.positionWeight * progress;
  }
  const before = board.confidence;
  board.confidence = clamp(before + delta);
  const c = board.confidence;
  if (c < B.ultimatumBelow && !board.alerts.ultimatum) (board.alerts.ultimatum = true), events.push({ kind: 'ultimatum' });
  else if (c < B.warnBelow && !board.alerts.warn) (board.alerts.warn = true), events.push({ kind: 'warn' });
  if (c > B.praiseAbove && !board.alerts.praise) (board.alerts.praise = true), events.push({ kind: 'praise' });
  if (progress >= B.sackFrom && c <= B.sackBelow) {
    board.sacked = { midSeason: true, offers: findOffers(dataset, game, 'worse', { sameLeague: true }) };
    events.push({ kind: 'sacked' });
  }
  return events;
}

// 시즌 끝 평가 (playWeek에서 시즌이 끝날 때, recordSeason 뒤). → { verdict, delta, sacked, offers }
export function evaluateSeason(dataset, game) {
  const board = boardOf(game);
  if (!board.objective || board.sacked) return null;
  const rec = game.history?.find((h) => h.seasonIndex === game.seasonIndex);
  if (!rec) return null;
  const S = B.season;
  const diff = board.objective.target - rec.mine.position;
  const verdict = diff >= S.exceeded.from ? 'exceeded' : diff >= S.met.from ? 'met' : diff >= S.missedSlightly.from ? 'missedSlightly' : 'missedBadly';
  let delta = S[verdict].delta + rec.trophies.length * S.trophy;
  if (rec.mine.promoted) delta += S.promoted;
  if (rec.mine.relegated) delta += S.relegated;
  board.confidence = clamp(board.confidence + delta);
  board.seasonEval = { verdict, delta, target: board.objective.target, label: board.objective.label, position: rec.mine.position, confidence: board.confidence, trophies: rec.trophies.length };
  if (board.confidence < B.seasonEndSackBelow) {
    board.sacked = { midSeason: false, offers: findOffers(dataset, game, 'worse') };
  } else if (board.confidence >= B.offers.goodFrom && (verdict === 'exceeded' || rec.trophies.length)) {
    board.offers = findOffers(dataset, game, 'better');
  }
  return board.seasonEval;
}

// 제안할 구단: 전력이 우리보다 높거나(better) 낮은(worse) 구단 중 같은 나라 먼저. sameLeague: 시즌 중 경질 (리그를 옮기면 일정이 꼬인다)
export function findOffers(dataset, game, kind, { sameLeague = false } = {}) {
  const O = B.offers;
  const mine = topElevenOvr(squadOf(dataset, game, game.teamId));
  const country = dataset.leagueById.get(game.leagueId).country;
  const [lo, hi] = O[kind];
  const rng = createRng(`${game.seed}:offers:${game.seasonIndex}:${game.round}:${kind}`);
  let pool = dataset.allTeams
    .filter((t) => t.id !== game.teamId && (!sameLeague || t.leagueId === game.leagueId))
    .map((t) => ({ t, gap: topElevenOvr(squadOf(dataset, game, t.id)) - mine }))
    .filter(({ gap }) => (kind === 'better' ? gap >= lo && gap <= hi : -gap >= lo && -gap <= hi));
  // 같은 리그 경질인데 전력이 낮은 구단이 없으면: 같은 리그 하위권 아무 데나
  if (!pool.length && sameLeague) pool = dataset.allTeams.filter((t) => t.id !== game.teamId && t.leagueId === game.leagueId).map((t) => ({ t, gap: 0 }));
  const weight = (x) => (dataset.leagueById.get(x.t.leagueId)?.country === country ? O.sameCountryWeight : 1) * (0.5 + rng.next());
  const n = O.count[0] + Math.floor(rng.next() * (O.count[1] - O.count[0] + 1));
  return pool
    .map((x) => ({ ...x, w: weight(x) }))
    .sort((a, b) => b.w - a.w)
    .slice(0, n)
    .map((x) => x.t.id);
}

// 새 구단 부임: 선발·전술·훈련·기분·사기를 새로. midSeason이면 같은 리그 안에서 바로, 아니면 새 시즌 시작 때
export function moveToTeam(dataset, game, teamId, { reason = 'offer' } = {}) {
  const team = dataset.teamById.get(teamId);
  const leagueChanged = team.leagueId !== game.leagueId;
  game.teamId = teamId;
  game.leagueId = team.leagueId;
  if (leagueChanged) {
    game.season = dataset.leagueById.get(team.leagueId).season;
    game.totalRounds = leagueTotalRounds(game, team.leagueId);
    game.round = (game.leagueRounds?.[team.leagueId] ?? 0) + 1;
    rebuildCupSchedule(game);
  }
  const squad = squadOf(dataset, game, teamId);
  const formation = bestFormation(squad, Object.keys(FORMATION_CELLS)).formation;
  game.formation = { cells: FORMATION_CELLS[formation].map((c) => [...c]) };
  game.lineup = autoSelectLineup(squad, userSlots(game)).map((p) => p.id);
  game.bench = [];
  game.tactics = { ...TACTICS.defaults, ...aiIdentity(squadProfile(userSlots(game), game.lineup.map((id) => dataset.playerById.get(id))), 0) };
  delete game.familiarity;
  delete game.training;
  delete game.squadMood;
  game.morale = { adjust: 0 };
  game.press = null;
  game.incomingOffers = [];
  if (game.aiFormations) delete game.aiFormations[teamId];
  (game.jobs ??= []).push({ seasonIndex: game.seasonIndex, round: game.round, teamId, reason });
  const board = boardOf(game);
  board.confidence = B.start;
  board.sacked = null;
  board.offers = null;
  board.pendingMove = null;
  noteSeasonExpectation(dataset, game);
  setObjective(dataset, game);
}

// 제안 수락: 시즌 중 경질이면 바로 부임, 그 밖에는 다음 시즌 시작 때 (startNextSeason → applyPendingMove)
export function acceptOffer(dataset, game, teamId) {
  const board = boardOf(game);
  if (board.sacked?.midSeason) return moveToTeam(dataset, game, teamId, { reason: 'sacked' });
  board.pendingMove = { teamId, reason: board.sacked ? 'sacked' : 'offer' };
  board.sacked = null;
  board.offers = null;
}

// 새 시즌 시작 (startNextSeason 끝): 옮기기로 한 구단이 있으면 부임, 아니면 신뢰도를 이어 받고 새 목표
export function startBoardSeason(dataset, game) {
  const board = boardOf(game);
  if (board.pendingMove) return moveToTeam(dataset, game, board.pendingMove.teamId, { reason: board.pendingMove.reason });
  board.confidence = clamp(B.start + (board.confidence - B.start) * B.carryOver);
  setObjective(dataset, game);
}
