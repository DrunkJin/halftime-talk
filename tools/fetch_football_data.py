"""football-data.org: 유럽 리그 팀·스쿼드·순위(이번·지난 시즌)·로고.

사용법:
  FOOTBALL_DATA_TOKEN=<토큰> python3 tools/fetch_football_data.py [--refresh] [--only PL,PD]
  (토큰은 프로젝트 루트 .env에 FOOTBALL_DATA_TOKEN=... 로 둬도 된다)

대상 리그는 tools/sources.json에서 source가 football-data인 리그.
무료 플랜은 분당 10회라 요청 사이에 간격을 둔다. 받은 원본은 tools/.cache/football-data/에 캐시.
"""
import argparse
from pathlib import Path

from common import CACHE, LOGOS, HttpError, RateLimiter, http_get, load_sources, progress, read_json, require_env, team_id_from_name, write_json

BASE = 'https://api.football-data.org/v4'
CACHE_DIR = CACHE / 'football-data'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--refresh', action='store_true', help='캐시가 있어도 다시 받기')
    parser.add_argument('--only', help='리그 코드 쉼표 구분 (예: PL,PD)')
    args = parser.parse_args()

    token = require_env('FOOTBALL_DATA_TOKEN')
    limiter = RateLimiter(per_minute=9)
    sources = load_sources()
    leagues = [l for l in sources['leagues'] if l['source'] == 'football-data']
    if args.only:
        wanted = set(args.only.split(','))
        leagues = [l for l in leagues if l['code'] in wanted]

    def cached(name, path):
        file = CACHE_DIR / name
        if file.exists() and not args.refresh:
            progress(f'  캐시 사용: {name}')
            return read_json(file)
        limiter.wait()
        data, _ = http_get(f'{BASE}{path}', {'X-Auth-Token': token})
        write_json(file, data)
        progress(f'  저장: {name}')
        return data

    for league in leagues:
        code = league['code']
        progress(f"{league['name']} ({code})")
        teams = cached(f'{code}-teams.json', f'/competitions/{code}/teams')
        start_year = int(teams['season']['startDate'][:4])
        cached(f'{code}-standings.json', f'/competitions/{code}/standings')
        try:
            cached(f'{code}-standings-prev.json', f'/competitions/{code}/standings?season={start_year - 1}')
        except HttpError as e:
            progress(f'  지난 시즌 순위 없음 ({e.status}) — 이번 시즌만 사용')
        download_crests(teams, args.refresh)

    progress('완료. 다음: python3 tools/merge.py')


def download_crests(teams, refresh):
    LOGOS.mkdir(parents=True, exist_ok=True)
    for team in teams['teams']:
        url = team.get('crest')
        if not url:
            continue
        ext = Path(url.split('?')[0]).suffix or '.png'
        file = LOGOS / f"{team_id_from_name(team['name'])}{ext}"
        if (file.exists() or file.with_suffix('.webp').exists()) and not refresh:  # WebP: optimize_logos.py로 바꾼 것
            continue
        try:
            body, _ = http_get(url, binary=True)
            file.write_bytes(body)
        except Exception as e:  # 로고 하나 실패해도 계속 (배지로 대체됨)
            progress(f"  로고 실패 {team['name']}: {e}")


if __name__ == '__main__':
    main()
