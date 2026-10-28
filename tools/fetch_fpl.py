"""EPL 보강 데이터: FPL 공개 API(선수 ID·현재 소속)와 premierleague.com(세부 포지션).
선수 기록·평점은 모든 리그 같은 기준으로 API-Football에서 받는다 (fetch_api_football.py).

사용법: python3 tools/fetch_fpl.py [--refresh]
"""
import argparse
from common import CACHE, http_get, load_sources, progress, read_json, write_json

FPL = 'https://fantasy.premierleague.com/api'
PL = 'https://footballapi.pulselive.com/football'
PL_COMPETITION_ID = 1
CACHE_DIR = CACHE / 'fpl'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--refresh', action='store_true')
    args = parser.parse_args()
    start_year = load_sources()['seasonStartYear']

    progress('FPL')
    boot_file = CACHE_DIR / 'bootstrap.json'
    if args.refresh or not boot_file.exists():
        bootstrap, _ = http_get(f'{FPL}/bootstrap-static/')
        write_json(boot_file, bootstrap)
    bootstrap = read_json(boot_file)

    progress('premierleague.com 세부 포지션')
    pl_file = CACHE_DIR / 'pl-players.json'
    if args.refresh or not pl_file.exists():
        headers = {'Origin': 'https://www.premierleague.com'}
        seasons, _ = http_get(f'{PL}/competitions/{PL_COMPETITION_ID}/compseasons?page=0&pageSize=10', headers)
        label = f'{start_year}/{start_year + 1}'
        season = next((s for s in seasons['content'] if label in s['label']), None)
        if not season:
            raise SystemExit(f'premierleague.com에서 {label} 시즌을 찾지 못함')
        players, page = [], 0
        while True:
            res, _ = http_get(f"{PL}/players?pageSize=100&compSeasons={int(season['id'])}&altIds=true&page={page}&type=player", headers)
            players += res['content']
            page += 1
            if page >= res['pageInfo']['numPages']:
                break
        write_json(pl_file, players)
    progress('완료')


if __name__ == '__main__':
    main()
