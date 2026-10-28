"""선수 능력치가 어떻게 계산됐는지 항목별로 보여준다 (공식 조정용 진단 도구).

사용법:
  python3 tools/inspect_player.py Senesi "Mika Godts"     이름 일부로 찾기
  python3 tools/inspect_player.py --outliers 20          팀 주전 평균보다 크게 튀는 선수 상위 20명
"""
import argparse
import sys
from collections import defaultdict

import formula as F
import merge


def build():
    m = merge.Merger()
    for cfg in m.sources['leagues']:
        e = m.build_fd_league(cfg) if cfg['source'] == 'football-data' else m.build_api_league(cfg)
        if e:
            m.leagues.append(e)
    m.finish()
    return m


def breakdown(m, r):
    """compute_quality와 같은 순서로 각 항목 값을 다시 계산"""
    ctx = m.ctx
    FM = F.FORMULA
    if r['source'] is None or r['share'] is None:
        time_adj = FM['unknownPlayingTime'] + F.stable_gauss(f"{r['id']}:q") * FM['unknownQualitySd']
    else:
        time_adj = F.interpolate(FM['playingTime'], F.clamp(r['share'], 0, 1))
    perf_parts = {}
    if r['source'] in F.PERF_WEIGHTS:
        for metric, w in F.PERF_WEIGHTS[r['source']][r['roleClass']].items():
            perf_parts[metric] = w * ctx.score(r, metric) * FM['perfRange']
    rating = 0.0
    if r['source'] == 'api':
        rating = ctx.score(r, 'rating') * FM['ratingRange'] * (FM['gkRatingFactor'] if r['roleClass'] == 'GK' else 1.0)
    return {
        'teamBase(대륙 보정 포함)': r['teamBase'],
        '대륙 보정': m.team_bonus.get(r['teamId'], 0.0),
        '출전 비중': time_adj,
        '기록 백분위': sum(perf_parts.values()),
        **{f'  · {k}': v for k, v in perf_parts.items()},
        'API 평점': rating,
        '나이': F.age_quality_offset(r['age']),
        '→ 품질(소프트캡 후)': r['quality'],
    }


def show(m, r):
    s = r.get('stats') or {}
    print(f"\n{r['name']} ({r['id']}) · {r['teamId']} · {r['position']} · {r['age']}세 · 소스 {r['source']} · 기록 리그 {r.get('statsLeague')}")
    if s:
        print(f"  출전 {s.get('minutes')}분 · 출전 비중 {r['share']:.2f}" + (f" · 평점 {s['rating']:.2f}" if s.get('rating') else '') +
              (f" · 골 {s.get('goals')} 도움 {s.get('assists')}" if 'goals' in s else ''))
    for k, v in breakdown(m, r).items():
        print(f'  {k:22} {v:+7.2f}' if not k.startswith('teamBase') and not k.startswith('→') else f'  {k:22} {v:7.2f}')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('names', nargs='*')
    parser.add_argument('--outliers', type=int)
    args = parser.parse_args()
    m = build()
    if args.outliers:
        by_team = defaultdict(list)
        for r in m.records:
            by_team[r['teamId']].append(r)
        rows = []
        for team_id, squad in by_team.items():
            top = sorted((r['quality'] for r in squad), reverse=True)[:11]
            avg = sum(top) / len(top)
            for r in squad:
                rows.append((r['quality'] - avg, r))
        rows.sort(key=lambda x: -x[0])
        print(f'\n주전 평균보다 크게 튀는 선수 상위 {args.outliers}')
        for gap, r in rows[: args.outliers]:
            print(f"  +{gap:4.1f}  {r['quality']:5.1f}  {r['name'][:24]:24} {r['teamId'][:22]:22} {r['position']} 소스={r['source']}")
        return
    for name in args.names:
        hits = [r for r in m.records if name.lower() in r['name'].lower()]
        if not hits:
            print(f'\n"{name}" 없음')
        for r in hits[:3]:
            show(m, r)


if __name__ == '__main__':
    sys.exit(main())
