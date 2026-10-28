"""tools/ 파이썬 스크립트 공용: 경로, .env, 캐시, HTTP, 이름 정규화. 표준 라이브러리만 쓴다."""
import json
import os
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TOOLS = ROOT / 'tools'
CACHE = TOOLS / '.cache'
DATA = ROOT / 'data'
LOGOS = ROOT / 'assets' / 'logos'
USER_AGENT = 'Mozilla/5.0 (halftime-talk data tool)'


def load_env():
    """프로젝트 루트 .env의 KEY=VALUE를 환경변수로 (이미 있으면 덮어쓰지 않음)"""
    path = ROOT / '.env'
    if not path.exists():
        return
    for line in path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def require_env(name):
    load_env()
    value = os.environ.get(name)
    if not value:
        sys.exit(f'{name} 환경변수가 없습니다 (또는 프로젝트 루트 .env에 {name}=... 추가)')
    return value


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def write_json(path, data, pretty=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, ensure_ascii=False, indent=2 if pretty else None)
    path.write_text(text + ('\n' if pretty else ''), encoding='utf-8')


def load_sources():
    return read_json(TOOLS / 'sources.json')


class HttpError(Exception):
    def __init__(self, status, url, body=''):
        super().__init__(f'HTTP {status}: {url}')
        self.status = status
        self.body = body


def http_get(url, headers=None, retries=3, binary=False):
    """GET → (본문, 응답 헤더 dict). 429·5xx는 잠깐 쉬고 재시도"""
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, **(headers or {})})
    for attempt in range(1, retries + 1):
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                body = res.read()
                hdrs = {k.lower(): v for k, v in res.headers.items()}
                return (body if binary else json.loads(body.decode('utf-8'))), hdrs
        except urllib.error.HTTPError as e:
            if (e.code == 429 or e.code >= 500) and attempt < retries:
                wait = 15 * attempt
                print(f'  HTTP {e.code}, {wait}초 후 재시도: {url}')
                time.sleep(wait)
                continue
            raise HttpError(e.code, url, e.read().decode('utf-8', 'replace')) from None
        except urllib.error.URLError as e:
            if attempt < retries:
                time.sleep(5 * attempt)
                continue
            raise


class RateLimiter:
    """분당 요청 수 제한: 직전 요청과 최소 간격을 둔다"""

    def __init__(self, per_minute):
        self.interval = 60.0 / per_minute
        self.last = 0.0

    def wait(self):
        delay = self.last + self.interval - time.monotonic()
        if delay > 0:
            time.sleep(delay)
        self.last = time.monotonic()


def strip_accents(s):
    return ''.join(c for c in unicodedata.normalize('NFD', s) if unicodedata.category(c) != 'Mn')


def clean_team_name(name):
    """'Brighton & Hove Albion FC' → 'Brighton & Hove Albion'"""
    return re.sub(r'^(AFC|FC|SC|SSC|AC|AS|RC|CF|SV|VfB|VfL|TSG|1\. FC)\s+(?=\S{4,})|\s+(A?FC|CF|SC|SAD|AC)$', '', name.strip()).strip()


def slugify(name):
    s = strip_accents(name).lower()
    s = re.sub(r'[^a-z0-9]+', '-', s)
    return s.strip('-')


def team_id_from_name(name):
    """data/teams.json의 id이자 로고 파일명"""
    return slugify(clean_team_name(name))


def name_tokens(name):
    s = strip_accents(name or '').lower()
    s = re.sub(r"[^a-z\s'-]", ' ', s)
    return {t for t in re.split(r"[\s-]+", s) if len(t) > 1}


def progress(msg):
    print(msg, flush=True)
