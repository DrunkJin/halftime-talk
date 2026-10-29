// data/*.json 을 불러와 검증하고, 화면·엔진이 쓰기 쉬운 인덱스를 만든다.
import { getLang } from '../i18n.js';
import { tx } from '../engine/text.js';
import { validateDataset } from './schema.js';

const FILES = ['leagues', 'teams', 'nations', 'players'];

// 부팅 오류. 데이터 로드가 사전 로드보다 먼저 끝날 수 있어 문장(message·details)은 읽을 때 만든다
export class DataError extends Error {
  constructor(key, vars, detailsOf = () => []) {
    super();
    this.key = key;
    this.vars = vars;
    this.detailsOf = detailsOf;
  }

  get message() {
    return tx(this.key, this.vars);
  }

  get details() {
    return this.detailsOf();
  }
}

// 없어도 동작하는 파일 (대륙 대회)
const OPTIONAL_FILES = ['competitions'];

export async function loadDataset(baseUrl = 'data/') {
  const raw = {};
  await Promise.all([
    ...FILES.map(async (name) => {
      const res = await fetch(`${baseUrl}${name}.json`);
      if (!res.ok) throw new DataError('engine.loader.fetchFailed', { file: name, status: res.status });
      raw[name] = await res.json();
    }),
    ...OPTIONAL_FILES.map(async (name) => {
      const res = await fetch(`${baseUrl}${name}.json`).catch(() => null);
      if (res?.ok) raw[name] = await res.json();
    }),
  ]);

  const { errors } = validateDataset(raw);
  if (errors.length > 0) throw new DataError('engine.loader.invalid', { n: errors.length }, () => validateDataset(raw).errors);
  return buildIndex(raw);
}

export function buildIndex(raw) {
  // allTeams = 리그에 속한 팀 (일정·재정·이적 대상). 게스트 팀은 대륙 대회에만 나온다
  const everyTeam = raw.teams.teams;
  const allTeams = everyTeam.filter((t) => !t.guest);
  const guestTeams = everyTeam.filter((t) => t.guest);
  const players = raw.players.players;
  const basis = raw.leagues.basis ?? null; // 능력치 기준 (시장가치 시점·기록 시즌·생성일)
  const teamById = new Map(everyTeam.map((t) => [t.id, t]));
  const squads = new Map(everyTeam.map((t) => [t.id, []]));
  const guestIds = new Set(guestTeams.map((t) => t.id));
  for (const p of players) squads.get(p.teamId)?.push(p);

  const leagues = raw.leagues.leagues;

  return {
    basis,
    leagues,
    leagueById: new Map(leagues.map((l) => [l.id, l])),
    allTeams,
    guestTeams,
    isGuest: (teamId) => guestIds.has(teamId),
    teamById,
    nationByCode: new Map(raw.nations.nations.map((n) => [n.code, n])),
    players,
    playerById: new Map(players.map((p) => [p.id, p])),
    squads,
    // 대륙 대회: [{ id, name, shortName, level, teamIds }] (data/competitions.json, 없으면 빈 목록)
    // name은 지금 언어의 이름 (nameKo·nameEn은 시즌 기록에 저장된 이름을 찾을 때)
    competitions: (raw.competitions?.competitions ?? []).map(({ name, nameKo, nameEn, ...c }) => ({
      ...c,
      nameKo: nameKo ?? name,
      nameEn: nameEn ?? name,
      get name() {
        return getLang() === 'ko' ? this.nameKo : this.nameEn;
      },
      teamIds: c.teamIds.filter((id) => teamById.has(id)),
    })),
    // 2시즌부터 대륙 대회 진출 규칙: { slots: { [대회]: { [리그]: 팀 수 } }, guests, order, holdersTo }
    qualification: raw.competitions?.qualification ?? null,
  };
}
