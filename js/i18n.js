// 다국어: 화면 문구 사전과 언어 선택. 메인 스레드와 Web Worker가 같은 모듈을 쓴다.
// 사전: data/i18n/{언어}/{묶음}.json — { "키": "문장" } 또는 복수형 { "키": { "one": "...", "other": "..." } }
// 문장 안의 {이름}은 t(키, { 이름: 값 })으로 바뀐다. 한국어 조사는 지금처럼 '을(를)' 식으로 문장에 둔다.
// 긴 문구 데이터(인터뷰·소식·면담·이사회·커리어)는 한국어가 data/, 다른 언어가 data/{언어}/ 아래 같은 경로 (contentBase)

export const LANGS = { ko: '한국어', en: 'English' };
const FALLBACK = 'ko';
const STORE_KEY = 'ht-lang';
// 화면·모듈별 사전 묶음 (data/i18n/{언어}/{묶음}.json)
export const NAMESPACES = [
  'common', 'app', 'select', 'squad', 'match', 'tactics', 'analysis', 'schedule', 'training', 'table', 'cups',
  'transfers', 'finance', 'history', 'career', 'inbox', 'components', 'board', 'engine', 'commentary', 'market', 'state', 'media',
];

let current = FALLBACK;
let dict = {};
let fallback = {};

// 주소의 ?lang= → 지난번 고른 언어 → 브라우저 언어 (한국어가 아니면 영어)
export function detectLang() {
  const ok = (l) => (l && LANGS[l] ? l : null);
  let fromUrl = null;
  let saved = null;
  try {
    fromUrl = ok(new URLSearchParams(location.search).get('lang'));
    saved = ok(localStorage.getItem(STORE_KEY));
  } catch {
    // 저장소를 못 쓰는 환경 (사생활 보호 모드 등)
  }
  const nav = typeof navigator !== 'undefined' ? navigator.language ?? '' : '';
  return fromUrl ?? saved ?? (nav.toLowerCase().startsWith('ko') ? 'ko' : 'en');
}

export function rememberLang(lang) {
  try {
    localStorage.setItem(STORE_KEY, lang);
  } catch {
    // 저장 못 해도 이번 접속에서는 그 언어로 보인다
  }
}

async function loadDict(lang, baseUrl) {
  const parts = await Promise.all(
    NAMESPACES.map((ns) =>
      fetch(`${baseUrl}i18n/${lang}/${ns}.json`)
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({})),
    ),
  );
  return Object.assign({}, ...parts);
}

// 사전 불러오기. 빠진 키는 한국어로 보인다 (영어 화면 한글 누출 검사로 찾는다)
export async function loadLang(lang, baseUrl = 'data/') {
  current = LANGS[lang] ? lang : FALLBACK;
  const [main, base] = await Promise.all([loadDict(current, baseUrl), current === FALLBACK ? null : loadDict(FALLBACK, baseUrl)]);
  dict = main;
  fallback = base ?? main;
  return current;
}

export const getLang = () => current;
// 날짜·숫자 표기용
export const localeTag = () => (current === 'ko' ? 'ko-KR' : 'en-GB');
// 긴 문구 데이터의 경로
export const contentBase = (baseUrl = 'data/') => (current === FALLBACK ? baseUrl : `${baseUrl}${current}/`);

const fill = (text, vars) => (vars ? text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m) + '') : text);

export function t(key, vars) {
  let s = dict[key] ?? fallback[key];
  if (s == null) return key;
  if (typeof s === 'object') s = vars?.n === 1 ? (s.one ?? s.other) : s.other;
  return fill(s, vars);
}

// 문장 목록 (중계처럼 여러 문장 중 하나를 고르는 곳). 없으면 빈 배열
export function tList(key) {
  const v = dict[key] ?? fallback[key];
  return Array.isArray(v) ? v : [];
}
