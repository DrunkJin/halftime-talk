// 시즌이 지나며 바뀌는 선수·리그 정보. 원본 데이터(data/*.json)는 그대로 두고 game.world에 바뀐 값만 저장한 뒤,
// 원본 위에 덮어 쓴 '이 게임의 데이터'를 만들어 화면·Worker가 같이 쓴다.
//
// game.world = {
//   version,                          바뀔 때마다 +1 (파생 데이터 캐시 키)
//   leagueTeams: { [리그 id]: [팀 id] }  승강 반영된 리그 구성
//   seasons: { [리그 id]: '2027-28' }   리그별 시즌 표기
//   players: { [선수 id]: [나이, ...능력치] }  능력치는 ATTRIBUTE_KEYS 순서
//   youth: [선수 객체]                  유스로 새로 생긴 선수
//   retired: [선수 id]
// }
import { ATTRIBUTE_KEYS } from '../data/schema.js';
import { buildIndex } from '../data/loader.js';

export const packAttributes = (age, attributes) => [age, ...ATTRIBUTE_KEYS.map((k) => attributes[k])];
const unpack = (arr) => Object.fromEntries(ATTRIBUTE_KEYS.map((k, i) => [k, arr[i + 1]]));

const cache = new WeakMap(); // 원본 데이터 → { key, dataset }

export function worldDataset(base, game) {
  const w = game?.world;
  if (!w) return base;
  const key = `${game.seed}:${game.slot}:${w.version}`;
  const hit = cache.get(base);
  if (hit?.key === key) return hit.dataset;

  const retired = new Set(w.retired);
  const players = [];
  for (const p of [...base.players, ...w.youth]) {
    if (retired.has(p.id)) continue;
    const o = w.players[p.id];
    players.push(o ? { ...p, age: o[0], attributes: unpack(o) } : p);
  }
  const membership = new Map();
  for (const [leagueId, ids] of Object.entries(w.leagueTeams)) for (const id of ids) membership.set(id, leagueId);
  const teams = [...base.allTeams, ...base.guestTeams].map((t) => (membership.has(t.id) && membership.get(t.id) !== t.leagueId ? { ...t, leagueId: membership.get(t.id) } : t));
  const leagues = base.leagues.map((l) => ({ ...l, teamIds: w.leagueTeams[l.id] ?? l.teamIds, season: w.seasons?.[l.id] ?? l.season }));
  const dataset = buildIndex({
    leagues: { leagues },
    teams: { teams },
    nations: { nations: [...base.nationByCode.values()] },
    players: { players },
    competitions: { competitions: base.competitions, qualification: base.qualification },
  });
  cache.set(base, { key, dataset });
  return dataset;
}
