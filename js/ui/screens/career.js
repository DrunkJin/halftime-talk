// 감독 커리어 엔딩: 칭호·등급, 통산 기록, 트로피 진열장, 순위 그래프, 하이라이트, 마지막 한마디, 커리어 카드
import { createRng } from '../../engine/rng.js';
import { loadMedia, rivalryBetween } from '../../media/interviews.js';
import { formatMoney } from '../../market/value.js';
import { careerReview } from '../../state/career.js';
import { isSeasonOver } from '../../state/game.js';
import { teamBadge } from '../badge.js';
import { saveCareerCard } from '../careerCard.js';
import { h } from '../dom.js';
import { showToast } from '../motion.js';

let quotesPromise = null;
// data/career.json (칭호 이름·문구). 실패하면 null
export function loadCareerText() {
  quotesPromise ??= fetch('data/career.json')
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  return quotesPromise;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...children) => {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  el.append(...children.flat().filter((c) => c != null));
  return el;
};

const pct = (v) => `${Math.round(v * 100)}%`;
const signed = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
const fill = (text, vars) => text.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

// 트로피 아이콘 (SVG)
function trophyIcon(kind) {
  return svg(
    'svg',
    { viewBox: '0 0 24 24', class: `trophy-icon ${kind}`, 'aria-hidden': 'true' },
    svg('path', { d: 'M7 3h10v4a5 5 0 0 1-10 0V3Z', fill: 'currentColor' }),
    svg('path', { d: 'M7 5H4a3 3 0 0 0 3 4M17 5h3a3 3 0 0 1-3 4', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.6' }),
    svg('path', { d: 'M11 12h2v4h-2zM8 18h8v3H8z', fill: 'currentColor' }),
  );
}

// ── 순위 그래프: 실제 순위(실선) vs 시즌 전 예상(점선). 위가 1위 ──
// 글자 크기가 화면 폭에 따라 커지지 않도록 실제 너비로 그린다 (ResizeObserver)
// 리그가 바뀐 커리어(승강)는 위 리그 팀 수를 더한 '전체 서열'로 그린다: 1부 20위 아래에 2부 1위
// tiers: [{ leagueId, name, offset, size }] — 한 리그만이면 길이 1
function drawChart(seasons, tiers, W, show, hide) {
  const H = 240;
  const multi = tiers.length > 1;
  const pad = { l: multi ? 92 : 52, r: 24, t: 22, b: 48 };
  const inset = seasons.length > 1 ? 24 : 0; // 첫·끝 점을 축 글자에서 띄운다
  const offsetOf = (id) => tiers.find((t) => t.leagueId === id)?.offset ?? 0;
  const rank = (s, key) => (s[key] ? s[key] + offsetOf(s.leagueId) : null);
  const maxSize = Math.max(...tiers.map((t) => t.offset + t.size), ...seasons.map((s) => s.size));
  const n = seasons.length;
  const x = (i) => (n === 1 ? (pad.l + W - pad.r) / 2 : pad.l + inset + (i * (W - pad.l - pad.r - inset * 2)) / (n - 1));
  const y = (pos) => pad.t + ((pos - 1) * (H - pad.t - pad.b)) / Math.max(1, maxSize - 1);
  const ticks = multi ? [] : [1, Math.ceil(maxSize / 4), Math.ceil(maxSize / 2), Math.ceil((maxSize * 3) / 4), maxSize].filter((v, i, a) => a.indexOf(v) === i);
  // 좁은 화면에서는 시즌 라벨을 듬성듬성
  const every = Math.max(1, Math.ceil((n * 64) / Math.max(1, W - pad.l - pad.r)));

  const grid = ticks.map((t) => svg('g', {}, svg('line', { x1: pad.l, x2: W - pad.r, y1: y(t), y2: y(t), class: 'cc-grid' }), svg('text', { x: pad.l - 10, y: y(t) + 4, class: 'cc-axis', 'text-anchor': 'end' }, `${t}위`)));
  // 여러 리그: 리그 구간마다 경계선과 이름 (1위·꼴찌 자리)
  const bands = multi
    ? tiers.map((t, k) =>
        svg(
          'g',
          {},
          k % 2 ? svg('rect', { x: pad.l, y: y(t.offset + 0.5), width: W - pad.l - pad.r, height: y(t.offset + t.size + 0.5) - y(t.offset + 0.5), class: 'cc-band' }) : null,
          svg('line', { x1: pad.l, x2: W - pad.r, y1: y(t.offset + 1), y2: y(t.offset + 1), class: 'cc-grid' }),
          svg('text', { x: pad.l - 10, y: y(t.offset + 1) + 4, class: 'cc-axis cc-league', 'text-anchor': 'end' }, t.name),
          k === tiers.length - 1 ? svg('text', { x: pad.l - 10, y: y(t.offset + t.size) + 4, class: 'cc-axis', 'text-anchor': 'end' }, `${t.size}위`) : null,
        ),
      )
    : [];
  const path = (key) => seasons.map((s, i) => (s[key] ? `${i === 0 || !seasons[i - 1][key] ? 'M' : 'L'}${x(i)},${y(rank(s, key))}` : '')).join(' ');
  const xLabels = seasons.map((s, i) => {
    // 리그 이름은 한 리그일 때 첫 시즌 아래에만 (여러 리그면 왼쪽 구간 라벨이 대신한다)
    const leagueChanged = !multi && i === 0;
    if (i % every && i !== n - 1 && !leagueChanged) return null;
    return svg(
      'text',
      { x: x(i), y: H - pad.b + 20, class: 'cc-axis', 'text-anchor': 'middle' },
      svg('tspan', { x: x(i) }, s.season),
      leagueChanged ? svg('tspan', { x: x(i), dy: '15', class: 'cc-league' }, s.leagueName) : null,
    );
  });
  const points = seasons.map((s, i) => {
    // 순위 숫자는 예상 점 반대쪽에 (겹치지 않게)
    const below = s.expected && s.expected < s.position;
    const py = y(rank(s, 'position'));
    const g = svg(
      'g',
      { class: 'cc-point', tabindex: '0', role: 'img', 'aria-label': `${s.season} ${s.leagueName} ${s.position}위${s.expected ? `, 예상 ${s.expected}위` : ''}${s.trophies.length ? `, ${s.trophies.map((t) => t.name).join(', ')}` : ''}` },
      svg('circle', { cx: x(i), cy: py, r: 16, class: 'cc-hit' }),
      s.expected ? svg('circle', { cx: x(i), cy: y(rank(s, 'expected')), r: 4.5, class: 'cc-dot-expected' }) : null,
      s.trophies.length ? svg('circle', { cx: x(i), cy: py, r: 9, class: 'cc-dot-trophy' }) : null,
      svg('circle', { cx: x(i), cy: py, r: 5, class: 'cc-dot' }),
      svg('text', { x: x(i), y: py + (below ? 22 : -13), class: 'cc-label', 'text-anchor': 'middle' }, `${s.position}${s.promoted ? ' ▲' : s.relegated ? ' ▼' : ''}`),
    );
    const at = () => show(s, x(i) / W, py / H);
    g.addEventListener('pointerenter', at);
    g.addEventListener('pointerleave', hide);
    g.addEventListener('focus', at);
    g.addEventListener('blur', hide);
    return g;
  });
  return svg(
    'svg',
    { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'cc-svg', role: 'group', 'aria-label': '시즌별 리그 순위' },
    bands,
    grid,
    svg('path', { d: path('expected'), class: 'cc-line-expected' }),
    svg('path', { d: path('position'), class: 'cc-line' }),
    points,
    xLabels,
  );
}

function positionChart(seasons, tiers) {
  const wrap = h('div', { class: 'cc-chart' });
  const tip = h('div', { class: 'cc-tip', role: 'status' });
  const show = (s, fx, fy) => {
    tip.replaceChildren(
      ...[
        h('b', {}, `${s.season} · ${s.leagueName}`),
        h('span', {}, `${s.position}위${s.expected ? ` (예상 ${s.expected}위)` : ''} · 승점 ${s.points}`),
        s.trophies.length ? h('span', { class: 'gold' }, s.trophies.map((t) => t.name).join(', ')) : null,
        s.promoted ? h('span', {}, '승격') : s.relegated ? h('span', { class: 'down' }, '강등') : null,
      ].filter(Boolean),
    );
    tip.style.left = `${fx * 100}%`;
    tip.style.top = `${fy * 100}%`;
    tip.classList.add('is-shown');
  };
  const hide = () => tip.classList.remove('is-shown');
  let width = 0;
  const paint = () => {
    const w = Math.max(280, Math.round(wrap.clientWidth));
    if (w === width) return;
    width = w;
    wrap.replaceChildren(drawChart(seasons, tiers, w, show, hide), tip);
  };
  new ResizeObserver(paint).observe(wrap);
  const legend = h(
    'div',
    { class: 'cc-legend' },
    h('span', {}, h('i', { class: 'lg-actual' }), '실제 순위'),
    h('span', {}, h('i', { class: 'lg-expected' }), '시즌 전 예상 (전력 순위)'),
    seasons.some((s) => s.trophies.length) ? h('span', {}, h('i', { class: 'lg-trophy' }), '트로피 시즌') : null,
  );
  return h('div', {}, legend, wrap);
}

// 커리어에 나온 리그를 승강 순서로: 같은 피라미드(승강으로 이어진 리그)면 위 리그 팀 수만큼 아래로 민다.
// 서로 이어지지 않은 리그를 오갔다면(드문 경우) 각자 1위부터 겹쳐 그린다
function chartTiers(dataset, seasons) {
  const ids = [...new Set(seasons.map((s) => s.leagueId))];
  const sizeOf = (id) => seasons.find((s) => s.leagueId === id)?.size ?? dataset.leagueById.get(id)?.teamIds.length ?? 20;
  const offsetOf = (id) => {
    let offset = 0;
    let cur = dataset.leagueById.get(id);
    for (let guard = 0; cur?.promotion?.league && guard < 5; guard++) {
      const up = dataset.leagueById.get(cur.promotion.league);
      if (!up) break;
      offset += sizeOf(up.id);
      cur = up;
    }
    return offset;
  };
  const tiers = ids.map((id) => ({ leagueId: id, name: seasons.find((s) => s.leagueId === id).leagueName, offset: offsetOf(id), size: sizeOf(id) })).sort((a, b) => a.offset - b.offset);
  const connected = tiers.every((t, i) => i === 0 || t.offset > tiers[i - 1].offset);
  if (!connected || tiers.length === 1) return [{ ...tiers[0], offset: 0 }];
  const top = tiers[0].offset; // 가장 위 리그를 1위부터
  return tiers.map((t) => ({ ...t, offset: t.offset - top }));
}

// 표로도 볼 수 있게 (그래프와 같은 내용)
function seasonTable(seasons) {
  return h(
    'details',
    { class: 'cc-table' },
    h('summary', {}, '시즌별 표로 보기'),
    h(
      'div',
      { class: 'table-scroll' },
      h(
        'table',
        { class: 'data compact' },
        h('thead', {}, h('tr', {}, h('th', {}, '시즌'), h('th', {}, '리그'), h('th', { class: 'num' }, '순위'), h('th', { class: 'num' }, '예상'), h('th', { class: 'num' }, '승점'), h('th', {}, '비고'))),
        h(
          'tbody',
          {},
          seasons.map((s) =>
            h(
              'tr',
              {},
              h('td', {}, s.season),
              h('td', {}, s.leagueName),
              h('td', { class: 'num' }, `${s.position}위`),
              h('td', { class: 'num muted' }, s.expected ? `${s.expected}위` : '—'),
              h('td', { class: 'num' }, s.points),
              h('td', {}, [...s.trophies.map((t) => t.name), s.promoted ? '승격' : null, s.relegated ? '강등' : null].filter(Boolean).join(', ') || '—'),
            ),
          ),
        ),
      ),
    ),
  );
}

const fact = (label, value, sub) => h('div', { class: 'cc-fact' }, h('dt', {}, label), h('dd', {}, h('b', {}, value), sub ? h('span', { class: 'muted' }, sub) : null));

function highlights(r) {
  const items = [];
  const s = r.bestSeason;
  if (s) {
    const extra = s.trophies.filter((t) => t.kind !== 'league').map((t) => t.name);
    const won = s.trophies.some((t) => t.kind === 'league');
    items.push(fact('최고의 시즌', `${s.season} ${won ? '우승' : `${s.position}위`}`, `${s.leagueName}${s.expected ? ` · 예상 ${s.expected}위` : ''}${extra.length ? ` · ${extra.join(', ')}` : ''}${s.promoted ? ' · 승격' : ''}`));
  }
  if (r.topScorer) items.push(fact('통산 득점왕', r.topScorer.name, `${r.topScorer.goals}골${r.topScorer.apps ? ` · ${r.topScorer.apps}경기` : ''}`));
  if (r.mostApps) items.push(fact('최다 출전', r.mostApps.name, `${r.mostApps.apps}경기 ${r.mostApps.goals}골 ${r.mostApps.assists}도움`));
  if (r.assistKing && r.assistKing.name !== r.topScorer?.name && r.assistKing.name !== r.mostApps?.name) items.push(fact('도움왕', r.assistKing.name, `${r.assistKing.assists}도움`));
  if (r.bestSigning) items.push(fact('최고의 영입', r.bestSigning.name, `${r.bestSigning.fee ? formatMoney(r.bestSigning.fee) : '자유 계약'} · ${r.bestSigning.apps}경기 ${r.bestSigning.goals}골 ${r.bestSigning.assists}도움`));
  if (r.bestWin) items.push(fact('최대 점수 차 승리', `${r.bestWin.gf}-${r.bestWin.ga} ${r.bestWin.opponent}`, `${r.bestWin.season} · ${r.bestWin.comp ?? ''}${r.bestWin.home ? ' · 홈' : ' · 원정'}`));
  if (r.worstLoss) items.push(fact('가장 아팠던 패배', `${r.worstLoss.gf}-${r.worstLoss.ga} ${r.worstLoss.opponent}`, `${r.worstLoss.season} · ${r.worstLoss.comp ?? ''}`));
  if (r.bestStreak) items.push(fact('최장 연승', `${r.bestStreak.count}연승`, r.bestStreak.season));
  for (const rv of r.rivals.slice(0, 2)) items.push(fact(rv.rivalry.name, `${rv.w}승 ${rv.d}무 ${rv.l}패`, `상대 ${rv.name} · ${rv.gf}득 ${rv.ga}실`));
  return items.length ? h('dl', { class: 'cc-facts' }, items) : h('p', { class: 'muted' }, '아직 쌓인 기록이 많지 않습니다.');
}

export function render(ctx) {
  const host = h('div', { class: 'career-end' }, h('p', { class: 'muted' }, '커리어를 정리하는 중…'));
  Promise.all([loadCareerText(), loadMedia().catch(() => null)]).then(([text, media]) => {
    const { game, dataset } = ctx;
    if (!game?.history?.length) {
      host.replaceChildren(h('div', { class: 'panel empty' }, h('p', {}, '시즌을 마치면 커리어가 여기에 정리됩니다.')));
      return;
    }
    const r = careerReview(game, { rivalryOf: (a, b) => rivalryBetween(media, a, b) });
    const title = text?.titles?.[r.titleId] ?? { label: '감독', summary: '', board: [], fans: [], captain: [] };
    const team = dataset.teamById.get(game.teamId);
    const finished = isSeasonOver(game) && game.seasonIndex >= game.years;
    const first = r.seasons[0];
    const last = r.seasons.at(-1);
    const rng = createRng(`${game.seed}:ending:${game.seasonIndex}`);
    const vars = {
      team: team.shortName,
      seasons: r.seasons.length,
      trophies: r.totals.trophies.length,
      captain: r.mostApps?.name ?? '',
      scorer: r.topScorer?.name ?? '',
      best: r.bestSeason?.season ?? '',
      over: Math.max(0, r.avgOver).toFixed(1),
    };
    const pickLine = (list) => (list?.length ? fill(list[Math.floor(rng.next() * list.length)], vars) : '');

    const hero = h(
      'section',
      { class: 'cc-hero reveal', style: { '--i': 0, '--team': team.colors.primary } },
      teamBadge(team, 96),
      h(
        'div',
        { class: 'cc-hero-text' },
        h('h1', {}, title.label),
        h('p', { class: 'cc-sub' }, `${team.name} 감독 · ${first.season}${last !== first ? ` ~ ${last.season}` : ''} · ${r.seasons.length}시즌`),
        title.summary ? h('p', { class: 'muted' }, title.summary) : null,
      ),
      h('div', { class: `cc-grade grade-${r.grade}`, 'aria-label': `감독 평가 ${r.grade}등급, ${r.score}점` }, h('span', { class: 'cc-grade-letter' }, r.grade), h('span', { class: 'cc-grade-score' }, `${r.score}점`)),
    );

    const stats = h(
      'section',
      { class: 'cc-stats reveal', style: { '--i': 1 } },
      [
        ['경기', `${r.totals.played}`, `${r.totals.won}승 ${r.totals.drawn}무 ${r.totals.lost}패`],
        ['승률', pct(r.totals.winRate), `득 ${r.totals.goalsFor} · 실 ${r.totals.goalsAgainst}`],
        ['트로피', `${r.totals.trophies.length}개`, r.counts.promotions ? `승격 ${r.counts.promotions}회` : null],
        ['최고 순위', r.totals.bestFinish ? `${r.totals.bestFinish.position}위` : '—', r.totals.bestFinish ? `${r.totals.bestFinish.season} ${r.totals.bestFinish.leagueName}` : null],
        ['기대 대비', `${signed(r.avgOver)}위`, '시즌 평균 (+면 예상보다 위)'],
      ].map(([label, value, sub]) => h('div', { class: 'cc-stat' }, h('span', { class: 'muted' }, label), h('b', {}, value), sub ? h('span', { class: 'muted small-note' }, sub) : null)),
    );

    const cabinet = h(
      'section',
      { class: 'cc-section reveal', style: { '--i': 2 } },
      h('h2', {}, '트로피 진열장'),
      r.totals.trophies.length
        ? h('ul', { class: 'cc-trophies' }, r.totals.trophies.map((t) => h('li', { class: `cc-trophy ${t.kind}` }, trophyIcon(t.kind), h('b', {}, t.name), h('span', { class: 'muted' }, t.season))))
        : h('p', { class: 'muted' }, r.counts.promotions ? '트로피는 없었지만, 승격이라는 값진 결과를 남겼습니다.' : '진열장은 비어 있지만, 기록은 남았습니다.'),
    );

    const chart = h('section', { class: 'cc-section reveal', style: { '--i': 3 } }, h('h2', {}, '시즌별 리그 순위'), positionChart(r.seasons, chartTiers(dataset, r.seasons)), seasonTable(r.seasons));
    const facts = h('section', { class: 'cc-section reveal', style: { '--i': 4 } }, h('h2', {}, '하이라이트'), highlights(r));

    const quote = (who, line) => (line ? h('figure', { class: 'cc-quote' }, h('blockquote', {}, line), h('figcaption', {}, who)) : null);
    const quotes = h(
      'section',
      { class: 'cc-section reveal', style: { '--i': 5 } },
      h('h2', {}, '마지막 한마디'),
      h('div', { class: 'cc-quotes' }, quote('이사회', pickLine(title.board)), quote('팬', pickLine(title.fans)), quote(r.mostApps ? `${r.mostApps.name} (최다 출전)` : '주장', pickLine(title.captain))),
    );

    const card = h('button', { class: 'btn', type: 'button' }, '커리어 카드 저장');
    card.addEventListener('click', async () => {
      card.disabled = true;
      try {
        await saveCareerCard({ review: r, title, team, quote: pickLine(title.fans) });
        showToast('커리어 카드를 저장했습니다');
      } catch (err) {
        console.error(err);
        showToast('카드를 만들지 못했습니다', { tone: 'warn' });
      } finally {
        card.disabled = false;
      }
    });
    const more = h('button', { class: 'btn primary', type: 'button' }, '한 시즌 더 하기');
    more.addEventListener('click', () => {
      ctx.game.years = Math.max(ctx.game.years, ctx.game.seasonIndex) + 1;
      ctx.persist();
      ctx.refreshTopbar();
      ctx.navigate('match');
    });
    const fresh = h('button', { class: 'btn ghost', type: 'button' }, '새 게임');
    fresh.addEventListener('click', () => ctx.leaveToSelect());
    const back = h('button', { class: 'btn ghost', type: 'button' }, '기록으로');
    back.addEventListener('click', () => ctx.navigate('history'));
    const actions = h(
      'section',
      { class: 'cc-actions reveal', style: { '--i': 6 } },
      finished ? null : h('p', { class: 'muted' }, `아직 커리어가 진행 중입니다 (${game.seasonIndex}/${game.years}시즌). 지금까지의 기록으로 정리했습니다.`),
      h('div', { class: 'btn-row' }, back, card, finished ? fresh : null, finished ? more : null),
    );

    host.replaceChildren(hero, stats, cabinet, chart, facts, quotes, actions);
  });
  return host;
}
