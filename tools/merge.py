"""소스별 원본(tools/.cache/)을 공통 스키마(data/*.json, schemaVersion 2)로 합친다. 네트워크를 쓰지 않는다.

사용법: python3 tools/merge.py
  먼저: fetch_football_data.py (유럽 리그), fetch_fpl.py (EPL 보강), fetch_api_football.py (K리그·선수 기록)

소스
  football-data.org  유럽 리그 팀·스쿼드(이름·생년월일·국적·4분류 포지션)·순위·로고
  FPL + PL 사이트     EPL 선수 기록·가격·세부 포지션 (EPL 선수 id는 p{opta})
  API-Football       K리그 팀·현재 명단(id는 af{id}), 리그별 선수 시즌 기록 (생년월일+이름으로 매칭)
능력치 공식은 tools/formula.py, 리그 설정은 tools/sources.json, 수동 보정은 tools/overrides.json.
"""
import glob
import json
import re
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import date

import formula as F
from common import CACHE, DATA, LOGOS, ROOT, TOOLS, clean_team_name, name_tokens, progress, read_json, slugify, strip_accents, team_id_from_name, write_json
from lineup_positions import MIN_STARTS, load_lineup_positions
from positions import assign_groups, from_coarse, from_pl_position_info

SCHEMA_VERSION = 2
GUEST_POOL = 'uefa-guests'  # 게스트 선수 기록 백분위 비교 묶음 (리그가 아님)
POSITION_ORDER = ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST']
DEFAULT_RULES = {
    'points': {'win': 3, 'draw': 1, 'loss': 0},
    'tiebreakers': ['points', 'goalDifference', 'goalsFor', 'headToHead'],
    'matchday': {'benchSize': 9, 'maxSubstitutions': 5},
}
FPL_TLA_ALIAS = {'NOT': 'NFO'}  # football-data tla → FPL short_name (다른 것만)
COLOR_WORDS = {
    'red': '#D71920', 'white': '#FFFFFF', 'black': '#111111', 'blue': '#1D4ED8', 'royal blue': '#034694', 'sky blue': '#6CABDD',
    'claret': '#670E36', 'navy blue': '#132257', 'navy': '#132257', 'orange': '#F18A00', 'yellow': '#FDE100', 'gold': '#FDB913',
    'amber': '#FFBF00', 'green': '#00843D', 'dark green': '#00563F', 'maroon': '#7A1F2B', 'purple': '#5B2A86', 'violet': '#6F2DA8',
    'grey': '#8A8D91', 'gray': '#8A8D91', 'silver': '#B8BCC2', 'burgundy': '#7A1F2B', 'light blue': '#7FB2E5', 'dark blue': '#0B2D6B',
    'garnet': '#A50044', 'granate': '#A50044', 'turquoise': '#00A6A6',
}
PALETTE = ['#C8102E', '#1D4ED8', '#00843D', '#F18A00', '#5B2A86', '#0B2D6B', '#7A1F2B', '#FDB913', '#00A6A6', '#111111']


# ── 공용 ──────────────────────────────────────────────

class Nations:
    def __init__(self):
        self.by_name = {}
        self.used = {}
        self.unknown = Counter()
        for n in read_json(TOOLS / 'nations.json')['nations']:
            for alias in [n['name'], n['code'], *n.get('aliases', [])]:
                self.by_name[self._norm(alias)] = n

    @staticmethod
    def _norm(s):
        return strip_accents(str(s or '')).strip().lower().replace('’', "'").replace('`', "'")

    def code(self, name):
        n = self.by_name.get(self._norm(name))
        if not n:
            if name:
                self.unknown[name] += 1
            return None
        self.used[n['code']] = {'code': n['code'], 'name': n['name'], 'nameKo': n['nameKo']}
        return n['code']


def age_on(birth, ref):
    y, m, d = map(int, birth[:10].split('-'))
    r = date.fromisoformat(ref[:10])
    return r.year - y - ((r.month, r.day) < (m, d))


def colors_from_text(text, seed):
    words = [w.strip().lower() for w in str(text or '').split('/')]
    found = [COLOR_WORDS[w] for w in words if w in COLOR_WORDS]
    if found:
        return {'primary': found[0], 'secondary': found[1] if len(found) > 1 else '#FFFFFF'}
    i = int(F._hash_unit(seed) * len(PALETTE))
    return {'primary': PALETTE[i], 'secondary': '#FFFFFF'}


def team_code(tla, *names):
    """football-data 약자가 3글자 형식이 아니면 ('RC ', 'AZ') 팀 이름 글자로 만든다"""
    t = (tla or '').strip().upper()
    if re.fullmatch(r'[A-Z0-9]{3}', t):
        return t
    for name in names:
        letters = re.sub(r'[^A-Z0-9]', '', strip_accents(name or '').upper())
        if len(letters) >= 3:
            return letters[:3]
    return (t + 'XXX')[:3]


def logo_file(team_id):
    for ext in ('.svg', '.webp', '.png'):  # optimize_logos.py가 PNG를 WebP로 바꾼다
        if (LOGOS / f'{team_id}{ext}').exists():
            return f'{team_id}{ext}'
    return None


def standings_rows(standings):
    """football-data 순위 → {팀 id: (승점, 경기 수)}"""
    if not standings:
        return {}
    table = next(s for s in standings['standings'] if s['type'] == 'TOTAL')['table']
    return {r['team']['id']: (r['points'], r['playedGames']) for r in table}


def optional(path):
    return read_json(path) if path.exists() else None


# ── API-Football 선수 기록 ───────────────────────────────

RAW_API = TOOLS / 'raw' / 'api-football'


