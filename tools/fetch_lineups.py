"""API-Football 경기 라인업 수집: 선수가 실제로 선 자리(포메이션 격자)로 세부 포지션을 정하기 위해.

사용법:
  API_FOOTBALL_KEY=<키> python3 tools/fetch_lineups.py           받기 (이어받기)
  API_FOOTBALL_KEY=<키> python3 tools/fetch_lineups.py --plan    요청 수만 추정
  옵션: --league laliga,k-league-1   --per-team 10

저장: tools/raw/api-football/{리그}/{시즌}/fixtures.json        /fixtures?league&season
      tools/raw/api-football/{리그}/{시즌}/lineups/{경기}.json   /fixtures/lineups?fixture
팀마다 최근 끝난 경기 per-team개를 고르고, 이번 시즌 경기가 모자라면 지난 시즌 경기로 채운다.
"""
import argparse

from common import load_sources, progress, read_json, require_env
from fetch_api_football import RAW, Client, QuotaExhausted, fetch_all
from merge import current_season_of

FINISHED = {'FT', 'AET', 'PEN'}


def season_of(league_id, cfg):
    return current_season_of(league_id) or max(cfg['seasons'])


def fixtures_file(league_id, season):
    return RAW / league_id / str(season) / 'fixtures.json'


def pick_fixtures(league, seasons, per_team):
    """팀마다 최근 끝난 경기 per_team개 (시즌 순서대로 채움) → [(시즌, 경기 id)]"""
    count = {}
    picked = []
    seen = set()
    for season in seasons:
        f = fixtures_file(league['id'], season)
        if not f.exists():
            continue
        done = [x for x in read_json(f).get('response', []) if x['fixture']['status']['short'] in FINISHED]
        done.sort(key=lambda x: x['fixture']['timestamp'], reverse=True)
        for x in done:
            fid = x['fixture']['id']
            teams = [x['teams']['home']['id'], x['teams']['away']['id']]
            if fid in seen or all(count.get(t, 0) >= per_team for t in teams):
                continue
            seen.add(fid)
            picked.append((season, fid))
            for t in teams:
                count[t] = count.get(t, 0) + 1
    return picked


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--plan', action='store_true')
    parser.add_argument('--league')
    parser.add_argument('--per-team', type=int, default=10)
    args = parser.parse_args()
    sources = load_sources()
    cfg = sources['apiFootball']['raw']
    wanted = set(args.league.split(',')) if args.league else None
    leagues = [l for l in sources['leagues'] if l.get('apiFootballId') and (not wanted or l['id'] in wanted)]
    seasons = {l['id']: [season_of(l['id'], cfg), season_of(l['id'], cfg) - 1] for l in leagues}

    fixture_jobs = [(fixtures_file(l['id'], s), f"/fixtures?league={l['apiFootballId']}&season={s}") for l in leagues for s in seasons[l['id']]]
    missing = [j for j in fixture_jobs if not j[0].exists()]
    if args.plan:
        lineups = sum(len(pick_fixtures(l, seasons[l['id']], args.per_team)) for l in leagues)
        progress(f'경기 목록 남은 요청 {len(missing)}회 · 라인업 약 {lineups}회 (경기 목록을 받은 리그 기준)')
        return

    client = Client(require_env('API_FOOTBALL_KEY'), cfg['perMinute'], cfg['dailyReserve'])
    try:
        progress('1) 경기 목록')
        fetch_all(client, fixture_jobs, cfg['workers'], False)
        progress('2) 라인업')
        for l in leagues:
            files = [(RAW / l['id'] / str(s) / 'lineups' / f'{fid}.json', f'/fixtures/lineups?fixture={fid}') for s, fid in pick_fixtures(l, seasons[l['id']], args.per_team)]
            progress(f"{l['name']}: 경기 {len(files)}개")
            fetch_all(client, files, cfg['workers'], False)
        progress(f'완료 (이번 실행 {client.used}회, 오늘 남은 {client.remaining_day}). 다음: python3 tools/merge.py')
    except QuotaExhausted:
        progress(f'일일 한도 근처라 멈춥니다 (이번 실행 {client.used}회). 같은 명령으로 이어받으세요.')
    finally:
        if client.errors:
            progress('  오류: ' + '; '.join(client.errors[:10]))


if __name__ == '__main__':
    main()
