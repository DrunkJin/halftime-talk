// 데이터 스키마 정의와 검증.
// 게임(브라우저)과 tools/(Node) 양쪽에서 import 하므로 DOM·Node API를 쓰지 않는다.
// 스키마 설명은 docs/data-schema.md 참고.

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
    if (!(key in obj)) err(path, `필수 필드 '${key}' 없음`);
  }
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key) && !optional.includes(key)) err(path, `허용되지 않은 필드 '${key}'`);
  }
}

function checkFileHeader(fileName, file, listKey, err) {
  if (!isObject(file)) {
    err(fileName, '최상위 값이 객체가 아님');
    return false;
  }
  if (file.schemaVersion !== SCHEMA_VERSION) {
    err(fileName, `schemaVersion이 ${file.schemaVersion} (기대값 ${SCHEMA_VERSION})`);
  }
  if (listKey && !Array.isArray(file[listKey])) {
    err(fileName, `'${listKey}' 배열 없음`);
    return false;
  }
  return true;
}

function validateLeague(league, path, teamById, leagueIds, err) {
  checkFields(league, LEAGUE_FIELDS, path, err, LEAGUE_OPTIONAL_FIELDS);
  if (!TEAM_ID_RE.test(league.id ?? '')) err(`${path}.id`, '소문자·숫자·하이픈만 (예: k-league-1)');
  if (!isText(league.name)) err(`${path}.name`, '빈 문자열');
  if (!CODE3_RE.test(league.country ?? '')) err(`${path}.country`, '국가 코드는 대문자 3글자');
  if (!isText(league.season)) err(`${path}.season`, '빈 문자열');
  if (!isIntIn(league.level, 1, 5)) err(`${path}.level`, '1~5 정수 (1부 = 1)');

  if (!Array.isArray(league.teamIds) || league.teamIds.length < 2) {
    err(`${path}.teamIds`, '팀이 2개 이상 필요');
  } else {
    const seen = new Set();
    for (const id of league.teamIds) {
      if (seen.has(id)) err(`${path}.teamIds`, `중복 팀 '${id}'`);
      const team = teamById.get(id);
      if (!team) err(`${path}.teamIds`, `teams.json에 없는 팀 '${id}'`);
      else if (team.leagueId !== league.id) err(`${path}.teamIds`, `'${id}'의 leagueId가 '${team.leagueId}'`);
      seen.add(id);
    }
  }

  for (const key of LEAGUE_OPTIONAL_FIELDS) {
    const link = league[key];
    if (link === undefined) continue;
    if (!isObject(link) || !leagueIds.has(link.league) || !isIntIn(link.spots, 1, 10)) {
      err(`${path}.${key}`, '{ league: 리그 id, spots: 1~10 }');
    }
  }

  const rules = league.rules;
  if (!isObject(rules)) {
    err(`${path}.rules`, '객체가 아님');
    return;
  }
  if (!isIntIn(rules.rounds, 1, 4)) err(`${path}.rules.rounds`, '1~4 정수');
  const pts = rules.points;
  if (!isObject(pts) || !['win', 'draw', 'loss'].every((k) => Number.isInteger(pts[k]))) {
    err(`${path}.rules.points`, 'win/draw/loss 정수 필요');
  }
  if (!Array.isArray(rules.tiebreakers) || rules.tiebreakers.length === 0) {
    err(`${path}.rules.tiebreakers`, '비어 있음');
  } else {
    for (const t of rules.tiebreakers) {
      if (!TIEBREAKERS.includes(t)) err(`${path}.rules.tiebreakers`, `알 수 없는 기준 '${t}'`);
    }
  }
  const md = rules.matchday;
  if (!isObject(md) || !isIntIn(md.benchSize, 0, 15) || !isIntIn(md.maxSubstitutions, 0, md.benchSize)) {
    err(`${path}.rules.matchday`, 'benchSize(0~15), maxSubstitutions(0~benchSize) 정수 필요');
  }
}

function validateTeam(team, path, err) {
  checkFields(team, TEAM_FIELDS, path, err, ['guest', 'country']);
  // 게스트 팀: 리그 없이 대륙 대회에만 나오는 팀 (leagueId null, guest true, country 국가 코드)
  if (team.guest !== undefined && (team.guest !== true || team.leagueId !== null || !isText(team.country))) err(path, '게스트 팀은 guest: true, leagueId: null, country 필요');
  if (!TEAM_ID_RE.test(team.id ?? '')) err(`${path}.id`, '소문자·숫자·하이픈만 (예: man-city)');
  if (!isText(team.name)) err(`${path}.name`, '빈 문자열');
  if (!isText(team.shortName)) err(`${path}.shortName`, '빈 문자열');
  if (!TEAM_CODE_RE.test(team.code ?? '')) err(`${path}.code`, '영문 대문자·숫자 3글자');
  if (!isObject(team.colors) || !HEX_COLOR_RE.test(team.colors.primary) || !HEX_COLOR_RE.test(team.colors.secondary)) {
    err(`${path}.colors`, 'primary/secondary 모두 #RRGGBB');
  }
  if (team.stadium !== null && !isText(team.stadium)) err(`${path}.stadium`, '문자열 또는 null');
  if (team.logo !== null && !LOGO_FILE_RE.test(team.logo ?? '')) {
    err(`${path}.logo`, 'null 또는 assets/logos/ 안의 파일명 (예: arsenal.png)');
  }
}

