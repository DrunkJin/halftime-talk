// 팀 배지: assets/logos/의 로고, 없거나 못 불러오면 팀 컬러 원형 배지
import { h } from './dom.js';

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const readableText = (hex) => (luminance(hex) > 0.4 ? '#111111' : '#ffffff');

// 어두운 배경 위 점·막대에 쓸 팀 색. 주 색이 너무 어두우면(토트넘 남색, 뉴캐슬 검정) 보조 색
export function teamAccent(team) {
  const { primary, secondary } = team.colors;
  if (luminance(primary) >= 0.05) return primary;
  return luminance(secondary) >= 0.05 ? secondary : '#c8ced8';
}

export function teamBadge(team, size = 24) {
  const wrap = h('span', { class: 'badge', style: { '--size': `${size}px` }, title: team.name });
  const circle = h(
    'span',
    {
      class: 'badge-circle',
      style: { background: team.colors.primary, borderColor: team.colors.secondary, color: readableText(team.colors.primary) },
    },
    team.code,
  );
  if (team.logo) {
    const img = h('img', { src: `assets/logos/${team.logo}`, alt: '', loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', () => wrap.replaceChildren(circle), { once: true });
    wrap.append(img);
  } else {
    wrap.append(circle);
  }
  return wrap;
}
