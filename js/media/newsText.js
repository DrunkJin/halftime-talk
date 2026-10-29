// 받은 편지함 문구 (data/news.json). 실패하면 null → 종류 이름만 보여준다
import { pickTalk } from './talks.js';

let newsPromise = null;

export function loadNewsText(baseUrl = 'data/') {
  newsPromise ??= fetch(`${baseUrl}news.json`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  return newsPromise;
}

// 메시지 → { from, title, body } (같은 메시지는 늘 같은 문장)
export function renderNews(text, msg) {
  const k = text?.kinds?.[msg.kind];
  const vars = { ...msg.vars, amount: msg.vars?.amount != null ? Number(msg.vars.amount).toFixed(1) : '' };
  if (!k) return { from: '', title: msg.kind, body: '' };
  return {
    from: pickTalk([k.from], msg.id, vars),
    title: pickTalk(k.title, `${msg.id}:t`, vars),
    body: pickTalk(k.body, `${msg.id}:b`, vars),
  };
}
