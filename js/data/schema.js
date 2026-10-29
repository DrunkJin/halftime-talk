// 데이터 스키마 정의와 검증.
// 게임(브라우저)과 tools/(Node) 양쪽에서 import 하므로 DOM·Node API를 쓰지 않는다.
// 스키마 설명은 docs/data-schema.md 참고.
// 오류 문장은 사전(engine.schema.*)에서. 사전이 없는 Node에서는 키와 값이 그대로 나온다 (engine/text.js)
import { tx } from '../engine/text.js';

export const SCHEMA_VERSION = 2;

export const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'];

// 능력치 키. 모든 선수가 모든 키를 가진다 (필드 플레이어도 GK 능력치를 낮게 가짐).
export const ATTRIBUTE_GROUPS = {
  technical: ['finishing', 'longShots', 'passing', 'crossing', 'dribbling', 'firstTouch', 'tackling', 'marking', 'heading'],
  mental: ['vision', 'positioning', 'offTheBall', 'composure', 'workRate'],
  physical: ['pace', 'stamina', 'strength', 'agility'],
  goalkeeping: ['gkReflexes', 'gkHandling', 'gkPositioning', 'gkDistribution'],
};
export const ATTRIBUTE_KEYS = Object.values(ATTRIBUTE_GROUPS).flat();
export const ATTRIBUTE_MIN = 1;
export const ATTRIBUTE_MAX = 100;

export const AGE_MIN = 15;
export const AGE_MAX = 45;

export const TIEBREAKERS = ['points', 'goalDifference', 'goalsFor', 'headToHead'];

// 파일별 허용 필드. 여기에 없는 필드가 있으면 검증 오류.
export const LEAGUE_FIELDS = ['id', 'name', 'country', 'season', 'level', 'teamIds', 'rules'];
export const LEAGUE_OPTIONAL_FIELDS = ['promotion', 'relegation'];
export const TEAM_FIELDS = ['id', 'name', 'shortName', 'code', 'colors', 'stadium', 'logo', 'leagueId'];
export const NATION_FIELDS = ['code', 'name', 'nameKo'];
// 선수는 이름·나이·국적·포지션·소속·능력치만 허용 (CLAUDE.md 데이터 규칙)
export const PLAYER_FIELDS = ['id', 'name', 'age', 'nationality', 'position', 'altPositions', 'teamId', 'attributes'];

const ID_RE = /^[A-Za-z0-9_-]+$/;
const TEAM_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CODE3_RE = /^[A-Z]{3}$/;
const TEAM_CODE_RE = /^[A-Z0-9]{3}$/; // 예: M05 (마인츠)
const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
// 로고는 assets/logos/ 안의 파일명만 적는다 (경로 금지)
const LOGO_FILE_RE = /^[\w.-]+\.(png|svg|webp|jpe?g)$/i;

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isText = (v) => typeof v === 'string' && v.trim() !== '';
const isIntIn = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;

function checkFields(obj, allowed, path, err, optional = []) {
  for (const key of allowed) {
    if (!(key in obj)) err(path, tx('engine.schema.missingField', { key }));
  }
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key) && !optional.includes(key)) err(path, tx('engine.schema.unknownField', { key }));
  }
}

function checkFileHeader(fileName, file, listKey, err) {
  if (!isObject(file)) {
    err(fileName, tx('engine.schema.topNotObject'));
    return false;
  }
  if (file.schemaVersion !== SCHEMA_VERSION) {
    err(fileName, tx('engine.schema.version', { got: String(file.schemaVersion), want: SCHEMA_VERSION }));
  }
  if (listKey && !Array.isArray(file[listKey])) {
    err(fileName, tx('engine.schema.noList', { key: listKey }));
    return false;
  }
  return true;
}

