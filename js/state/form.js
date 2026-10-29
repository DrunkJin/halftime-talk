// 선수 평점: 시즌 평균(playerStats.rSum / rN, 모든 대회)과 최근 폼(game.form, 최근 5경기 — 사용자 리그·대륙 대회 경기만 남긴다)
export const FORM_MATCHES = 5;
const round1 = (v) => Math.round(v * 10) / 10;

// 경기 결과의 평점을 쌓는다. keepForm: 최근 폼까지 남길지 (세이브 크기 때문에 우리 리그·우리 대륙 대회 경기만)
export function addRatings(game, result, { keepForm = false } = {}) {
  for (const [id, r] of Object.entries(result?.ratings ?? {})) {
    const s = (game.playerStats[id] ??= { goals: 0, assists: 0, apps: 0 });
    s.rSum = round1((s.rSum ?? 0) + r);
    s.rN = (s.rN ?? 0) + 1;
    if (!keepForm) continue;
    const f = ((game.form ??= {})[id] ??= []);
    f.push(r);
    if (f.length > FORM_MATCHES) f.shift();
  }
}

// 이번 시즌 평균 평점 (없으면 null)
export function seasonRating(game, id) {
  const s = game.playerStats?.[id];
  return s?.rN ? s.rSum / s.rN : null;
}

// 최근 평점 목록 (오래된 것부터)
export const formOf = (game, id) => game.form?.[id] ?? [];

// 최근 폼 평균 (없으면 null)
export function formAverage(game, id) {
  const f = formOf(game, id);
  return f.length ? f.reduce((s, v) => s + v, 0) / f.length : null;
}

// 평점 색 등급 (화면용)
export const ratingClass = (r) => (r == null ? '' : r >= 7.5 ? 'rt-great' : r >= 7.0 ? 'rt-good' : r >= 6.3 ? 'rt-ok' : 'rt-poor');
