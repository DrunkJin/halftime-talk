"""능력치 공식. 공개 경기 기록과 팀 성적으로 능력치를 직접 계산한다 (FM·EA FC 등 다른 게임 능력치는 쓰지 않음).

1) 팀 기본값 = 리그 기준점(리그 수준 계수) + 경기당 승점 보정
2) 선수 품질 = 팀 기본값 + 출전 비중 + 기록 백분위 + 평점 백분위 + 나이
3) 능력치 = 품질 + 포지션 프로필 + 기록 기반 보정 + 나이별 신체·정신 보정 + 고정 편차(선수 ID 해시)

기록 소스 (모든 리그 같은 기준)
  api: API-Football 시즌 기록·평점 (진행 중 + 지난 시즌)
  없음: 기록이 없는 선수 — 출전 비중은 중립, 품질에 고정 편차
FPL은 EPL 세부 포지션·선수 ID 매칭에만 쓴다 (다른 리그엔 같은 데이터가 없어 리그 간 비교가 불공평해지므로)
백분위는 같은 소스·같은 리그·같은 포지션군 안에서만 비교한다.
API-Football 기록은 '기록을 낸 리그'(출전 시간이 가장 많은 리그) 안에서 비교하고,
그 리그가 지금 소속 리그보다 약하면 보정 폭을 (기록 리그 수준 / 현재 리그 수준) 배로 줄인다 — 약한 리그 활약이 그대로 강팀 주전급이 되지 않도록.
"""
import json
import math
import subprocess
from pathlib import Path

ATTRIBUTE_GROUPS = {
    'technical': ['finishing', 'longShots', 'passing', 'crossing', 'dribbling', 'firstTouch', 'tackling', 'marking', 'heading'],
    'mental': ['vision', 'positioning', 'offTheBall', 'composure', 'workRate'],
    'physical': ['pace', 'stamina', 'strength', 'agility'],
    'goalkeeping': ['gkReflexes', 'gkHandling', 'gkPositioning', 'gkDistribution'],
}
ATTRIBUTE_KEYS = [k for keys in ATTRIBUTE_GROUPS.values() for k in keys]
GK_KEYS = set(ATTRIBUTE_GROUPS['goalkeeping'])