function validateLeague(league, path, teamById, leagueIds, err) {
  checkFields(league, LEAGUE_FIELDS, path, err, LEAGUE_OPTIONAL_FIELDS);
  if (!TEAM_ID_RE.test(league.id ?? '')) err(`${path}.id`, tx('engine.schema.leagueId'));
  if (!isText(league.name)) err(`${path}.name`, tx('engine.schema.empty'));
  if (!CODE3_RE.test(league.country ?? '')) err(`${path}.country`, tx('engine.schema.countryCode'));
  if (!isText(league.season)) err(`${path}.season`, tx('engine.schema.empty'));
  if (!isIntIn(league.level, 1, 5)) err(`${path}.level`, tx('engine.schema.level'));

  if (!Array.isArray(league.teamIds) || league.teamIds.length < 2) {
    err(`${path}.teamIds`, tx('engine.schema.minTeams'));
  } else {
    const seen = new Set();
    for (const id of league.teamIds) {
      if (seen.has(id)) err(`${path}.teamIds`, tx('engine.schema.duplicateTeam', { id: String(id) }));
      const team = teamById.get(id);
      if (!team) err(`${path}.teamIds`, tx('engine.schema.unknownTeam', { id: String(id) }));
      else if (team.leagueId !== league.id) err(`${path}.teamIds`, tx('engine.schema.teamLeague', { id: String(id), leagueId: String(team.leagueId) }));
      seen.add(id);
    }
  }

  for (const key of LEAGUE_OPTIONAL_FIELDS) {
    const link = league[key];
    if (link === undefined) continue;
    if (!isObject(link) || !leagueIds.has(link.league) || !isIntIn(link.spots, 1, 10)) {
      err(`${path}.${key}`, tx('engine.schema.link'));
    }
  }

  const rules = league.rules;
  if (!isObject(rules)) {
    err(`${path}.rules`, tx('engine.schema.notObject'));
    return;
  }
  if (!isIntIn(rules.rounds, 1, 4)) err(`${path}.rules.rounds`, tx('engine.schema.rounds'));
  const pts = rules.points;
  if (!isObject(pts) || !['win', 'draw', 'loss'].every((k) => Number.isInteger(pts[k]))) {
    err(`${path}.rules.points`, tx('engine.schema.points'));
  }
  if (!Array.isArray(rules.tiebreakers) || rules.tiebreakers.length === 0) {
    err(`${path}.rules.tiebreakers`, tx('engine.schema.emptyList'));
  } else {
    for (const t of rules.tiebreakers) {
      if (!TIEBREAKERS.includes(t)) err(`${path}.rules.tiebreakers`, tx('engine.schema.unknownTiebreaker', { value: String(t) }));
    }
  }
  const md = rules.matchday;
  if (!isObject(md) || !isIntIn(md.benchSize, 0, 15) || !isIntIn(md.maxSubstitutions, 0, md.benchSize)) {
    err(`${path}.rules.matchday`, tx('engine.schema.matchday'));
  }
}

function validateTeam(team, path, err) {
  checkFields(team, TEAM_FIELDS, path, err, ['guest', 'country']);
  // 게스트 팀: 리그 없이 대륙 대회에만 나오는 팀 (leagueId null, guest true, country 국가 코드)
  if (team.guest !== undefined && (team.guest !== true || team.leagueId !== null || !isText(team.country))) err(path, tx('engine.schema.guest'));
  if (!TEAM_ID_RE.test(team.id ?? '')) err(`${path}.id`, tx('engine.schema.teamId'));
  if (!isText(team.name)) err(`${path}.name`, tx('engine.schema.empty'));
  if (!isText(team.shortName)) err(`${path}.shortName`, tx('engine.schema.empty'));
  if (!TEAM_CODE_RE.test(team.code ?? '')) err(`${path}.code`, tx('engine.schema.teamCode'));
  if (!isObject(team.colors) || !HEX_COLOR_RE.test(team.colors.primary) || !HEX_COLOR_RE.test(team.colors.secondary)) {
    err(`${path}.colors`, tx('engine.schema.colors'));
  }
  if (team.stadium !== null && !isText(team.stadium)) err(`${path}.stadium`, tx('engine.schema.stadium'));
  if (team.logo !== null && !LOGO_FILE_RE.test(team.logo ?? '')) {
    err(`${path}.logo`, tx('engine.schema.logo'));
  }
}

function validatePlayer(p, path, ctx, err) {
  checkFields(p, PLAYER_FIELDS, path, err);
  if (!ID_RE.test(p.id ?? '')) err(`${path}.id`, tx('engine.schema.playerId'));
  if (!isText(p.name)) err(`${path}.name`, tx('engine.schema.empty'));
  if (!isIntIn(p.age, AGE_MIN, AGE_MAX)) err(`${path}.age`, tx('engine.schema.intRange', { min: AGE_MIN, max: AGE_MAX }));
  if (!ctx.nationCodes.has(p.nationality)) err(`${path}.nationality`, tx('engine.schema.unknownNation', { code: String(p.nationality) }));
  if (!POSITIONS.includes(p.position)) err(`${path}.position`, tx('engine.schema.unknownPosition', { pos: String(p.position) }));

  if (!Array.isArray(p.altPositions)) {
    err(`${path}.altPositions`, tx('engine.schema.altNotArray'));
  } else {
    if (new Set(p.altPositions).size !== p.altPositions.length) err(`${path}.altPositions`, tx('engine.schema.duplicate'));
    for (const pos of p.altPositions) {
      if (!POSITIONS.includes(pos)) err(`${path}.altPositions`, tx('engine.schema.unknownPosition', { pos: String(pos) }));
      if (pos === p.position) err(`${path}.altPositions`, tx('engine.schema.altIsMain'));
    }
  }

  if (p.teamId !== null && !ctx.teamIds.has(p.teamId)) err(`${path}.teamId`, tx('engine.schema.unknownTeam', { id: String(p.teamId) }));

  if (!isObject(p.attributes)) {
    err(`${path}.attributes`, tx('engine.schema.notObject'));
    return;
  }
  checkFields(p.attributes, ATTRIBUTE_KEYS, `${path}.attributes`, err);
  for (const key of ATTRIBUTE_KEYS) {
    if (key in p.attributes && !isIntIn(p.attributes[key], ATTRIBUTE_MIN, ATTRIBUTE_MAX)) {
      err(`${path}.attributes.${key}`, tx('engine.schema.intRange', { min: ATTRIBUTE_MIN, max: ATTRIBUTE_MAX }));
    }
  }
}