def load_api_stats(seasons):
    """tools/raw/api-football/*/{시즌}/players/p*.json → {선수 id: 시즌·리그 합산 기록}.
    한 선수가 시즌 중 팀·리그를 옮겼거나 여러 시즌에 걸쳐 있으면 모두 합친다"""
    stats = {}
    for season in seasons:
        for file in sorted(glob.glob(str(RAW_API / '*' / str(season) / 'players' / 'p*.json'))):
            for item in read_json(file).get('response', []):
                for st in item.get('statistics', []):
                    _add_stat(stats, item['player'], st, season)
    for s in stats.values():
        s['rating'] = s['_rating_minutes'] / s['_rated_minutes'] if s['_rated_minutes'] else None
    return stats


def _add_stat(stats, p, st, season):
    s = stats.setdefault(p['id'], {
        'apiId': p['id'], 'name': p.get('name') or '', 'firstname': p.get('firstname') or '', 'lastname': p.get('lastname') or '',
        'birth': (p.get('birth') or {}).get('date'), 'nationality': p.get('nationality'), 'teams': set(),
        'minutes': 0, 'goals': 0, 'assists': 0, 'shots': 0, 'shotsOn': 0, 'keyPasses': 0, 'tackles': 0, 'interceptions': 0,
        'blocks': 0, 'duelsWon': 0, 'saves': 0, 'conceded': 0, '_rating_minutes': 0.0, '_rated_minutes': 0, 'position': None,
        'leagueMinutes': {}, 'teamMinutes': {},
    })
    # 같은 시즌·팀·대회 기록이 페이지 경계 등으로 두 번 오면 무시
    key = (season, (st.get('team') or {}).get('id'), (st.get('league') or {}).get('id'))
    if key in s['teams']:
        return
    s['teams'].add(key)
    g = st.get('games') or {}
    minutes = g.get('minutes') or 0
    s['minutes'] += minutes
    lid = (st.get('league') or {}).get('id')
    s['leagueMinutes'][lid] = s['leagueMinutes'].get(lid, 0) + minutes
    tid = (st.get('team') or {}).get('id')
    s['teamMinutes'][tid] = s['teamMinutes'].get(tid, 0) + minutes
    s['position'] = s['position'] or g.get('position')
    for key, (group, field) in {
        'goals': ('goals', 'total'), 'assists': ('goals', 'assists'), 'conceded': ('goals', 'conceded'), 'saves': ('goals', 'saves'),
        'shots': ('shots', 'total'), 'shotsOn': ('shots', 'on'), 'keyPasses': ('passes', 'key'), 'tackles': ('tackles', 'total'),
        'interceptions': ('tackles', 'interceptions'), 'blocks': ('tackles', 'blocks'), 'duelsWon': ('duels', 'won'),
    }.items():
        s[key] += (st.get(group) or {}).get(field) or 0
    if g.get('rating') and minutes:
        s['_rating_minutes'] += float(g['rating']) * minutes
        s['_rated_minutes'] += minutes


GENERIC_TEAM_WORDS = {'fc', 'cf', 'sc', 'ac', 'as', 'afc', 'club', 'de', 'calcio', 'the', 'sv', 'vfl', 'vfb', 'ssc', 'rc', 'cd', 'ud', 'sd', 'ca', 'cp', 'tsg', 'bsc', 'hsc', 'ogc', 'olympique', 'stade', 'real', 'athletic', 'atletico', 'sporting', 'united', 'city', 'town'}


def team_tokens(name):
    """팀 이름 비교용 단어 (FC·Club 같은 흔한 단어 제외. 다 빠지면 원래 단어 유지)"""
    tokens = name_tokens(name)
    core = tokens - GENERIC_TEAM_WORDS
    return core or tokens


def team_name_score(a, b):
    """두 팀 이름 단어 집합의 유사도. 흔한 단어(FC·City 등)는 절반만 치고, 앞 4글자가 같은 단어(Rennes/Rennais)는 부분 점수"""
    def weight(t):
        return 0.5 if t in GENERIC_TEAM_WORDS else 1.0
    exact = sum(weight(t) for t in a & b)
    partial = 0.5 * sum(1 for t in a - b if len(t) >= 4 and any(len(u) >= 4 and u[:4] == t[:4] for u in b - a))
    total = sum(weight(t) for t in a | b)
    return (exact + partial) / total if total else 0.0


def current_season_of(league_id):
    """fetch_api_football.py가 저장한 league.json에서 리그의 현재 시즌 (매물용 리그)"""
    info = optional(RAW_API / league_id / 'league.json')
    for item in (info or {}).get('response', []):
        for season in item.get('seasons', []):
            if season.get('current'):
                return season['year']
    return None


def index_by_birth(stats):
    idx = defaultdict(list)
    for s in stats.values():
        if s['birth']:
            idx[s['birth']].append(s)
    return idx


def match_api_stats(name, birth, by_birth):
    """생년월일이 같고 이름이 한 단어 이상 겹치면 동일인"""
    if not birth:
        return None
    tokens = name_tokens(name)
    for s in by_birth.get(birth[:10], []):
        if tokens & name_tokens(f"{s['firstname']} {s['lastname']} {s['name']}"):
            return s
    return None


# ── 병합 ──────────────────────────────────────────────