FORMULA = {
    # 리그 기준점: 리그의 '평균 팀(경기당 승점 ppgMid)' 기본값 = ref - (1 - strength) × perStrength
    'league': {'ref': 66.0, 'perStrength': 40.0},
    # 팀 기본값 = 리그 기준점 + (ppg - ppgMid) × perPpg, 리그 기준점 ± [min, max]로 제한
    'teamBase': {'ppgMid': 1.4, 'perPpg': 6.0, 'min': -5.0, 'max': 9.0},
    'promotedPpg': 1.0,  # 지난 시즌 이 리그에 없던(승격) 팀
    'relegatedPpg': 1.7,  # 위 리그에서 내려온 팀
    'unknownPpg': 1.2,  # 정보 없는 신생 팀 등
    'currentSeasonWeight': 2,  # 이번 시즌 1경기를 지난 시즌 몇 경기로 칠지

    'playingTime': [(0, -8), (0.1, -5), (0.3, -1), (0.5, 1.5), (0.75, 3.5), (1, 4.5)],
    'unknownPlayingTime': -2.0,  # 기록 소스에 없는 선수
    'unknownQualitySd': 3.0,  # 기록 없는 선수끼리 품질이 같지 않도록 주는 고정 편차
    # 기록을 낸 팀(출전 시간 최다)이 지금 팀과 다르면 팀 기본값을 섞는다: 지금 팀 × (1-w) + 기록 팀 × w
    # 강팀으로 막 이적한 선수가 새 팀 기본값을 그대로 받아 과대평가되지 않도록
    'transferBaseBlend': 0.5,

    'minMinutesForStats': 450,
    # 처진 공격수 판정 (merge.reclassify_second_strikers): 득점 지표 점수 이하 · 키패스 점수 이상 · 둘의 차 (점수 -1~1, 출전 신뢰도 반영)
    'pivot': {'defendingEdge': 0.15},
    # 보조 포지션 자동 보완 (merge.auto_alt_positions): 이웃 자리 능력이 주 포지션과 margin 이내면 보조로 (최대 2개)
    'autoAlt': {
        'margin': 3.5,
        'neighbors': {
            'CB': ['RB', 'LB', 'DM'], 'LB': ['RB', 'LW', 'CB'], 'RB': ['LB', 'RW', 'CB'], 'DM': ['CM', 'CB'],
            'CM': ['DM', 'AM'], 'AM': ['CM', 'LW', 'RW', 'ST'], 'LW': ['RW', 'AM', 'ST'], 'RW': ['LW', 'AM', 'ST'], 'ST': ['LW', 'RW', 'AM'],
        },
    },
    # 시장가치(트랜스퍼마르크트) 반영 (merge.blend_market_value): 품질 = weight × 평판 품질 + (1 - weight) × 기록 품질
    #   평판 점수 = ln(가치 백만 유로) + 나이 보정(어린 선수는 잠재력 프리미엄을 빼고, 베테랑은 낮게 매겨진 만큼 더한다) + 골키퍼 보정
    'marketValue': {
        'weight': 0.65,
        'minValue': 50_000,
        'ageAdjust': [(20, -0.6), (22, -0.35), (24, -0.15), (28, 0.0), (30, 0.2), (32, 0.45), (99, 0.75)],
        'gkAdjust': 0.45,
    },
    # 라인업 기록 없는 선수의 세부 포지션 추정 (merge.guess_groups_from_stats): 기록 점수 차 기준
    'groupGuess': {'dmEdge': 0.25, 'amEdge': 0.3, 'stEdge': 0.2},  # 더블 피벗 판정: 수비 기록 점수가 기회 창출 점수보다 이만큼 높으면 DM
    'secondStriker': {'maxFinishing': 0.05, 'minCreativity': 0.4, 'minGap': 0.6},
    'fullReliabilityMinutes': 1800,
    'apiStatsReliability': 0.8,  # API-Football 기록은 오래된 시즌일 수 있어 신뢰도를 낮춘다
    'perfRange': 6.0,
    'ratingRange': 7.0,  # API-Football 평균 평점 백분위
    'gkRatingFactor': 0.5,  # GK 평점은 실점 많은 약팀에서 선방 수로 부풀기 쉬워 절반만 (선방률 지표가 따로 있음)

    # 대륙 대회(챔피언스리그 등) 보정: 자국 리그 성적만으로는 리그 간 차이를 다 못 담는다
    #   승점률 보정 = clamp((대회 경기당 승점 - ppgRef) × perPpg, ppgMin, ppgMax) × min(1, 가중 경기 수 / fullWeight)
    #   단계 보너스 = 도달 단계 값 × 대회·시즌 가중치 (가장 높은 것 하나)
    #   합계 × 리그 배율 (약한 리그 팀일수록 크게), 최대 max
    'continental': {
        'ppgRef': 1.2, 'perPpg': 4.0, 'ppgMin': -2.0, 'ppgMax': 5.0, 'fullWeight': 8.0,
        'stages': {'Quarter-finals': 1.0, 'Semi-finals': 2.0, 'Final': 3.0}, 'winner': 5.0, 'max': 10.0,
        # 대회에서 증명한 팀은 리그 수준 계수로 깎인 몫을 일부 되돌린다: 보정 × (1 + (1 - 리그 계수) × leagueScale)
        'leagueScale': 2.0,
    },

    'quality': {'min': 35.0, 'max': 92.0, 'softCap': 80.0, 'softCapSlope': 0.5},
    # 기록이 개별 능력치를 직접 움직이는 폭. 같은 기록이 품질에도 이미 반영되므로 작게 (이중 반영 방지)
    'statTweakRange': 3.0,
    # 포지션 프로필이 그 포지션 OVR(게임 공식)에 주는 순효과를 모든 포지션에서 이 값으로 맞춘다.
    # 맞추지 않으면 같은 품질이라도 CB는 OVR이 +7, GK는 +4처럼 포지션마다 다르게 부풀려진다
    'profileOvrOffset': 4.0,
    'noiseSd': 3.0,
    'attribute': {'min': 1, 'max': 99},
}

# 소스별 포지션군 기록 가중치 (품질 계산용)
PERF_WEIGHTS = {
    # 평점(rating)은 여기 넣지 않고 ratingRange로 따로 반영한다
    'api': {
        'GK': {'gkStop': 1.0},
        # 수비 행동 수(태클·인터셉트·블록)는 수비할 일이 많은 약팀 수비수에게 유리해 비중을 낮춘다
        'DEF': {'defending': 0.3, 'creativity': 0.35, 'involvement': 0.35},
        'MID': {'involvement': 0.4, 'creativity': 0.35, 'defending': 0.25},
        'FWD': {'finishing': 0.6, 'involvement': 0.4},
    },
}

