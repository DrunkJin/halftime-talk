// 엔진·데이터 검증의 오류 문장. 사전이 없는 환경(Node 측정·검증 스크립트)에서는 t()가 키만 돌려주므로 값을 붙여 정보를 남긴다
import { t } from '../i18n.js';

export function tx(key, vars) {
  const s = t(key, vars);
  return s === key && vars ? `${key} ${JSON.stringify(vars)}` : s;
}