class Merger:
    def __init__(self):
        self.sources = read_json(TOOLS / 'sources.json')
        self.overrides = read_json(TOOLS / 'overrides.json')
        self.nations = Nations()
        self.stats_seasons = self.sources['apiFootball']['statsSeasons']
        self.leagues_cfg = {l['id']: l for l in self.sources['leagues']}
        self.league_by_api = {l['apiFootballId']: l for l in self.sources['leagues'] if l.get('apiFootballId')}
        # API-Football 선수 기록: 6개 리그 · 진행 중+지난 시즌 합산. 리그를 옮긴 선수도 찾을 수 있게 전체 색인
        progress('API-Football 선수 기록 불러오기')
        self.api_stats = load_api_stats(self.stats_seasons)
        self.api_by_birth = index_by_birth(self.api_stats)
        self.leagues = []
        self.teams = []
        self.team_base = {}
        self.records = []
        self.player_ids = set()
        self.api_team_map = {}  # API-Football 팀 id → 우리 팀 id (대륙 대회 보정용)
        self.guest_count = 0
        self.guest_strength = {}  # 게스트 팀 id → 국내 리그 수준
        self.report = Counter()
        self.missing = []

    @staticmethod
    def season_matches(cfg, team_count):
        """리그 한 시즌 팀당 경기 수 (출전 비중 계산용)"""
        return max(1, (team_count - 1) * cfg['rounds'])

    def add_team(self, league, team_id, name, short, code, colors, stadium, base):
        ov = self.overrides['teams'].get(team_id, {})
        team = {
            'id': team_id, 'name': name, 'shortName': ov.get('shortName', short), 'code': ov.get('code', code),
            'colors': ov.get('colors', colors), 'stadium': ov.get('stadium', stadium), 'logo': logo_file(team_id), 'leagueId': league['id'],
        }
        # 다른 나라 리그에 같은 이름의 팀이 있으면 국가 코드를 붙여 구분 (예: nacional-uru)
        if any(t['id'] == team_id for t in self.teams):
            team_id = team['id'] = f"{team_id}-{league['country'].lower()}"
            team['logo'] = logo_file(team_id)
            if any(t['id'] == team_id for t in self.teams):
                raise SystemExit(f'팀 id 중복: {team_id} — overrides나 이름 정리 규칙 확인')
        self.teams.append(team)
        self.team_base[team_id] = base
        return team

    def stats_origin(self, stats):
        """기록을 낸 리그(출전 시간 최다, 설정에 있는 리그만) → (리그 id, 수준 계수)"""
        if not stats:
            return None, None
        known = {lid: mins for lid, mins in stats['leagueMinutes'].items() if lid in self.league_by_api}
        if not known:
            return None, None
        cfg = self.league_by_api[max(known, key=known.get)]
        return cfg['id'], cfg['strength']

    def add_player(self, **r):
        # 스키마 범위를 벗어난 나이(코치·유소년 오등록 등)와 두 팀 명단에 동시에 있는 선수(임대 등)는 뺀다
        if not 15 <= r['age'] <= 45:
            self.report['skippedAge'] += 1
            return
        if r['id'] in self.player_ids:
            self.report['skippedDuplicate'] += 1
            return
        self.player_ids.add(r['id'])
        pos = r.pop('pos')
        r.update(pos)
        r['roleClass'] = F.ROLE_CLASS[pos.get('position') or pos['group'][0]]
        r['teamBase'] = self.team_base[r['teamId']]
        r['leagueStrength'] = r.pop('strength', None) or self.leagues_cfg[r['leagueId']]['strength']
        if r['source'] == 'api':
            r['statsLeague'], r['statsStrength'] = self.stats_origin(r['stats'])
        self.records.append(r)

    # ── football-data 리그 ──
    def build_fd_league(self, cfg):
        code = cfg['code']
        base = CACHE / 'football-data'
        teams_json = optional(base / f'{code}-teams.json')
        if not teams_json:
            self.missing.append(f"{cfg['name']}: football-data 캐시 없음 (fetch_football_data.py 실행)")
            return None
        season_start = teams_json['season']['startDate']
        start_year = int(season_start[:4])
        cur = standings_rows(optional(base / f'{code}-standings.json'))
        prev = standings_rows(optional(base / f'{code}-standings-prev.json'))
        upper_prev = {}
        if cfg.get('promotion'):
            up = self.leagues_cfg[cfg['promotion']['league']]
            upper_prev = standings_rows(optional(base / f"{up['code']}-standings-prev.json"))

        league_out = self.league_entry(cfg, f'{start_year}-{str(start_year + 1)[2:]}')
        prev_matches = self.season_matches(cfg, len(teams_json['teams']))
        fpl = FplEnricher(teams_json, season_start, self) if cfg['id'] == 'epl' and (CACHE / 'fpl' / 'bootstrap.json').exists() else None
        if cfg['id'] == 'epl' and not fpl:
            self.missing.append('EPL: FPL 캐시 없음 (fetch_fpl.py 실행) — 기록 없이 계산')

        for t in teams_json['teams']:
            team_id = team_id_from_name(t['name'])
            if t['id'] in prev:
                pts, played = prev[t['id']]
                prev_ppg = pts / played if played else F.FORMULA['unknownPpg']
            else:
                prev_ppg = F.FORMULA['relegatedPpg'] if t['id'] in upper_prev else F.FORMULA['promotedPpg']
            pts, played = cur.get(t['id'], (0, 0))
            team_base = F.team_base(cfg['strength'], F.blend_ppg(prev_ppg, pts, played))
            team_id = self.add_team(cfg, team_id, clean_team_name(t['name']), t.get('shortName') or clean_team_name(t['name']), team_code(t.get('tla'), clean_team_name(t['name']), t.get('shortName')),
                                    colors_from_text(t.get('clubColors'), team_id), t.get('venue'), team_base)['id']
            league_out['teamIds'].append(team_id)
            if fpl:
                fpl.add_team_players(self, t, team_id, played)
                continue
            for p in t.get('squad') or []:
                if not p.get('dateOfBirth'):
                    continue
                s = match_api_stats(p['name'], p['dateOfBirth'], self.api_by_birth)
                self.report['stats' if s else 'noStats'] += 1
                self.add_player(
                    id=f"fd{p['id']}", name=p['name'], age=age_on(p['dateOfBirth'], season_start), nationality=self.nationality(p.get('nationality')),
                    teamId=team_id, leagueId=cfg['id'], pos=from_coarse(p.get('position') or (s or {}).get('position')),
                    source='api' if s else None, stats=s, share=self.share(s, prev_matches + played),
                )
        if fpl:
            fpl.add_fpl_only(self, cfg['id'])
        self.map_api_teams(cfg['id'], league_out['teamIds'])
        return league_out

    def map_api_teams(self, league_id, team_ids):
        """football-data 팀 ↔ API-Football 팀: 리그 원본 팀 목록의 이름 단어로 맞춘다.
        모든 쌍의 점수를 매겨 높은 쌍부터 배정한다 (목록 순서대로 먼저 잡으면 Barcelona가 Espanyol에 붙는 식의 오류가 난다)"""
        season = current_season_of(league_id) or max(self.sources['apiFootball']['raw']['seasons'])
        api_teams = (optional(RAW_API / league_id / str(season) / 'teams.json') or {}).get('response', [])
        ours = {t['id']: name_tokens(t['name']) | name_tokens(t['shortName']) for t in self.teams if t['id'] in team_ids}
        pairs = []
        for x in api_teams:
            api_tokens = name_tokens(x['team']['name'])
            for tid, ot in ours.items():
                score = team_name_score(api_tokens, ot)
                if score > 0:
                    pairs.append((score, x['team']['id'], tid))
        used_api, used_ours = set(), set()
        for score, api_id, tid in sorted(pairs, key=lambda p: -p[0]):
            if api_id in used_api or tid in used_ours:
                continue
            used_api.add(api_id)
            used_ours.add(tid)
            self.api_team_map[api_id] = tid

    def share(self, stats, available_matches):
        """출전 비중: 합산 기록의 출전 시간 / (지난 시즌 + 이번 시즌 진행 경기) × 90분"""
        if not stats:
            return None
        return stats['minutes'] / (max(1, available_matches) * 90)

    # ── API-Football 리그 (K리그) ──
    def build_api_league(self, cfg):
        """tools/raw/api-football/{리그}/{최근 시즌}/ 의 팀 목록·순위·현재 명단으로 만든다.
        sources.json의 teams는 약칭·코드 보정용 (apiId로 매칭)"""
        latest = current_season_of(cfg['id']) or max(self.sources['apiFootball']['raw']['seasons'])
        folder = RAW_API / cfg['id'] / str(latest)
        teams_json = optional(folder / 'teams.json')
        if not teams_json or not teams_json.get('response'):
            self.missing.append(f"{cfg['name']}: API-Football 원본 없음 (fetch_api_football.py 실행)")
            return None
        cur = {r['id']: r for r in api_standings(optional(folder / 'standings.json'))}
        # 지난 시즌 소속과 승점: 같은 나라 다른 리그 순위도 같이 본다 (승강 판단)
        prev_rows = {}
        for other in self.sources['leagues']:
            if other['source'] == 'api-football':
                for row in api_standings(optional(RAW_API / other['id'] / str(latest - 1) / 'standings.json')):
                    prev_rows[row['id']] = (other['id'], row['points'], row['played'])
        hints = {t['apiId']: t for t in cfg.get('teams', [])}

        league_out = self.league_entry(cfg, str(latest))
        prev_matches = self.season_matches(cfg, len(teams_json['response']))
        for x in teams_json['response']:
            info, venue = x['team'], x.get('venue') or {}
            hint = hints.get(info['id'], {})
            name = hint.get('name') or info['name']
            team_id = slugify(name)
            prev = prev_rows.get(info['id'])
            if not prev:
                prev_ppg = F.FORMULA['unknownPpg']
            elif prev[0] == cfg['id']:
                prev_ppg = prev[1] / prev[2] if prev[2] else F.FORMULA['unknownPpg']
            elif self.leagues_cfg[prev[0]]['level'] < cfg['level']:
                prev_ppg = F.FORMULA['relegatedPpg']
            else:
                prev_ppg = F.FORMULA['promotedPpg']
            now = cur.get(info['id'], {'points': 0, 'played': 0})
            base = F.team_base(cfg['strength'], F.blend_ppg(prev_ppg, now['points'], now['played'], prev_matches))
            team = self.add_team(cfg, team_id, name, hint.get('short') or clean_team_name(info['name']), team_code(hint.get('code') or info.get('code'), name),
                                 colors_from_text(None, team_id), venue.get('name'), base)
            team_id = team['id']
            self.api_team_map[info['id']] = team_id
            league_out['teamIds'].append(team_id)

            squad = (optional(folder / 'squads' / f"{info['id']}.json") or {}).get('response') or []
            roster = squad[0].get('players') if squad else None
            if not roster:
                # 현재 명단이 비어 있으면 이번 시즌 이 팀 기록에 나온 선수로 대신한다
                roster = [{'id': pid, 'name': st['name'], 'age': age_on(st['birth'], f'{latest}-07-01') if st['birth'] else None, 'position': st['position']}
                          for pid, st in self.api_stats.items() if any(k[0] == latest and k[1] == info['id'] for k in st['teams'])]
                self.missing.append(f"{name}: 현재 명단 없음 → 이번 시즌 기록 선수 {len(roster)}명으로 대체")
            for p in roster:
                if not p.get('age'):
                    continue
                s = self.api_stats.get(p['id'])
                self.report['stats' if s else 'noStats'] += 1
                nat = self.nationality(s['nationality']) if s and s.get('nationality') else None
                if not nat:
                    nat = self.nationality(cfg['country'])
                    self.report['defaultNationality'] += 1
                self.add_player(
                    id=f"af{p['id']}", name=p['name'], age=p['age'], nationality=nat, teamId=team_id, leagueId=cfg['id'],
                    pos=from_coarse(p.get('position')), source='api' if s else None, stats=s,
                    share=self.share(s, prev_matches + now['played']),
                )
        return league_out

    # ── 게스트 팀 (대륙 대회 전용) ──
    def build_guests(self):
        """tools/raw/api-football/guests/ → 리그 없이 대륙 대회에만 나오는 팀.
        국내 리그 수준은 sources.json competitions.guestLeagues, 선수 기록 백분위는 게스트 선수끼리 비교"""
        comps = self.sources.get('competitions') or {}
        strengths = {int(k): v['strength'] for k, v in comps.get('guestLeagues', {}).items() if not k.startswith('_')}
        g = RAW_API / 'guests'
        seasons = sorted(self.stats_seasons, reverse=True)
        for f in sorted((g / 'teams').glob('*.json')):
            api_id = int(f.stem)
            info = (read_json(f).get('response') or [{}])[0]
            team, venue = info.get('team') or {}, info.get('venue') or {}
            if not team:
                continue

            def domestic(season):
                """그 시즌 국내 리그 (리그 id, 순위 행). 국가가 같은 대회만 (UEFA 대회 제외)"""
                for item in (optional(g / 'standings' / f'{api_id}-{season}.json') or {}).get('response', []):
                    lg = item['league']
                    if lg.get('country') != team.get('country'):
                        continue
                    for grp in lg['standings']:
                        for row in grp:
                            if row['team']['id'] == api_id:
                                return lg['id'], row
                return None, None

            cur_league, cur = domestic(seasons[0])
            prev_league, prev = domestic(seasons[1])
            league_id = cur_league or prev_league
            if league_id not in strengths:
                self.missing.append(f"{team['name']}: 국내 리그 {league_id} 수준 미정 (sources.json competitions.guestLeagues)")
                continue
            strength = strengths[league_id]
            if prev and prev_league == league_id and prev['all']['played']:
                prev_ppg = prev['points'] / prev['all']['played']
            elif prev and prev_league in strengths and strengths[prev_league] < strength:
                prev_ppg = F.FORMULA['promotedPpg']
            else:
                prev_ppg = F.FORMULA['unknownPpg']
            prev_matches = prev['all']['played'] if prev else 30
            now_pts, now_played = (cur['points'], cur['all']['played']) if cur else (0, 0)
            base = F.team_base(strength, F.blend_ppg(prev_ppg, now_pts, now_played, prev_matches))
            nat = self.nationality(team.get('country'))
            name = team['name']
            t = self.add_team({'id': None, 'country': nat}, slugify(name), name, clean_team_name(name), team_code(team.get('code'), name),
                              colors_from_text(None, slugify(name)), venue.get('name'), base)
            t['guest'] = True
            t['country'] = nat
            self.guest_strength[t['id']] = strength
            self.api_team_map[api_id] = t['id']
            squad = (optional(g / 'squads' / f'{api_id}.json') or {}).get('response') or []
            for p in (squad[0].get('players') if squad else []) or []:
                if not p.get('age'):
                    continue
                s = self.api_stats.get(p['id'])
                self.report['stats' if s else 'noStats'] += 1
                pnat = self.nationality(s['nationality']) if s and s.get('nationality') else nat
                self.add_player(
                    id=f"af{p['id']}", name=p['name'], age=p['age'], nationality=pnat, teamId=t['id'], leagueId=GUEST_POOL, strength=strength,
                    pos=from_coarse(p.get('position')), source='api' if s else None, stats=s,
                    share=self.share(s, prev_matches + now_played),
                )
            self.guest_count += 1

    def league_entry(self, cfg, season_label):
        entry = {
            'id': cfg['id'], 'name': cfg['name'], 'country': cfg['country'], 'season': season_label, 'level': cfg['level'], 'teamIds': [],
            'rules': {'rounds': cfg['rounds'], **DEFAULT_RULES},
        }
        for key in ('promotion', 'relegation'):
            if cfg.get(key):
                entry[key] = cfg[key]
        return entry

    def nationality(self, name):
        return self.nations.code(name)

    # ── 마무리 ──
    def continental_bonus(self):
        """대륙 대회 경기 결과 → 팀 기본값 보정 {우리 팀 id: 값}"""
        C = F.FORMULA['continental']
        raw = self.sources['apiFootball']['raw']
        acc = defaultdict(lambda: {'w': 0.0, 'pts': 0.0, 'stage': 0.0})
        for comp in raw.get('continental', []):
            for season, sw in raw.get('continentalSeasons', {}).items():
                for x in (optional(RAW_API / 'continental' / comp['id'] / season / 'fixtures.json') or {}).get('response', []):
                    rnd = x['league']['round']
                    if 'Qualifying' in rnd or rnd == 'Play-offs' or x['fixture']['status']['short'] not in ('FT', 'AET', 'PEN'):
                        continue  # 예선은 상대가 약해 제외, 끝난 경기만
                    w = sw * comp['weight']
                    gh, ga = x['goals']['home'], x['goals']['away']
                    for side, gf, gaa in (('home', gh, ga), ('away', ga, gh)):
                        a = acc[x['teams'][side]['id']]
                        a['w'] += w
                        a['pts'] += w * (3 if gf > gaa else 1 if gf == gaa else 0)
                        stage = C['stages'].get(rnd, 0)
                        if rnd == 'Final' and x['teams'][side]['winner']:
                            stage = C['winner']
                        a['stage'] = max(a['stage'], stage * w)
        bonus = {}
        for api_id, a in acc.items():
            tid = self.api_team_map.get(api_id)
            if not tid or a['w'] == 0:
                continue
            ppg_part = F.clamp((a['pts'] / a['w'] - C['ppgRef']) * C['perPpg'], C['ppgMin'], C['ppgMax']) * min(1.0, a['w'] / C['fullWeight'])
            league_id = next(t['leagueId'] for t in self.teams if t['id'] == tid)
            strength = self.guest_strength[tid] if league_id is None else self.leagues_cfg[league_id]['strength']
            scale = 1 + max(0.0, 1 - strength) * C['leagueScale']
            bonus[tid] = min(C['max'], (ppg_part + a['stage']) * scale)
        return bonus

    def apply_lineup_positions(self):
        """세부 포지션을 모르는 선수(그룹만 앎)는 실제 경기 라인업에서 선 자리로 정한다 (tools/lineup_positions.py).
        선발 기록이 적은 선수는 원래 포지션 그룹과 맞을 때만 쓴다"""
        lineup = load_lineup_positions()
        for r in self.records:
            if 'group' not in r:
                continue
            api_id = (r.get('stats') or {}).get('apiId') or (int(r['id'][2:]) if r['id'].startswith('af') else None)
            hit = lineup.get(api_id)
            if not hit:
                continue
            main, alt, starts = hit
            if starts < MIN_STARTS and main not in r['group']:
                continue
            r['position'] = main
            r['alt'] = [p for p in alt if p != main]
            del r['group']
            r['roleClass'] = F.ROLE_CLASS[main]
            self.report['lineupPositions'] += 1

    def finish(self):
        self.apply_lineup_positions()
        self.team_bonus = self.continental_bonus()
        blend = F.FORMULA['transferBaseBlend']
        for r in self.records:
            r['teamBase'] += self.team_bonus.get(r['teamId'], 0.0)
            # 기록을 낸 팀이 지금 팀과 다르면 두 팀 기본값을 섞는다 (이적생)
            tm = (r.get('stats') or {}).get('teamMinutes') if r['source'] == 'api' else None
            if tm:
                origin = self.api_team_map.get(max(tm, key=tm.get))
                if origin and origin != r['teamId'] and origin in self.team_base:
                    origin_base = self.team_base[origin] + self.team_bonus.get(origin, 0.0)
                    r['teamBase'] = r['teamBase'] * (1 - blend) + origin_base * blend
                    self.report['blendedBase'] += 1
        progress('능력치 계산')
        ctx = self.ctx = F.StatContext(self.records)
        for r in self.records:
            r['quality'] = F.compute_quality(r, ctx)
        by_team = defaultdict(list)
        for r in self.records:
            by_team[r['teamId']].append(r)
        for squad in by_team.values():
            fixed = [r['position'] for r in squad if 'position' in r]
            # 품질 순으로 배정하면 목표 인원이 많은 CB·CM·ST에 좋은 선수가 몰린다 → 선수 ID 해시 순서로 고르게
            grouped = sorted((r for r in squad if 'group' in r), key=lambda r: F._hash_unit(f"{r['id']}:pos"))
            self.report['groupAssigned'] += len(grouped)
            assign_groups(fixed, grouped)
        for r in self.records:
            ov = self.overrides['players'].get(r['id'], {})
            if 'position' in ov:
                r['position'] = ov['position']
            if 'altPositions' in ov:
                r['alt'] = ov['altPositions']
            if 'nationality' in ov:
                r['nationality'] = ov['nationality']
            r['attributes'] = F.compute_attributes(r, r['quality'], ctx)


