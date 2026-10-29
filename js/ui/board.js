// 이사회 화면 조각: 경기 전 목표·신뢰도 줄, 경질 통보와 제의 구단, 시즌 끝 평가와 제안 (state/board.js)
import { boardOf, acceptOffer, confidenceLabel } from '../state/board.js';
import { BOARD } from '../state/boardConfig.js';
import { squadOf } from '../state/game.js';
import { topElevenOvr, formatMoney } from '../market/value.js';
import { loadBoardText } from '../media/boardText.js';
import { pickTalk } from '../media/talks.js';
import { teamBadge } from './badge.js';
import { panel } from './components.js';
import { h } from './dom.js';
import { showToast } from './motion.js';

const textVars = (ctx, extra = {}) => {
  const b = boardOf(ctx.game);
  return { team: ctx.dataset.teamById.get(ctx.game.teamId)?.shortName ?? '', target: b.objective?.target ?? '', goal: b.objective?.label ?? '', ...extra };
};

// 경기 전 한 줄: 이사회 목표 · 신뢰도 막대
export function boardLine(ctx) {
  const b = boardOf(ctx.game);
  if (!b.objective) return null;
  const c = Math.round(b.confidence);
  return h(
    'div',
    { class: 'board-line', title: '이사회 신뢰도: 리그 순위와 목표의 차이, 경기 결과로 오르내립니다. 바닥나면 경질됩니다.' },
    h('span', { class: 'muted' }, '이사회 목표 '),
    h('b', {}, b.objective.label),
    h('span', { class: 'muted' }, ' · 신뢰도 '),
    h('span', { class: `board-bar lv-${c >= 60 ? 'good' : c >= 35 ? 'ok' : 'bad'}`, style: { '--v': `${c}%` } }),
    h('b', {}, ` ${confidenceLabel(ctx.game)}`),
  );
}

// 제의 구단 카드 목록. onPick(teamId)
function offerCards(ctx, offers, lines, onPick, buttonLabel) {
  const { dataset, game } = ctx;
  return h(
    'div',
    { class: 'offer-cards' },
    offers.map((id, i) => {
      const t = dataset.teamById.get(id);
      const league = dataset.leagueById.get(t.leagueId);
      const ranked = league.teamIds.map((x) => [x, topElevenOvr(squadOf(dataset, game, x))]).sort((a, b) => b[1] - a[1]);
      const rank = ranked.findIndex(([x]) => x === id) + 1;
      const pick = h('button', { class: 'btn primary small', type: 'button' }, buttonLabel);
      pick.addEventListener('click', () => onPick(id));
      return h(
        'div',
        { class: 'offer-card' },
        h('div', { class: 'offer-head' }, teamBadge(t, 40), h('div', {}, h('b', {}, t.name), h('span', { class: 'muted' }, `${league.name} · 전력 ${rank}위 / ${league.teamIds.length}팀`))),
        h('p', { class: 'offer-letter' }, pickTalk(lines, `${game.seed}:${id}:${i}`, { club: t.shortName, league: league.name })),
        h('p', { class: 'muted small-note' }, `잔고 ${formatMoney(game.budgets?.[id] ?? 0)}`),
        pick,
      );
    }),
  );
}

// 경질 이유 (사실만: 목표·순위·최근 흐름). 숫자 신뢰도는 보여 주지 않는다
function sackReasonText(reason) {
  if (!reason) return '';
  const parts = [`목표는 ${reason.goal}였지만 ${reason.position}위에 머물렀습니다.`];
  const r = reason.recent;
  if (r?.played >= 4) parts.push(r.w <= 1 ? `최근 ${r.played}경기 ${r.w}승 ${r.d}무 ${r.l}패, 흐름을 되돌리지 못했습니다.` : `최근 ${r.played}경기 ${r.w}승 ${r.d}무 ${r.l}패였지만 이사회의 인내심이 먼저 바닥났습니다.`);
  return parts.join(' ');
}

// 신뢰 변화 → 말
const trustShift = (d) => (d >= 15 ? '이사회의 신뢰가 크게 깊어졌습니다' : d > 0 ? '이사회의 신뢰가 조금 깊어졌습니다' : d <= -25 ? '이사회의 신뢰가 크게 흔들렸습니다' : d < 0 ? '이사회의 신뢰가 조금 줄었습니다' : '이사회의 신뢰는 그대로입니다');

