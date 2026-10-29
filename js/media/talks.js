// 선수 면담 대사 (data/talks.json). 실패하면 null → 대사 없이 결과만 보여준다
let talksPromise = null;

export function loadTalks(baseUrl = 'data/') {
  talksPromise ??= fetch(`${baseUrl}talks.json`)
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  return talksPromise;
}

// 목록에서 하나 (seed가 같으면 같은 문장) + 자리표시자 채우기
export function pickTalk(list, seed, vars = {}) {
  if (!list?.length) return '';
  let hsh = 0;
  for (const ch of String(seed)) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
  return list[hsh % list.length].replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}
