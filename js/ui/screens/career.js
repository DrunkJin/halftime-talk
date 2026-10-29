// 감독 커리어 엔딩: 칭호·등급, 통산 기록, 트로피 진열장, 순위 그래프, 하이라이트, 마지막 한마디, 커리어 카드
import { contentBase, getLang, t } from '../../i18n.js';
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
  quotesPromise ??= fetch(`${contentBase()}career.json`)
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
// 라이벌 이름: 한국어면 name, 그 밖에는 nameEn (없으면 name)
const rivalryName = (rv) => (getLang() === 'ko' ? rv.name : rv.nameEn ?? rv.name);

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
  const offsetOf = (id) => tiers.find((tier) => tier.leagueId === id)?.offset ?? 0;
  const rank = (s, key) => (s[key] ? s[key] + offsetOf(s.leagueId) : null);
  const maxSize = Math.max(...tiers.map((tier) => tier.offset + tier.size), ...seasons.map((s) => s.size));
  const n = seasons.length;
  const x = (i) => (n === 1 ? (pad.l + W - pad.r) / 2 : pad.l + inset + (i * (W - pad.l - pad.r - inset * 2)) / (n - 1));
  const y = (pos) => pad.t + ((pos - 1) * (H - pad.t - pad.b)) / Math.max(1, maxSize - 1);
  const ticks = multi ? [] : [1, Math.ceil(maxSize / 4), Math.ceil(maxSize / 2), Math.ceil((maxSize * 3) / 4), maxSize].filter((v, i, a) => a.indexOf(v) === i);
  // 좁은 화면에서는 시즌 라벨을 듬성듬성
  const every = Math.max(1, Math.ceil((n * 64) / Math.max(1, W - pad.l - pad.r)));

  const grid = ticks.map((tick) => svg('g', {}, svg('line', { x1: pad.l, x2: W - pad.r, y1: y(tick), y2: y(tick), class: 'cc-grid' }), svg('text', { x: pad.l - 10, y: y(tick) + 4, class: 'cc-axis', 'text-anchor': 'end' }, t('career.pos', { n: tick }))));
  // 여러 리그: 리그 구간마다 경계선과 이름 (1위·꼴찌 자리)
  const bands = multi
    ? tiers.map((tier, k) =>
        svg(
          'g',
          {},
          k % 2 ? svg('rect', { x: pad.l, y: y(tier.offset + 0.5), width: W - pad.l - pad.r, height: y(tier.offset + tier.size + 0.5) - y(tier.offset + 0.5), class: 'cc-band' }) : null,
          svg('line', { x1: pad.l, x2: W - pad.r, y1: y(tier.offset + 1), y2: y(tier.offset + 1), class: 'cc-grid' }),
          svg('text', { x: pad.l - 10, y: y(tier.offset + 1) + 4, class: 'cc-axis cc-league', 'text-anchor': 'end' }, tier.name),
          k === tiers.length - 1 ? svg('text', { x: pad.l - 10, y: y(tier.offset + tier.size) + 4, class: 'cc-axis', 'text-anchor': 'end' }, t('career.pos', { n: tier.size })) : null,
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
      { class: 'cc-point', tabindex: '0', role: 'img', 'aria-label': [t('career.chart.pointLabel', { season: s.season, league: s.leagueName, pos: s.position }), s.expected ? t('career.chart.pointExpected', { n: s.expected }) : '', s.trophies.length ? `, ${s.trophies.map((x) => x.name).join(', ')}` : ''].join('') },
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
    { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'cc-svg', role: 'group', 'aria-label': t('career.chart.aria') },
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
        h('span', {}, s.expected ? t('career.tip.posExpected', { pos: s.position, exp: s.expected, pts: s.points }) : t('career.tip.pos', { pos: s.position, pts: s.points })),
        s.trophies.length ? h('span', { class: 'gold' }, s.trophies.map((x) => x.name).join(', ')) : null,
        s.promoted ? h('span', {}, t('career.promoted')) : s.relegated ? h('span', { class: 'down' }, t('career.relegated')) : null,
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
    h('span', {}, h('i', { class: 'lg-actual' }), t('career.legend.actual')),
    h('span', {}, h('i', { class: 'lg-expected' }), t('career.legend.expected')),
    seasons.some((s) => s.trophies.length) ? h('span', {}, h('i', { class: 'lg-trophy' }), t('career.legend.trophy')) : null,
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
  const connected = tiers.every((tier, i) => i === 0 || tier.offset > tiers[i - 1].offset);
  if (!connected || tiers.length === 1) return [{ ...tiers[0], offset: 0 }];
  const top = tiers[0].offset; // 가장 위 리그를 1위부터
  return tiers.map((tier) => ({ ...tier, offset: tier.offset - top }));
}

// 표로도 볼 수 있게 (그래프와 같은 내용)
function seasonTable(seasons) {
  return h(
    'details',
    { class: 'cc-table' },
    h('summary', {}, t('career.table.summary')),
    h(
      'div',
      { class: 'table-scroll' },
      h(
        'table',
        { class: 'data compact' },
        h('thead', {}, h('tr', {}, h('th', {}, t('career.th.season')), h('th', {}, t('career.th.league')), h('th', { class: 'num' }, t('career.th.pos')), h('th', { class: 'num' }, t('career.th.expected')), h('th', { class: 'num' }, t('career.th.pts')), h('th', {}, t('career.th.notes')))),
        h(
          'tbody',
          {},
          seasons.map((s) =>
            h(
              'tr',
              {},
              h('td', {}, s.season),
              h('td', {}, s.leagueName),
              h('td', { class: 'num' }, t('career.pos', { n: s.position })),
              h('td', { class: 'num muted' }, s.expected ? t('career.pos', { n: s.expected }) : '—'),
              h('td', { class: 'num' }, s.points),
              h('td', {}, [...s.trophies.map((x) => x.name), s.promoted ? t('career.promoted') : null, s.relegated ? t('career.relegated') : null].filter(Boolean).join(', ') || '—'),
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
    const extra = s.trophies.filter((x) => x.kind !== 'league').map((x) => x.name);
    const won = s.trophies.some((x) => x.kind === 'league');
    const sub = [s.leagueName, s.expected ? t('career.hl.expected', { n: s.expected }) : null, extra.join(', '), s.promoted ? t('career.promoted') : null].filter(Boolean).join(' · ');
    items.push(fact(t('career.hl.bestSeason'), `${s.season} ${won ? t('career.hl.champions') : t('career.pos', { n: s.position })}`, sub));
  }
  if (r.topScorer) items.push(fact(t('career.hl.topScorer'), r.topScorer.name, r.topScorer.apps ? t('career.hl.goalsApps', { g: r.topScorer.goals, apps: r.topScorer.apps }) : t('career.hl.goals', { n: r.topScorer.goals })));
  if (r.mostApps) items.push(fact(t('career.hl.mostApps'), r.mostApps.name, t('career.hl.line', { apps: r.mostApps.apps, g: r.mostApps.goals, a: r.mostApps.assists })));
  if (r.assistKing && r.assistKing.name !== r.topScorer?.name && r.assistKing.name !== r.mostApps?.name) items.push(fact(t('career.hl.assists'), r.assistKing.name, t('career.hl.assistCount', { n: r.assistKing.assists })));
  if (r.bestSigning) items.push(fact(t('career.hl.bestSigning'), r.bestSigning.name, `${r.bestSigning.fee ? formatMoney(r.bestSigning.fee) : t('career.hl.free')} · ${t('career.hl.line', { apps: r.bestSigning.apps, g: r.bestSigning.goals, a: r.bestSigning.assists })}`));
  if (r.bestWin) items.push(fact(t('career.hl.bestWin'), `${r.bestWin.gf}-${r.bestWin.ga} ${r.bestWin.opponent}`, `${r.bestWin.season} · ${r.bestWin.comp ?? ''} · ${r.bestWin.home ? t('career.hl.home') : t('career.hl.away')}`));
  if (r.worstLoss) items.push(fact(t('career.hl.worstLoss'), `${r.worstLoss.gf}-${r.worstLoss.ga} ${r.worstLoss.opponent}`, `${r.worstLoss.season} · ${r.worstLoss.comp ?? ''}`));
  if (r.bestStreak) items.push(fact(t('career.hl.streak'), t('career.hl.streakCount', { n: r.bestStreak.count }), r.bestStreak.season));
  for (const rv of r.rivals.slice(0, 2)) items.push(fact(rivalryName(rv.rivalry), t('career.wdl', { w: rv.w, d: rv.d, l: rv.l }), t('career.hl.rival', { team: rv.name, gf: rv.gf, ga: rv.ga })));
  return items.length ? h('dl', { class: 'cc-facts' }, items) : h('p', { class: 'muted' }, t('career.hl.empty'));
}

export function render(ctx) {
  const host = h('div', { class: 'career-end' }, h('p', { class: 'muted' }, t('career.loading')));
  Promise.all([loadCareerText(), loadMedia().catch(() => null)]).then(([text, media]) => {
    const { game, dataset } = ctx;
    if (!game?.history?.length) {
      host.replaceChildren(h('div', { class: 'panel empty' }, h('p', {}, t('career.empty'))));
      return;
    }
    const r = careerReview(game, { rivalryOf: (a, b) => rivalryBetween(media, a, b) });
    const title = text?.titles?.[r.titleId] ?? { label: t('career.titleFallback'), summary: '', board: [], fans: [], captain: [] };
    const team = dataset.teamById.get(game.teamId);
    // 부임 기록 (경질·이직): 연속으로 같은 구단은 한 번만
    const clubs = (game.jobs ?? []).map((j) => dataset.teamById.get(j.teamId)?.shortName ?? j.teamId).filter((n, i, a) => i === 0 || a[i - 1] !== n);
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
        h('p', { class: 'cc-sub' }, t('career.hero.sub', { team: team.name, span: last !== first ? `${first.season} ~ ${last.season}` : first.season, n: r.seasons.length })),
        title.summary ? h('p', { class: 'muted' }, title.summary) : null,
        clubs.length > 1 ? h('p', { class: 'cc-clubs muted' }, t('career.hero.clubs', { clubs: clubs.join(' → ') })) : null,
      ),
      h('div', { class: `cc-grade grade-${r.grade}`, 'aria-label': t('career.grade.aria', { grade: r.grade, score: r.score }) }, h('span', { class: 'cc-grade-letter' }, r.grade), h('span', { class: 'cc-grade-score' }, t('career.grade.score', { score: r.score }))),
    );

    const stats = h(
      'section',
      { class: 'cc-stats reveal', style: { '--i': 1 } },
      [
        [t('career.stat.played'), `${r.totals.played}`, t('career.wdl', { w: r.totals.won, d: r.totals.drawn, l: r.totals.lost })],
        [t('career.stat.winRate'), pct(r.totals.winRate), t('career.stat.goals', { gf: r.totals.goalsFor, ga: r.totals.goalsAgainst })],
        [t('career.stat.trophies'), t('career.stat.trophyCount', { n: r.totals.trophies.length }), r.counts.promotions ? t('career.stat.promotions', { n: r.counts.promotions }) : null],
        [t('career.stat.best'), r.totals.bestFinish ? t('career.pos', { n: r.totals.bestFinish.position }) : '—', r.totals.bestFinish ? `${r.totals.bestFinish.season} ${r.totals.bestFinish.leagueName}` : null],
        [t('career.stat.overPerf'), t('career.stat.overValue', { v: signed(r.avgOver) }), t('career.stat.overNote')],
      ].map(([label, value, sub]) => h('div', { class: 'cc-stat' }, h('span', { class: 'muted' }, label), h('b', {}, value), sub ? h('span', { class: 'muted small-note' }, sub) : null)),
    );

    const cabinet = h(
      'section',
      { class: 'cc-section reveal', style: { '--i': 2 } },
      h('h2', {}, t('career.cabinet.title')),
      r.totals.trophies.length
        ? h('ul', { class: 'cc-trophies' }, r.totals.trophies.map((x) => h('li', { class: `cc-trophy ${x.kind}` }, trophyIcon(x.kind), h('b', {}, x.name), h('span', { class: 'muted' }, x.season))))
        : h('p', { class: 'muted' }, r.counts.promotions ? t('career.cabinet.promotionOnly') : t('career.cabinet.empty')),
    );

    const chart = h('section', { class: 'cc-section reveal', style: { '--i': 3 } }, h('h2', {}, t('career.chart.title')), positionChart(r.seasons, chartTiers(dataset, r.seasons)), seasonTable(r.seasons));
    const facts = h('section', { class: 'cc-section reveal', style: { '--i': 4 } }, h('h2', {}, t('career.hl.title')), highlights(r));

    const quote = (who, line) => (line ? h('figure', { class: 'cc-quote' }, h('blockquote', {}, line), h('figcaption', {}, who)) : null);
    const quotes = h(
      'section',
      { class: 'cc-section reveal', style: { '--i': 5 } },
      h('h2', {}, t('career.quotes.title')),
      h('div', { class: 'cc-quotes' }, quote(t('career.quotes.board'), pickLine(title.board)), quote(t('career.quotes.fans'), pickLine(title.fans)), quote(r.mostApps ? t('career.quotes.mostApps', { name: r.mostApps.name }) : t('career.quotes.captain'), pickLine(title.captain))),
    );

    const card = h('button', { class: 'btn', type: 'button' }, t('career.card.save'));
    card.addEventListener('click', async () => {
      card.disabled = true;
      try {
        await saveCareerCard({ review: r, title, team, quote: pickLine(title.fans) });
        showToast(t('career.card.saved'));
      } catch (err) {
        console.error(err);
        showToast(t('career.card.failed'), { tone: 'warn' });
      } finally {
        card.disabled = false;
      }
    });
    const more = h('button', { class: 'btn primary', type: 'button' }, t('career.action.oneMore'));
    more.addEventListener('click', () => {
      ctx.game.years = Math.max(ctx.game.years, ctx.game.seasonIndex) + 1;
      ctx.persist();
      ctx.refreshTopbar();
      ctx.navigate('match');
    });
    const fresh = h('button', { class: 'btn ghost', type: 'button' }, t('career.action.newGame'));
    fresh.addEventListener('click', () => ctx.leaveToSelect());
    const back = h('button', { class: 'btn ghost', type: 'button' }, t('career.action.history'));
    back.addEventListener('click', () => ctx.navigate('history'));
    const actions = h(
      'section',
      { class: 'cc-actions reveal', style: { '--i': 6 } },
      finished ? null : h('p', { class: 'muted' }, t('career.ongoing', { i: game.seasonIndex, n: game.years })),
      h('div', { class: 'btn-row' }, back, card, finished ? fresh : null, finished ? more : null),
    );

    host.replaceChildren(hero, stats, cabinet, chart, facts, quotes, actions);
  });
  return host;
}
