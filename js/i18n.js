// 다국어: 화면 문구 사전과 언어 선택. 메인 스레드와 Web Worker가 같은 모듈을 쓴다.
// 사전: data/i18n/{언어}/{묶음}.json — { "키": "문장" } 또는 복수형 { "키": { "one": "...", "other": "..." } }
// 문장 안의 {이름}은 t(키, { 이름: 값 })으로 바뀐다. 한국어 조사는 '을(를)' 식으로 문장에 두면 josa()가 앞 단어에 맞게 고른다.
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

const fill = (text, vars) => (vars ? josa(text.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m) + '')) : text);

// 한국어 조사 '이(가)'·'을(를)'·'은(는)'·'과(와)'·'와(과)'·'(으)로'를 앞 단어 끝소리에 맞게 하나로 고른다.
// 한글은 받침으로 판단. 로마자 이름은 끝 글자로 어림한다: m·n·l·ng로 끝나면 받침이 있다고 본다
// (Kane처럼 끝의 묵음 e는 빼고 본다. Rice·Haaland처럼 '-스·-드'로 읽히는 끝은 받침 없음). 숫자는 한국어 읽기로, 대문자 약어는 알파벳 이름으로
const JOSA = { '이(가)': ['이', '가'], '을(를)': ['을', '를'], '은(는)': ['은', '는'], '과(와)': ['과', '와'], '와(과)': ['과', '와'], '(으)로': ['으로', '로'] };
const DIGIT_FINAL = { 0: 'ㅇ', 1: 'ㄹ', 3: 'ㅁ', 6: 'ㄱ', 7: 'ㄹ', 8: 'ㄹ' }; // 받침 있는 숫자 (영·일·삼·육·칠·팔)
function finalSound(word) {
  const ch = word.at(-1);
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const jong = (code - 0xac00) % 28;
    return jong === 0 ? '' : jong === 8 ? 'ㄹ' : 'x';
  }
  if (/[0-9]/.test(ch)) return DIGIT_FINAL[ch] ?? '';
  // 대문자 약어(포지션 AM·RB, 팀 약칭 PSG)는 알파벳 이름으로 읽는다: L·R은 ㄹ, M·N은 받침
  if (/^[A-Z]{1,4}$/.test(word)) return /[LR]$/.test(word) ? 'ㄹ' : /[MN]$/.test(word) ? 'x' : '';
  let w = word.toLowerCase().replace(/[^a-z]/g, '');
  if (w.length > 2 && w.endsWith('e') && !/[aeiouy]/.test(w.at(-2))) w = w.slice(0, -1);
  if (w.endsWith('l')) return 'ㄹ';
  return /(m|n|ng)$/.test(w) ? 'x' : '';
}
export function josa(text) {
  if (!text.includes('(')) return text;
  return text.replace(/([\p{L}\p{N}.'’-]+)(이\(가\)|을\(를\)|은\(는\)|과\(와\)|와\(과\)|\(으\)로)/gu, (_, word, mark) => {
    const f = finalSound(word);
    const [withFinal, without] = JOSA[mark];
    return word + (mark === '(으)로' ? (f && f !== 'ㄹ' ? withFinal : without) : f ? withFinal : without);
  });
}

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