function validatePlayer(p, path, ctx, err) {
  checkFields(p, PLAYER_FIELDS, path, err);
  if (!ID_RE.test(p.id ?? '')) err(`${path}.id`, '영문·숫자·_·- 만');
  if (!isText(p.name)) err(`${path}.name`, '빈 문자열');
  if (!isIntIn(p.age, AGE_MIN, AGE_MAX)) err(`${path}.age`, `${AGE_MIN}~${AGE_MAX} 정수`);
  if (!ctx.nationCodes.has(p.nationality)) err(`${path}.nationality`, `nations.json에 없는 코드 '${p.nationality}'`);
  if (!POSITIONS.includes(p.position)) err(`${path}.position`, `알 수 없는 포지션 '${p.position}'`);

  if (!Array.isArray(p.altPositions)) {
    err(`${path}.altPositions`, '배열이 아님 (없으면 [])');
  } else {
    if (new Set(p.altPositions).size !== p.altPositions.length) err(`${path}.altPositions`, '중복');
    for (const pos of p.altPositions) {
      if (!POSITIONS.includes(pos)) err(`${path}.altPositions`, `알 수 없는 포지션 '${pos}'`);
      if (pos === p.position) err(`${path}.altPositions`, '주 포지션과 중복');
    }
  }

  if (p.teamId !== null && !ctx.teamIds.has(p.teamId)) err(`${path}.teamId`, `teams.json에 없는 팀 '${p.teamId}'`);

  if (!isObject(p.attributes)) {
    err(`${path}.attributes`, '객체가 아님');
    return;
  }
  checkFields(p.attributes, ATTRIBUTE_KEYS, `${path}.attributes`, err);
  for (const key of ATTRIBUTE_KEYS) {
    if (key in p.attributes && !isIntIn(p.attributes[key], ATTRIBUTE_MIN, ATTRIBUTE_MAX)) {
      err(`${path}.attributes.${key}`, `${ATTRIBUTE_MIN}~${ATTRIBUTE_MAX} 정수`);
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
      if (!isObject(t)) return err(path, '객체가 아님');
      validateTeam(t, path, err);
      if (teamIds.has(t.id)) err(`${path}.id`, `중복 '${t.id}'`);
      teamIds.add(t.id);
      teamById.set(t.id, t);
    });
  }

  const nationCodes = new Set();
  if (checkFileHeader('nations.json', nations, 'nations', err)) {
    nations.nations.forEach((n, i) => {
      const path = `nations[${i}]`;
      if (!isObject(n)) return err(path, '객체가 아님');
      checkFields(n, NATION_FIELDS, path, err);
      if (!CODE3_RE.test(n.code ?? '')) err(`${path}.code`, '대문자 3글자');
      if (!isText(n.name) || !isText(n.nameKo)) err(path, 'name/nameKo 빈 문자열');
      if (nationCodes.has(n.code)) err(`${path}.code`, `중복 '${n.code}'`);
      nationCodes.add(n.code);
    });
  }

  const leagueList = checkFileHeader('leagues.json', leagues, 'leagues', err) ? leagues.leagues : [];
  const leagueIds = new Set(leagueList.map((l) => l?.id));
  if (leagueIds.size !== leagueList.length) err('leagues.json', '리그 id 중복');
  leagueList.forEach((l, i) => (isObject(l) ? validateLeague(l, `leagues[${i}]`, teamById, leagueIds, err) : err(`leagues[${i}]`, '객체가 아님')));
  // 모든 팀은 정확히 한 리그에 속한다
  const inLeague = new Map();
  for (const l of leagueList) for (const id of l?.teamIds ?? []) inLeague.set(id, (inLeague.get(id) ?? 0) + 1);
  for (const t of teamById.values()) {
    if (t.guest) continue;
    if (!leagueIds.has(t.leagueId)) err(`team '${t.id}'`, `leagues.json에 없는 리그 '${t.leagueId}'`);
    else if (inLeague.get(t.id) !== 1) err(`team '${t.id}'`, `리그 teamIds에 ${inLeague.get(t.id) ?? 0}번 등장 (정확히 1번이어야 함)`);
  }

  const squads = new Map([...teamIds].map((id) => [id, []]));
  if (checkFileHeader('players.json', players, 'players', err)) {
    const playerIds = new Set();
    const names = new Set(); // 같은 팀 안의 동명이인만 경고 (리그가 많아 다른 팀 동명이인은 흔함)
    players.players.forEach((p, i) => {
      const path = `players[${i}]`;
      if (!isObject(p)) return err(path, '객체가 아님');
      validatePlayer(p, path, { teamIds, nationCodes }, err);
      if (playerIds.has(p.id)) err(`${path}.id`, `중복 '${p.id}'`);
      playerIds.add(p.id);
      const nameKey = `${p.teamId}|${p.name}`;
      if (names.has(nameKey)) warn(`${path}.name`, `같은 팀 동명이인 '${p.name}'`);
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
        err(`squad '${id}'`, `${squad.length}명, GK ${gks}명 — 최소 11명·GK 1명 필요`);
      } else {
        if (squad.length < 11 + benchSize) warn(`squad '${id}'`, `${squad.length}명 — 교체 명단(${benchSize}명)을 다 못 채움`);
        if (gks < 2) warn(`squad '${id}'`, `GK ${gks}명`);
      }
    }
  }

  return { errors, warnings };
}
