// 받은 편지함 문구 (data/news.json). 실패하면 null → 종류 이름만 보여준다
import { injuryLabel as engineInjuryLabel } from '../engine/config.js';
import { contentBase, t, getLang } from '../i18n.js';
import { objectiveLabel } from '../state/boardConfig.js';
import { VERDICT_LABELS } from '../state/scouting.js';
import { pickTalk } from './talks.js';

let newsPromise = null;

export function loadNewsText(baseUrl = 'data/') {
  newsPromise ??= fetch(`${contentBase(baseUrl)}news.json`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  return newsPromise;
}

// 저장된 데이터 → 지금 언어의 라벨 (state/inbox.js 참고). 예전 세이브의 문자열 vars는 그대로 쓴다
function labelVars(msg) {
  const v = msg.vars ?? {};
  const out = {};
  if (v.goalKind) out.goal = objectiveLabel({ kind: v.goalKind, target: v.goalTarget ?? v.target });
  if (v.verdictKey) out.verdict = VERDICT_LABELS[v.verdictKey] ?? '';
  if (v.injuryKey) out.injury = t(v.injuryKey);
  else if (v.injury) out.injury = engineInjuryLabel(v.injury); // 경기 부상은 엔진 표의 이름으로 저장된다
  if (v.rivalryEn && getLang() !== 'ko') out.rivalry = v.rivalryEn;
  // 무소속 (구단 자리가 null)
  for (const k of ['from', 'to', 'club']) if (k in v && v[k] === null && msg.kind.startsWith('transfer.')) out[k] = t('media.news.freeAgent');
  return out;
}

// 메시지 → { from, title, body } (같은 메시지는 늘 같은 문장)
export function renderNews(text, msg) {
  const k = text?.kinds?.[msg.kind];
  const vars = { ...msg.vars, ...labelVars(msg), amount: msg.vars?.amount != null ? Number(msg.vars.amount).toFixed(1) : '' };
  if (!k) return { from: '', title: msg.kind, body: '' };
  return {
    from: pickTalk([k.from], msg.id, vars),
    title: pickTalk(k.title, `${msg.id}:t`, vars),
    body: pickTalk(k.body, `${msg.id}:b`, vars),
  };
}
