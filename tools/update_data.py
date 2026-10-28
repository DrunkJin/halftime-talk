"""데이터 한 번에 갱신: 수집(football-data · FPL · API-Football) → 병합 → 검증.

사용법:
  python3 tools/update_data.py                 받을 것만 받고 병합 (캐시·이어받기)
  python3 tools/update_data.py --refresh       이번 시즌 데이터(순위·명단 등)를 새로 받고 병합
  python3 tools/update_data.py --merge-only    네트워크 없이 병합만 (능력치 공식을 고쳤을 때)
  python3 tools/update_data.py --skip fpl,api  일부 소스 건너뛰기 (football-data, fpl, api)

토큰·키는 환경변수 또는 프로젝트 루트 .env:
  FOOTBALL_DATA_TOKEN=...
  API_FOOTBALL_KEY=...
"""
import argparse
import subprocess
import sys

from common import ROOT, TOOLS, load_env

STEPS = [
    ('football-data', 'fetch_football_data.py', 'FOOTBALL_DATA_TOKEN'),
    ('fpl', 'fetch_fpl.py', None),
    ('api', 'fetch_api_football.py', 'API_FOOTBALL_KEY'),
]


def run(script, *args):
    print(f'\n▶ {script} {" ".join(args)}'.rstrip(), flush=True)
    return subprocess.call([sys.executable, str(TOOLS / script), *args], cwd=ROOT)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--refresh', action='store_true')
    parser.add_argument('--merge-only', action='store_true')
    parser.add_argument('--skip', default='')
    args = parser.parse_args()
    load_env()
    import os

    skip = set(filter(None, args.skip.split(',')))
    if not args.merge_only:
        for name, script, env_key in STEPS:
            if name in skip:
                continue
            if env_key and not os.environ.get(env_key):
                print(f'\n▶ {script} 건너뜀 — {env_key}가 없습니다 (환경변수 또는 .env)')
                continue
            code = run(script, *(['--refresh'] if args.refresh and name != 'api' else []))
            if code != 0:
                sys.exit(f'{script} 실패 (종료 코드 {code})')
    sys.exit(run('merge.py'))


if __name__ == '__main__':
    main()
