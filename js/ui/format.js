// 화면 표시용 이름·색상 규칙
import { localeTag, t } from '../i18n.js';

// 이름표 묶음: 키마다 getter로 그때그때 사전에서 읽는다 (사전은 부팅 뒤에 로드되므로)
const labels = (prefix, keys) =>
  Object.defineProperties({}, Object.fromEntries(keys.map((k) => [k, { get: () => t(`${prefix}.${k}`), enumerable: true }])));

// 포지션 전체 이름 (GK: 골키퍼 …)
export const POSITION_NAMES = labels('components.pos', ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST']);

export const ATTRIBUTE_LABELS = labels('components.attr', [
  'finishing', 'longShots', 'passing', 'crossing', 'dribbling', 'firstTouch', 'tackling', 'marking', 'heading',
  'vision', 'positioning', 'offTheBall', 'composure', 'workRate', 'pace', 'stamina', 'strength', 'agility',
  'gkReflexes', 'gkHandling', 'gkPositioning', 'gkDistribution',
]);

export const ATTRIBUTE_GROUP_LABELS = labels('components.attrGroup', ['technical', 'mental', 'physical', 'goalkeeping']);

// 능력치 색 단계 (FM처럼 높을수록 밝게)
export function attrClass(v) {
  if (v >= 85) return 'a5';
  if (v >= 75) return 'a4';
  if (v >= 65) return 'a3';
  if (v >= 50) return 'a2';
  return 'a1';
}

// 성 앞에 붙는 소사 (van de Ven, De Bruyne, dos Santos)
const SURNAME_PARTICLES = new Set(['van', 'von', 'de', 'der', 'den', 'da', 'das', 'do', 'dos', 'di', 'du', 'del', 'della', 'la', 'le', 'el', 'al', 'ten', 'ter', 'mac', 'st.']);

// 피치 칩처럼 좁은 곳에 쓸 이름: 성(마지막 단어 + 앞의 소사)
export function shortName(name) {
  const parts = name.split(' ');
  if (parts.length === 1) return name;
  let start = parts.length - 1;
  while (start > 1 && SURNAME_PARTICLES.has(parts[start - 1].toLowerCase())) start--;
  return parts.slice(start).join(' ');
}

export const fmt1 = (v) => v.toFixed(1);

// 순위 서수 (1위 / 1st). 언어의 서수 규칙(one·two·few·other)마다 사전에 형식이 있다
export const ordinal = (n) => t(`components.ordinal.${new Intl.PluralRules(localeTag(), { type: 'ordinal' }).select(n)}`, { n });