def build_competitions(m):
    """대륙 대회 1시즌 참가 팀: 실제 리그 페이즈 참가 팀 중 데이터에 있는 팀, 빈자리는 유럽 1부 팀 중 전력(상위 11명 품질 평균)순"""
    cfg = m.sources.get('competitions')
    if not cfg:
        return []
    by_team = defaultdict(list)
    for r in m.records:
        by_team[r['teamId']].append(r['quality'])
    strength = {tid: sum(sorted(q, reverse=True)[:11]) / min(11, len(q)) for tid, q in by_team.items() if q}
    league_of = {t['id']: t['leagueId'] for t in m.teams}
    eligible = [tid for tid in strength if league_of[tid] in cfg['eligibleLeagues']]
    caps = {k: v for k, v in cfg.get('leagueCaps', {}).items() if not k.startswith('_')}
    per_league = Counter()
    # 실제 참가 팀을 먼저 모두 확정한 뒤 빈자리를 채운다 (UCL 빈자리에 실제 UEL 팀을 끌어오지 않도록)
    reals = {}
    for comp in cfg['list']:
        fixtures = (optional(RAW_API / 'continental' / comp['raw'] / cfg['season'] / 'fixtures.json') or {}).get('response', [])
        real = []
        for x in fixtures:
            if not x['league']['round'].startswith('League Stage'):
                continue
            for side in ('home', 'away'):
                tid = m.api_team_map.get(x['teams'][side]['id'])
                if tid and tid not in real:
                    real.append(tid)
        reals[comp['id']] = real
    taken = {tid for real in reals.values() for tid in real}
    per_league.update(league_of[t] for t in taken)
    out = []
    for comp in cfg['list']:
        real = reals[comp['id']]
        filled = []
        for tid in sorted(eligible, key=lambda t: -strength[t]):
            if len(real) + len(filled) >= comp['size']:
                break
            if tid not in taken and per_league[league_of[tid]] < caps.get(league_of[tid], 99):
                filled.append(tid)
                taken.add(tid)
                per_league[league_of[tid]] += 1
        out.append({'id': comp['id'], 'name': comp['name'], 'shortName': comp['shortName'], 'level': comp['level'],
                    'teamIds': real + filled, 'realEntrants': len(real)})
        progress(f"  {comp['shortName']}: 실제 참가 팀 {len(real)} + 채움 {len(filled)} (" + ', '.join(filled) + ')')
    return out


