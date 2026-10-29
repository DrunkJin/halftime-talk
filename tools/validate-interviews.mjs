// 인터뷰 문구 데이터 검증: node tools/validate-interviews.mjs [pre|post|talk]
// 상황 누락, 성향별 최소 수량, 허용되지 않은 {자리}, 자리 바로 뒤 조사, 중복 문장을 검사한다
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INTERVIEW_SCHEMA_VERSION, MIN_COUNTS, PLACEHOLDERS, SITUATIONS, STANCES, allowedPlaceholders } from '../js/media/situations.js';

const DIR = process.env.INTERVIEW_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '../data/interviews'); // 합치기 전 검사용으로 바꿀 수 있다
const kinds = process.argv[2] ? [process.argv[2]] : Object.keys(SITUATIONS);
// 자리 바로 뒤에 오면 안 되는 조사 (받침에 따라 달라지는 것)
const JOSA = /\}(을|를|이|가|은|는|과|와|으로|로|이라|라|이랑|랑|아|야)(?![가-힣])/;
let errors = 0;
const err = (m) => {
  errors++;
  console.log('  ✗', m);
};

for (const kind of kinds) {
  let data;
  try {
    data = JSON.parse(readFileSync(join(DIR, `${kind}.json`), 'utf8'));
  } catch (e) {
    err(`${kind}.json 읽기 실패: ${e.message}`);
    continue;
  }
  console.log(`\n[${kind}]`);
  if (data.schemaVersion !== INTERVIEW_SCHEMA_VERSION || data.kind !== kind) err('schemaVersion/kind 불일치');
  const seen = new Set();
  let total = 0;
  for (const id of Object.keys(data.situations ?? {})) if (!SITUATIONS[kind][id]) err(`알 수 없는 상황 ${id}`);
  for (const id of Object.keys(SITUATIONS[kind])) {
    const s = data.situations?.[id];
    if (!s) {
      err(`${id}: 없음`);
      continue;
    }
    const allowed = allowedPlaceholders(kind, id);
    const check = (text, where) => {
      if (typeof text !== 'string' || !text.trim()) return err(`${id} ${where}: 빈 문자열`);
      for (const [, name] of text.matchAll(/\{([^}]*)\}/g)) {
        if (!PLACEHOLDERS[name]) err(`${id} ${where}: 없는 자리 {${name}} — ${text}`);
        else if (!allowed.has(name)) err(`${id} ${where}: 이 상황에서 못 쓰는 자리 {${name}} — ${text}`);
      }
      if (JOSA.test(text)) err(`${id} ${where}: 자리 뒤 조사 — ${text}`);
      if (seen.has(text)) err(`${id} ${where}: 중복 — ${text}`);
      seen.add(text);
    };
    if ((s.questions?.length ?? 0) < MIN_COUNTS.questionsPerSituation) err(`${id}: 질문 ${s.questions?.length ?? 0}개 (최소 ${MIN_COUNTS.questionsPerSituation})`);
    (s.questions ?? []).forEach((q, i) => {
      if (typeof q === 'string') return check(q, `질문${i}`);
      // 전용 답이 있는 질문: 성향마다 dedicatedPerStance개 이상
      check(q?.text, `질문${i}`);
      const n = Object.fromEntries(Object.keys(STANCES[kind]).map((k) => [k, 0]));
      for (const [j, a] of (q?.answers ?? []).entries()) {
        if (!(a.stance in n)) err(`${id} 질문${i} 답${j}: 알 수 없는 성향 ${a.stance}`);
        else n[a.stance]++;
        check(a.text, `질문${i} 답${j}`);
      }
      for (const [k, c] of Object.entries(n)) if (c < MIN_COUNTS.dedicatedPerStance) err(`${id} 질문${i}: ${k} 전용 답 ${c}개 (최소 ${MIN_COUNTS.dedicatedPerStance})`);
    });
    const byStance = Object.fromEntries(Object.keys(STANCES[kind]).map((k) => [k, 0]));
    for (const [i, a] of (s.answers ?? []).entries()) {
      if (!(a.stance in byStance)) err(`${id} 답${i}: 알 수 없는 성향 ${a.stance}`);
      else byStance[a.stance]++;
      check(a.text, `답${i}`);
      total++;
    }
    const minPer = SITUATIONS[kind][id].cup ? MIN_COUNTS.cupAnswersPerStance[kind] : MIN_COUNTS.answersPerStance[kind];
    for (const [k, n] of Object.entries(byStance)) if (n < minPer) err(`${id}: ${k} ${n}개 (최소 ${minPer})`);
  }
  console.log(`  답변 ${total}개 (최소 ${MIN_COUNTS.answersPerKind})`);
  if (total < MIN_COUNTS.answersPerKind) err(`${kind}: 답변 총 ${total}개`);
}
console.log(errors ? `\n오류 ${errors}건` : '\n검증 통과');
process.exit(errors ? 1 : 0);
