// 커리어 카드 이미지 (1080×1350 PNG): 칭호·등급·통산 기록·트로피·순위 흐름·팬 한마디를 한 장에 그려 내려받는다
import { teamAccent } from './badge.js';
import { ordinal } from './format.js';
import { t } from '../i18n.js';

const W = 1080;
const H = 1350;
const FONT = '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif';
const C = { bg: '#0b0e12', panel: '#141920', line: '#2e3844', text: '#e7eaf0', text2: '#b4bcc8', muted: '#8d97a5', accent: '#3ddc97', gold: '#ffd166', actual: '#22a874', expected: '#7a6fd6' };

const loadImage = (src) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });

// 줄바꿈: 폭에 맞춰 글자 단위로 (한글은 공백이 적어 단어 단위로는 넘친다)
function wrapText(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const ch of text) {
    if (ctx.measureText(line + ch).width > maxWidth && line) {
      // 가능하면 마지막 공백에서 끊는다
      const cut = line.lastIndexOf(' ');
      if (cut > line.length * 0.6) {
        lines.push(line.slice(0, cut));
        line = line.slice(cut + 1) + ch;
      } else {
        lines.push(line);
        line = ch;
      }
    } else line += ch;
  }
  if (line) lines.push(line);
  return lines;
}

function draw(ctx, { review: r, title, team, quote }, logo) {
  const accent = teamAccent(team);
  // 배경: 어두운 바탕에 팀 색이 왼쪽 위에서 번진다
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 900);
  glow.addColorStop(0, `${accent}55`);
  glow.addColorStop(1, `${accent}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  const x0 = 80;
  let y = 110;
  ctx.fillStyle = C.muted;
  ctx.font = `600 26px ${FONT}`;
  ctx.fillText(t('components.card.header'), x0, y);

  // 로고 + 팀·기간
  y += 60;
  if (logo) ctx.drawImage(logo, x0, y, 120, 120 * (logo.height / logo.width || 1));
  const first = r.seasons[0];
  const last = r.seasons.at(-1);
  ctx.fillStyle = C.text;
  ctx.font = `700 40px ${FONT}`;
  ctx.fillText(team.name, x0 + 150, y + 50);
  ctx.fillStyle = C.text2;
  ctx.font = `500 28px ${FONT}`;
  ctx.fillText(`${first.season}${last !== first ? ` ~ ${last.season}` : ''} · ${t('components.card.seasons', { n: r.seasons.length })}`, x0 + 150, y + 96);

  // 칭호 + 등급
  y += 230;
  ctx.fillStyle = C.text;
  ctx.font = `800 84px ${FONT}`;
  ctx.fillText(title.label, x0, y);
  ctx.textAlign = 'right';
  ctx.fillStyle = r.grade === 'S' ? C.gold : C.accent;
  ctx.font = `900 150px ${FONT}`;
  ctx.fillText(r.grade, W - x0, y + 10);
  ctx.fillStyle = C.muted;
  ctx.font = `600 28px ${FONT}`;
  ctx.fillText(t('components.card.score', { score: r.score }), W - x0, y + 52);
  ctx.textAlign = 'left';
  if (title.summary) {
    ctx.fillStyle = C.text2;
    ctx.font = `500 30px ${FONT}`;
    ctx.fillText(title.summary, x0, y + 56);
  }

  // 통산 기록 4칸
  y += 130;
  const cells = [
    [t('components.card.played'), `${r.totals.played}`, t('components.card.record', { w: r.totals.won, d: r.totals.drawn, l: r.totals.lost })],
    [t('components.card.winRate'), `${Math.round(r.totals.winRate * 100)}%`, t('components.card.goals', { gf: r.totals.goalsFor, ga: r.totals.goalsAgainst })],
    [t('components.card.trophies'), `${r.totals.trophies.length}`, r.counts.promotions ? t('components.card.promotions', { n: r.counts.promotions }) : ''],
    [t('components.card.bestFinish'), r.totals.bestFinish ? ordinal(r.totals.bestFinish.position) : '—', r.totals.bestFinish?.season ?? ''],
  ];
  const cw = (W - x0 * 2) / 4;
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, y - 10);
  ctx.lineTo(W - x0, y - 10);
  ctx.stroke();
  cells.forEach(([label, value, sub], i) => {
    const cx = x0 + cw * i;
    ctx.fillStyle = C.muted;
    ctx.font = `600 24px ${FONT}`;
    ctx.fillText(label, cx, y + 30);
    ctx.fillStyle = C.text;
    ctx.font = `800 54px ${FONT}`;
    ctx.fillText(value, cx, y + 92);
    ctx.fillStyle = C.text2;
    ctx.font = `500 22px ${FONT}`;
    ctx.fillText(sub, cx, y + 126);
  });

  // 트로피 목록 (최대 6개)
  y += 190;
  ctx.fillStyle = C.muted;
  ctx.font = `600 24px ${FONT}`;
  ctx.fillText(t('components.card.trophies'), x0, y);
  ctx.font = `600 30px ${FONT}`;
  const trophies = r.totals.trophies.slice(0, 6);
  if (!trophies.length) {
    ctx.fillStyle = C.text2;
    ctx.fillText(t(r.counts.promotions ? 'components.card.noTrophyPromoted' : 'components.card.noTrophy'), x0, y + 46);
  }
  trophies.forEach((tr, i) => {
    const tx = x0 + (i % 2) * ((W - x0 * 2) / 2);
    const ty = y + 46 + Math.floor(i / 2) * 44;
    ctx.fillStyle = C.gold;
    ctx.fillRect(tx, ty - 22, 8, 26);
    ctx.fillStyle = C.text;
    ctx.fillText(`${tr.season} ${tr.name}`, tx + 22, ty);
  });

  // 순위 흐름 (작은 꺾은선)
  y += 46 + Math.ceil(Math.max(1, trophies.length) / 2) * 44 + 40;
  const chartH = 170;
  const maxSize = Math.max(...r.seasons.map((s) => s.size));
  const n = r.seasons.length;
  const px = (i) => (n === 1 ? W / 2 : x0 + 20 + (i * (W - x0 * 2 - 40)) / (n - 1));
  const py = (pos) => y + 20 + ((pos - 1) * (chartH - 40)) / Math.max(1, maxSize - 1);
  ctx.fillStyle = C.muted;
  ctx.font = `600 24px ${FONT}`;
  ctx.fillText(t('components.card.finishes'), x0, y);
  ctx.lineWidth = 4;
  ctx.strokeStyle = C.actual;
  ctx.beginPath();
  r.seasons.forEach((s, i) => (i ? ctx.lineTo(px(i), py(s.position)) : ctx.moveTo(px(i), py(s.position))));
  ctx.stroke();
  r.seasons.forEach((s, i) => {
    ctx.fillStyle = s.trophies.length ? C.gold : C.actual;
    ctx.beginPath();
    ctx.arc(px(i), py(s.position), s.trophies.length ? 12 : 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = C.text;
    ctx.font = `700 24px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.fillText(ordinal(s.position), px(i), py(s.position) - 20);
    ctx.textAlign = 'left';
  });

  // 팬 한마디
  y += chartH + 40;
  ctx.fillStyle = C.panel;
  ctx.fillRect(x0, y, W - x0 * 2, 170);
  ctx.fillStyle = C.accent;
  ctx.font = `800 72px ${FONT}`;
  ctx.fillText('“', x0 + 24, y + 70);
  ctx.fillStyle = C.text;
  ctx.font = `500 30px ${FONT}`;
  wrapText(ctx, quote, W - x0 * 2 - 120)
    .slice(0, 3)
    .forEach((line, i) => ctx.fillText(line, x0 + 84, y + 52 + i * 42));
  ctx.fillStyle = C.muted;
  ctx.font = `600 22px ${FONT}`;
  ctx.fillText(t('components.card.fan'), x0 + 84, y + 152);

  // 맨 아래 한 줄: 통산 득점왕 · 기대 대비 · 최대 승리
  const foot = [
    r.topScorer ? t('components.card.topScorer', { name: r.topScorer.name, goals: r.topScorer.goals }) : null,
    t('components.card.vsExpected', { diff: `${r.avgOver > 0 ? '+' : ''}${r.avgOver.toFixed(1)}` }),
    r.bestWin ? t('components.card.bestWin', { gf: r.bestWin.gf, ga: r.bestWin.ga, opponent: r.bestWin.opponent }) : null,
  ].filter(Boolean);
  ctx.fillStyle = C.text2;
  ctx.font = `500 24px ${FONT}`;
  wrapText(ctx, foot.join('  ·  '), W - x0 * 2)
    .slice(0, 2)
    .forEach((line, i) => ctx.fillText(line, x0, y + 226 + i * 34));
}

export async function saveCareerCard(data) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const logo = data.team.logo ? await loadImage(`assets/logos/${data.team.logo}`) : null;
  draw(ctx, data, logo);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error(t('components.card.imageFailed'));
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `halftime-talk-${data.team.id}-career.png`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
