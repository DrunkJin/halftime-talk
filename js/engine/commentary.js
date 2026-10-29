// 경기 중계 문구. 선수·팀 이름이 영어라 이/가·을/를 같은 조사가 붙지 않는 문장으로 쓴다.
// 문구 선택은 경기 결과와 별개의 난수(textRng)를 써서, 문구를 바꿔도 경기 결과는 그대로다.
// 문장 풀은 사전(data/i18n/{언어}/commentary.json)의 배열: "commentary.{종류}": ["...", ...]
import { t, tList } from '../i18n.js';

const fill = (template, vars) => template.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

// shotType: open | long | header | big
export function shotPhrase(shotType, shooterName) {
  return fill(t(`commentary.shot.${shotType}`), { shooter: shooterName });
}

export function commentText(type, vars, textRng) {
  const pool = tList(`commentary.${type}`);
  // 사전이 없을 때(Node 측정 스크립트)도 textRng를 똑같이 한 번 쓴다
  return fill(textRng.pick(pool.length ? pool : [`commentary.${type}`]), vars);
}
