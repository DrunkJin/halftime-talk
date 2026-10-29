// 받은 편지함: 이사회·선수·이적·리그 소식. 상태에는 종류(kind)와 변수만 남기고 문장은 data/news.json에서 고른다
// game.inbox = [{ id, kind, vars, season, round, read, important }] (최신 먼저, 최대 MAX개)
// vars에는 이름·숫자 같은 데이터만 (언어에 따라 바뀌는 라벨은 media/newsText.js renderNews가 채운다):
//   goalKind·goalTarget → {goal}, verdictKey → {verdict}, injuryKey → {injury}, 무소속은 null
//   lines(결산 등의 줄 목록)는 { key, vars } 배열 — 화면이 t(key, vars)로 그린다 (예전 세이브는 문자열)
import { createRng } from '../engine/rng.js';
import { t } from '../i18n.js';
import { overall } from '../engine/ratings.js';
import { computeTable } from '../league/table.js';
import { topElevenOvr } from '../market/value.js';
import { currentTeamId, fixturesOf, squadOf } from './game.js';

const RUMOR_CHANCE = 0.22; // 라운드마다 이적설이 하나 나올 확률
const BIG_LEAGUES = ['epl', 'laliga', 'serie-a', 'bundesliga', 'ligue-1'];

const MAX = 150;
// 종류 → 분류 (화면 필터)
export const NEWS_GROUPS = {
  get board() { return t('state.newsGroup.board'); },
  get player() { return t('state.newsGroup.player'); },
  get transfer() { return t('state.newsGroup.transfer'); },
  get league() { return t('state.newsGroup.league'); },
  get match() { return t('state.newsGroup.match'); },
};
export const groupOf = (kind) => kind.split('.')[0];

let seq = 0;
export function pushNews(game, kind, vars = {}, { important = false } = {}) {
  const list = (game.inbox ??= []);
  const id = `${game.seasonIndex}-${game.round}-${kind}-${Date.now().toString(36)}-${++seq}`;
  list.unshift({ id, kind, vars, season: game.seasonIndex, round: game.round, read: false, important });
  if (list.length > MAX) list.length = MAX;
  return id;
}

export const unreadCount = (game) => (game.inbox ?? []).filter((m) => !m.read).length;
export function markRead(game, id = null) {
  for (const m of game.inbox ?? []) if (!id || m.id === id) m.read = true;
}

