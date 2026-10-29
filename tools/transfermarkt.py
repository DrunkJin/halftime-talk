"""트랜스퍼마르크트 공개 데이터셋(dcaribou/transfermarkt-datasets, CC0)으로 주 포지션과 시장가치를 붙인다.

받기: tools/raw/transfermarkt/players.csv.gz (git 제외)
  curl -o tools/raw/transfermarkt/players.csv.gz https://pub-e682421888d945d684bcae8890b0ec20.r2.dev/data/players.csv.gz
데이터 기준일은 merge.py가 data/meta에 남긴다 (TM_SNAPSHOT).

선수 짝 맞추기: 생년월일이 같은 후보 중 이름이 가장 비슷한 선수 (성 일치 필수). 생년월일이 없으면 전체 이름이 같고 나이가 ±1인 유일한 선수
"""
import csv
import gzip
import re
import unicodedata
from collections import defaultdict

from common import TOOLS

TM_FILE = TOOLS / 'raw' / 'transfermarkt' / 'players.csv.gz'
TM_SNAPSHOT = '2026-07'  # 데이터셋 갱신 중단 시점 (2026-07-06)
RECENT_SEASON = '2024'  # 이 시즌 이후 기록이 있는 선수만 시장가치를 쓴다 (그 전 값은 지금 실력과 멀 수 있다)

# 트랜스퍼마르크트 세부 포지션 → 게임 포지션 (보조 포지션 후보)
SUB_POSITION = {
    'Goalkeeper': ('GK', []),
    'Centre-Back': ('CB', []),
    'Left-Back': ('LB', []),
    'Right-Back': ('RB', []),
    'Defensive Midfield': ('DM', []),
    'Central Midfield': ('CM', []),
    'Attacking Midfield': ('AM', []),
    'Left Midfield': ('LW', ['CM']),
    'Right Midfield': ('RW', ['CM']),
    'Left Winger': ('LW', []),
    'Right Winger': ('RW', []),
    'Second Striker': ('ST', ['AM']),
    'Centre-Forward': ('ST', []),
}


def norm(text):
    text = unicodedata.normalize('NFKD', text or '').encode('ascii', 'ignore').decode().lower()
    return re.sub(r'[^a-z ]+', ' ', text).split()


def similarity(a, b):
    """이름 토큰 겹침 (0~1). 성(마지막 토큰)이나 한 토큰이 상대 이름에 없으면 낮게"""
    ta, tb = norm(a), norm(b)
    if not ta or not tb:
        return 0.0
    common = len(set(ta) & set(tb))
    score = common / max(len(set(ta)), len(set(tb)))
    if ta[-1] in tb or tb[-1] in ta:
        score += 0.5
    # 'A. Mac Allister' 같은 머리글자
    if any(len(t) == 1 for t in ta + tb):
        initials = {t[0] for t in ta} & {t[0] for t in tb}
        score += 0.1 * len(initials)
    return score


def load():
    """→ { by_birth: { 'YYYY-MM-DD': [행] }, by_last: { 성: [행] }, by_name: { 'full name': [행] } } (파일이 없으면 None).
    마지막 시즌이 오래된 선수(데이터셋이 다루지 않는 리그로 옮긴 경우)도 넣는다: 포지션은 쓰고, 시장가치는 recent일 때만"""
    if not TM_FILE.exists():
        return None
    by_birth = defaultdict(list)
    by_last = defaultdict(list)
    by_name = defaultdict(list)
    with gzip.open(TM_FILE, 'rt', encoding='utf-8') as f:
        for row in csv.DictReader(f):
            birth = (row.get('date_of_birth') or '')[:10]
            if birth and birth < '1980':  # 은퇴했을 나이
                continue
            tokens = norm(row['name'])
            entry = {
                'name': row['name'],
                'tokens': tokens,
                'birth': birth,
                'position': SUB_POSITION.get(row.get('sub_position') or ''),
                'recent': (row.get('last_season') or '0') >= RECENT_SEASON,
                'value': float(row['market_value_in_eur']) if row.get('market_value_in_eur') else None,
                'peak': float(row['highest_market_value_in_eur']) if row.get('highest_market_value_in_eur') else None,
                'club': norm(row.get('current_club_name') or ''),
            }
            if birth:
                by_birth[birth].append(entry)
            if tokens:
                by_last[tokens[-1]].append(entry)
            by_name[' '.join(tokens)].append(entry)
    return {'by_birth': by_birth, 'by_last': by_last, 'by_name': by_name}


def club_overlap(team_name, club_tokens):
    """우리 팀 이름과 TM 구단 이름이 겹치는 정도 (4글자 이상 토큰)"""
    mine = {t for t in norm(team_name) if len(t) >= 4}
    return len(mine & {t for t in club_tokens if len(t) >= 4})


def match(tm, name, birth=None, age=None, season_year=None, team_name=''):
    """우리 선수 → 트랜스퍼마르크트 행 (없으면 None)"""
    if birth:
        cands = tm['by_birth'].get(birth[:10], [])
        best = max(cands, key=lambda e: similarity(name, e['name']), default=None)
        if best and similarity(name, best['name']) >= 0.75:
            return best
        return None
    exact = tm['by_name'].get(' '.join(norm(name)), [])
    tokens = norm(name)
    if not tokens:
        return None
    # 생년월일이 없으면 이름으로: 나이(±1)가 맞는 후보 중
    #   - 이름이 다 쓰여 있으면(Mohamed Salim Fares) 우리 이름 단어가 모두 상대 이름에 있어야 한다
    #   - 머리글자(Y. Lee)나 한 단어 이름(Miguel)은 너무 흔해서 구단까지 같아야 한다
    initial_only = len(tokens[0]) == 1
    cands = exact or [e for e in tm['by_last'].get(tokens[-1], []) if e['tokens'] and e['tokens'][0][0] == tokens[0][0]]
    if not initial_only and len(tokens) > 1:
        cands = [e for e in cands if set(tokens) <= set(e['tokens'])]
    if age is not None and season_year:
        cands = [e for e in cands if e['birth'] and abs((season_year - int(e['birth'][:4])) - age) <= 1]
    same_club = [e for e in cands if team_name and club_overlap(team_name, e['club'])]
    if initial_only or len(tokens) == 1:
        cands = same_club
    elif len(cands) > 1 and same_club:
        cands = same_club
    return cands[0] if len(cands) == 1 else None
