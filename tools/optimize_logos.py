"""팀 로고 PNG → WebP 변환 (용량 줄이기)

화면에서 로고는 최대 72px로 보인다 → 2배 해상도 화면까지 고려해 긴 변 144px로 줄여 WebP로 저장하고 PNG는 지운다.
data/teams.json의 logo 파일명도 .webp로 바꾼다. 다음 merge.py도 logo_file()이 .webp를 먼저 찾는다.

사용법: python3 tools/optimize_logos.py   (cwebp 필요: brew install webp)
"""
import shutil
import subprocess

from common import LOGOS, ROOT, progress, read_json, write_json

MAX_SIZE = 144
QUALITY = 85


def png_size(path):
    """PNG 헤더에서 (가로, 세로)"""
    with open(path, 'rb') as f:
        head = f.read(24)
    return int.from_bytes(head[16:20], 'big'), int.from_bytes(head[20:24], 'big')


def convert(png):
    webp = png.with_suffix('.webp')
    w, h = png_size(png)
    resize = ['-resize', str(MAX_SIZE), '0'] if w >= h and w > MAX_SIZE else ['-resize', '0', str(MAX_SIZE)] if h > MAX_SIZE else []
    subprocess.run(['cwebp', '-quiet', '-q', str(QUALITY), '-alpha_q', '100', *resize, str(png), '-o', str(webp)], check=True)
    png.unlink()
    return webp


def main():
    if not shutil.which('cwebp'):
        raise SystemExit('cwebp가 없습니다 (brew install webp)')
    pngs = sorted(LOGOS.glob('*.png'))
    before = sum(p.stat().st_size for p in pngs)
    after = sum(convert(p).stat().st_size for p in pngs)
    progress(f'로고 {len(pngs)}개: {before / 1e6:.1f}MB → {after / 1e6:.1f}MB')

    teams_path = ROOT / 'data' / 'teams.json'
    data = read_json(teams_path)
    changed = 0
    for team in data['teams']:
        logo = team.get('logo')
        if logo and logo.endswith('.png') and (LOGOS / logo).with_suffix('.webp').exists():
            team['logo'] = logo[:-4] + '.webp'
            changed += 1
    write_json(teams_path, data, pretty=True)
    progress(f'teams.json 로고 파일명 {changed}개 변경')


if __name__ == '__main__':
    main()