def api_standings(data):
    """API-Football 순위 → [{id, points, played}] (스플릿 등 여러 그룹이면 경기 수가 가장 많은 행)"""
    best = {}
    for block in (data or {}).get('response', []):
        for group in block['league'].get('standings', []):
            for row in group:
                tid = row['team']['id']
                played = (row.get('all') or {}).get('played') or 0
                if tid not in best or played > best[tid]['played']:
                    best[tid] = {'id': tid, 'points': row['points'], 'played': played}
    return list(best.values())


# ── EPL: FPL은 선수 ID·소속 확인용, PL 사이트는 세부 포지션용. 기록은 다른 리그와 같은 API-Football ──

class FplEnricher:
    def __init__(self, teams_json, season_start, merger):
        base = CACHE / 'fpl'
        self.pending = []  # (football-data 선수, FPL 선수, 팀 id, 이번 시즌 경기 수)
        self.season_start = season_start
        self.boot = read_json(base / 'bootstrap.json')
        pl = read_json(base / 'pl-players.json') if (base / 'pl-players.json').exists() else []
        self.team_by_short = {t['short_name']: t['id'] for t in self.boot['teams']}
        self.fpl_team_to_ours = {}
        self.played = {}
        self.used = set()
        self.tokens = {e['id']: name_tokens(f"{e['first_name']} {e['second_name']} {e['web_name']}") for e in self.boot['elements']}
        self.pl_by_opta = {(p.get('altIds') or {}).get('opta'): p for p in pl if (p.get('altIds') or {}).get('opta')}
        self.pl_by_dob = defaultdict(list)
        for p in pl:
            millis = ((p.get('birth') or {}).get('date') or {}).get('millis')
            if millis:
                self.pl_by_dob[date.fromtimestamp(millis / 1000).isoformat()].append(p)
        self.active = [e for e in self.boot['elements'] if e['status'] != 'u']

    def match(self, fd_player, fpl_team_id):
        tokens = name_tokens(fd_player['name'])

        def score(e):
            o = len(tokens & self.tokens[e['id']])
            same_dob = e.get('birth_date') == fd_player.get('dateOfBirth')
            return o * 2 + (3 if same_dob else 0) if (o >= 2 or (o >= 1 and same_dob)) else 0

        def best(cands):
            scored = [(score(e), e) for e in cands if e['id'] not in self.used]
            scored = [x for x in scored if x[0] > 0]
            return max(scored, key=lambda x: x[0])[1] if scored else None

        els = self.boot['elements']
        return best([e for e in els if e['team'] == fpl_team_id]) or best([e for e in els if e.get('birth_date') == fd_player.get('dateOfBirth')])

    def record(self, merger, *, fd_player, element, team_id, played):
        if element and element['team'] in self.fpl_team_to_ours:
            team_id = self.fpl_team_to_ours[element['team']]
            played = self.played[team_id]
        name = fd_player['name'] if fd_player else None
        dob = (fd_player or {}).get('dateOfBirth') or (element or {}).get('birth_date')
        pl = None
        if element:
            pl = self.pl_by_opta.get(f"p{element['code']}")
        if not pl and dob:
            tokens = name_tokens(name or f"{element['first_name']} {element['second_name']}")
            pl = next((p for p in self.pl_by_dob.get(dob, []) if tokens & name_tokens((p.get('name') or {}).get('display', ''))), None)
        name = name or (pl or {}).get('name', {}).get('display') or f"{element['first_name']} {element['second_name']}"
        nat_name = (fd_player or {}).get('nationality') or ((pl or {}).get('nationalTeam') or {}).get('country')
        if not dob or not nat_name:
            merger.report['fplOnlySkipped'] += 1
            return
        pos = from_pl_position_info(((pl or {}).get('info') or {}).get('positionInfo')) or from_coarse((fd_player or {}).get('position'), (element or {}).get('element_type'))
        # 기록은 다른 리그와 같은 기준(API-Football 기록·평점)
        stats = match_api_stats(name, dob, merger.api_by_birth)
        merger.report['stats' if stats else 'noStats'] += 1
        merger.add_player(
            id=f"p{element['code']}" if element else f"fd{fd_player['id']}", name=name, age=age_on(dob, self.season_start),
            nationality=merger.nationality(nat_name), teamId=team_id, leagueId='epl', pos=pos,
            source='api' if stats else None, stats=stats, share=merger.share(stats, 38 + played),
        )

    def add_team_players(self, merger, fd_team, team_id, played):
        fpl_team = self.team_by_short.get(FPL_TLA_ALIAS.get(fd_team['tla'], fd_team['tla']))
        if not fpl_team:
            raise SystemExit(f"FPL에서 팀을 찾지 못함: {fd_team['tla']} — FPL_TLA_ALIAS에 추가")
        self.fpl_team_to_ours[fpl_team] = team_id
        self.played[team_id] = played
        for p in fd_team.get('squad') or []:
            e = self.match(p, fpl_team)
            if e:
                self.used.add(e['id'])
            merger.report['fplMatched' if e else 'fdOnly'] += 1
            self.pending.append((p, e, team_id, played))

    def add_fpl_only(self, merger, league_id):
        # 소속은 FPL(실시간 반영) 우선이므로 팀 매핑이 모두 끝난 뒤에 기록을 만든다
        for p, e, team_id, played in self.pending:
            self.record(merger, fd_player=p, element=e, team_id=team_id, played=played)
        for e in self.active:
            if e['id'] in self.used or e['team'] not in self.fpl_team_to_ours:
                continue
            self.used.add(e['id'])
            merger.report['fplOnly'] += 1
            team_id = self.fpl_team_to_ours[e['team']]
            self.record(merger, fd_player=None, element=e, team_id=team_id, played=self.played[team_id])


