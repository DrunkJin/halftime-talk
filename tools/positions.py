"""소스별 포지션 표기 → 게임 포지션(GK·CB·LB·RB·DM·CM·AM·LW·RW·ST).

결과는 둘 중 하나
  {'position': 'CB', 'alt': []}          세부 포지션이 확정된 경우
  {'group': ['CB', 'LB', 'RB'], 'alt': []}  후보만 아는 경우 → assign_groups()가 팀 내 균형으로 고른다
"""
import re

# premierleague.com positionInfo의 역할. 예: "Left/Centre Central Defender" → 사이드 [Left, Centre] + 역할 "Central Defender"
ROLES = {
    'Goalkeeper': {'by_side': {'Left': 'GK', 'Centre': 'GK', 'Right': 'GK'}, 'fallback': ['GK']},
    'Central Defender': {'by_side': {'Left': 'LB', 'Centre': 'CB', 'Right': 'RB'}, 'fallback': ['CB'], 'prefer': 'CB'},
    'Full Back': {'by_side': {'Left': 'LB', 'Centre': 'CB', 'Right': 'RB'}, 'fallback': ['LB', 'RB']},
    'Wing Back': {'by_side': {'Left': 'LB', 'Centre': 'CB', 'Right': 'RB'}, 'fallback': ['LB', 'RB']},
    'Defender': {'by_side': {'Left': 'LB', 'Centre': 'CB', 'Right': 'RB'}, 'fallback': ['CB', 'LB', 'RB']},
    'Defensive Midfielder': {'by_side': {'Left': 'DM', 'Centre': 'DM', 'Right': 'DM'}, 'fallback': ['DM']},
    'Central Midfielder': {'by_side': {'Left': 'CM', 'Centre': 'CM', 'Right': 'CM'}, 'fallback': ['CM']},
    'Attacking Midfielder': {'by_side': {'Left': 'LW', 'Centre': 'AM', 'Right': 'RW'}, 'fallback': ['AM'], 'prefer': 'AM'},
    'Midfielder': {'by_side': {'Left': 'CM', 'Centre': 'CM', 'Right': 'CM'}, 'fallback': ['CM', 'DM', 'AM']},
    'Winger': {'by_side': {'Left': 'LW', 'Centre': 'AM', 'Right': 'RW'}, 'fallback': ['LW', 'RW'], 'centre_is_alt': True},
    'Striker': {'by_side': {'Left': 'LW', 'Centre': 'ST', 'Right': 'RW'}, 'fallback': ['ST'], 'prefer': 'ST'},
    'Second Striker': {'by_side': {'Left': 'LW', 'Centre': 'ST', 'Right': 'RW'}, 'fallback': ['ST'], 'prefer': 'ST'},
    'Centre Forward': {'by_side': {'Left': 'LW', 'Centre': 'ST', 'Right': 'RW'}, 'fallback': ['ST'], 'prefer': 'ST'},
    'Forward': {'by_side': {'Left': 'LW', 'Centre': 'ST', 'Right': 'RW'}, 'fallback': ['ST', 'LW', 'RW']},
}
SIDED_RE = re.compile(r'^((?:Left|Centre|Right)(?:/(?:Left|Centre|Right))*)\s+(.+)$')


def _unique(items):
    return list(dict.fromkeys(items))


def from_pl_position_info(info):
    """premierleague.com positionInfo → 포지션 또는 그룹. 모르는 표기면 None"""
    if not info:
        return None
    m = SIDED_RE.match(info)
    sides = m.group(1).split('/') if m else []
    role = ROLES.get(m.group(2) if m else info)
    if not role:
        return None
    cands = _unique(role['by_side'][s] for s in sides) if sides else role['fallback']
    if len(cands) == 1:
        return {'position': cands[0], 'alt': []}
    if not sides:
        return {'group': list(cands), 'alt': []}
    if role.get('prefer') in cands:
        return {'position': role['prefer'], 'alt': [p for p in cands if p != role['prefer']]}
    wide = [p for p in cands if p != role['by_side']['Centre']] if role.get('centre_is_alt') else cands
    if len(wide) == 1:
        return {'position': wide[0], 'alt': [p for p in cands if p != wide[0]]}
    return {'group': wide, 'alt': [p for p in cands if p not in wide]}


# 4분류 표기 (football-data: Goalkeeper/Defence/Midfield/Offence, API-Football: Goalkeeper/Defender/Midfielder/Attacker)
COARSE = {
    'Goalkeeper': ['GK'],
    'Defence': ['CB', 'LB', 'RB'], 'Defender': ['CB', 'LB', 'RB'],
    'Midfield': ['CM', 'DM', 'AM'], 'Midfielder': ['CM', 'DM', 'AM'],
    'Offence': ['ST', 'LW', 'RW'], 'Attacker': ['ST', 'LW', 'RW'],
}
FPL_TYPES = {1: 'Goalkeeper', 2: 'Defender', 3: 'Midfielder', 4: 'Attacker'}


def from_coarse(label, fpl_type=None):
    group = COARSE.get(label) or COARSE.get(FPL_TYPES.get(fpl_type)) or COARSE['Midfield']
    return {'position': group[0], 'alt': []} if len(group) == 1 else {'group': list(group), 'alt': []}


# 균형 배정 기준이 되는 팀당 목표 인원
SQUAD_TARGET = {'GK': 3, 'CB': 4, 'LB': 2, 'RB': 2, 'DM': 2, 'CM': 3, 'AM': 2, 'LW': 2, 'RW': 2, 'ST': 3}


def assign_groups(fixed_positions, entries):
    """그룹으로만 아는 선수들에게 팀 내 부족한 포지션부터 배정 (entries 순서대로)"""
    count = {p: 0 for p in SQUAD_TARGET}
    for p in fixed_positions:
        count[p] += 1
    for e in entries:
        group = e.pop('group')
        best = max(group, key=lambda p: (SQUAD_TARGET[p] - count[p], -group.index(p)))
        count[best] += 1
        e['position'] = best
        others = [p for p in group if p != best] if len(group) == 2 else []
        e['alt'] = [p for p in _unique(e['alt'] + others) if p != best]
