"""API-Football 원본 수집: 리그·시즌별 팀 목록, 순위, 선수 시즌 기록, 현재 명단, 이적, 감독.

사용법:
  API_FOOTBALL_KEY=<키> python3 tools/fetch_api_football.py            전부 받기 (이어받기)
  API_FOOTBALL_KEY=<키> python3 tools/fetch_api_football.py --plan     요청 없이 남은 요청 수 추정
  API_FOOTBALL_KEY=<키> python3 tools/fetch_api_football.py --discover 추정에 필요한 것만 받기 (팀 목록·순위·기록 1페이지)
  옵션: --league epl,k-league-1   --season 2026   --refresh (다시 받기)
  (키는 프로젝트 루트 .env에 API_FOOTBALL_KEY=... 로 둬도 된다)

대상 리그·시즌·속도는 tools/sources.json의 apiFootball.raw.
  leagues        시즌 목록(seasons) 전체 × 팀·순위·선수 기록·현재 명단·이적·감독
  marketLeagues  이적시장 매물용: 리그별 현재 시즌(API에서 조회, league.json)과 그 전 시즌의 팀·순위·선수 기록 + 현재 명단
저장: tools/raw/api-football/{리그}/{시즌}/
  teams.json           /teams?league&season
  standings.json       /standings?league&season
  players/p{n}.json    /players?league&season&page=n   (선수 시즌 기록, 20명씩)
  squads/{팀}.json     /players/squads?team            (현재 명단 — 가장 최근 시즌 폴더에만)
  transfers/{팀}.json  /transfers?team                 (팀의 전체 이적 이력)
  coaches/{팀}.json    /coachs?team                    (팀 감독과 경력)
  tools/raw/api-football/continental/{대회}/{시즌}/fixtures.json   대륙 대회 경기 결과 (팀 기본값 보정)

게스트 팀 (--guests): 대륙 대회 리그 페이즈 참가 팀 중 우리 리그에 없는 팀 (sources.json competitions.list의 guests: true 대회)
  guests/teams/{팀}.json                 /teams?id
  guests/squads/{팀}.json                /players/squads?team
  guests/standings/{팀}-{시즌}.json      /standings?team&season   (국내 리그 순위 → 팀 기본값)
  guests/{시즌}/players/p{팀}_{n}.json   /players?team&season&page=n
이적·감독은 시즌과 무관한 팀 단위 데이터라 한 번만 요청하고 다른 시즌 폴더에는 복사한다.

이어받기: 파일은 받기를 마친 뒤에만 생긴다(임시 파일 → 이름 변경). 다시 실행하면 없는 파일만 받는다.
속도: 분당 요청 수를 apiFootball.raw.perMinute 이하로, 응답 헤더의 분당 남은 수도 확인한다.
"""
import argparse
import os
import shutil
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from common import LOGOS, TOOLS, HttpError, http_get, load_sources, progress, read_json, require_env, slugify, write_json

BASE = 'https://v3.football.api-sports.io'
RAW = TOOLS / 'raw' / 'api-football'


class QuotaExhausted(Exception):
    pass


class Client:
    """스레드 여러 개가 같이 쓰는 클라이언트: 요청 간격·일일 잔여량을 공유한다"""

    def __init__(self, key, per_minute, daily_reserve):
        self.key = key
        self.interval = 60.0 / per_minute
        self.daily_reserve = daily_reserve
        self.lock = threading.Lock()
        self.next_at = 0.0
        self.used = 0
        self.remaining_day = None
        self.errors = []

    def _slot(self):
        with self.lock:
            if self.remaining_day is not None and self.remaining_day <= self.daily_reserve:
                raise QuotaExhausted()
            now = time.monotonic()
            at = max(now, self.next_at)
            self.next_at = at + self.interval
        if at > now:
            time.sleep(at - now)

    def status(self):
        data, _ = http_get(f'{BASE}/status', {'x-apisports-key': self.key})
        r = data.get('response') or {}
        req = r.get('requests') or {}
        self.remaining_day = req.get('limit_day', 0) - req.get('current', 0)
        return (r.get('subscription') or {}).get('plan'), req

    def get(self, path):
        for attempt in range(4):
            self._slot()
            data, headers = http_get(f'{BASE}{path}', {'x-apisports-key': self.key})
            with self.lock:
                self.used += 1
                if 'x-ratelimit-requests-remaining' in headers:
                    self.remaining_day = int(headers['x-ratelimit-requests-remaining'])
            if headers.get('x-ratelimit-remaining') == '0':
                time.sleep(5)  # 분당 한도 바닥: 잠깐 쉰다
            errors = data.get('errors')
            if isinstance(errors, dict) and errors:
                if 'rateLimit' in errors:
                    time.sleep(10 * (attempt + 1))
                    continue
                if 'requests' in errors:
                    raise QuotaExhausted()
            return data
        return data