# ── 출력 ──────────────────────────────────────────────

def list_json(key, items):
    lines = ',\n'.join('    ' + json.dumps(it, ensure_ascii=False, separators=(',', ':')) for it in items)
    return f'{{\n  "schemaVersion": {SCHEMA_VERSION},\n  "{key}": [\n{lines}\n  ]\n}}\n'


def main():
    m = Merger()
    for cfg in m.sources['leagues']:
        progress(f"{cfg['name']}")
        entry = m.build_fd_league(cfg) if cfg['source'] == 'football-data' else m.build_api_league(cfg)
        if entry:
            m.leagues.append(entry)

    m.build_guests()
    if m.nations.unknown:
        sys.exit('모르는 국가명 (tools/nations.json에 별칭 추가 필요): ' + ', '.join(f'{k}({v})' for k, v in m.nations.unknown.most_common()))
    m.finish()

    league_ids = {l['id'] for l in m.leagues}
    for l in m.leagues:  # 데이터에 없는 리그를 가리키는 승강 정보는 뺀다
        for key in ('promotion', 'relegation'):
            if key in l and l[key]['league'] not in league_ids:
                del l[key]

    order = {l['id']: i for i, l in enumerate(m.leagues)}
    team_order = {t['id']: i for i, t in enumerate(sorted(m.teams, key=lambda t: (order.get(t['leagueId'], len(order)), t['name'])))}
    m.records.sort(key=lambda r: (team_order[r['teamId']], POSITION_ORDER.index(r['position']), -r['quality']))
    players = [
        {'id': r['id'], 'name': r['name'], 'age': r['age'], 'nationality': r['nationality'], 'position': r['position'], 'altPositions': r['alt'],
         'teamId': r['teamId'], 'attributes': r['attributes']}
        for r in m.records
    ]
    teams = sorted(m.teams, key=lambda t: team_order[t['id']])
    for l in m.leagues:
        l['teamIds'].sort(key=lambda tid: team_order[tid])

    DATA.mkdir(exist_ok=True)
    write_json(DATA / 'leagues.json', {'schemaVersion': SCHEMA_VERSION, 'leagues': m.leagues}, pretty=True)
    write_json(DATA / 'teams.json', {'schemaVersion': SCHEMA_VERSION, 'teams': teams}, pretty=True)
    (DATA / 'nations.json').write_text(list_json('nations', sorted(m.nations.used.values(), key=lambda n: n['code'])), encoding='utf-8')
    (DATA / 'players.json').write_text(list_json('players', players), encoding='utf-8')
    comps = build_competitions(m)
    if comps:
        q = {k: v for k, v in m.sources['competitions'].get('qualification', {}).items() if not k.startswith('_')}
        write_json(DATA / 'competitions.json', {'schemaVersion': 1, 'eligibleLeagues': m.sources['competitions']['eligibleLeagues'], 'competitions': comps, 'qualification': q}, pretty=True)
    old = DATA / 'league.json'
    if old.exists():
        old.unlink()  # schemaVersion 1 파일

    # ── 요약 ──
    progress(f'\n리그 {len(m.leagues)}개, 팀 {len(teams)}개, 선수 {len(players)}명, 국적 {len(m.nations.used)}개')
    rep = m.report
    total = rep['stats'] + rep['noStats']
    progress(f"  EPL: FPL 매칭 {rep['fplMatched']}, football-data만 {rep['fdOnly']}, FPL만 추가 {rep['fplOnly']} (정보 부족 제외 {rep['fplOnlySkipped']})")
    progress(f"  API-Football 기록 매칭 {rep['stats']}/{total}명" + (f" ({rep['stats'] * 100 // total}%)" if total else '') +
             f" · 국적 미상→리그 국가로 대체 {rep['defaultNationality']}명 · 라인업 기준 포지션 {rep['lineupPositions']}명 · 팀 내 균형 배정 포지션 {rep['groupAssigned']}명"
             f" · 제외: 나이 범위 밖 {rep['skippedAge']}명, 중복 등록 {rep['skippedDuplicate']}명 · 이적생 팀 기본값 혼합 {rep['blendedBase']}명")
    by_team = defaultdict(list)
    for r in m.records:
        by_team[r['teamId']].append(r['quality'])
    progress('\n  리그           팀  선수  상위11 품질 (최고 / 최저 팀)')
    for l in m.leagues:
        tops = sorted(((sum(sorted(by_team[t], reverse=True)[:11]) / max(1, min(11, len(by_team[t]))), t) for t in l['teamIds']), reverse=True)
        n = sum(len(by_team[t]) for t in l['teamIds'])
        progress(f"  {l['name'][:14]:14} {len(l['teamIds']):3} {n:5}   {tops[0][0]:5.1f} {tops[0][1]}  /  {tops[-1][0]:5.1f} {tops[-1][1]}")
    top_bonus = sorted(m.team_bonus.items(), key=lambda x: -x[1])[:8]
    progress('  대륙 대회 보정 상위: ' + ', '.join(f'{tid} +{v:.1f}' for tid, v in top_bonus))
    for msg in m.missing:
        progress(f'  누락: {msg}')

    progress('\n검증')
    sys.exit(subprocess.call(['node', str(TOOLS / 'validate-data.mjs')], cwd=ROOT))


if __name__ == '__main__':
    main()
