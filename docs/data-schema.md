# 데이터 스키마 (schemaVersion 2)

게임은 `data/` 의 JSON 네 개만 읽는다. 이 네 파일을 스키마에 맞게 교체하면 코드 수정 없이 동작해야 한다.
스키마 정의와 검증 로직은 `js/data/schema.js` 한 곳에 있다 (게임과 `tools/validate-data.mjs` 공용).

```
node tools/validate-data.mjs     # 교체 후 검증
```

모든 파일 최상위에 `"schemaVersion": 2`. 버전이 다르면 검증 오류. 스키마를 바꾸면 버전을 올린다.
허용 목록에 없는 필드가 있어도 오류다.

## leagues.json — `{ schemaVersion, leagues: League[] }`

| 필드 | 타입 | 설명 |
|---|---|---|
| id | string | 소문자·숫자·하이픈 (`epl`, `k-league-1`) |
| name | string | 표시 이름 |
| country | string | 국가 코드 3글자 |
| season | string | `2026-27` 또는 `2026` (K리그처럼 한 해에 끝나는 리그) |
| level | int 1~5 | 리그 단계 (1부 = 1) |
| teamIds | string[] | 참가 팀. 각 팀의 leagueId와 일치해야 함 |
| rules.rounds | int 1~4 | 각 팀과 몇 번씩 붙는지 (EPL 2, K리그1 3) |
| rules.points | {win, draw, loss} | 승점 |
| rules.tiebreakers | string[] | `points` `goalDifference` `goalsFor` `headToHead` 중 순서대로 |
| rules.matchday | {benchSize, maxSubstitutions} | 교체 명단 인원, 최대 교체 수 |
| promotion | {league, spots} (선택) | 위 리그로 승격하는 팀 수 |
| relegation | {league, spots} (선택) | 아래 리그로 강등되는 팀 수 |

경기 일정은 데이터에 넣지 않는다. 게임이 teamIds로 생성한다.

## teams.json — `{ schemaVersion, teams: Team[] }`

| 필드 | 타입 | 설명 |
|---|---|---|
| id | string | 소문자·숫자·하이픈 (`manchester-city`). 세이브와 선수 소속이 참조하므로 바꾸지 말 것 |
| name | string | 정식 이름 |
| shortName | string | 짧은 이름 (순위표·스코어보드) |
| code | string | 영문 대문자·숫자 3글자 (`MCI`, `M05`) |
| colors | {primary, secondary} | `#RRGGBB`. 로고가 없을 때 원형 배지 배경·테두리 |
| stadium | string \| null | 홈 경기장 |
| logo | string \| null | `assets/logos/` 안의 **파일명만** (`arsenal.png`). null이면 배지로 대체 |
| leagueId | string | leagues.json의 id. 모든 팀은 정확히 한 리그에 속한다 |

## nations.json — `{ schemaVersion, nations: Nation[] }`

| 필드 | 타입 | 설명 |
|---|---|---|
| code | string | FIFA 3글자 코드 (`ENG`, `KOR`) |
| name | string | 영어 이름 |
| nameKo | string | 한국어 이름 |

## players.json — `{ schemaVersion, players: Player[] }`

CLAUDE.md 데이터 규칙에 따라 이름·나이·국적·포지션·소속·능력치 외의 필드는 허용하지 않는다 (사진, 등번호, 계약, 몸값 없음).
등번호·컨디션·계약·이적처럼 게임 중 바뀌는 값은 데이터가 아니라 세이브에 둔다.

| 필드 | 타입 | 설명 |
|---|---|---|
| id | string | 영문·숫자·`_`·`-`. 세이브가 참조하므로 데이터를 갱신해도 같은 선수는 같은 ID |
| name | string | 표시 이름 |
| age | int 15~45 | 시즌 시작일 기준 나이 |
| nationality | string | nations.json의 code |
| position | string | 주 포지션 |
| altPositions | string[] | 보조 포지션 (없으면 `[]`) |
| teamId | string \| null | teams.json의 id. null은 무소속 |
| attributes | object | 아래 22개 키 전부, 정수 1~100 |

포지션: `GK` `CB` `LB` `RB` `DM` `CM` `AM` `LW` `RW` `ST`

능력치 (필드 플레이어도 GK 능력치를 갖고, GK도 필드 능력치를 가진다):

| 그룹 | 키 |
|---|---|
| 기술 | finishing 결정력, longShots 중거리, passing 패스, crossing 크로스, dribbling 드리블, firstTouch 퍼스트터치, tackling 태클, marking 마킹, heading 헤딩 |
| 정신 | vision 시야, positioning 위치선정(수비), offTheBall 침투, composure 침착성, workRate 활동량 |
| 신체 | pace 속도, stamina 체력, strength 몸싸움, agility 민첩성 |
| GK | gkReflexes 반사신경, gkHandling 핸들링, gkPositioning 위치선정, gkDistribution 볼배급 |

종합 능력치(OVR)는 데이터에 저장하지 않는다. 게임이 포지션별 가중치로 계산한다.

### 검증 규칙
- 오류(게임 시작 불가): 필드 누락·초과, 타입·범위 위반, ID 중복, 없는 팀·국가·리그 참조, 팀이 리그에 0번 또는 2번 이상 등장, 리그 팀 인원 11명 미만 또는 GK 0명
- 경고: 같은 팀 동명이인, 교체 명단까지 못 채우는 스쿼드, GK 1명

## 현재 데이터 만드는 법

```
python3 tools/update_data.py                # 수집(받을 것만) → 병합 → 검증
python3 tools/update_data.py --merge-only   # 능력치 공식만 고쳤을 때
```

토큰·키는 환경변수 또는 프로젝트 루트 `.env` (커밋 안 됨): `FOOTBALL_DATA_TOKEN`, `API_FOOTBALL_KEY`

| 스크립트 | 소스 | 저장 위치 |
|---|---|---|
| fetch_football_data.py | football-data.org: 유럽 8개 리그 팀·스쿼드·순위·로고 | tools/.cache/football-data/ |
| fetch_fpl.py | FPL 공개 API(EPL 선수 기록·가격) + premierleague.com(세부 포지션) | tools/.cache/fpl/ |
| fetch_api_football.py | API-Football: 6개 리그 × 3시즌 팀·순위·선수 기록·현재 명단·이적·감독 | tools/raw/api-football/{리그}/{시즌}/ |
| merge.py | 위 원본 → data/*.json, 마지막에 검증 | data/ |

- 리그 목록·리그 수준 계수·수집 대상은 `tools/sources.json`
- 능력치 공식은 `tools/formula.py`의 `FORMULA` 상수
- 소스가 틀린 포지션·국적은 `tools/overrides.json`의 `players`에서 선수 id로 덮어쓴다
- 경기장 이름, 팀 컬러, 약칭은 `tools/overrides.json`의 `teams`에서 팀 id로 덮어쓴다
- 국가명이 새로 나오면 `tools/nations.json`에 별칭 추가 (merge.py가 오류로 알려 줌)
