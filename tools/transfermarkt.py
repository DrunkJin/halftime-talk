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
    """→ { by_birth: { 'YYYY-MM-DD': [행] }, by_name: { 'full name': [행] } } (파일이 없으면 None)"""
    if not TM_FILE.exists():
        return None
    by_birth = defaultdict(list)
    by_name = defaultdict(list)
    with gzip.open(TM_FILE, 'rt', encoding='utf-8') as f:
        for row in csv.DictReader(f):
            if (row.get('last_season') or '0') < '2024':  # 은퇴·오래된 기록 제외
                continue
            birth = (row.get('date_of_birth') or '')[:10]
            entry = {
                'name': row['name'],
                'birth': birth,
                'position': SUB_POSITION.get(row.get('sub_position') or ''),
                'value': float(row['market_value_in_eur']) if row.get('market_value_in_eur') else None,
                'peak': float(row['highest_market_value_in_eur']) if row.get('highest_market_value_in_eur') else None,
                'club': row.get('current_club_name') or '',
            }
            if birth:
                by_birth[birth].append(entry)
            by_name[' '.join(norm(row['name']))].append(entry)
    return {'by_birth': by_birth, 'by_name': by_name}


def match(tm, name, birth=None, age=None, season_year=None):
    """우리 선수 → 트랜스퍼마르크트 행 (없으면 None)"""
    if birth:
        cands = tm['by_birth'].get(birth[:10], [])
        best = max(cands, key=lambda e: similarity(name, e['name']), default=None)
        if best and similarity(name, best['name']) >= 0.75:
            return best
        return None
    cands = tm['by_name'].get(' '.join(norm(name)), [])
    if age is not None and season_year:
        cands = [e for e in cands if e['birth'] and abs((season_year - int(e['birth'][:4])) - age) <= 1]
    return cands[0] if len(cands) == 1 else None