# 기록 지표 → 영향을 받는 능력치
STAT_LINKS = {
    'finishing': ['finishing'],
    'threat': ['longShots', 'offTheBall'],
    'involvement': ['offTheBall'],
    'creativity': ['passing', 'crossing', 'vision'],
    'defending': ['tackling', 'marking', 'positioning'],
    'conceded': ['positioning'],
    'cbi': ['heading'],
    'recoveries': ['workRate', 'stamina'],
    'rating': ['composure', 'firstTouch'],
    'gkStop': ['gkReflexes', 'gkPositioning'],
    'gkCleanSheets': ['gkHandling', 'gkPositioning'],
}

# 포지션별 능력치 오프셋 (품질 대비). 없는 키는 0
PROFILES = {
    'GK': dict(finishing=-45, longShots=-40, passing=-15, crossing=-40, dribbling=-40, firstTouch=-20, tackling=-40, marking=-40,
               heading=-35, vision=-20, positioning=-25, offTheBall=-50, workRate=-10, pace=-25, stamina=-25, strength=-5, agility=-5,
               gkReflexes=5, gkHandling=3, gkPositioning=4, gkDistribution=-2),
    'CB': dict(finishing=-30, longShots=-20, passing=-6, crossing=-18, dribbling=-18, firstTouch=-8, tackling=6, marking=7, heading=6,
               vision=-12, positioning=6, offTheBall=-25, pace=-6, stamina=-2, strength=6, agility=-8),
    'LB': dict(finishing=-22, longShots=-15, passing=-3, crossing=4, dribbling=-2, firstTouch=-3, tackling=2, marking=1, heading=-8,
               vision=-6, positioning=1, offTheBall=-8, composure=-3, workRate=4, pace=5, stamina=5, strength=-4, agility=2),
    'DM': dict(finishing=-18, longShots=-6, passing=3, crossing=-10, dribbling=-6, tackling=5, marking=3, vision=0, positioning=5,
               offTheBall=-12, composure=2, workRate=5, pace=-5, stamina=4, strength=3, agility=-3),
    'CM': dict(finishing=-10, longShots=-2, passing=5, crossing=-4, firstTouch=2, tackling=-2, marking=-4, heading=-6, vision=4,
               positioning=-1, offTheBall=-2, composure=2, workRate=4, pace=-2, stamina=5, strength=-2),
    'AM': dict(finishing=-3, longShots=2, passing=5, crossing=-2, dribbling=5, firstTouch=5, tackling=-18, marking=-20, heading=-12,
               vision=7, positioning=-16, offTheBall=4, composure=2, workRate=-2, stamina=-2, strength=-8, agility=5),
    'LW': dict(finishing=-3, longShots=-2, passing=-1, crossing=4, dribbling=7, firstTouch=3, tackling=-18, marking=-20, heading=-12,
               vision=1, positioning=-16, offTheBall=5, composure=-1, pace=8, stamina=1, strength=-8, agility=7),
    'ST': dict(finishing=7, passing=-6, crossing=-12, dribbling=1, firstTouch=3, tackling=-25, marking=-28, heading=3, vision=-4,
               positioning=-22, offTheBall=8, composure=3, workRate=-3, pace=2, stamina=-2, strength=2, agility=1),
}
PROFILES['RB'] = PROFILES['LB']
PROFILES['RW'] = PROFILES['LW']

# 게임의 포지션별 OVR 가중치 (js/engine/config.js POSITION_RATING_WEIGHTS). 같은 공식을 두 곳에 두지 않도록 Node로 읽는다
_OVR_WEIGHTS = None


def ovr_weights():
    global _OVR_WEIGHTS
    if _OVR_WEIGHTS is None:
        root = Path(__file__).resolve().parent.parent
        out = subprocess.check_output(
            ['node', '--input-type=module', '-e', "import('./js/engine/config.js').then((c) => console.log(JSON.stringify(c.POSITION_RATING_WEIGHTS)))"],
            cwd=root, text=True,
        )
        _OVR_WEIGHTS = json.loads(out)
    return _OVR_WEIGHTS


_SHIFTS = {}