def continental_files(cfg):
    """대륙 대회(챔피언스리그 등) 시즌 전체 경기: /fixtures?league&season (한 번에 전부 옴)"""
    return [
        (RAW / 'continental' / comp['id'] / season / 'fixtures.json', f"/fixtures?league={comp['apiId']}&season={season}")
        for comp in cfg.get('continental', [])
        for season in cfg.get('continentalSeasons', {})
    ]


def guest_team_ids(sources):
    """게스트 팀 API id: guests 대회의 리그 페이즈 참가 팀 중 우리 리그 원본 팀 목록에 없는 팀"""
    comps = sources.get('competitions') or {}
    ours = {x['team']['id'] for f in RAW.glob('*/*/teams.json') for x in read_json(f).get('response', [])}
    ids = []
    for comp in comps.get('list', []):
        if not comp.get('guests'):
            continue
        f = RAW / 'continental' / comp['raw'] / comps['season'] / 'fixtures.json'
        for x in (read_json(f) if f.exists() else {}).get('response', []):
            if not x['league']['round'].startswith('League Stage'):
                continue
            for side in ('home', 'away'):
                tid = x['teams'][side]['id']
                if tid not in ours and tid not in ids:
                    ids.append(tid)
    return ids


def guest_files(ids, seasons, first_pages_only):
    """게스트 팀 파일 목록. first_pages_only면 선수 기록은 1페이지만 (페이지 수를 알아야 나머지를 만든다)"""
    g = RAW / 'guests'
    files = []
    for tid in ids:
        files.append((g / 'teams' / f'{tid}.json', f'/teams?id={tid}'))
        files.append((g / 'squads' / f'{tid}.json', f'/players/squads?team={tid}'))
        for season in seasons:
            files.append((g / 'standings' / f'{tid}-{season}.json', f'/standings?team={tid}&season={season}'))
            first = g / str(season) / 'players' / f'p{tid}_1.json'
            files.append((first, f'/players?team={tid}&season={season}&page=1'))
            if not first_pages_only and first.exists():
                total = (read_json(first).get('paging') or {}).get('total', 1)
                files += [(g / str(season) / 'players' / f'p{tid}_{n}.json', f'/players?team={tid}&season={season}&page={n}') for n in range(2, total + 1)]
    return files


def download_guest_logos(ids):
    """게스트 팀 로고: merge.py의 팀 id(API 이름 slug)와 같은 파일명"""
    LOGOS.mkdir(parents=True, exist_ok=True)
    for tid in ids:
        f = RAW / 'guests' / 'teams' / f'{tid}.json'
        info = (read_json(f).get('response') or [{}])[0].get('team') if f.exists() else None
        if not info or not info.get('logo'):
            continue
        file = LOGOS / f"{slugify(info['name'])}.png"
        if file.exists() or file.with_suffix('.webp').exists():
            continue
        try:
            body, _ = http_get(info['logo'], binary=True)
            file.write_bytes(body)
        except Exception as e:
            progress(f"  로고 실패 {info['name']}: {e}")


def current_season(league_info):
    """/leagues?id= 응답에서 current가 true인 시즌 연도"""
    for item in league_info.get('response', []):
        for s in item.get('seasons', []):
            if s.get('current'):
                return s['year']
    return None


def save_atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.tmp')
    write_json(tmp, data)
    os.replace(tmp, path)


class Job:
    """리그·시즌 하나의 수집 작업"""

    def __init__(self, league, season, latest, full=True):
        self.league = league
        self.season = season
        self.latest = latest
        self.full = full  # False면 이적·감독 생략 (이적시장 매물용 리그)
        self.dir = RAW / league['id'] / str(season)

    def base_files(self):
        q = f"league={self.league['apiFootballId']}&season={self.season}"
        return [
            (self.dir / 'teams.json', f'/teams?{q}'),
            (self.dir / 'standings.json', f'/standings?{q}'),
            (self.dir / 'players' / 'p1.json', f'/players?{q}&page=1'),
        ]

    def team_ids(self):
        f = self.dir / 'teams.json'
        return [x['team']['id'] for x in read_json(f).get('response', [])] if f.exists() else None

    def page_total(self):
        f = self.dir / 'players' / 'p1.json'
        return (read_json(f).get('paging') or {}).get('total', 1) if f.exists() else None

    def detail_files(self):
        q = f"league={self.league['apiFootballId']}&season={self.season}"
        files = [(self.dir / 'players' / f'p{n}.json', f'/players?{q}&page={n}') for n in range(2, (self.page_total() or 1) + 1)]
        for tid in self.team_ids() or []:
            if self.latest:
                files.append((self.dir / 'squads' / f'{tid}.json', f'/players/squads?team={tid}'))
            if self.full:
                files.append((self.dir / 'transfers' / f'{tid}.json', f'/transfers?team={tid}'))
                files.append((self.dir / 'coaches' / f'{tid}.json', f'/coachs?team={tid}'))
        return files