// 한 주(리그 라운드) 진행 뒤 나오는 소식을 모아 넣는다. week: playWeek의 결과
export function weeklyNews(dataset, game, week, userFixture, userResult) {
  const team = (id) => dataset.teamById.get(id)?.shortName ?? id;
  const player = (id) => dataset.playerById.get(id)?.name ?? id;
  const me = team(game.teamId);

  // 이사회
  const objective = game.board?.objective;
  for (const e of week.board ?? []) pushNews(game, `board.${e.kind}`, { team: me, goalKind: objective?.kind ?? null, goalTarget: objective?.target ?? null }, { important: e.kind !== 'praise' });
  // 선수 기분
  for (const e of week.moods ?? []) pushNews(game, `player.${e.kind}`, { name: e.name, id: e.id }, { important: e.kind === 'request' || e.kind === 'promiseBroken' });
  // 스카우트 보고서
  for (const r of week.scouting ?? []) pushNews(game, 'player.scoutReport', { name: r.name, id: r.id, verdictKey: r.verdict }, { important: r.verdict === 'starter' });
  // 임대 보낸 선수 근황: 꾸준히 뛰는지(임대 뒤 라운드의 절반 이상 출전)에 따라
  for (const r of week.loans ?? []) pushNews(game, r.apps >= r.rounds * 0.5 ? 'player.loanReport' : 'player.loanBench', { name: r.name, id: r.id, club: r.club, apps: r.apps, goals: r.goals });
  // 우리 팀 부상 (이번 경기)
  if (userResult) {
    const mySide = userFixture.homeId === game.teamId ? 'home' : 'away';
    for (const inj of userResult.injuries ?? []) if (inj.team === mySide) pushNews(game, 'player.injury', { name: inj.playerName, id: inj.playerId, injury: inj.type, injuryKey: inj.typeKey ?? null, weeks: inj.matchesOut }, { important: inj.matchesOut >= 4 });
  }
  // 훈련 부상·성과
  for (const i of week.training?.injuries ?? []) pushNews(game, 'player.trainingInjury', { name: i.name, id: i.id, weeks: i.weeks });
  const gains = week.training?.gains ?? [];
  if (gains.length) {
    const names = [...new Set(gains.map((g) => g.name))];
    pushNews(game, 'player.training', { names: names.slice(0, 4).join(', '), count: gains.length });
  }
  // 이적: 우리 선수에게 온 제안, 우리 리그 이적
  for (const o of week.newOffers ?? []) pushNews(game, 'transfer.offer', { name: player(o.playerId), club: team(o.teamId), amount: o.amount }, { important: true });
  const myLeague = new Set(dataset.leagueById.get(game.leagueId).teamIds);
  for (const t of (week.aiTransfers ?? []).filter((x) => myLeague.has(x.to) || myLeague.has(x.from)).slice(0, 3)) {
    pushNews(game, 'transfer.done', { name: player(t.playerId), from: t.from ? team(t.from) : null, to: team(t.to), fee: t.fee });
  }
  // 이적설: 가끔 우리 리그 스타가 더 강한 유럽 빅리그 구단의 관심을 받는다 (분위기용)
  const rng = createRng(`${game.seed}:rumor:${game.seasonIndex}:${game.round}`);
  if (rng.next() < RUMOR_CHANCE) {
    const stars = [...myLeague].flatMap((id) => squadOf(dataset, game, id)).sort((a, b) => overall(b) - overall(a)).slice(0, 30);
    const p = stars[Math.floor(rng.next() * stars.length)];
    const from = p && currentTeamId(dataset, game, p.id);
    const clubs = p ? dataset.allTeams.filter((t) => BIG_LEAGUES.includes(t.leagueId) && t.id !== from && topElevenOvr(squadOf(dataset, game, t.id)) >= topElevenOvr(squadOf(dataset, game, from))) : [];
    const club = clubs[Math.floor(rng.next() * clubs.length)];
    if (club) pushNews(game, 'transfer.rumor', { name: p.name, id: p.id, club: club.shortName, team: team(from), mine: from === game.teamId });
  }
  // 리그 판도: 6라운드마다
  const played = game.round - 1;
  if (played > 0 && played % 6 === 0 && played < game.totalRounds) {
    const league = dataset.leagueById.get(game.leagueId);
    const table = computeTable(league.teamIds, fixturesOf(game), league.rules);
    const mine = table.find((r) => r.teamId === game.teamId);
    pushNews(game, 'league.roundup', { round: played, leader: team(table[0].teamId), leaderPts: table[0].points, gap: table[0].points - table[1].points, position: mine?.position ?? '', points: mine?.points ?? '' });
  }
}

// ── 자동 진행 결산 ──────────────────────────────────────
// '시즌 끝까지'로 여러 라운드를 한 번에 넘기면 소식이 수십 통 쌓인다. 진행 전 상태를 찍어 두고(digestStart),
// 끝나면 그 기간을 한 통으로 정리한다(digestFinish): 전적·순위 변화·기억할 경기·득점·부상·이적·이사회 반응.
// 개별 소식은 읽음으로 돌리고, 시즌 끝 평가·경질·제안처럼 감독이 결정해야 하는 것만 안 읽음으로 남긴다.
const KEEP_UNREAD = (kind) => kind.startsWith('board.eval') || ['board.sacked', 'board.offer', 'board.objective', 'board.welcome'].includes(kind);

export function digestStart(dataset, game) {
  const league = dataset.leagueById.get(game.leagueId);
  // 아직 경기를 안 치렀으면 순위는 의미가 없다 (결산에 '→'를 쓰지 않는다)
  const pos = game.round > 1 ? computeTable(league.teamIds, fixturesOf(game), league.rules).find((r) => r.teamId === game.teamId)?.position ?? null : null;
  const goals = Object.fromEntries(squadOf(dataset, game, game.teamId).map((p) => [p.id, game.playerStats[p.id]?.goals ?? 0]));
  return { ids: new Set((game.inbox ?? []).map((m) => m.id)), round: game.round, season: game.seasonIndex, teamId: game.teamId, transfers: game.transfers.length, pos, goals };
}