// 네 파일을 함께 검증한다. 오류가 하나라도 있으면 게임을 시작하면 안 된다.
export function validateDataset({ leagues, teams, nations, players }) {
  const errors = [];
  const warnings = [];
  const err = (path, msg) => errors.push(`${path}: ${msg}`);
  const warn = (path, msg) => warnings.push(`${path}: ${msg}`);

  const teamIds = new Set();
  const teamById = new Map();
  if (checkFileHeader('teams.json', teams, 'teams', err)) {
    teams.teams.forEach((t, i) => {
      const path = `teams[${i}]`;
      if (!isObject(t)) return err(path, tx('engine.schema.notObject'));
      validateTeam(t, path, err);
      if (teamIds.has(t.id)) err(`${path}.id`, tx('engine.schema.duplicateId', { id: String(t.id) }));
      teamIds.add(t.id);
      teamById.set(t.id, t);
    });
  }

  const nationCodes = new Set();
  if (checkFileHeader('nations.json', nations, 'nations', err)) {
    nations.nations.forEach((n, i) => {
      const path = `nations[${i}]`;
      if (!isObject(n)) return err(path, tx('engine.schema.notObject'));
      checkFields(n, NATION_FIELDS, path, err);
      if (!CODE3_RE.test(n.code ?? '')) err(`${path}.code`, tx('engine.schema.code3'));
      if (!isText(n.name) || !isText(n.nameKo)) err(path, tx('engine.schema.nationName'));
      if (nationCodes.has(n.code)) err(`${path}.code`, tx('engine.schema.duplicateId', { id: String(n.code) }));
      nationCodes.add(n.code);
    });
  }

  const leagueList = checkFileHeader('leagues.json', leagues, 'leagues', err) ? leagues.leagues : [];
  const leagueIds = new Set(leagueList.map((l) => l?.id));
  if (leagueIds.size !== leagueList.length) err('leagues.json', tx('engine.schema.duplicateLeagueId'));
  leagueList.forEach((l, i) => (isObject(l) ? validateLeague(l, `leagues[${i}]`, teamById, leagueIds, err) : err(`leagues[${i}]`, tx('engine.schema.notObject'))));
  // 모든 팀은 정확히 한 리그에 속한다
  const inLeague = new Map();
  for (const l of leagueList) for (const id of l?.teamIds ?? []) inLeague.set(id, (inLeague.get(id) ?? 0) + 1);
  for (const t of teamById.values()) {
    if (t.guest) continue;
    if (!leagueIds.has(t.leagueId)) err(`team '${t.id}'`, tx('engine.schema.unknownLeague', { id: String(t.leagueId) }));
    else if (inLeague.get(t.id) !== 1) err(`team '${t.id}'`, tx('engine.schema.teamInLeagues', { n: inLeague.get(t.id) ?? 0 }));
  }

  const squads = new Map([...teamIds].map((id) => [id, []]));
  if (checkFileHeader('players.json', players, 'players', err)) {
    const playerIds = new Set();
    const names = new Set(); // 같은 팀 안의 동명이인만 경고 (리그가 많아 다른 팀 동명이인은 흔함)
    players.players.forEach((p, i) => {
      const path = `players[${i}]`;
      if (!isObject(p)) return err(path, tx('engine.schema.notObject'));
      validatePlayer(p, path, { teamIds, nationCodes }, err);
      if (playerIds.has(p.id)) err(`${path}.id`, tx('engine.schema.duplicateId', { id: String(p.id) }));
      playerIds.add(p.id);
      const nameKey = `${p.teamId}|${p.name}`;
      if (names.has(nameKey)) warn(`${path}.name`, tx('engine.schema.sameName', { name: String(p.name) }));
      names.add(nameKey);
      squads.get(p.teamId)?.push(p);
    });
  }

  // 리그 팀은 경기를 치를 수 있는 최소 인원이 있어야 한다
  for (const league of leagueList) {
    const benchSize = league?.rules?.matchday?.benchSize ?? 0;
    for (const id of league?.teamIds ?? []) {
      const squad = squads.get(id);
      if (!squad) continue;
      const gks = squad.filter((p) => p.position === 'GK').length;
      if (squad.length < 11 || gks === 0) {
        err(`squad '${id}'`, tx('engine.schema.squadMin', { n: squad.length, gks }));
      } else {
        if (squad.length < 11 + benchSize) warn(`squad '${id}'`, tx('engine.schema.squadBench', { n: squad.length, bench: benchSize }));
        if (gks < 2) warn(`squad '${id}'`, tx('engine.schema.fewGk', { gks }));
      }
    }
  }

  return { errors, warnings };
}
