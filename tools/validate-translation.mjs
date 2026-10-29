// 번역 검사: node tools/validate-translation.mjs <원문.json> <번역.json>
// 두 JSON의 구조(키·배열 길이·문장이 아닌 값)가 같은지, 한국어 문장이 번역됐는지(한글 없음),
// 문장의 {자리}가 원문과 같은지 확인한다. 한글이 없는 원문 값(id·성향·숫자)은 번역에서도 같아야 한다
import { readFileSync } from 'node:fs';

const [srcPath, dstPath] = process.argv.slice(2);
const src = JSON.parse(readFileSync(srcPath, 'utf8'));
const dst = JSON.parse(readFileSync(dstPath, 'utf8'));
const HANGUL = /[가-힣]/;
const slots = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
let errors = 0;
let texts = 0;
const err = (path, msg) => {
  if (++errors <= 60) console.log(`  ✗ ${path}: ${msg}`);
};

function walk(a, b, path) {
  if (typeof a === 'string') {
    if (typeof b !== 'string') return err(path, '문자열이 아님');
    if (!HANGUL.test(a)) return a === b || err(path, `원문과 달라짐 (${a} → ${b})`);
    texts++;
    if (HANGUL.test(b)) err(path, `한글이 남음 — ${b}`);
    if (!b.trim()) err(path, '빈 번역');
    if (slots(a) !== slots(b)) err(path, `자리 다름 {${slots(a)}} → {${slots(b)}} — ${b}`);
    return;
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b)) return err(path, '배열이 아님');
    if (a.length !== b.length) err(path, `길이 ${a.length} → ${b.length}`);
    a.forEach((x, i) => walk(x, b[i], `${path}[${i}]`));
    return;
  }
  if (a && typeof a === 'object') {
    if (!b || typeof b !== 'object') return err(path, '객체가 아님');
    for (const k of Object.keys(a)) if (!(k in b)) err(path, `키 없음 ${k}`);
    for (const k of Object.keys(b)) if (!(k in a)) err(path, `원문에 없는 키 ${k}`);
    for (const k of Object.keys(a)) if (k in b) walk(a[k], b[k], `${path}.${k}`);
    return;
  }
  if (a !== b) err(path, `값 다름 ${a} → ${b}`);
}

walk(src, dst, '$');
console.log(`문장 ${texts}개 · ${errors ? `오류 ${errors}건` : '검증 통과'}`);
process.exit(errors ? 1 : 0);