def profile_shift(position):
    """그 포지션 OVR 가중치로 본 프로필 평균 오프셋 - profileOvrOffset"""
    if position not in _SHIFTS:
        w = ovr_weights()[position]
        mean = sum(PROFILES[position].get(k, 0) * v for k, v in w.items()) / sum(w.values())
        _SHIFTS[position] = mean - FORMULA['profileOvrOffset']
    return _SHIFTS[position]


ROLE_CLASS = {'GK': 'GK', 'CB': 'DEF', 'LB': 'DEF', 'RB': 'DEF', 'DM': 'MID', 'CM': 'MID', 'AM': 'MID', 'LW': 'FWD', 'RW': 'FWD', 'ST': 'FWD'}
SKILL_REF = 70


def clamp(v, lo, hi):
    return max(lo, min(hi, v))


def interpolate(points, x):
    if x <= points[0][0]:
        return points[0][1]
    for (x0, y0), (x1, y1) in zip(points, points[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return points[-1][1]


def league_anchor(strength):
    L = FORMULA['league']
    return L['ref'] - (1 - strength) * L['perStrength']


def team_base(strength, ppg):
    T = FORMULA['teamBase']
    anchor = league_anchor(strength)
    return anchor + clamp((ppg - T['ppgMid']) * T['perPpg'], T['min'], T['max'])


def blend_ppg(prev_ppg, current_points, current_played, prev_matches=38):
    """지난 시즌 ppg와 이번 시즌 성적을 섞는다 (이번 시즌 경기에 가중치)"""
    w = FORMULA['currentSeasonWeight']
    if current_played <= 0:
        return prev_ppg
    cur = current_points / current_played
    return (prev_ppg * prev_matches + cur * current_played * w) / (prev_matches + current_played * w)


# ── 기록 → 90분당 지표 ─────────────────────────────────

def _per90(stats):
    m = stats['minutes']
    return lambda v: v * 90 / m


def api_metrics(s):
    if not s or s['minutes'] < FORMULA['minMinutesForStats']:
        return None
    p = _per90(s)
    faced = s['saves'] + s['conceded']
    metrics = {
        'finishing': p(s['goals'] + 0.2 * s['shotsOn']),
        'involvement': p(s['goals'] + s['assists']),
        'creativity': p(s['keyPasses']),
        'threat': p(s['shots']),
        'defending': p(s['tackles'] + s['interceptions'] + s['blocks']),
        'cbi': p(s['interceptions'] + s['blocks']),
        'recoveries': p(s['duelsWon']),
    }
    if s.get('rating'):
        metrics['rating'] = s['rating']
    if faced > 0:
        metrics['gkStop'] = s['saves'] / faced
    return metrics


METRIC_FNS = {'api': api_metrics}


class StatContext:
    """(소스, 리그, 포지션군)별로 지표를 정렬해 두고 백분위를 구한다"""

    def __init__(self, records):
        self.metrics = {}
        self.pools = {}
        for r in records:
            fn = METRIC_FNS.get(r['source'])
            m = fn(r['stats']) if fn else None
            if not m:
                continue
            self.metrics[r['id']] = m
            pool = self.pools.setdefault(self.pool_key(r), {})
            for k, v in m.items():
                pool.setdefault(k, []).append(v)
        for pool in self.pools.values():
            for arr in pool.values():
                arr.sort()

    @staticmethod
    def pool_key(r):
        return (r['source'], r.get('statsLeague') or r['leagueId'], r['roleClass'])

    def score(self, r, metric):
        """백분위(0~1)를 -1~1로 바꾸고 출전 시간 신뢰도를 곱한 값. 기록이 없으면 0"""
        v = self.metrics.get(r['id'], {}).get(metric)
        pool = self.pools.get(self.pool_key(r), {}).get(metric)
        if v is None or not pool:
            return 0.0
        below = sum(1 for x in pool if x < v)
        equal = sum(1 for x in pool if x == v)
        pct = (below + equal / 2) / len(pool)
        reliability = min(1.0, r['stats']['minutes'] / FORMULA['fullReliabilityMinutes'])
        if r['source'] == 'api':
            reliability *= FORMULA['apiStatsReliability']
        score = (pct - 0.5) * 2 * reliability
        # 약한 리그에서 낸 좋은 기록은 덜 반영 (나쁜 기록은 그대로)
        if score > 0 and r.get('statsStrength') and r.get('leagueStrength'):
            score *= min(1.0, r['statsStrength'] / r['leagueStrength'])
        return score


# ── 고정 난수: 같은 선수는 몇 번을 다시 만들어도 같은 편차 ──

def _hash_unit(text):
    h = 2166136261
    for ch in text.encode('utf-8'):
        h = ((h ^ ch) * 16777619) & 0xFFFFFFFF
    h = ((h ^ (h >> 15)) * 2246822507) & 0xFFFFFFFF
    h = ((h ^ (h >> 13)) * 3266489909) & 0xFFFFFFFF
    return ((h ^ (h >> 16)) & 0xFFFFFFFF) / 4294967296


def stable_gauss(seed):
    u = max(_hash_unit(seed + '#u'), 1e-9)
    v = _hash_unit(seed + '#v')
    return math.sqrt(-2 * math.log(u)) * math.cos(2 * math.pi * v)


# ── 품질 · 능력치 ─────────────────────────────────────

def age_quality_offset(age):
    if age <= 18:
        return -4
    if age <= 20:
        return -2
    if age <= 30:
        return 0
    if age <= 32:
        return -1
    return -2


def age_attribute_offset(key, age):
    if key in ('pace', 'agility'):
        return -(age - 28) * 1.5 if age > 28 else 0
    if key == 'stamina':
        return -(age - 30) * 1.5 if age > 30 else 0
    if key == 'strength':
        return -(21 - age) * 2 if age < 21 else 0
    if key in ('composure', 'positioning', 'vision'):
        return 2 if age >= 29 else -3 if age <= 20 else 0
    return 0


def compute_quality(r, ctx):
    """r: id, source, leagueId, roleClass, age, teamBase, stats, share(출전 비중 0~1 또는 None)"""
    F = FORMULA
    if r['source'] is None or r['share'] is None:
        time_adj = F['unknownPlayingTime'] + stable_gauss(f"{r['id']}:q") * F['unknownQualitySd']
    else:
        time_adj = interpolate(F['playingTime'], clamp(r['share'], 0, 1))

    perf = 0.0
    if r['source'] in PERF_WEIGHTS:
        for metric, w in PERF_WEIGHTS[r['source']][r['roleClass']].items():
            perf += w * ctx.score(r, metric)
    perf_adj = perf * F['perfRange']
    rating_adj = 0.0
    if r['source'] == 'api':
        rating_adj = ctx.score(r, 'rating') * F['ratingRange'] * (F['gkRatingFactor'] if r['roleClass'] == 'GK' else 1.0)

    Q = F['quality']
    q = r['teamBase'] + time_adj + perf_adj + rating_adj + age_quality_offset(r['age'])
    if q > Q['softCap']:
        q = Q['softCap'] + (q - Q['softCap']) * Q['softCapSlope']
    return clamp(q, Q['min'], Q['max'])


def compute_attributes(r, quality, ctx):
    tweaks = {}
    for metric, keys in STAT_LINKS.items():
        # 포지션군과 무관한 지표는 쓰지 않음 (예: 필드 플레이어의 gkStop)
        if metric.startswith('gk') != (r['roleClass'] == 'GK'):
            continue
        score = ctx.score(r, metric)
        for k in keys:
            tweaks[k] = tweaks.get(k, 0.0) + score * FORMULA['statTweakRange']

    profile = PROFILES[r['position']]
    shift = profile_shift(r['position'])
    A = FORMULA['attribute']
    # 기록 보정·나이·고정 편차는 능력치의 '모양'만 바꾸고 OVR은 움직이지 않게:
    # 그 포지션 OVR 가중치로 본 평균을 0으로 맞춘다 (전체 수준은 이미 품질에 반영됨)
    dev = {key: tweaks.get(key, 0) + age_attribute_offset(key, r['age']) + stable_gauss(f"{r['id']}:{key}") * FORMULA['noiseSd'] for key in ATTRIBUTE_KEYS}
    weights = ovr_weights()[r['position']]
    center = sum(dev[k] * w for k, w in weights.items()) / sum(weights.values())
    attrs = {}
    for key in ATTRIBUTE_KEYS:
        if r['position'] != 'GK' and key in GK_KEYS:
            v = 10 + stable_gauss(f"{r['id']}:{key}") * FORMULA['noiseSd'] * 2  # 필드 플레이어의 GK 능력치는 품질과 무관하게 낮게
        else:
            v = quality + profile.get(key, 0) - shift + dev[key] - center
        attrs[key] = int(round(clamp(v, A['min'], A['max'])))
    return attrs
