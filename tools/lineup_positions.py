"""경기 라인업(포메이션 격자)으로 선수의 세부 포지션을 정한다.

API-Football 라인업의 grid는 '줄:칸' (줄 1 = GK, 앞으로 갈수록 큰 수 / 칸 1 = 왼쪽).
줄마다 인원과 깊이로 역할을 정한 뒤, 선수별로 가장 많이 선 자리를 주 포지션, 자주 선 다른 자리를 보조 포지션으로 쓴다.
"""
import glob
from collections import Counter, defaultdict

from common import TOOLS, read_json

RAW_API = TOOLS / 'raw' / 'api-football'
MIN_STARTS = 2  # 이보다 적게 선발로 뛴 선수는 원래 포지션 그룹과 맞을 때만 쓴다
ALT_SHARE = 0.25  # 보조 포지션: 선발의 25% 이상을 그 자리에서


def _wide(n, inner, left, right):
    """양끝은 left/right, 가운데는 inner"""
    return [left] + [inner] * (n - 2) + [right] if n >= 2 else [inner]


def line_roles(depth, middle_count, n, back_three):
    """한 줄의 역할 (왼쪽부터). depth: 'def' | 'att' | 중간 줄 번호(0 = 가장 깊은 중간 줄)"""
    if depth == 'def':
        return _wide(n, 'CB', 'LB', 'RB') if n >= 4 else ['CB'] * n
    if depth == 'att':
        return _wide(n, 'ST', 'LW', 'RW') if n >= 3 else ['ST'] * n
    deepest = depth == 0
    highest = depth == middle_count - 1
    if middle_count == 1:
        if n >= 4:
            return _wide(n, 'CM', 'LB', 'RB') if back_three else _wide(n, 'CM', 'LW', 'RW')
        return ['CM'] * n
    if deepest:
        if n <= 2:
            return ['DM'] * n
        if n >= 4:
            return _wide(n, 'CM', 'LB', 'RB') if back_three else _wide(n, 'CM', 'LW', 'RW')
        return ['CM'] * n
    if highest:
        if n == 1:
            return ['AM']
        if n == 2:
            return ['AM', 'AM']
        if n == 3:
            return ['LW', 'AM', 'RW']
        return _wide(n, 'CM', 'LW', 'RW')
    return ['CM'] * n if n <= 2 else _wide(n, 'CM', 'LW', 'RW')


def roles_of_lineup(start_xi):
    """startXI → {API 선수 id: 역할}"""
    rows = defaultdict(list)
    for item in start_xi:
        p = item['player']
        grid = p.get('grid')
        if not grid or ':' not in grid:
            continue
        row, col = (int(x) for x in grid.split(':'))
        rows[row].append((col, p['id'], p.get('pos')))
    if len(rows) < 3:
        return {}
    order = sorted(rows)
    out = {}
    for _, pid, pos in rows[order[0]]:
        if pos == 'G':
            out[pid] = 'GK'
    outfield = order[1:]
    middles = outfield[1:-1]
    back_three = len(rows[outfield[0]]) == 3
    for i, row in enumerate(outfield):
        line = sorted(rows[row])  # 칸 번호 = 왼쪽부터
        depth = 'def' if i == 0 else 'att' if i == len(outfield) - 1 else i - 1
        roles = line_roles(depth, len(middles), len(line), back_three)
        for (col, pid, pos), role in zip(line, roles):
            if pos != 'G':
                out[pid] = role
    return out


def load_lineup_positions():
    """모든 라인업 파일 → {API 선수 id: (주 포지션, [보조], 선발 수)}"""
    counts = defaultdict(Counter)
    for f in glob.glob(str(RAW_API / '*' / '*' / 'lineups' / '*.json')):
        for team in read_json(f).get('response', []):
            for pid, role in roles_of_lineup(team.get('startXI') or []).items():
                counts[pid][role] += 1
    result = {}
    for pid, c in counts.items():
        total = sum(c.values())
        (main, _), *rest = c.most_common()
        alt = [r for r, n in rest if n / total >= ALT_SHARE][:2]
        result[pid] = (main, alt, total)
    return result
