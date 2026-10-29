// 이사회 화면 조각: 경기 전 목표·신뢰도 줄, 경질 통보와 제의 구단, 시즌 끝 평가와 제안 (state/board.js)
import { t } from '../i18n.js';
import { boardOf, acceptOffer, confidenceLabel, objectiveLabel } from '../state/board.js';
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
  return { team: ctx.dataset.teamById.get(ctx.game.teamId)?.shortName ?? '', target: b.objective?.target ?? '', goal: objectiveLabel(b.objective), ...extra };
};

// 경기 전 한 줄: 이사회 목표 · 신뢰도 막대
export function boardLine(ctx) {
  const b = boardOf(ctx.game);
  if (!b.objective) return null;
  const c = Math.round(b.confidence);
  return h(
    'div',
    { class: 'board-line', title: t('board.line.title') },
    h('span', { class: 'muted' }, t('board.line.goal')),
    h('b', {}, objectiveLabel(b.objective)),
    h('span', { class: 'muted' }, t('board.line.confidence')),
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
      const team = dataset.teamById.get(id);
      const league = dataset.leagueById.get(team.leagueId);
      const ranked = league.teamIds.map((x) => [x, topElevenOvr(squadOf(dataset, game, x))]).sort((a, b) => b[1] - a[1]);
      const rank = ranked.findIndex(([x]) => x === id) + 1;
      const pick = h('button', { class: 'btn primary small', type: 'button' }, buttonLabel);
      pick.addEventListener('click', () => onPick(id));
      return h(
        'div',
        { class: 'offer-card' },
        h('div', { class: 'offer-head' }, teamBadge(team, 40), h('div', {}, h('b', {}, team.name), h('span', { class: 'muted' }, t('board.offer.strength', { league: league.name, rank, n: league.teamIds.length })))),
        h('p', { class: 'offer-letter' }, pickTalk(lines, `${game.seed}:${id}:${i}`, { club: team.shortName, league: league.name })),
        h('p', { class: 'muted small-note' }, t('board.offer.balance', { money: formatMoney(game.budgets?.[id] ?? 0) })),
        pick,
      );
    }),
  );
}

// 경질 이유 (사실만: 목표·순위·최근 흐름). 숫자 신뢰도는 보여 주지 않는다
// 목표는 goalKind·target으로 지금 언어에 맞게 (예전 세이브는 저장된 goal 문자열)
function sackReasonText(reason) {
  if (!reason) return '';
  const goal = objectiveLabel({ kind: reason.goalKind, target: reason.target, label: reason.goal });
  const parts = [t('board.sack.reason', { goal, position: reason.position })];
  const r = reason.recent;
  if (r?.played >= 4) parts.push(t(r.w <= 1 ? 'board.sack.recentBad' : 'board.sack.recentPatience', { n: r.played, w: r.w, d: r.d, l: r.l }));
  return parts.join(' ');
}

// 신뢰 변화 → 말
const trustShift = (d) => t(`board.trust.${d >= 15 ? 'upBig' : d > 0 ? 'up' : d <= -25 ? 'downBig' : d < 0 ? 'down' : 'same'}`);

// 시즌 중 경질: 경기 화면 대신 보여준다. done() → 부임 뒤 화면 다시 그리기
export function sackedPanel(ctx, done) {
  const host = h('div', { class: 'board-sacked' }, h('p', { class: 'muted' }, '…'));
  loadBoardText().then((text) => {
    const b = boardOf(ctx.game);
    const offers = b.sacked?.offers ?? [];
    host.replaceChildren(
      panel(
        t('board.sacked.panel'),
        h(
          'div',
          { class: 'board-letter' },
          h('h2', {}, t('board.sacked.title')),
          h('p', {}, pickTalk(text?.sacked, `${ctx.game.seed}:${ctx.game.seasonIndex}:${ctx.game.round}`, textVars(ctx)) || t('board.sacked.fallback')),
          h('p', { class: 'board-reason' }, sackReasonText(b.sacked?.reason) || t('board.sacked.goal', { goal: objectiveLabel(b.objective) })),
        ),
      ),
      panel(
        t('board.sacked.offersPanel'),
        h(
          'div',
          { class: 'board-offers' },
          h('p', { class: 'muted' }, t(offers.length ? 'board.sacked.offersHint' : 'board.sacked.noOffers')),
          offerCards(ctx, offers, text?.sackedOffer, (id) => {
            acceptOffer(ctx.dataset, ctx.game, id);
            ctx.persist();
            ctx.rebuildTopbar?.();
            showToast(pickTalk(text?.welcome, `${ctx.game.seed}:${id}`, { club: ctx.dataset.teamById.get(id).shortName }) || t('board.sacked.welcomeFallback'));
            done();
          }, t('board.offer.take')),
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
    const vars = textVars(ctx, { position: e?.position ?? '', target: e?.target ?? '', goal: e ? objectiveLabel(e) : '' });
    const parts = [];
    if (e) {
      const verdictLabel = t(`board.verdict.${e.verdict}`);
      parts.push(h('div', { class: 'board-eval' }, h('b', {}, verdictLabel), h('span', { class: 'muted' }, t('board.eval.line', { goal: objectiveLabel(e), position: e.position, shift: b.sacked ? t('board.eval.sacked') : trustShift(e.delta) }))));
      // 경질이면 '다음 시즌 기대' 같은 평가 문장은 빼고 통보만 (메시지가 서로 어긋나지 않게)
      if (!b.sacked) parts.push(h('p', { class: 'board-quote' }, pickTalk(text?.season?.[e.verdict], `${game.seed}:${game.seasonIndex}:eval`, vars)));
      else if (b.sacked.reason) parts.push(h('p', { class: 'board-reason' }, sackReasonText(b.sacked.reason)));
    }
    const pending = b.pendingMove ? dataset.teamById.get(b.pendingMove.teamId) : null;
    if (pending) {
      const cancel = h('button', { class: 'btn small ghost', type: 'button' }, t('board.pending.cancel'));
      cancel.addEventListener('click', () => {
        b.offers = b.offers ?? [b.pendingMove.teamId];
        if (b.pendingMove.reason === 'sacked') b.sacked = { midSeason: false, offers: b.lastOffers ?? [b.pendingMove.teamId] };
        b.pendingMove = null;
        ctx.persist();
        redraw();
      });
      parts.push(h('div', { class: 'board-pending' }, teamBadge(pending, 28), h('span', {}, t('board.pending.before'), h('b', {}, pending.name), t('board.pending.after')), cancel));
    } else if (b.sacked) {
      parts.push(
        h('p', { class: 'board-quote bad' }, pickTalk(text?.sacked, `${game.seed}:${game.seasonIndex}:end`, vars)),
        h('p', { class: 'muted' }, t('board.season.sackedHint')),
        offerCards(ctx, b.sacked.offers, text?.sackedOffer, (id) => pick(id), t('board.offer.take')),
      );
    } else if (b.offers?.length) {
      parts.push(h('h3', {}, t('board.season.offersTitle')), offerCards(ctx, b.offers, text?.offer, (id) => pick(id), t('board.season.accept')), h('p', { class: 'muted small-note' }, t('board.season.stayHint')));
    }
    function pick(id) {
      b.lastOffers = b.sacked?.offers ?? b.offers;
      acceptOffer(dataset, game, id);
      ctx.persist();
      redraw();
    }
    host.replaceChildren(panel(t('board.season.panel'), h('div', { class: 'board-season' }, parts)));
  });
  return host;
}

export const mustChooseClub = (game) => Boolean(game.board?.sacked);
export { BOARD };