def team_level_copy(path):
    """이적·감독은 팀 단위라 다른 리그·시즌 폴더에 이미 있으면 복사로 대신한다"""
    if path.parent.name not in ('transfers', 'coaches'):
        return False
    for other in RAW.glob(f'*/*/{path.parent.name}/{path.name}'):
        if other != path:
            path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(other, path)
            return True
    return False


def fetch_all(client, files, workers, refresh):
    todo = []
    copied = 0
    for path, query in files:
        if path.exists() and not refresh:
            continue
        if not refresh and team_level_copy(path):
            copied += 1
            continue
        todo.append((path, query))
    if copied:
        progress(f'  복사로 대신함 {copied}개 (이적·감독 중복)')
    if not todo:
        return
    progress(f'  요청 {len(todo)}회')
    done = 0
    started = time.monotonic()
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(client.get, query): (path, query) for path, query in todo}
        for fut in as_completed(futures):
            path, query = futures[fut]
            try:
                data = fut.result()
            except QuotaExhausted:
                pool.shutdown(cancel_futures=True)
                raise
            except HttpError as e:
                client.errors.append(f'{query}: HTTP {e.status}')
                continue
            if data.get('errors'):
                client.errors.append(f"{query}: {data['errors']}")
            save_atomic(path, data)
            done += 1
            if done % 50 == 0 or done == len(todo):
                rate = done / max(1e-6, time.monotonic() - started) * 60
                progress(f'  {done}/{len(todo)}  (분당 {rate:.0f}회, 오늘 남은 {client.remaining_day})')


def download_logos(sources, latest):
    """API-Football이 주 소스인 리그(K리그) 팀 로고. 미디어 서버라 요청 할당량과 무관.
    파일명은 merge.py의 팀 id(sources.json 이름 보정 → 없으면 API 이름)와 같게"""
    LOGOS.mkdir(parents=True, exist_ok=True)
    for league in sources['leagues']:
        if league['source'] != 'api-football':
            continue
        teams = RAW / league['id'] / str(latest) / 'teams.json'
        if not teams.exists():
            continue
        hints = {t['apiId']: t['name'] for t in league.get('teams', [])}
        for x in read_json(teams).get('response', []):
            info = x['team']
            file = LOGOS / f"{slugify(hints.get(info['id'], info['name']))}.png"
            if file.exists() or file.with_suffix('.webp').exists() or not info.get('logo'):
                continue
            try:
                body, _ = http_get(info['logo'], binary=True)
                file.write_bytes(body)
            except Exception as e:
                progress(f"  로고 실패 {info['name']}: {e}")