// 시즌 중 경질: 경기 화면 대신 보여준다. done() → 부임 뒤 화면 다시 그리기
export function sackedPanel(ctx, done) {
  const host = h('div', { class: 'board-sacked' }, h('p', { class: 'muted' }, '…'));
  loadBoardText().then((text) => {
    const b = boardOf(ctx.game);
    const offers = b.sacked?.offers ?? [];
    host.replaceChildren(
      panel(
        '이사회 통보',
        h(
          'div',
          { class: 'board-letter' },
          h('h2', {}, '경질'),
          h('p', {}, pickTalk(text?.sacked, `${ctx.game.seed}:${ctx.game.seasonIndex}:${ctx.game.round}`, textVars(ctx)) || '이사회가 계약 해지를 결정했습니다.'),
          h('p', { class: 'board-reason' }, sackReasonText(b.sacked?.reason) || `목표 ${b.objective?.label ?? ''}`),
        ),
      ),
      panel(
        '새 구단의 제의',
        h(
          'div',
          { class: 'board-offers' },
          h('p', { class: 'muted' }, offers.length ? '아래 구단 중 한 곳을 골라 지휘봉을 잡으면 이번 시즌을 이어 갑니다.' : '제의가 없습니다.'),
          offerCards(ctx, offers, text?.sackedOffer, (id) => {
            acceptOffer(ctx.dataset, ctx.game, id);
            ctx.persist();
            ctx.rebuildTopbar?.();
            showToast(pickTalk(text?.welcome, `${ctx.game.seed}:${id}`, { club: ctx.dataset.teamById.get(id).shortName }) || '새 구단에 부임했습니다');
            done();
          }, '이 구단으로'),
        ),
      ),
    );
  });
  return host;
}

// 시즌 끝: 이사회 평가 + (경질이면 필수) 제의 구단 / (잘했으면) 이직 제안
export function seasonBoardPanel(ctx, redraw) {
  const host = h('div', {});
  loadBoardText().then((text) => {
    const { game, dataset } = ctx;
    const b = boardOf(game);
    const e = b.seasonEval;
    if (!e && !b.sacked && !b.pendingMove) return;
    const vars = textVars(ctx, { position: e?.position ?? '', target: e?.target ?? '', goal: e?.label ?? '' });
    const parts = [];
    if (e) {
      const verdictLabel = { exceeded: '목표 초과 달성', met: '목표 달성', missedSlightly: '목표에 조금 못 미침', missedBadly: '목표 실패' }[e.verdict];
      parts.push(h('div', { class: 'board-eval' }, h('b', {}, verdictLabel), h('span', { class: 'muted' }, ` · 목표 ${e.label} → ${e.position}위 · ${b.sacked ? '이사회가 결단을 내렸습니다' : trustShift(e.delta)}`)));
      // 경질이면 '다음 시즌 기대' 같은 평가 문장은 빼고 통보만 (메시지가 서로 어긋나지 않게)
      if (!b.sacked) parts.push(h('p', { class: 'board-quote' }, pickTalk(text?.season?.[e.verdict], `${game.seed}:${game.seasonIndex}:eval`, vars)));
      else if (b.sacked.reason) parts.push(h('p', { class: 'board-reason' }, sackReasonText(b.sacked.reason)));
    }
    const pending = b.pendingMove ? dataset.teamById.get(b.pendingMove.teamId) : null;
    if (pending) {
      const cancel = h('button', { class: 'btn small ghost', type: 'button' }, '취소');
      cancel.addEventListener('click', () => {
        b.offers = b.offers ?? [b.pendingMove.teamId];
        if (b.pendingMove.reason === 'sacked') b.sacked = { midSeason: false, offers: b.lastOffers ?? [b.pendingMove.teamId] };
        b.pendingMove = null;
        ctx.persist();
        redraw();
      });
      parts.push(h('div', { class: 'board-pending' }, teamBadge(pending, 28), h('span', {}, `다음 시즌부터 `, h('b', {}, pending.name), ' 지휘봉을 잡습니다.'), cancel));
    } else if (b.sacked) {
      parts.push(
        h('p', { class: 'board-quote bad' }, pickTalk(text?.sacked, `${game.seed}:${game.seasonIndex}:end`, vars)),
        h('p', { class: 'muted' }, '경질됐습니다. 다음 시즌에 지휘할 구단을 골라야 이어 갈 수 있습니다.'),
        offerCards(ctx, b.sacked.offers, text?.sackedOffer, (id) => pick(id), '이 구단으로'),
      );
    } else if (b.offers?.length) {
      parts.push(h('h3', {}, '다른 구단의 제안'), offerCards(ctx, b.offers, text?.offer, (id) => pick(id), '수락 (다음 시즌부터)'), h('p', { class: 'muted small-note' }, '수락하지 않으면 지금 구단에 남습니다.'));
    }
    function pick(id) {
      b.lastOffers = b.sacked?.offers ?? b.offers;
      acceptOffer(dataset, game, id);
      ctx.persist();
      redraw();
    }
    host.replaceChildren(panel('이사회', h('div', { class: 'board-season' }, parts)));
  });
  return host;
}

export const mustChooseClub = (game) => Boolean(game.board?.sacked);
export { BOARD };