export function digestFinish(dataset, game, start) {
  if (!start || game.seasonIndex !== start.season || game.teamId !== start.teamId || game.round <= start.round + 1) return null;
  const team = (id) => dataset.teamById.get(id)?.shortName ?? id;
  const league = dataset.leagueById.get(game.leagueId);
  const mine = fixturesOf(game).filter((f) => f.result && f.round >= start.round && f.round < game.round && (f.homeId === game.teamId || f.awayId === game.teamId));
  const rec = { w: 0, d: 0, l: 0, gf: 0, ga: 0 };
  let best = null;
  let worst = null;
  for (const f of mine) {
    const side = f.homeId === game.teamId ? 'home' : 'away';
    const gf = f.result.score[side];
    const ga = f.result.score[side === 'home' ? 'away' : 'home'];
    rec.gf += gf;
    rec.ga += ga;
    rec[gf > ga ? 'w' : gf < ga ? 'l' : 'd']++;
    const m = { round: f.round, opp: team(side === 'home' ? f.awayId : f.homeId), score: `${gf}-${ga}`, diff: gf - ga };
    if (m.diff > 0 && (!best || m.diff > best.diff)) best = m;
    if (m.diff < 0 && (!worst || m.diff < worst.diff)) worst = m;
  }
  const table = computeTable(league.teamIds, fixturesOf(game), league.rules);
  const pos = table.find((r) => r.teamId === game.teamId)?.position;
  const over = game.round > game.totalRounds;
  const L = (key, vars) => ({ key: `state.digest.${key}`, vars });
  const lines = [L('record', { n: mine.length, w: rec.w, d: rec.d, l: rec.l, gf: rec.gf, ga: rec.ga })];
  if (pos) lines.push(start.pos && start.pos !== pos ? L(over ? 'posMoveFinal' : 'posMove', { from: start.pos, pos }) : L(over ? 'posFinal' : 'posNow', { pos }));
  if (best) lines.push(L('best', { round: best.round, opp: best.opp, score: best.score }));
  if (worst) lines.push(L('worst', { round: worst.round, opp: worst.opp, score: worst.score }));
  const scorer = squadOf(dataset, game, game.teamId)
    .map((p) => ({ p, g: (game.playerStats[p.id]?.goals ?? 0) - (start.goals[p.id] ?? 0) }))
    .sort((a, b) => b.g - a.g)[0];
  if (scorer?.g > 0) lines.push(L('scorer', { name: scorer.p.name, n: scorer.g }));
  // 새로 온 소식에서: 큰 부상, 이사회 반응
  const fresh = (game.inbox ?? []).filter((m) => !start.ids.has(m.id));
  const injuries = fresh.filter((m) => (m.kind === 'player.injury' || m.kind === 'player.trainingInjury') && (m.vars.weeks ?? 0) >= 3);
  if (injuries.length) {
    // 이름·경기 수를 하나씩 자리로 (어순이 언어마다 달라 목록 틀을 사람 수별 문장으로 둔다)
    const vars = {};
    injuries.slice(0, 4).forEach((m, i) => Object.assign(vars, { [`name${i + 1}`]: m.vars.name, [`weeks${i + 1}`]: m.vars.weeks }));
    if (injuries.length > 4) vars.more = injuries.length - 4;
    lines.push(L(injuries.length > 4 ? 'injuries4More' : `injuries${injuries.length}`, vars));
  }
  const moves = game.transfers.slice(start.transfers).filter((t) => t.from === game.teamId || t.to === game.teamId);
  const cameIn = moves.filter((t) => t.to === game.teamId && t.by !== 'loanEnd').map((t) => dataset.playerById.get(t.playerId)?.name).filter(Boolean);
  const left = moves.filter((t) => t.from === game.teamId).map((t) => dataset.playerById.get(t.playerId)?.name).filter(Boolean);
  if (cameIn.length || left.length) lines.push(L(cameIn.length && left.length ? 'movesBoth' : cameIn.length ? 'movesIn' : 'movesOut', { in: cameIn.join(', '), out: left.join(', ') }));
  // 이사회 반응: 나온 순서대로 (조합마다 문장 하나 — 키는 종류를 _로 이은 것)
  const boardKinds = [...new Set(fresh.map((m) => m.kind).filter((k) => k === 'board.praise' || k === 'board.warn' || k === 'board.ultimatum'))].map((k) => k.slice(6));
  if (boardKinds.length) lines.push(L(`board.${boardKinds.join('_')}`, {}));
  // 정리: 결정이 필요한 것만 남기고 읽음으로
  let folded = 0;
  for (const m of fresh) {
    if (m.read || KEEP_UNREAD(m.kind)) continue;
    m.read = true;
    folded++;
  }
  if (folded) lines.push(L('folded', { n: folded }));
  return pushNews(game, 'match.digest', { from: start.round, to: Math.min(game.round, game.totalRounds + 1) - 1, lines }, { important: true });
}

