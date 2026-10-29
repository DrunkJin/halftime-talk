// 받은 편지함: 이사회·선수·이적·리그 소식. 상태에는 종류(kind)와 변수만 남기고 문장은 data/news.json에서 고른다
// game.inbox = [{ id, kind, vars, season, round, read, important }] (최신 먼저, 최대 MAX개)
import { createRng } from '../engine/rng.js';
import { overall } from '../engine/ratings.js';
import { computeTable } from '../league/table.js';
import { topElevenOvr } from '../market/value.js';
import { currentTeamId, fixturesOf, squadOf } from './game.js';

const RUMOR_CHANCE = 0.22; // 라운드마다 이적설이 하나 나올 확률
const BIG_LEAGUES = ['epl', 'laliga', 'serie-a', 'bundesliga', 'ligue-1'];

const MAX = 150;
// 종류 → 분류 (화면 필터)
export const NEWS_GROUPS = { board: '이사회', player: '선수', transfer: '이적', league: '리그', match: '경기' };
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
  for (const e of week.board ?? []) pushNews(game, `board.${e.kind}`, { team: me, goal: game.board?.objective?.label ?? '' }, { important: e.kind !== 'praise' });
  // 선수 기분
  for (const e of week.moods ?? []) pushNews(game, `player.${e.kind}`, { name: e.name, id: e.id }, { important: e.kind === 'request' || e.kind === 'promiseBroken' });
  // 우리 팀 부상 (이번 경기)
  if (userResult) {
    const mySide = userFixture.homeId === game.teamId ? 'home' : 'away';
    for (const inj of userResult.injuries ?? []) if (inj.team === mySide) pushNews(game, 'player.injury', { name: inj.playerName, id: inj.playerId, injury: inj.type, weeks: inj.matchesOut }, { important: inj.matchesOut >= 4 });
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
    pushNews(game, 'transfer.done', { name: player(t.playerId), from: t.from ? team(t.from) : '무소속', to: team(t.to), fee: t.fee });
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