def estimate(jobs):
    """남은 요청 수. 페이지·팀 수를 아직 모르는 리그·시즌은 표준값으로 가정"""
    rows = []
    total = 0
    seen_team_files = set()
    for job in jobs:
        known = job.team_ids() is not None and job.page_total() is not None
        teams = job.team_ids() or [None] * 20
        pages = job.page_total() or 40
        need = sum(1 for p, _ in job.base_files() if not p.exists())
        need += sum(1 for n in range(2, pages + 1) if not (job.dir / 'players' / f'p{n}.json').exists())
        team_req = 0
        for tid in teams:
            if job.latest and not (tid and (job.dir / 'squads' / f'{tid}.json').exists()):
                team_req += 1
            for kind in ('transfers', 'coaches') if job.full else ():
                key = (kind, tid)
                if tid is None or (key not in seen_team_files and not (job.dir / kind / f'{tid}.json').exists()):
                    team_req += 1
                seen_team_files.add(key)
        rows.append((job, len(teams), pages, need + team_req, known))
        total += need + team_req
    return rows, total


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--plan', action='store_true')
    parser.add_argument('--discover', action='store_true')
    parser.add_argument('--league')
    parser.add_argument('--season', type=int)
    parser.add_argument('--refresh', action='store_true')
    parser.add_argument('--guests', action='store_true', help='대륙 대회 게스트 팀만 받기')
    args = parser.parse_args()

    sources = load_sources()
    cfg = sources['apiFootball']['raw']
    by_id = {l['id']: l for l in sources['leagues']}
    wanted = set(args.league.split(',')) if args.league else None
    seasons = [args.season] if args.season else cfg['seasons']
    latest = max(cfg['seasons'])
    jobs = [Job(by_id[lid], s, s == latest) for lid in cfg['leagues'] if not wanted or lid in wanted for s in seasons]
    market = [by_id[lid] for lid in cfg.get('marketLeagues', []) if not wanted or lid in wanted]

    def print_estimate():
        rows, total = estimate(jobs)
        progress('\n  리그           시즌   팀  기록 페이지  남은 요청')
        for job, teams, pages, need, known in rows:
            progress(f"  {job.league['name'][:14]:14} {job.season}  {teams:3}  {pages:5}        {need:5}{'' if known else '  (추정)'}")
        minutes = total / cfg['perMinute']
        progress(f'  합계 약 {total}회 · 분당 {cfg["perMinute"]}회 기준 최소 {minutes:.0f}분')
        return total

    def add_market_jobs(client):
        """매물용 리그: 현재 시즌을 API에서 조회해(league.json, 1회) 현재·전 시즌 작업을 만든다"""
        for league in market:
            info_file = RAW / league['id'] / 'league.json'
            if not info_file.exists():
                if client is None:
                    continue
                save_atomic(info_file, client.get(f"/leagues?id={league['apiFootballId']}"))
            current = current_season(read_json(info_file))
            if current is None:
                progress(f"  {league['name']}: 현재 시즌을 찾지 못함")
                continue
            if not args.season or args.season in (current, current - 1):
                jobs.extend(Job(league, s, s == current, full=False) for s in (current, current - 1) if not args.season or s == args.season)

    if args.guests:
        ids = guest_team_ids(sources)
        stats_seasons = sources['apiFootball']['statsSeasons']
        if args.plan:
            progress(f'게스트 팀 {len(ids)}개 · 1단계 요청 약 {len(guest_files(ids, stats_seasons, True))}회 + 선수 기록 나머지 페이지')
            return
        client = Client(require_env('API_FOOTBALL_KEY'), cfg['perMinute'], cfg['dailyReserve'])
        progress(f'게스트 팀 {len(ids)}개')
        try:
            fetch_all(client, guest_files(ids, stats_seasons, True), cfg['workers'], args.refresh)
            fetch_all(client, guest_files(ids, stats_seasons, False), cfg['workers'], args.refresh)
            download_guest_logos(ids)
            progress(f'완료 (이번 실행 {client.used}회, 오늘 남은 {client.remaining_day}). 다음: python3 tools/merge.py')
        except QuotaExhausted:
            progress(f'일일 한도 근처라 멈춥니다 (이번 실행 {client.used}회).')
        finally:
            if client.errors:
                progress('  오류: ' + '; '.join(client.errors[:10]))
        return

    if args.plan:
        add_market_jobs(None)
        unknown = [l['name'] for l in market if not (RAW / l['id'] / 'league.json').exists()]
        print_estimate()
        if unknown:
            progress(f"  + 현재 시즌 미확인 매물 리그 {len(unknown)}개 (리그당 약 100회): {', '.join(unknown)}")
        return

    client = Client(require_env('API_FOOTBALL_KEY'), cfg['perMinute'], cfg['dailyReserve'])
    plan, req = client.status()
    progress(f"플랜 {plan} · 오늘 {req.get('current')}/{req.get('limit_day')}회 사용")
    try:
        add_market_jobs(client)
        if not wanted:
            progress('0) 대륙 대회 경기 결과')
            fetch_all(client, continental_files(cfg), cfg['workers'], args.refresh)
        progress('1) 팀 목록 · 순위 · 기록 1페이지')
        fetch_all(client, [f for job in jobs for f in job.base_files()], cfg['workers'], args.refresh)
        total = print_estimate()
        if args.discover:
            return
        if client.remaining_day is not None and total > client.remaining_day - cfg['dailyReserve']:
            progress(f'  오늘 남은 요청({client.remaining_day})보다 많아 받을 수 있는 만큼 받고 멈춥니다')
        progress('2) 선수 기록 · 현재 명단 · 이적 · 감독')
        # 팀 단위 파일 복사가 잘 되도록 리그·시즌 순서대로
        for job in jobs:
            progress(f"{job.league['name']} {job.season}")
            fetch_all(client, job.detail_files(), cfg['workers'], args.refresh)
        download_logos(sources, latest)
        progress(f'완료 (이번 실행 {client.used}회). 다음: python3 tools/merge.py')
    except QuotaExhausted:
        progress(f'일일 한도 근처라 멈춥니다 (이번 실행 {client.used}회). 내일 같은 명령으로 이어받으세요.')
    finally:
        if client.errors:
            log = RAW / '_errors.log'
            log.parent.mkdir(parents=True, exist_ok=True)
            log.write_text('\n'.join(client.errors) + '\n', encoding='utf-8')
            progress(f'  오류 응답 {len(client.errors)}건 → {log.relative_to(TOOLS.parent)}')


if __name__ == '__main__':
    main()
